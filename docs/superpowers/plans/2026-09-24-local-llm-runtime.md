# Local LLM Runtime + Enriched Alert Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local LLM inference runtime to NorthGate and use it for one feature: an on-demand, natural-language explanation of the phishing classifier's verdict, shown in `about:northgate`.

**Architecture:** A new Rust XPCOM service (`northgate_llm`, mirroring the existing `northgate_classifier`) runs llama.cpp-backed inference on a dedicated background thread in the parent process, invoked via a callback interface from `AboutNorthGateParent`. A new JS module (`NorthGateLLMManager.sys.mjs`) owns the one-time, checksum-verified download of the quantized model into the user's profile directory. The prompt-building and response-cleanup logic lives in a small, dependency-free Rust crate (`northgate_llm_prompt`) so it can be unit-tested with plain `cargo test`, independent of the Gecko build.

**Tech Stack:** Rust (xpcom-rust, llama.cpp via `llama-cpp-2` bindings, vendored + built via `cmake` in `build.rs`), JS ES Modules (`JSWindowActor`, `IOUtils`, `nsICryptoHash`), Fluent (`.ftl`), xpcshell tests.

**Spec:** `docs/superpowers/specs/2026-09-24-local-llm-runtime-design.md`

## Global Constraints

- Inference is never on the navigation-blocking path — `NorthGateNavGuard` continues to depend only on `nsINorthGateClassifier`. If the LLM is unavailable, the dashboard's classifier verdict is unaffected.
- The only network request this feature ever makes is the one-time model download, only after explicit user consent, only on first use of "Explicar".
- No raw page content, HTML, or script source is ever sent to the LLM in this plan — only the already-extracted `{verdict, probability, reasons}` shape already computed by `NorthGateClassifier.classify()` and already rendered by the dashboard today.
- The model is downloaded into the profile directory (`<profile>/northgate/models/`), never embedded in the binary, never written before its SHA-256 matches the pinned expected value.
- Generation is bounded: ~200 output tokens max, ~15s timeout.
- Follow existing project conventions: MPL-2.0 header on every new file (copy verbatim from `nsINorthGateClassifier.idl`), `BUG_COMPONENT = ("NorthGate", ...)` in new `moz.build` files, minimal comments (only on non-obvious code, per `AGENTS.md`).

---

## File Structure

New files:

- `toolkit/components/northgate-llm-prompt/Cargo.toml` — standalone, dependency-free crate for prompt/response logic.
- `toolkit/components/northgate-llm-prompt/src/lib.rs` — `build_prompt()`, `clean_response()`.
- `toolkit/components/northgate-llm/Cargo.toml` — the XPCOM service crate (depends on `northgate-llm-prompt`, `xpcom`, `nserror`, `nsstring`, `moz_task`, and later the llama.cpp bindings).
- `toolkit/components/northgate-llm/moz.build`
- `toolkit/components/northgate-llm/components.conf`
- `toolkit/components/northgate-llm/nsINorthGateLLM.idl`
- `toolkit/components/northgate-llm/src/lib.rs` — XPCOM glue: `explainVerdict()`, background-thread dispatch, callback invocation.
- `toolkit/components/northgate-llm/src/engine.rs` — model loading + generation; stub in Task 4, llama.cpp-backed in Task 8.
- `toolkit/components/northgate-llm/build.rs` — cmake build of vendored llama.cpp (Task 8).
- `toolkit/components/northgate-llm/vendor/llama.cpp/` — vendored llama.cpp source (Task 8).
- `toolkit/components/northgate-llm/LLM_INTEGRATION.md` — build/verification checklist, mirrors `toolkit/components/northgate/INTEGRATION.md`.
- `browser/components/northgate-browser/NorthGateLLMManager.sys.mjs` — model state machine + download + checksum verification.
- `browser/components/northgate-browser/test/xpcshell/xpcshell.toml`
- `browser/components/northgate-browser/test/xpcshell/test_NorthGateLLMManager.js`

Modified files:

- `toolkit/library/rust/shared/Cargo.toml` — register `northgate_llm`.
- `toolkit/library/rust/shared/lib.rs` — `extern crate northgate_llm;`.
- `browser/components/northgate-browser/AboutNorthGateParent.sys.mjs` — new message handlers for LLM state/download/explain.
- `browser/components/northgate-browser/AboutNorthGateChild.sys.mjs` — relay the new messages.
- `browser/components/northgate-browser/content/aboutNorthGate.js` — "Explicar" button wiring, consent/progress/result rendering.
- `browser/components/northgate-browser/content/aboutNorthGate.html` — new UI elements.
- `browser/components/northgate-browser/content/aboutNorthGate.css` — styling for the new elements.
- `browser/components/northgate-browser/moz.build` — register the new `.sys.mjs` file and the xpcshell test manifest.
- `browser/locales/en-US/browser/aboutNorthGate.ftl` — new strings.
- `README.md`, `src/THREAT_MODEL.md` — document the download exception (paths relative to repo root; `THREAT_MODEL.md` lives at `src/THREAT_MODEL.md`, so edit it from the repo root, not from inside `src/`).

---

### Task 1: Publish the quantized model as a GitHub Release asset

**Files:** none (produces the constants Task 4 and Task 5 hardcode).

**Interfaces:**
- Produces: a pinned download URL and SHA-256 checksum, used verbatim as `MODEL_URL` / `MODEL_SHA256` in Task 5, and as the expected filename in Task 4/8.

- [ ] **Step 1: Download the pre-quantized model from Hugging Face**

```bash
mkdir -p /tmp/northgate-llm-model && cd /tmp/northgate-llm-model
curl -L -o qwen2.5-1.5b-instruct-q4_k_m.gguf \
  "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
```

- [ ] **Step 2: Compute its SHA-256**

```bash
sha256sum qwen2.5-1.5b-instruct-q4_k_m.gguf
```

Record the printed hash — it is `MODEL_SHA256` in later tasks.

- [ ] **Step 3: Create a dedicated GitHub Release to host the asset**

```bash
gh release create llm-model-v1 \
  --repo eduolihez/northgate-browser \
  --title "NorthGate LLM model v1 (Qwen2.5-1.5B-Instruct, Q4_K_M)" \
  --notes "Quantized GGUF model for the local alert-explanation feature. Not part of the browser installer; downloaded on demand from about:northgate." \
  qwen2.5-1.5b-instruct-q4_k_m.gguf
```

- [ ] **Step 4: Verify the published asset's checksum matches**

```bash
curl -L -o /tmp/verify.gguf \
  "https://github.com/eduolihez/northgate-browser/releases/download/llm-model-v1/qwen2.5-1.5b-instruct-q4_k_m.gguf"
sha256sum /tmp/verify.gguf
```

Confirm the hash matches Step 2's output exactly. This is the value that goes into `MODEL_SHA256` in Task 5 — if it doesn't match, the upload was corrupted; redo Step 3.

- [ ] **Step 5: Record the constants for later tasks**

