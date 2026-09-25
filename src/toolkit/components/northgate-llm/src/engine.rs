/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Model loading and text generation, backed by `llama-cpp-2` /
//! `llama-cpp-sys-2` (which in turn builds llama.cpp; see `build.rs` and
//! `vendor/llama.cpp`, pinned to tag `v0.5.0`).
//!
//! `generate()` is deliberately incomplete: it loads the model, creates a
//! context, and tokenizes the prompt, then returns
//! `EngineError::GenerationFailed("decode loop not implemented")` instead of
//! running a decode/sample loop. Task 8's brief is explicit that this loop
//! cannot be written responsibly without the pinned `llama-cpp-2` version in
//! hand to check its current decode/sampling API, which is a fast-moving,
//! version-specific surface (see the comment at the end of `generate()` for
//! what was actually verified against `llama-cpp-2` 0.1.158's
//! `examples/simple` at implementation time, and what remains to be
//! transcribed).

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;

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

        // `LlamaBackend::init()` sets up ggml's global state (thread pools,
        // backend registry). It is meant to be called once per process; if
        // more than one `Engine` ever needs to coexist we'll need to share
        // a single `LlamaBackend` rather than creating one per `Engine`, but
        // the current XPCOM plumbing (Task 4) only ever constructs one
        // `Engine` per `explainVerdict()` call.
        let backend = LlamaBackend::init()
            .map_err(|e| EngineError::GenerationFailed(format!("backend init failed: {e}")))?;

        // CPU-only inference: no `.with_n_gpu_layers(...)` override, so this
        // relies on llama-cpp-sys-2's build defaulting to a CPU-only build
        // when none of its GPU-backend Cargo features (cuda/metal/vulkan/
        // hip) are enabled -- which is the case here, since our Cargo.toml
        // pulls in `llama-cpp-2` with `default-features = false` and none of
        // those features turned on. Unverified beyond reading the crate's
        // published feature list; not exercised by an actual build here.
        let model_params = LlamaModelParams::default();
        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| EngineError::GenerationFailed(format!("model load failed: {e}")))?;

        Ok(Engine { backend, model })
    }

    pub fn generate(&self, prompt: &str, max_tokens: usize) -> Result<String, EngineError> {
        if prompt.is_empty() {
            return Err(EngineError::GenerationFailed("empty prompt".into()));
        }

        let ctx_params = LlamaContextParams::default();
        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| EngineError::GenerationFailed(format!("context init failed: {e}")))?;

        // `LlamaModel::str_to_token` + `AddBos` (as sketched in this task's
        // brief) is NOT what `llama-cpp-2` 0.1.158's own `examples/simple`
        // uses as of this writing -- that example tokenizes via
        // `model.vocab().tokenize(prompt.as_bytes(), add_bos, special)`.
        // Using the verified-current form rather than the brief's sketch,
        // since the brief itself says to consult the vendored version's
        // examples rather than trust the sketch verbatim.
        let add_bos = true;
        let parse_special = true;
        let tokens = self.model.vocab().tokenize(prompt.as_bytes(), add_bos, parse_special);

        // --- decode/sample loop: intentionally not implemented here. ---
        //
        // What's verified (read from llama-cpp-2 0.1.158's
        // `examples/simple/src/main.rs` at
        // https://github.com/utilityai/llama-cpp-rs on 2026-09-25):
        //   - Prompt tokens must first be loaded into an `LlamaBatch`
        //     (`llama_cpp_2::llama_batch::LlamaBatch`) and decoded once via
        //     `ctx.decode(&mut batch)` before sampling can start; the example
        //     builds that initial batch itself (sizing it, adding each
        //     prompt token with `batch.add(token, pos, &[0], is_last)`, and
        //     marking only the final prompt token as needing logits) and I
        //     have not independently verified every argument of that call
        //     well enough to transcribe it here without risking a subtly
        //     wrong sequence-id/logits flag that would silently produce
        //     garbage rather than fail loudly.
        //   - The per-token loop then is, at a high level: build a
        //     `LlamaSampler` chain (e.g.
        //     `LlamaSampler::chain_simple([LlamaSampler::dist(seed),
        //     LlamaSampler::greedy()])`), call
        //     `sampler.sample(&ctx, batch.n_tokens() - 1)`, `sampler.accept(token)`,
        //     stop when `model.vocab().is_eog(token)`, otherwise convert the
        //     token to text via `model.vocab().token_to_piece(token, true, None)`
        //     (through a `UTF_8` streaming decoder, since a single token can
        //     be a partial multi-byte UTF-8 sequence), clear and refill the
        //     batch with just the new token, and call `ctx.decode(&mut
        //     batch)` again, up to `max_tokens` iterations.
        //
        // What's NOT done here, deliberately: actually writing and testing
        // that loop against the real vendored `llama-cpp-2`/`llama-cpp-sys-2`
        // build. This environment cannot run `./mach build` (standing
        // blocker since Task 4; see task-8-report.md), so there is no way to
        // compile-check, let alone run, a hand-transcribed version of the
        // above against this crate's actual generated bindings -- doing so
        // would risk committing code that merely *looks* right. Whoever picks
        // this up next should build against the pinned `vendor/llama.cpp`
        // v0.5.0 / `llama-cpp-2` 0.1.158 (see Cargo.lock once generated),
        // re-read `examples/simple` at that exact locked version (APIs here
        // have already drifted once between the brief's sketch and current
        // main), and replace the `Err` return below with a loop that respects
        // `max_tokens` and appends decoded text to `output`.
        //
        // Until then this must return an error, never `todo!()`/panic: Gecko
        // builds Rust with `panic = "abort"` (see src/Cargo.toml), so a panic
        // here aborts the whole browser process instead of being caught by
        // the `catch_unwind` in lib.rs.
        let mut output = String::new();
        let _ = (&mut ctx, &tokens, max_tokens, &mut output);
        Err(EngineError::GenerationFailed(
            "decode loop not implemented".into(),
        ))
    }
}
