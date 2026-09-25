/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! On-device LLM explanation service exposed to Gecko as the XPCOM service
//! `@mozilla.org/northgate/llm;1` (`nsINorthGateLLM`).
//!
//! `explainVerdict()` dispatches to the shared XPCOM background thread pool
//! so inference never blocks the caller; the result is delivered back to
//! the calling thread via `nsINorthGateLLMCallback`.

#[macro_use]
extern crate cstr;
#[macro_use]
extern crate xpcom;

use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use moz_task::{DispatchOptions, Task, TaskRunnable, ThreadPtrHandle, ThreadPtrHolder};
use nserror::{nsresult, NS_ERROR_FAILURE, NS_OK};
use nsstring::{nsACString, nsCString};
use thin_vec::ThinVec;
use xpcom::interfaces::{nsINorthGateLLM, nsINorthGateLLMCallback};
use xpcom::{nsIID, xpcom_method, RefPtr};

use northgate_llm_prompt::{build_prompt, clean_response, Verdict};

mod engine;
use engine::Engine;

const MAX_RESPONSE_CHARS: usize = 800;
const MAX_TOKENS: usize = 200;
/// Per design spec: generation is bounded to ~15s so a slow machine never
/// hangs the caller. `Engine::generate()` cannot be preempted mid-call, so
/// this is only a deadline check after it returns: it cannot interrupt a hung
/// call, and it discards a valid-but-slow result. A real timeout needs a
/// cancellation/deadline check inside the (not yet written) decode loop in
/// engine.rs; see LLM_INTEGRATION.md.
const GENERATION_TIMEOUT_SECS: u64 = 15;

struct ExplainTask {
    verdict: Verdict,
    model_path: String,
    callback: ThreadPtrHandle<nsINorthGateLLMCallback>,
    result: Mutex<Option<Result<String, String>>>,
}

impl Task for ExplainTask {
    fn run(&self) {
        // Runs on the shared background thread pool.
        //
        // `catch_unwind` is defense in depth only: Gecko builds Rust with
        // `panic = "abort"`, so a panic aborts the process before it could be
        // caught here. Everything on this path must return `Err`, never panic.
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            let engine = Engine::load(&self.model_path)
                .map_err(|e| format!("model load failed: {e:?}"))?;
            let prompt = build_prompt(&self.verdict);
            let deadline_start = Instant::now();
            let raw = engine
                .generate(&prompt, MAX_TOKENS)
                .map_err(|e| format!("generation failed: {e:?}"))?;
            if deadline_start.elapsed() > Duration::from_secs(GENERATION_TIMEOUT_SECS) {
                return Err(format!(
                    "generation exceeded {GENERATION_TIMEOUT_SECS}s timeout"
                ));
            }
            Ok(clean_response(&raw, MAX_RESPONSE_CHARS))
        }))
        .unwrap_or_else(|_| Err("panic during inference".to_string()));

        *self.result.lock().unwrap() = Some(outcome);
    }

    fn done(&self) -> Result<(), nsresult> {
        // Runs back on the thread that dispatched us (the main thread).
        let callback = self.callback.get().ok_or(NS_ERROR_FAILURE)?;
        match self.result.lock().unwrap().take() {
            Some(Ok(text)) => unsafe {
                callback.OnResult(&*nsCString::from(text));
            },
            Some(Err(message)) => unsafe {
                callback.OnError(&*nsCString::from(message));
            },
            None => unsafe {
                callback.OnError(&*nsCString::from("internal error: no result produced"));
            },
        }
        Ok(())
    }
}

#[xpcom(implement(nsINorthGateLLM), atomic)]
struct NorthGateLLM {}

impl NorthGateLLM {
    fn new() -> RefPtr<NorthGateLLM> {
        NorthGateLLM::allocate(InitNorthGateLLM {})
    }

    xpcom_method!(
        explain_verdict => ExplainVerdict(
            verdict: *const nsACString,
            probability: f64,
            reasons: *const ThinVec<nsCString>,
            model_path: *const nsACString,
            callback: *const nsINorthGateLLMCallback
        )
    );
    fn explain_verdict(
        &self,
        verdict: &nsACString,
        probability: f64,
        reasons: &ThinVec<nsCString>,
        model_path: &nsACString,
        callback: &nsINorthGateLLMCallback,
    ) -> Result<(), nsresult> {
        let verdict = Verdict {
            label: std::str::from_utf8(verdict)
                .map_err(|_| NS_ERROR_FAILURE)?
                .to_string(),
            probability,
            reasons: reasons
                .iter()
                .map(|r| String::from_utf8_lossy(r).to_string())
                .collect(),
        };
        let model_path = std::str::from_utf8(model_path)
            .map_err(|_| NS_ERROR_FAILURE)?
            .to_string();

        let callback_handle =
            ThreadPtrHolder::new(cstr!("nsINorthGateLLMCallback"), RefPtr::new(callback))
                .map_err(|_| NS_ERROR_FAILURE)?;

        let task = ExplainTask {
            verdict,
            model_path,
            callback: callback_handle,
            result: Mutex::new(None),
        };

        // Dispatch to the shared XPCOM background thread pool rather than a
        // dedicated per-call thread: a thread created via
        // `moz_task::create_thread` keeps running (leaking the OS thread)
        // until explicitly shut down, and nothing here ever shuts it down.
        // Inference blocks on CPU/model-file I/O, so mark it `may_block` per
        // `DispatchOptions::may_block`'s doc comment.
        TaskRunnable::new("NorthGateLLM::ExplainTask", Box::new(task))?
            .dispatch_background_task_with_options(DispatchOptions::new().may_block(true))?;
        Ok(())
    }
}

/// # Safety
/// `result` must be a valid out-pointer supplied by the XPCOM component
/// manager.
#[no_mangle]
pub unsafe extern "C" fn nsNorthGateLLMConstructor(
    iid: &nsIID,
    result: *mut *mut c_void,
) -> nsresult {
    let instance = NorthGateLLM::new();
    let rv = instance.QueryInterface(iid, result);
    if rv.failed() {
        return rv;
    }
    NS_OK
}