```
MODEL_URL    = https://github.com/eduolihez/northgate-browser/releases/download/llm-model-v1/qwen2.5-1.5b-instruct-q4_k_m.gguf
MODEL_SHA256 = <hash from Step 4>
MODEL_FILENAME = qwen2.5-1.5b-instruct-q4_k_m.gguf
```

No commit for this task — nothing in the repo changes yet.

---

### Task 2: `northgate-llm-prompt` crate — prompt builder (TDD)

**Files:**
- Create: `toolkit/components/northgate-llm-prompt/Cargo.toml`
- Create: `toolkit/components/northgate-llm-prompt/src/lib.rs`

**Interfaces:**
- Produces: `pub struct Verdict { pub label: String, pub probability: f64, pub reasons: Vec<String> }` and `pub fn build_prompt(verdict: &Verdict) -> String`, consumed by Task 4's `northgate-llm` crate.

- [ ] **Step 1: Create the crate manifest**

```toml
# toolkit/components/northgate-llm-prompt/Cargo.toml
[package]
name = "northgate_llm_prompt"
version = "0.1.0"
authors = ["The NorthGate Project"]
edition = "2021"
license = "MPL-2.0"
description = "Dependency-free prompt construction and response cleanup for the NorthGate local LLM explanation feature."

[lib]
path = "src/lib.rs"
```

No dependencies on `xpcom` or anything Gecko-specific — this crate must build and test with plain `cargo test`, independent of a Gecko checkout.

- [ ] **Step 2: Write the failing test for prompt construction**

```rust
// toolkit/components/northgate-llm-prompt/src/lib.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_deterministic_prompt_for_dangerous_verdict() {
        let verdict = Verdict {
            label: "dangerous".to_string(),
            probability: 0.87,
            reasons: vec![
                "Uses a raw IP address instead of a domain name.".to_string(),
                "Contains words often used to imitate logins or brands.".to_string(),
            ],
        };
        let prompt = build_prompt(&verdict);
        assert!(prompt.contains("dangerous"));
        assert!(prompt.contains("87%"));
        assert!(prompt.contains("Uses a raw IP address instead of a domain name."));
        assert!(prompt.contains("Contains words often used to imitate logins or brands."));
    }

    #[test]
    fn builds_prompt_with_no_reasons() {
        let verdict = Verdict {
            label: "safe".to_string(),
            probability: 0.02,
            reasons: vec![],
        };
        let prompt = build_prompt(&verdict);
        assert!(prompt.contains("safe"));
        assert!(prompt.contains("no specific suspicious traits"));
    }
}
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
cd toolkit/components/northgate-llm-prompt
cargo test
```

Expected: compile error — `Verdict` and `build_prompt` don't exist yet.

- [ ] **Step 4: Implement `Verdict` and `build_prompt`**

```rust
// toolkit/components/northgate-llm-prompt/src/lib.rs (above the tests module)

/// The classifier's already-computed verdict for one page, exactly as shown
/// today in about:northgate. No raw URL, HTML, or script content is ever
/// part of this — only categorical/numeric signals already surfaced to the
/// user.
pub struct Verdict {
    pub label: String,
    pub probability: f64,
    pub reasons: Vec<String>,
}

pub fn build_prompt(verdict: &Verdict) -> String {
    let percent = (verdict.probability * 100.0).round() as i64;
    let reasons = if verdict.reasons.is_empty() {
        "no specific suspicious traits were flagged".to_string()
    } else {
        verdict
            .reasons
            .iter()
            .map(|r| format!("- {r}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "You are a browser security assistant. A local phishing classifier \
         scored a web address as \"{label}\" ({percent}% estimated phishing \
         probability). The signals it detected were:\n{reasons}\n\n\
         In 2-3 short sentences, explain in plain language why this address \
         got this verdict. Do not invent additional signals beyond the ones \
         listed. Do not mention that you are an AI model.",
        label = verdict.label,
        percent = percent,
        reasons = reasons,
    )
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd toolkit/components/northgate-llm-prompt
cargo test
```

Expected: both tests `PASS`.

- [ ] **Step 6: Commit**

```bash
git add toolkit/components/northgate-llm-prompt
git commit -m "feat(northgate-llm): add dependency-free prompt builder crate"
```

---

### Task 3: `northgate-llm-prompt` crate — response cleanup (TDD)

**Files:**
- Modify: `toolkit/components/northgate-llm-prompt/src/lib.rs`

**Interfaces:**
- Consumes: nothing from Task 2 beyond being in the same crate.
- Produces: `pub fn clean_response(raw: &str, max_chars: usize) -> String`, consumed by Task 4's `northgate-llm` crate to post-process the model's raw output before it reaches the callback.

- [ ] **Step 1: Write the failing tests**

```rust
// toolkit/components/northgate-llm-prompt/src/lib.rs, inside `mod tests`

#[test]
fn trims_whitespace_and_leading_labels() {
    let raw = "  \n\nAssistant: This address looks dangerous because...\n";
    let cleaned = clean_response(raw, 500);
    assert_eq!(cleaned, "This address looks dangerous because...");
}

#[test]
fn truncates_to_max_chars_on_a_word_boundary() {
    let raw = "This is a very long explanation that keeps going and going and going past the limit.";
    let cleaned = clean_response(raw, 20);
    assert!(cleaned.len() <= 21); // allow the trailing ellipsis character
    assert!(cleaned.ends_with('…'));
    assert!(!cleaned.contains("  "));
}

#[test]
fn returns_empty_string_unchanged() {
    assert_eq!(clean_response("", 500), "");
}
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd toolkit/components/northgate-llm-prompt
cargo test clean_response
```

Expected: compile error — `clean_response` doesn't exist yet.

- [ ] **Step 3: Implement `clean_response`**

```rust
// toolkit/components/northgate-llm-prompt/src/lib.rs

/// Strip common chat-model artifacts (role labels, leading/trailing
/// whitespace) and cap length so a runaway generation can't produce an
/// unbounded string for the UI to render.
pub fn clean_response(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    let without_label = trimmed
        .strip_prefix("Assistant:")
        .or_else(|| trimmed.strip_prefix("assistant:"))
        .map(str::trim)
        .unwrap_or(trimmed);

    if without_label.chars().count() <= max_chars {
        return without_label.to_string();
    }

    let mut truncated: String = without_label.chars().take(max_chars).collect();
    if let Some(last_space) = truncated.rfind(' ') {
        truncated.truncate(last_space);
    }
    truncated.push('…');
    truncated
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd toolkit/components/northgate-llm-prompt
cargo test
```

Expected: all tests `PASS` (both this task's and Task 2's).

- [ ] **Step 5: Commit**

```bash
git add toolkit/components/northgate-llm-prompt/src/lib.rs
git commit -m "feat(northgate-llm): add response cleanup/truncation"
```

---

### Task 4: `nsINorthGateLLM` XPCOM service (stub engine, async callback)

