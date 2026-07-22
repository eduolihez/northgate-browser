/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! On-device phishing classifier exposed to Gecko as the XPCOM service
//! `@mozilla.org/northgate/classifier;1` (`nsINorthGateClassifier`).
//!
//! The ONNX model is embedded in the binary via `include_bytes!`, and the
//! `ort` runtime is linked statically with no dynamic loading, so scoring is
//! completely local and never performs network I/O.

#[macro_use]
extern crate xpcom;

use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

use nserror::{nsresult, NS_ERROR_FAILURE, NS_OK};
use nsstring::nsACString;
use xpcom::interfaces::nsINorthGateClassifier;
use xpcom::{nsIID, xpcom_method, RefPtr};

mod features;

/// The trained model, compiled into the binary (guarantees offline scoring).
static MODEL_BYTES: &[u8] = include_bytes!("../model/northgate_phishing.onnx");

/// Block threshold — keep in sync with `model/feature_order.json`.
const BLOCK_THRESHOLD: f64 = 0.2429;

/// Lazily-built inference session, shared for the life of the process.
fn session() -> Option<&'static ort::session::Session> {
    static SESSION: OnceLock<Option<ort::session::Session>> = OnceLock::new();
    SESSION
        .get_or_init(|| {
            ort::session::Session::builder()
                .ok()?
                .with_optimization_level(
                    ort::session::builder::GraphOptimizationLevel::Level3,
                )
                .ok()?
                .with_intra_threads(1)
                .ok()?
                // Inference from the embedded bytes; no file or network access.
                .commit_from_memory(MODEL_BYTES)
                .ok()
        })
        .as_ref()
}

/// Run the model on one URL and return the phishing probability in [0, 1].
fn score(url: &str) -> Option<f64> {
    let feats = features::extract(url)?;
    let session = session()?;
    let input = ndarray::Array2::from_shape_vec((1, features::FEATURE_COUNT), feats.to_vec())
        .ok()?;
    let outputs = session.run(ort::inputs!["X" => input].ok()?).ok()?;
    // Output "probabilities" has shape [1, 2]; column 1 is the phishing class.
    let probs = outputs["probabilities"]
        .try_extract_tensor::<f32>()
        .ok()?;
    let view = probs.view();
    view.get([0, 1]).map(|p| *p as f64)
}

#[xpcom(implement(nsINorthGateClassifier), atomic)]
struct NorthGateClassifier {}

impl NorthGateClassifier {
    fn new() -> RefPtr<NorthGateClassifier> {
        NorthGateClassifier::allocate(InitNorthGateClassifier {})
    }

    xpcom_method!(score_url => ScoreURL(url: *const nsACString) -> f64);
    fn score_url(&self, url: &nsACString) -> Result<f64, nsresult> {
        let url = std::str::from_utf8(url).map_err(|_| NS_ERROR_FAILURE)?;
        // Never let a panic in inference unwind across the FFI boundary.
        catch_unwind(AssertUnwindSafe(|| score(url)))
            .ok()
            .flatten()
            .ok_or(NS_ERROR_FAILURE)
    }

    xpcom_method!(get_block_threshold => GetBlockThreshold() -> f64);
    fn get_block_threshold(&self) -> Result<f64, nsresult> {
        Ok(BLOCK_THRESHOLD)
    }
}

/// XPCOM constructor referenced by `components.conf`.
///
/// # Safety
/// `result` must be a valid out-pointer supplied by the XPCOM component
/// manager.
#[no_mangle]
pub unsafe extern "C" fn nsNorthGateClassifierConstructor(
    iid: &nsIID,
    result: *mut *mut c_void,
) -> nsresult {
    let instance = NorthGateClassifier::new();
    let rv = instance.QueryInterface(iid, result);
    if rv.failed() {
        return rv;
    }
    NS_OK
}
