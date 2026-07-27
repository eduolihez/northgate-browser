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
use std::io::Cursor;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

use nserror::{nsresult, NS_ERROR_FAILURE, NS_OK};
use nsstring::nsACString;
use tract_onnx::prelude::*;
use xpcom::interfaces::nsINorthGateClassifier;
use xpcom::{nsIID, xpcom_method, RefPtr};

mod features;

/// The trained model, compiled into the binary (guarantees offline scoring).
static MODEL_BYTES: &[u8] = include_bytes!("../model/northgate_phishing.onnx");

/// Block threshold — keep in sync with `model/feature_order.json`.
const BLOCK_THRESHOLD: f64 = 0.2429;

struct ModelWrapper {
    predict: Box<dyn Fn(&[f32]) -> Option<f64> + Send + Sync>,
}

/// Lazily-built inference model execution plan, shared for the life of the process.
fn model() -> Option<&'static ModelWrapper> {
    static MODEL: OnceLock<Option<ModelWrapper>> = OnceLock::new();
    MODEL
        .get_or_init(|| {
            let reader = Cursor::new(MODEL_BYTES);
            let runnable = tract_onnx::onnx()
                .model_for_read(reader)
                .ok()?
                .into_optimized()
                .ok()?
                .into_runnable()
                .ok()?;

            let predict = Box::new(move |feats: &[f32]| -> Option<f64> {
                let input_tensor: Tensor = ndarray::Array2::from_shape_vec(
                    (1, features::FEATURE_COUNT),
                    feats.to_vec(),
                )
                .ok()?
                .into();
                let outputs = runnable.run(tvec!(input_tensor)).ok()?;
                let probs_tensor = outputs.get(1)?;
                let view = probs_tensor.to_array_view::<f32>().ok()?;
                view.get([0, 1]).map(|p| *p as f64)
            });

            Some(ModelWrapper { predict })
        })
        .as_ref()
}

/// Run the model on one URL and return the phishing probability in [0, 1].
fn score(url: &str) -> Option<f64> {
    let feats = features::extract(url)?;
    let model = model()?;
    (model.predict)(&feats)
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