This task requires a working Gecko/`mach` build environment to compile and verify — like the existing classifier (see `toolkit/components/northgate/INTEGRATION.md`), treat the steps below as the checklist, and confirm each one actually builds rather than assuming it does.

**Files:**
- Create: `toolkit/components/northgate-llm/Cargo.toml`
- Create: `toolkit/components/northgate-llm/nsINorthGateLLM.idl`
- Create: `toolkit/components/northgate-llm/components.conf`
- Create: `toolkit/components/northgate-llm/moz.build`
- Create: `toolkit/components/northgate-llm/src/lib.rs`
- Create: `toolkit/components/northgate-llm/src/engine.rs`
- Modify: `toolkit/library/rust/shared/Cargo.toml`
- Modify: `toolkit/library/rust/shared/lib.rs`

**Interfaces:**
- Consumes: `northgate_llm_prompt::{Verdict, build_prompt, clean_response}` from Task 2/3.
- Produces: XPCOM contract `@mozilla.org/northgate/llm;1` (`nsINorthGateLLM`), method `explainVerdict(in AUTF8String verdict, in double probability, in Array<AUTF8String> reasons, in AUTF8String modelPath, in nsINorthGateLLMCallback callback)`. Callback interface `nsINorthGateLLMCallback` with `onResult(in AUTF8String explanation)` / `onError(in AUTF8String message)`. Consumed by Task 6's `AboutNorthGateParent`.

- [ ] **Step 1: Write the IDL**

```idl
/* toolkit/components/northgate-llm/nsINorthGateLLM.idl */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsISupports.idl"

/**
 * Callback for the result of an asynchronous nsINorthGateLLM.explainVerdict()
 * call. Invoked on the same thread that called explainVerdict() (the main
 * thread, in practice).
 */
[scriptable, uuid(e1a2b3c4-5d6e-4f70-8192-a3b4c5d6e7f8)]
interface nsINorthGateLLMCallback : nsISupports {
  void onResult(in AUTF8String explanation);
  void onError(in AUTF8String message);
};

/**
 * Local, on-device natural-language explanation of a phishing classifier
 * verdict. Backed by a small quantized LLM (llama.cpp) loaded from a model
 * file already downloaded and checksum-verified by
 * NorthGateLLMManager.sys.mjs. Never makes network requests itself.
 *
 * Generation runs on a background thread; this call returns immediately and
 * the result arrives via the callback. Never part of the navigation-blocking
 * path — callers must treat failure as "no explanation available", not as a
 * reason to change the classifier's verdict.
 */
[scriptable, uuid(f2b3c4d5-6e7f-4081-92a3-b4c5d6e7f8a9)]
interface nsINorthGateLLM : nsISupports {
  /**
   * @param verdict "safe" | "suspicious" | "dangerous"
   * @param probability Estimated phishing probability, 0..1.
   * @param reasons Human-readable reason strings already shown in the
   *   dashboard (not Fluent ids — resolved English/localized text).
   * @param modelPath Absolute path to the checksum-verified .gguf file.
   * @param callback Invoked exactly once, with either onResult or onError.
   */
  void explainVerdict(in AUTF8String verdict,
                       in double probability,
                       in Array<AUTF8String> reasons,
                       in AUTF8String modelPath,
                       in nsINorthGateLLMCallback callback);
};
```

- [ ] **Step 2: Write the crate manifest**

```toml
# toolkit/components/northgate-llm/Cargo.toml
[package]
name = "northgate_llm"
version = "0.1.0"
authors = ["The NorthGate Project"]
edition = "2021"
license = "MPL-2.0"
description = "On-device LLM explanation service exposed as an XPCOM service."

[dependencies]
xpcom = { path = "../../../xpcom/rust/xpcom" }
nserror = { path = "../../../xpcom/rust/nserror" }
nsstring = { path = "../../../xpcom/rust/nsstring" }
moz_task = { path = "../../../xpcom/rust/moz_task" }

northgate_llm_prompt = { path = "../northgate-llm-prompt" }

[lib]
path = "src/lib.rs"
```

- [ ] **Step 3: Write `components.conf`**

```python
# toolkit/components/northgate-llm/components.conf
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

Classes = [
    {
        'cid': '{d3e4f5a6-7b8c-4d9e-af01-2b3c4d5e6f70}',
        'contract_ids': ['@mozilla.org/northgate/llm;1'],
        'headers': ['/toolkit/components/northgate-llm/nsNorthGateLLMModule.h'],
        'legacy_constructor': 'nsNorthGateLLMConstructor',
    },
]
```

- [ ] **Step 4: Write `moz.build`**

```python
# toolkit/components/northgate-llm/moz.build
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

with Files("**"):
    BUG_COMPONENT = ("NorthGate", "LLM Explanation Service")

XPIDL_SOURCES += [
    "nsINorthGateLLM.idl",
]

XPIDL_MODULE = "northgate_llm"

XPCOM_MANIFESTS += [
    "components.conf",
]

FINAL_LIBRARY = "xul"
```

Also create the matching C++ header, mirroring the classifier's `nsNorthGateClassifierModule.h`:

```cpp
/* toolkit/components/northgate-llm/nsNorthGateLLMModule.h */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef nsNorthGateLLMModule_h
#define nsNorthGateLLMModule_h

#include "nsError.h"
#include "nsID.h"

extern "C" nsresult nsNorthGateLLMConstructor(const nsIID& aIID,
                                               void** aResult);

#endif  // nsNorthGateLLMModule_h
```

(Check `toolkit/components/northgate/nsNorthGateClassifierModule.h` for the exact existing signature/style before finalizing this file — match it exactly rather than the sketch above if it differs.)

- [ ] **Step 5: Implement the stub engine**

```rust
// toolkit/components/northgate-llm/src/engine.rs

//! Model loading and text generation. This is a stub until Task 8 wires in
//! real llama.cpp-backed inference — it lets the XPCOM plumbing (threading,
//! callback dispatch, error handling) be built and exercised independently
//! of the native dependency.

pub struct Engine;

#[derive(Debug)]
pub enum EngineError {
    ModelNotFound,
    GenerationFailed(String),
}

impl Engine {
    pub fn load(_model_path: &str) -> Result<Self, EngineError> {
        Ok(Engine)
    }

    pub fn generate(&self, prompt: &str, max_tokens: usize) -> Result<String, EngineError> {
        let _ = max_tokens;
        if prompt.is_empty() {
            return Err(EngineError::GenerationFailed("empty prompt".into()));
        }
        Ok("(stub) explanation generation not yet wired to llama.cpp".to_string())
    }
}
```

- [ ] **Step 6: Implement the XPCOM service with background-thread dispatch**

