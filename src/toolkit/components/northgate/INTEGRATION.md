# NorthGate ONNX classifier — integration guide

On-device phishing detection wired into the navigation flow. Everything runs
locally: the model is compiled into the binary and neither training features
nor inference touch the network.

> Status: the code is complete and follows Gecko conventions, but it has **not
> been compiled** in this environment. Linking the `ort` (ONNX Runtime) crate
> into libxul is a multi-step build-system change (see step 3) that must be
> done and validated on a real build. Treat the notes below as the checklist to
> get it building.

## Pieces

| Layer | Location |
|-------|----------|
| Trained model + training script | `ml-model/model/` (`train_export.py`, `northgate_phishing.onnx`) |
| Rust inference crate (`ort`) | `toolkit/components/northgate/` (`src/lib.rs`, `src/features.rs`) |
| XPCOM interface | `toolkit/components/northgate/nsINorthGateClassifier.idl` → `@mozilla.org/northgate/classifier;1` |
| Embedded model copy | `toolkit/components/northgate/model/` (`include_bytes!`d into the crate) |
| Navigation hook (docshell) | `browser/components/northgate-browser/NorthGateNavGuard.sys.mjs` (`nsIContentPolicy`) |
| Internal score API (parent/content) | `browser/components/northgate-browser/NorthGateGuard{Parent,Child}.sys.mjs` |
| Warning interstitial | `about:northgate-blocked` (`content/aboutNorthGateBlocked.*`) |

### Request flow

```
top-level http(s) navigation
        │
        ▼
NorthGateNavGuard.shouldLoad  (nsIContentPolicy, TYPE_DOCUMENT)
        │  scoreURL(spec)  ── @mozilla.org/northgate/classifier;1 (Rust + ort)
        │                        └─ features::extract → ONNX Session::run (local)
        ▼
 score ≥ blockThreshold  and  not in session allow-list ?
        │ yes                              │ no
        ▼                                  ▼
 REJECT_REQUEST + redirect to        ACCEPT (normal navigation, untouched)
 about:northgate-blocked
        │
   user chooses
   ├─ "Go back"  → history.back()/about:home        (page-only)
   └─ "Continue" → NorthGateBlocked:Proceed event
                     → NorthGateGuardChild
                     → NorthGateGuardParent.AllowOnce
                        · add URL to NorthGateAllowList
                        · mirror to content procs via ppmm.sharedData
                        · re-navigate to the URL (now allow-listed)
```

## 1. Refresh the model

The ML pipeline lives at the repo root in `ml-model/`; the browser source is
under `src/`, so copy the exported model into `src/toolkit/...`:

```bash
cd ml-model
python model/train_export.py            # writes ml-model/model/northgate_phishing.onnx
cp model/northgate_phishing.onnx  ../src/toolkit/components/northgate/model/
cp model/feature_order.json       ../src/toolkit/components/northgate/model/
```

`feature_order.json` must stay in lockstep with `FEATURE_ORDER` in
`src/features.rs` and `BLOCK_THRESHOLD` in `src/lib.rs`. The deployed model is
trained on network-free features only (no `domain_age_days`/WHOIS).

## 2. Link the crate into libxul

Add the crate as a dependency of the shared gkrust crate:

- `toolkit/library/rust/shared/Cargo.toml`:
  ```toml
  northgate_classifier = { path = "../../../components/northgate" }
  ```
- `toolkit/library/rust/shared/lib.rs`:
  ```rust
  extern crate northgate_classifier;
  ```

Then refresh the vendored crates and lockfile:

```bash
./mach vendor rust           # pulls ort, ndarray, url, psl and their deps
```

## 3. ONNX Runtime native library (the heavy part)

`ort` needs the ONNX Runtime native library. To keep the build hermetic and the
runtime offline:

- Keep `default-features = false` on `ort` (already set) so the
  `download-binaries` feature stays **off** — otherwise Cargo fetches a prebuilt
  binary over the network at build time.
- Vendor a prebuilt (or self-built) `libonnxruntime` for each target
  (Windows/macOS/Linux/Android) and point `ort` at it, e.g. via
  `ORT_LIB_LOCATION` or a static-link build script. Building ONNX Runtime with
  telemetry disabled (`--disable_telemetry`) guarantees no runtime callbacks.
- Add the licensing (MIT) to `about:license` and account for the binary-size
  increase (tens of MB) in the packaging review.

> If native-lib integration proves too costly, `tract` (pure Rust, no native
> deps) is a drop-in alternative that loads the same `.onnx`; only `src/lib.rs`
> and `Cargo.toml` change.

## 4. Build & run

The change touches C++ (`AboutRedirector.cpp`), XPIDL and Rust, so a full build
is required the first time:

```bash
./mach build
./mach run
```

Front-end-only follow-ups (the guard/interstitial JS, CSS, FTL) rebuild with
`./mach build faster`.

## 5. Verify

1. `about:northgate-blocked?url=https://example.com&score=0.99` renders the
   warning with host + risk.
2. Navigate to a URL the model scores above `blockThreshold` (e.g. a long
   IP-literal login URL) → interstitial appears; normal sites load untouched.
3. "Continue" proceeds and is not re-blocked for the session; "Go back" returns.
4. Airplane mode / offline: scoring still works (model is embedded).

## Caveats

- **Content-policy placement/perf.** `shouldLoad` runs on a hot path; it fast
  -paths everything except top-level http(s) documents. Confirm under Fission
  whether the policy runs in the parent or content process on your build and
  that `bc.docShell`/`bc.loadURI` redirect works in that process.
- **Threshold tuning.** `BLOCK_THRESHOLD` (0.2429) was picked for ~99%
  precision on the held-out set; the dataset has a known homepage-vs-deeplink
  construction bias (see `ml-model/dataset/README.md`), so re-tune against real
  traffic before shipping to avoid false blocks.
- **Allow-list scope.** Session-only and in-memory; cleared on restart. It is
  intentionally not persisted.
