/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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