```rust
// toolkit/components/northgate-llm/src/lib.rs
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#[macro_use]
extern crate xpcom;

use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};

use moz_task::{Task, TaskRunnable, ThreadPtrHandle, ThreadPtrHolder};
use nserror::{nsresult, NS_ERROR_FAILURE, NS_OK};
use nsstring::{nsACString, nsCString};
use xpcom::interfaces::{nsINorthGateLLM, nsINorthGateLLMCallback};
use xpcom::{nsIID, xpcom_method, RefPtr};

use northgate_llm_prompt::{build_prompt, clean_response, Verdict};

mod engine;
use engine::Engine;

const MAX_RESPONSE_CHARS: usize = 800;
const MAX_TOKENS: usize = 200;

struct ExplainTask {
    verdict: Verdict,
    model_path: String,
    callback: ThreadPtrHandle<nsINorthGateLLMCallback>,
    result: std::sync::Mutex<Option<Result<String, String>>>,
}

impl Task for ExplainTask {
    fn run(&self) {
        // Runs on the dedicated background thread.
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            let engine = Engine::load(&self.model_path)
                .map_err(|e| format!("model load failed: {e:?}"))?;
            let prompt = build_prompt(&self.verdict);
            let raw = engine
                .generate(&prompt, MAX_TOKENS)
                .map_err(|e| format!("generation failed: {e:?}"))?;
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

    fn name(&self) -> &str {
        "NorthGateLLM::ExplainTask"
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
            reasons: *const thin_vec::ThinVec<nsCString>,
            model_path: *const nsACString,
            callback: *const nsINorthGateLLMCallback
        )
    );
    fn explain_verdict(
        &self,
        verdict: &nsACString,
        probability: f64,
        reasons: &thin_vec::ThinVec<nsCString>,
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
            ThreadPtrHolder::new(cstr::cstr!("nsINorthGateLLMCallback"), RefPtr::new(callback))
                .map_err(|_| NS_ERROR_FAILURE)?;

        let task = ExplainTask {
            verdict,
            model_path,
            callback: callback_handle,
            result: std::sync::Mutex::new(None),
        };

        let thread = moz_task::create_thread("NorthGateLLM")?;
        TaskRunnable::new("NorthGateLLM::ExplainTask", Box::new(task))?
            .dispatch(&thread)?;
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
```

**Note for the implementer:** the exact `moz_task`/`ThreadPtrHolder`/`TaskRunnable` call signatures above are written from the established in-tree pattern for background-thread XPCOM callbacks, but must be checked against the `moz_task` crate version actually vendored in this tree (`xpcom/rust/moz_task`) before this will compile — adjust argument order/types to match if they've drifted, the same way `INTEGRATION.md` flags the `ort`/`tract` linkage as unverified. The array parameter type (`Array<AUTF8String>` in IDL, `ThinVec<nsCString>` here) similarly needs checking against how another in-tree XPIDL array-of-string parameter is bound in Rust — grep for an existing `Array<AUTF8String>` XPIDL method and copy its exact Rust signature rather than trusting the sketch above verbatim.

- [ ] **Step 7: Wire the crate into libxul**

```toml
# toolkit/library/rust/shared/Cargo.toml — add alongside the existing northgate_classifier line
northgate_llm = { path = "../../../components/northgate-llm" }
```

```rust
// toolkit/library/rust/shared/lib.rs — add alongside the existing northgate_classifier line
extern crate northgate_llm;
```

- [ ] **Step 8: Refresh vendored crates and attempt a build**

```bash
./mach vendor rust
./mach build binaries
```

Expected: build succeeds (Rust + the new XPIDL-generated header + component registration). If it fails, fix the mismatch per the note in Step 6 before moving on — do not proceed to Task 5 with a non-compiling crate.

- [ ] **Step 9: Manual smoke test**

```bash
./mach run
```

In the browser console (`Ctrl+Shift+J` or `about:devtools-toolbox`), run:

```js
let llm = Cc["@mozilla.org/northgate/llm;1"].getService(Ci.nsINorthGateLLM);
llm.explainVerdict("dangerous", 0.87, ["Uses a raw IP address instead of a domain name."], "/nonexistent/path.gguf", {
  onResult: text => console.log("RESULT:", text),
  onError: msg => console.log("ERROR:", msg),
});
```

Expected: `ERROR: model load failed: ModelNotFound` is logged (the stub engine's `load()` currently always succeeds — if you see `RESULT: (stub) explanation...` instead, that's also correct given the current stub; either confirms the callback round-trip works end to end). Fix any crash or missing callback invocation before proceeding.

- [ ] **Step 10: Commit**

```bash
git add toolkit/components/northgate-llm toolkit/library/rust/shared/Cargo.toml toolkit/library/rust/shared/lib.rs
git commit -m "feat(northgate-llm): add nsINorthGateLLM XPCOM service with stub engine"
```

---

### Task 5: `NorthGateLLMManager.sys.mjs` — download, verification, state

**Files:**
- Create: `browser/components/northgate-browser/NorthGateLLMManager.sys.mjs`
- Create: `browser/components/northgate-browser/test/xpcshell/xpcshell.toml`
- Create: `browser/components/northgate-browser/test/xpcshell/test_NorthGateLLMManager.js`
- Modify: `browser/components/northgate-browser/moz.build`

**Interfaces:**
- Produces: `export const NorthGateLLMManager` with `getState()`, `ensureDownloaded(onProgress)`, `modelPath()`. Consumed by Task 6's `AboutNorthGateParent`.

- [ ] **Step 1: Write the failing xpcshell test**

```js
// browser/components/northgate-browser/test/xpcshell/test_NorthGateLLMManager.js
"use strict";

const { NorthGateLLMManager } = ChromeUtils.importESModule(
  "moz-src:///browser/components/northgate-browser/NorthGateLLMManager.sys.mjs"
);

const MODEL_BYTES = new TextEncoder().encode("fake-model-bytes-for-testing");

function sha256Hex(bytes) {
  let hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(Ci.nsICryptoHash.SHA256);
  hasher.update(bytes, bytes.length);
  let hash = hasher.finish(false);
  return Array.from(hash, c =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
}

add_task(async function test_state_starts_not_downloaded() {
  let manager = new NorthGateLLMManager({
    profileDir: PathUtils.tempDir,
  });
  Assert.equal(manager.getState(), "not-downloaded");
});

add_task(async function test_ensure_downloaded_verifies_checksum() {
  let expectedHash = sha256Hex(MODEL_BYTES);
  let manager = new NorthGateLLMManager({
    profileDir: PathUtils.tempDir,
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: expectedHash,
    fetchImpl: async () => new Response(MODEL_BYTES),
  });

  await manager.ensureDownloaded();

  Assert.equal(manager.getState(), "ready");
  let onDisk = await IOUtils.read(manager.modelPath());
  Assert.deepEqual(Array.from(onDisk), Array.from(MODEL_BYTES));
});

add_task(async function test_ensure_downloaded_rejects_checksum_mismatch() {
  let manager = new NorthGateLLMManager({
    profileDir: PathUtils.tempDir,
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    fetchImpl: async () => new Response(MODEL_BYTES),
  });

  await Assert.rejects(
    manager.ensureDownloaded(),
    /checksum mismatch/,
    "should reject on checksum mismatch"
  );
  Assert.equal(manager.getState(), "error");
  Assert.ok(
    !(await IOUtils.exists(manager.modelPath())),
    "partial file must not be left on disk"
  );
});
```

- [ ] **Step 2: Register the test manifest**

```toml
# browser/components/northgate-browser/test/xpcshell/xpcshell.toml
[test_NorthGateLLMManager.js]
```

```python
# browser/components/northgate-browser/moz.build — add near the other list additions
XPCSHELL_TESTS_MANIFESTS += [
    "test/xpcshell/xpcshell.toml",
]
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
./mach test browser/components/northgate-browser/test/xpcshell/test_NorthGateLLMManager.js
```

Expected: FAIL — `NorthGateLLMManager.sys.mjs` doesn't exist yet.

- [ ] **Step 4: Implement `NorthGateLLMManager`**

```js
// browser/components/northgate-browser/NorthGateLLMManager.sys.mjs
/**
 * Downloads, checksum-verifies, and tracks the on-disk state of the
 * quantized LLM model used for on-demand alert explanations.
 *
 * This is the ONLY network request NorthGate's LLM feature ever makes: a
 * one-time download of a project-published, checksum-pinned .gguf file,
 * triggered only after explicit user consent. Once cached, generation is
 * fully local (see nsINorthGateLLM).
 */

const DEFAULT_MODEL_URL =
  "https://github.com/eduolihez/northgate-browser/releases/download/llm-model-v1/qwen2.5-1.5b-instruct-q4_k_m.gguf";
// SHA-256 of the file published at DEFAULT_MODEL_URL (see Task 1).
const DEFAULT_MODEL_SHA256 =
  "REPLACE_WITH_HASH_FROM_TASK_1_STEP_4";
const MODEL_FILENAME = "qwen2.5-1.5b-instruct-q4_k_m.gguf";

function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256OfFile(path) {
  const bytes = await IOUtils.read(path);
  const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(Ci.nsICryptoHash.SHA256);
  hasher.update(bytes, bytes.length);
  const digest = hasher.finish(false);
  const raw = Uint8Array.from(digest, c => c.charCodeAt(0));
  return toHex(raw);
}

export class NorthGateLLMManager {
  #profileDir;
  #modelUrl;
  #modelSha256;
  #fetchImpl;
  #state = "not-downloaded";

  constructor({
    profileDir,
    modelUrl = DEFAULT_MODEL_URL,
    modelSha256 = DEFAULT_MODEL_SHA256,
    fetchImpl = fetch,
  } = {}) {
    this.#profileDir = profileDir;
    this.#modelUrl = modelUrl;
    this.#modelSha256 = modelSha256;
    this.#fetchImpl = fetchImpl;
  }

  modelPath() {
    return PathUtils.join(this.#profileDir, "northgate", "models", MODEL_FILENAME);
  }

  getState() {
    return this.#state;
  }

  /**
   * Downloads and verifies the model if it is not already present. Safe to
   * call repeatedly; a no-op once state is "ready".
   *
   * @param {(fraction: number) => void} [onProgress]
   */
  async ensureDownloaded(onProgress) {
    if (this.#state === "ready" && (await IOUtils.exists(this.modelPath()))) {
      return;
    }

    this.#state = "downloading";
    const destination = this.modelPath();
    const partial = `${destination}.partial`;

    try {
      await IOUtils.makeDirectory(PathUtils.parent(destination), {
        createAncestors: true,
      });

      const response = await this.#fetchImpl(this.#modelUrl);
      const total = Number(response.headers?.get?.("content-length")) || 0;
      const reader = response.body?.getReader?.();
      const chunks = [];
      let received = 0;

      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
          received += value.length;
          if (total && onProgress) {
            onProgress(received / total);
          }
        }
      } else {
        chunks.push(new Uint8Array(await response.arrayBuffer()));
      }

      const bytes = new Uint8Array(received || chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      await IOUtils.write(partial, bytes);

      const actualHash = await sha256OfFile(partial);
      if (actualHash !== this.#modelSha256) {
        await IOUtils.remove(partial, { ignoreAbsent: true });
        this.#state = "error";
        throw new Error(
          `model download checksum mismatch: expected ${this.#modelSha256}, got ${actualHash}`
        );
      }

      await IOUtils.move(partial, destination);
      this.#state = "ready";
    } catch (e) {
      await IOUtils.remove(partial, { ignoreAbsent: true });
      this.#state = "error";
      throw e;
    }
  }
}

export const northGateLLMManager = new NorthGateLLMManager({
  profileDir: PathUtils.profileDir,
});
```

- [ ] **Step 5: Fill in the real checksum**

Replace `REPLACE_WITH_HASH_FROM_TASK_1_STEP_4` with the actual value recorded in Task 1, Step 5. (This is the one deliberate exception to "no placeholders" in this plan — the value is genuinely unknown until Task 1 runs, and Task 1's own steps show exactly how to obtain and verify it. Do not proceed to Step 6 below until this is a real hex string.)

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
./mach test browser/components/northgate-browser/test/xpcshell/test_NorthGateLLMManager.js
```

Expected: all three tests `PASS`.

- [ ] **Step 7: Commit**

```bash
git add browser/components/northgate-browser/NorthGateLLMManager.sys.mjs \
        browser/components/northgate-browser/test/xpcshell \
        browser/components/northgate-browser/moz.build
git commit -m "feat(northgate-llm): add model download manager with checksum verification"
```

---

### Task 6: Actor plumbing — state, download, and explain messages

**Files:**
- Modify: `browser/components/northgate-browser/AboutNorthGateParent.sys.mjs`
- Modify: `browser/components/northgate-browser/AboutNorthGateChild.sys.mjs`

**Interfaces:**
- Consumes: `northGateLLMManager` (Task 5), `nsINorthGateLLM` via `@mozilla.org/northgate/llm;1` (Task 4).
- Produces: actor messages `AboutNorthGate:LLMState`, `AboutNorthGate:LLMDownload`, `AboutNorthGate:LLMExplain`, each resolving to a plain-object payload. Consumed by Task 7's `aboutNorthGate.js`.

- [ ] **Step 1: Add the LLM message handlers to `AboutNorthGateParent`**

Add near the top of the file, alongside the existing `ChromeUtils.defineESModuleGetters` call:

```js
ChromeUtils.defineESModuleGetters(lazy, {
  NorthGateClassifier:
    "moz-src:///browser/components/northgate-browser/NorthGateClassifier.sys.mjs",
  northGateLLMManager:
    "moz-src:///browser/components/northgate-browser/NorthGateLLMManager.sys.mjs",
});
```

Add new cases to `receiveMessage` (extending the existing `switch`):

```js
  receiveMessage(message) {
    switch (message.name) {
      case "AboutNorthGate:GetData":
        return Promise.resolve(this.#buildPayload());
      case "AboutNorthGate:ClearAlerts":
        sessionAlerts.clear();
        return Promise.resolve(this.#buildPayload());
      case "AboutNorthGate:LLMState":
        return Promise.resolve({ state: lazy.northGateLLMManager.getState() });
      case "AboutNorthGate:LLMDownload":
        return this.#downloadModel();
      case "AboutNorthGate:LLMExplain":
        return this.#explainVerdict(message.data);
    }
    return undefined;
  }
```

Add the new private methods (place them near `#buildPayload`):

```js
  async #downloadModel() {
    try {
      await lazy.northGateLLMManager.ensureDownloaded(fraction => {
        this.sendAsyncMessage("AboutNorthGate:LLMProgress", { fraction });
      });
      return { state: "ready" };
    } catch (e) {
      return { state: "error", message: String(e) };
    }
  }

  #explainVerdict({ verdict, probability, reasons }) {
    return new Promise(resolve => {
      let service;
      try {
        service = Cc["@mozilla.org/northgate/llm;1"].getService(
          Ci.nsINorthGateLLM
        );
      } catch (e) {
        resolve({ ok: false, message: "LLM service unavailable" });
        return;
      }

      service.explainVerdict(
        verdict,
        probability,
        reasons,
        lazy.northGateLLMManager.modelPath(),
        {
          QueryInterface: ChromeUtils.generateQI(["nsINorthGateLLMCallback"]),
          onResult: explanation => resolve({ ok: true, explanation }),
          onError: message => resolve({ ok: false, message }),
        }
      );
    });
  }
```

- [ ] **Step 2: Relay the new messages from `AboutNorthGateChild`**

```js
// browser/components/northgate-browser/AboutNorthGateChild.sys.mjs
export class AboutNorthGateChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded":
      case "NorthGate:Refresh":
        this.#send("AboutNorthGate:GetData", "NorthGate:Data");
        break;
      case "NorthGate:ClearAlerts":
        this.#send("AboutNorthGate:ClearAlerts", "NorthGate:Data");
        break;
      case "NorthGate:LLMState":
        this.#send("AboutNorthGate:LLMState", "NorthGate:LLMState");
        break;
      case "NorthGate:LLMDownload":
        this.#send("AboutNorthGate:LLMDownload", "NorthGate:LLMDownload");
        break;
      case "NorthGate:LLMExplain":
        this.#send(
          "AboutNorthGate:LLMExplain",
          "NorthGate:LLMExplain",
          event.detail
        );
        break;
    }
  }

  receiveMessage(message) {
    if (message.name === "AboutNorthGate:LLMProgress") {
      this.#dispatch("NorthGate:LLMProgress", message.data);
    }
  }

  #send(query, eventName, data) {
    this.sendQuery(query, data).then(result =>
      this.#dispatch(eventName, result)
    );
  }

  #dispatch(eventName, data) {
    const event = new this.contentWindow.CustomEvent(eventName, {
      detail: Cu.cloneInto(data, this.contentWindow),
    });
    this.contentWindow.dispatchEvent(event);
  }
}
```

Note the original `#send`/`#dispatch` were hardcoded to `"NorthGate:Data"` — this step generalizes them to take the event name, and adds `receiveMessage` for the parent-pushed progress updates (`sendAsyncMessage`, not a query/response).

- [ ] **Step 3: Manual verification (requires a build from Task 4)**

```bash
./mach build faster
./mach run
```

Open `about:northgate`, then in the browser console:

```js
gBrowser.selectedBrowser.browsingContext.currentWindowGlobal
  .getActor("AboutNorthGate")
  .sendQuery("AboutNorthGate:LLMState")
  .then(console.log);
```

Expected: logs `{ state: "not-downloaded" }` (or `"ready"` if a prior task already downloaded a model in this profile).

- [ ] **Step 4: Commit**

```bash
git add browser/components/northgate-browser/AboutNorthGateParent.sys.mjs \
        browser/components/northgate-browser/AboutNorthGateChild.sys.mjs
git commit -m "feat(northgate-llm): wire actor messages for LLM state, download, explain"
```

---

### Task 7: `about:northgate` UI — "Explicar" button, consent, progress, result

**Files:**
- Modify: `browser/components/northgate-browser/content/aboutNorthGate.html`
- Modify: `browser/components/northgate-browser/content/aboutNorthGate.js`
- Modify: `browser/components/northgate-browser/content/aboutNorthGate.css`
- Modify: `browser/locales/en-US/browser/aboutNorthGate.ftl`

**Interfaces:**
- Consumes: DOM events `NorthGate:LLMState`, `NorthGate:LLMDownload`, `NorthGate:LLMExplain`, `NorthGate:LLMProgress` (dispatched to `window` by Task 6's `AboutNorthGateChild`, via the same `window.dispatchEvent(new CustomEvent(eventName, ...))` pattern already used for `NorthGate:Data`).

- [ ] **Step 1: Add the UI elements to `aboutNorthGate.html`**

Insert inside `<section class="ngate-card ngate-classifier-card">`, right after the existing `<ul id="ngate-reasons" class="ngate-reasons"></ul>` (which is the last child of that section):

```html
        <div id="ngate-llm-explain" class="ngate-llm-explain">
          <button
            id="ngate-llm-button"
            class="ngate-ghost-button"
            data-l10n-id="ngate-llm-explain-button"
          ></button>
          <p
            id="ngate-llm-consent"
            class="ngate-llm-consent"
            data-l10n-id="ngate-llm-consent"
            hidden
          ></p>
          <div id="ngate-llm-progress" class="ngate-meter" hidden>
            <div id="ngate-llm-progress-bar" class="ngate-meter-fill"></div>
          </div>
          <p id="ngate-llm-loading" class="ngate-muted" data-l10n-id="ngate-llm-loading" hidden></p>
          <p id="ngate-llm-error" class="ngate-llm-error" hidden></p>
          <p id="ngate-llm-result" class="ngate-llm-result" hidden></p>
        </div>
```

- [ ] **Step 2: Add the Fluent strings**

Append to `browser/locales/en-US/browser/aboutNorthGate.ftl`, after the existing `## AI classifier` section's entries:

```fluent
ngate-llm-explain-button = Explain with local AI
ngate-llm-consent = This downloads a small AI model (about 1 GB) from NorthGate's GitHub releases the first time you use this. After that, explanations are generated fully offline. Continue?
ngate-llm-consent-confirm = Download and explain
ngate-llm-consent-cancel = Cancel
ngate-llm-loading = Generating explanation…
ngate-llm-error-generic = Couldn't generate an explanation right now.
# Variables:
#   $percent (number) - Download progress, 0-100.
ngate-llm-downloading = Downloading model… { $percent }%
```

Add the two consent-button ids to the HTML from Step 1 as well — replace the single `<p id="ngate-llm-consent">` block with:

```html
          <div id="ngate-llm-consent" class="ngate-llm-consent" hidden>
            <p data-l10n-id="ngate-llm-consent"></p>
            <button id="ngate-llm-consent-confirm" data-l10n-id="ngate-llm-consent-confirm"></button>
            <button id="ngate-llm-consent-cancel" class="ngate-ghost-button" data-l10n-id="ngate-llm-consent-cancel"></button>
          </div>
```

- [ ] **Step 3: Add the styling**

Append to `browser/components/northgate-browser/content/aboutNorthGate.css`:

```css
.ngate-llm-explain {
  margin-block-start: 1em;
  padding-block-start: 1em;
  border-block-start: 1px solid var(--in-content-border-color);
}

.ngate-llm-consent {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  align-items: flex-start;
}

.ngate-llm-error {
  color: var(--text-color-error, #d70022);
}

.ngate-llm-result {
  white-space: pre-wrap;
  line-height: 1.5;
}
```

- [ ] **Step 4: Wire up the behavior in `aboutNorthGate.js`**

Add near the top of the file, after the existing `CATEGORIES` constant:

```js
let llmState = "not-downloaded";
let currentClassification = null;
```

Add new render/handler functions (place them near the other `render*` functions):

```js
function setLLMSection(state) {
  llmState = state;
  const button = $("ngate-llm-button");
  const consent = $("ngate-llm-consent");
  const progress = $("ngate-llm-progress");
  const loading = $("ngate-llm-loading");
  const error = $("ngate-llm-error");
  const result = $("ngate-llm-result");

  consent.hidden = state !== "awaiting-consent";
  progress.hidden = state !== "downloading";
  loading.hidden = state !== "generating";
  error.hidden = state !== "error";
  if (state !== "done") {
    result.hidden = true;
  }
  button.disabled = state === "downloading" || state === "generating";
}

function requestExplanation() {
  if (!currentClassification) {
    return;
  }
  if (llmState === "ready" || llmState === "done") {
    dispatchExplain();
  } else {
    setLLMSection("awaiting-consent");
  }
}

function confirmDownloadAndExplain() {
  setLLMSection("downloading");
  window.dispatchEvent(new CustomEvent("NorthGate:LLMDownload"));
}

function dispatchExplain() {
  setLLMSection("generating");
  window.dispatchEvent(
    new CustomEvent("NorthGate:LLMExplain", {
      detail: {
        verdict: currentClassification.verdict,
        probability: currentClassification.probability,
        reasons: currentClassification.reasons,
      },
    })
  );
}
```

Add the new event listeners inside the existing `document.addEventListener("DOMContentLoaded", ...)` block, after the existing `ngate-clear` listener:

```js
  $("ngate-llm-button").addEventListener("click", requestExplanation);
  $("ngate-llm-consent-confirm").addEventListener("click", confirmDownloadAndExplain);
  $("ngate-llm-consent-cancel").addEventListener("click", () => setLLMSection(llmState === "ready" ? "ready" : "not-downloaded"));

  window.addEventListener("NorthGate:LLMState", event => {
    const state = event.detail.state === "ready" ? "ready" : "not-downloaded";
    setLLMSection(state);
  });

  window.addEventListener("NorthGate:LLMProgress", event => {
    $("ngate-llm-progress-bar").style.inlineSize = `${Math.round(event.detail.fraction * 100)}%`;
  });

  window.addEventListener("NorthGate:LLMDownload", event => {
    if (event.detail?.state === "ready") {
      dispatchExplain();
    } else {
      setLLMSection("error");
      document.l10n.setAttributes($("ngate-llm-error"), "ngate-llm-error-generic");
    }
  });

  window.addEventListener("NorthGate:LLMExplain", event => {
    if (event.detail?.ok) {
      $("ngate-llm-result").textContent = event.detail.explanation;
      $("ngate-llm-result").hidden = false;
      setLLMSection("done");
    } else {
      setLLMSection("error");
      document.l10n.setAttributes($("ngate-llm-error"), "ngate-llm-error-generic");
    }
  });

  window.dispatchEvent(new CustomEvent("NorthGate:LLMState"));
```

Finally, update `renderClassifier` to record `currentClassification` (add this as the first line inside the existing function body):

```js
function renderClassifier(classification) {
  currentClassification = classification;
  // ...(existing body unchanged below this line)
```

- [ ] **Step 5: Manual verification (requires builds from Tasks 4-6)**

```bash
./mach build faster
./mach run
```

Navigate to a normal site, open `about:northgate`, click "Explain with local AI" → confirm the consent prompt appears with the correct copy → cancel → confirm the section returns to its initial state without errors. This validates the UI state machine independent of a working model download (which additionally needs Task 1's real release to exist).

- [ ] **Step 6: Commit**

```bash
git add browser/components/northgate-browser/content/aboutNorthGate.html \
        browser/components/northgate-browser/content/aboutNorthGate.js \
        browser/components/northgate-browser/content/aboutNorthGate.css \
        browser/locales/en-US/browser/aboutNorthGate.ftl
git commit -m "feat(northgate-llm): add explain-with-AI UI to about:northgate"
```

---

### Task 8: Vendor llama.cpp and replace the stub engine

This is the highest-uncertainty task in this plan — vendoring and cmake-building a C++ dependency inside Gecko's Rust build has no precedent elsewhere in this tree (unlike `northgate_classifier`, which deliberately avoided this by using `tract`). Budget real iteration time; do not assume the steps below compile unmodified.

**Files:**
- Create: `toolkit/components/northgate-llm/vendor/llama.cpp/` (vendored source)
- Create: `toolkit/components/northgate-llm/build.rs`
- Modify: `toolkit/components/northgate-llm/Cargo.toml`
- Modify: `toolkit/components/northgate-llm/src/engine.rs`

**Interfaces:**
- Consumes: nothing new externally.
- Produces: `Engine::load`/`Engine::generate` (same signatures as the Task 4 stub) now backed by real inference — no other file's interface changes, by design, so this task is swappable in isolation.

- [ ] **Step 1: Vendor llama.cpp source**

```bash
cd toolkit/components/northgate-llm
git submodule add https://github.com/ggml-org/llama.cpp vendor/llama.cpp
git -C vendor/llama.cpp checkout b4400  # pin an exact tagged release, not a moving branch
```

(Check the llama.cpp repository for the latest stable tag at implementation time and use that instead of `b4400` if it's since been superseded — the important constraint is "an exact pinned tag", not this specific value.)

- [ ] **Step 2: Add the build-time dependency and `build.rs`**

```toml
# toolkit/components/northgate-llm/Cargo.toml — add to [dependencies]
llama-cpp-2 = { version = "0.1", default-features = false }

# add a new section
[build-dependencies]
cmake = "0.1"
```

```rust
// toolkit/components/northgate-llm/build.rs
fn main() {
    let dst = cmake::Config::new("vendor/llama.cpp")
        .define("LLAMA_BUILD_TESTS", "OFF")
        .define("LLAMA_BUILD_EXAMPLES", "OFF")
        .define("LLAMA_BUILD_SERVER", "OFF")
        .define("BUILD_SHARED_LIBS", "OFF")
        .build();

    println!("cargo:rustc-link-search=native={}/lib", dst.display());
    println!("cargo:rustc-link-lib=static=llama");
    println!("cargo:rustc-link-lib=static=ggml");
}
```

Verify `llama-cpp-2`'s actual required link flags/library names against its published documentation at implementation time — the crate's own `build.rs` may already do some or all of this, in which case this file should shrink to just building the vendored source and pointing `llama-cpp-2` at it via its documented env vars, rather than duplicating link flags by hand.

- [ ] **Step 3: Replace the stub with real loading/generation**

```rust
// toolkit/components/northgate-llm/src/engine.rs
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::model::AddBos;
use llama_cpp_2::token::data_array::LlamaTokenDataArray;

pub struct Engine {
    backend: LlamaBackend,
    model: LlamaModel,
}

#[derive(Debug)]
pub enum EngineError {
    ModelNotFound,
    GenerationFailed(String),
}

impl Engine {
    pub fn load(model_path: &str) -> Result<Self, EngineError> {
        if !std::path::Path::new(model_path).exists() {
            return Err(EngineError::ModelNotFound);
        }
        let backend = LlamaBackend::init().map_err(|e| {
            EngineError::GenerationFailed(format!("backend init failed: {e}"))
        })?;
        let model = LlamaModel::load_from_file(&backend, model_path, &LlamaModelParams::default())
            .map_err(|e| EngineError::GenerationFailed(format!("model load failed: {e}")))?;
        Ok(Engine { backend, model })
    }

    pub fn generate(&self, prompt: &str, max_tokens: usize) -> Result<String, EngineError> {
        let ctx_params = LlamaContextParams::default();
        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| EngineError::GenerationFailed(format!("context init failed: {e}")))?;

        let tokens = self
            .model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| EngineError::GenerationFailed(format!("tokenize failed: {e}")))?;

        // The exact decode/sample loop API differs across llama-cpp-2 versions;
        // consult the version actually vendored (Cargo.lock) and its examples
        // directory for the current batch-decode + greedy/temperature sampling
        // idiom, then fill in the loop below to append up to `max_tokens`
        // tokens, stopping early on the model's EOS token.
        let mut output = String::new();
        let _ = (&mut ctx, &tokens, max_tokens);
        todo!("wire the decode/sample loop against the vendored llama-cpp-2 API");
        #[allow(unreachable_code)]
        Ok(output)
    }
}
```

**This step intentionally cannot be completed as runnable code sight-unseen** — `llama-cpp-2`'s decode/sampling API is exactly the kind of fast-moving, version-specific surface that would be fabricated if written here without the crate in hand. Do not skip filling in the `todo!()` before calling this task done: pin the exact `llama-cpp-2` version in Step 2, read its own `examples/simple` (or equivalent) at that version, and mirror its decode loop.

- [ ] **Step 4: Build**

```bash
./mach vendor rust
./mach build binaries
```

Iterate on Steps 2-3 until this succeeds — expect this to be the slowest step in the whole plan.

- [ ] **Step 5: Re-run the Task 4 manual smoke test, now against a real downloaded model**

Repeat Task 4 Step 9's browser-console snippet, but with `modelPath` pointing at the file downloaded in Task 1 / cached by Task 5 (`~/.mozilla/.../northgate/models/qwen2.5-1.5b-instruct-q4_k_m.gguf` on Linux, or the equivalent profile path on your platform). Expected: `RESULT:` logs a real generated explanation instead of the stub string.

- [ ] **Step 6: Commit**

```bash
git add toolkit/components/northgate-llm/vendor toolkit/components/northgate-llm/build.rs \
        toolkit/components/northgate-llm/Cargo.toml toolkit/components/northgate-llm/src/engine.rs \
        .gitmodules
git commit -m "feat(northgate-llm): vendor llama.cpp and wire real inference"
```

---

### Task 9: Privacy docs, integration checklist, end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `src/THREAT_MODEL.md`
- Create: `toolkit/components/northgate-llm/LLM_INTEGRATION.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `README.md`'s privacy commitments section**

In the `### On-device ML privacy commitments` section, change:

```markdown
- **No network calls from the model.** The ONNX model is embedded in the binary; the ONNX Runtime is linked without any dynamic download, and scoring is entirely local.
```

to:

```markdown
- **No network calls from the phishing classifier.** The ONNX model is embedded in the binary; the ONNX Runtime is linked without any dynamic download, and scoring is entirely local.
- **One narrow, opt-in exception: the local LLM explanation feature.** `about:northgate`'s "Explain with local AI" button downloads a quantized language model (~1GB, from this project's own GitHub Releases, checksum-verified) the first time it's used, after explicit consent. This is the only network request anywhere in NorthGate's ML stack. After that one-time download, generation is 100% local, same as the classifier. The rest of NorthGate — including the phishing classifier and navigation guard — is completely unaffected if you never use this feature.
```

- [ ] **Step 2: Update `src/THREAT_MODEL.md`**

Read the file first to find its existing network/telemetry claims section, then add a corresponding entry documenting the same one-time, opt-in, checksum-verified download exception, cross-referencing `README.md`'s wording so the two documents don't drift.

- [ ] **Step 3: Write `LLM_INTEGRATION.md`**

Mirror the structure and tone of `toolkit/components/northgate/INTEGRATION.md` (pieces table, request flow diagram, numbered build steps, caveats section), covering:
- The component table: prompt/response crate, XPCOM service, download manager, actor messages, UI.
- The request flow: button click → consent → download+verify → `explainVerdict()` → background thread → callback → UI.
- A "Caveats" section listing: the `moz_task`/`ThreadPtrHolder` API surface flagged as unverified in Task 4, the llama.cpp decode-loop left unfinished in Task 8 pending the pinned crate version, and the process-isolation deferral from the design spec (link back to `docs/superpowers/specs/2026-09-24-local-llm-runtime-design.md`'s "Open items" section).

- [ ] **Step 4: End-to-end manual verification**

With Tasks 1-8 complete and built:

1. Fresh profile, `./mach run`, open `about:northgate` on any http(s) site.
2. Click "Explain with local AI" → consent prompt appears with accurate size/behavior copy.
3. Confirm → progress bar advances → model downloads into `<profile>/northgate/models/`.
4. Explanation text appears, is coherent, and does not claim signals beyond what `ngate-reasons` already listed for that page.
5. Restart the browser, repeat on a different site → no second download (state is `ready` immediately, per Task 5's `getState()`).
6. Disconnect network entirely, repeat on a third site → explanation still generates (proves inference truly makes no network calls).
7. Force an error (e.g., temporarily rename the cached model file) → UI shows the generic error message, and the classifier's verdict/score elsewhere on the page is unaffected.

- [ ] **Step 5: Commit**

```bash
git add README.md src/THREAT_MODEL.md toolkit/components/northgate-llm/LLM_INTEGRATION.md
git commit -m "docs(northgate-llm): document the LLM download exception and build checklist"
```
