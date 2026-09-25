# Local LLM runtime + enriched alert explanations — design

Status: approved for implementation planning
Date: 2026-09-24

## Context

NorthGate already ships a fully local phishing classifier
(`nsINorthGateClassifier`): a tree-ensemble model exported to ONNX, run
synchronously and offline via `tract-onnx` (pure Rust, no external binary
dependencies), embedded in the binary via `include_bytes!`. It scores a URL
from lexical features alone and exposes `scoreURL()` / `blockThreshold` to
the navigation guard (`NorthGateNavGuard.sys.mjs`) and the `about:northgate`
dashboard.

The roadmap's Phase 3 ("Blue-team tooling") calls for richer local security
analysis. This spec covers the first sub-project of that phase: a local LLM
inference runtime plus one concrete use of it — turning the classifier's
numeric verdict into a natural-language explanation on demand.

This is the first of several planned LLM-backed features (page content
analysis, script/JS analysis, a conversational security assistant). Those
are explicitly **out of scope** here and will get their own specs once this
runtime exists, since each introduces materially different inputs
(untrusted page content vs. trusted, already-extracted features) and
therefore different security considerations.

## Goals

- Add a local LLM inference runtime to NorthGate that other security
  features can build on.
- Use it for one feature in this sub-project: an on-demand, natural-language
  explanation of why the classifier scored a page the way it did, shown in
  `about:northgate`.
- Preserve the project's existing guarantees wherever possible: local-only
  inference, fail-safe behavior (the LLM is never on the blocking path),
  reproducible CI builds on Linux/Windows/macOS.

## Non-goals

- Analyzing page HTML, DOM text, or JavaScript with the LLM (future
  sub-projects — different input trust boundary).
- A conversational chat interface (future sub-project).
- Process-level sandboxing/isolation of the LLM inference (deferred until a
  sub-project feeds it untrusted page content — see "Security
  considerations").
- Automated quality evaluation of generated explanations (qualitative,
  manual validation only for this sub-project).

## Approach

### Inference engine: llama.cpp via Rust bindings

Chosen over `tract` (the engine already used by the classifier) because
`tract` has no GGUF/quantization support and isn't optimized for LLM-scale
models — it would badly limit viable model size/speed. Chosen over `candle`
for maturity/performance on CPU-only inference.

This is a deliberate departure from the classifier's "zero external binary
dependencies" property: llama.cpp is vendored C++ source, built via `cmake`
as part of the `mach build`, analogous to how Firefox already vendors other
native third-party libraries. It is **not** a system/dynamic dependency —
builds stay fully reproducible in CI with no new install-time requirements.

### Model: ~1-2B parameter instruct model, quantized (GGUF, Q4)

E.g. Qwen2.5-1.5B-Instruct or Llama-3.2-1B. Chosen as the balance point:
coherent short explanations, ~1-2GB RAM at Q4, acceptable CPU latency on a
typical laptop. Smaller models were judged too unreliable for explanatory
text; larger models (3-4B) too slow/heavy without a GPU requirement.

### Distribution: optional download on first use

The model is **not** embedded in the binary (unlike the ONNX classifier) —
at ~800MB-1GB it would make the installer and CI artifacts unreasonably
large. Instead:

- The `.gguf` is hosted on the project's own GitHub Releases, at a URL
  pinned to a specific release and a SHA-256 checksum embedded in source.
- Downloaded once, on first use of the "Explicar" feature, into the user's
  profile directory (`<profile>/northgate/models/`), after explicit user
  consent (size shown up front).
- This is the **only** network request this feature ever makes. It is an
  explicit, documented, opt-in exception to NorthGate's "zero network
  requests" posture (see "Privacy documentation updates" below) — inference
  itself, after download, makes no network calls.

### Process placement: in-process, async, parent process

A new XPCOM component runs in the parent process (like the existing
classifier), not in a sandboxed utility/content process. This is safe for
this sub-project specifically because the only data reaching the LLM is
already-trusted, already-extracted numeric/categorical features (URL
length, entropy, keyword flags, etc.) and the classifier's score — the same
data already shown verbatim in the dashboard today. No raw page content,
HTML, or script source reaches the model in this sub-project.

Unlike the classifier, inference cannot be synchronous: generation from a
1-2B model takes hundreds of ms to several seconds on CPU. The API is
Promise-based; generation runs on a dedicated thread and resolves back on
the main thread.

**This placement decision does not carry over to future sub-projects.**
Page content and script analysis feed the LLM attacker-influenced input and
will need their own security review (prompt-injection resistance, likely
process isolation) before reusing this runtime.

## Components

### `northgate-llm` (new Rust crate, `src/toolkit/components/northgate-llm/`)

- New XPCOM service, `nsINorthGateLLM`, parallel to
  `nsINorthGateClassifier`.
- `explainVerdict(features, score, threshold) -> Promise<AUTF8String>`:
  builds a short, fixed-template prompt from the already-extracted
  features and the score (no free-form/user-controlled text in the
  prompt), runs generation on a dedicated thread, resolves the returned
  Promise with the explanation text.
- Bounded output (~200 tokens) and a generation timeout (~15s) so a slow
  machine never hangs the UI.
- Panics during inference are caught (`catch_unwind`, same pattern as
  `NorthGateClassifier::score_url`) and surfaced as a rejected Promise, not
  a crash.
  **Correction (post-implementation):** Gecko builds Rust with
  `panic = "abort"` (`src/Cargo.toml`), so `catch_unwind` does *not* catch
  panics here; a panic aborts the browser. The actual safety property is
  "never panic in the first place": the inference path must return errors
  (see `LLM_INTEGRATION.md`).
- Model loading is lazy and cached for the process lifetime (mirrors
  `model()` in the existing classifier's `lib.rs`), but sourced from the
  profile-directory file instead of `include_bytes!`.
  **Not yet implemented:** every call currently reloads the model and
  re-initializes the llama.cpp backend; tracked in `LLM_INTEGRATION.md`.

### `NorthGateLLMManager` (new JS ES Module, alongside `NorthGateNavGuard.sys.mjs`)

- Tracks model state: not-downloaded / downloading / ready / error.
- Drives the first-use download flow: fetch from the pinned GitHub
  Releases URL, verify SHA-256 against the embedded expected hash, discard
  and allow retry on mismatch or failure, write into
  `<profile>/northgate/models/` only after verification succeeds.
- Reports progress for the UI's download progress bar.

### `about:northgate` UI changes

- "Explicar" button next to the existing verdict/score display.
- Model not ready → clicking shows a consent prompt (approx. size stated)
  before starting the download, then a progress bar.
- Model ready → clicking shows a loading state, then the generated
  explanation text, or an error message if generation failed.
- The existing verdict/score/blocking UI is unchanged and does not depend
  on the LLM in any way.

## Data flow

1. User views a scored page in `about:northgate` and clicks "Explicar".
2. If the model isn't downloaded: consent → download → checksum verify →
   cache in profile dir → proceed to step 3. If any step fails, show error,
   allow retry, no partial file left in place.
3. Dashboard calls `nsINorthGateLLM.explainVerdict()` with the features
   already computed for that page (the same struct the classifier used),
   the score, and the threshold.
4. `northgate-llm` builds the fixed-template prompt, runs generation on its
   worker thread.
5. Promise resolves with explanation text (success) or rejects (failure) →
   UI renders accordingly.

## Error handling

Fail-safe, matching the existing classifier's philosophy: the LLM is
never part of the blocking decision path — `NorthGateNavGuard` continues to
rely solely on `nsINorthGateClassifier`.

- Model not downloaded: feature is inert until the user opts in; nothing
  else is affected.
- Download failure / checksum mismatch: error shown, partial file
  discarded, retry available.
- Inference failure, panic, or timeout (see the `panic = "abort"`
  correction above: panics are not actually catchable): caught, Promise rejects, UI shows
  "couldn't generate an explanation"; the classifier's verdict remains
  visible and correct.
- Insufficient RAM / model load failure: same rejected-Promise path, with a
  distinguishable error message where detectable.

## Testing

- Rust unit tests: prompt construction is deterministic for a given
  features/score input; response truncation/parsing logic.
- Download/verification: checksum-mismatch and retry behavior against a
  mock server.
- Manual: `./mach build binaries` after vendoring llama.cpp, `./mach run`,
  verify the explanation flow on both a blocked and a normal page, and
  verify the dashboard behaves normally with no model downloaded.
- No automated quality evaluation of generated text in this sub-project —
  it's generative output, not a binary metric; validated qualitatively by
  hand.

## Privacy documentation updates

`README.md` and `src/THREAT_MODEL.md` currently state the classifier makes
zero network requests. This feature is opt-in and must be documented as an
explicit, narrow exception:

- Only network call: one-time model download from the project's own GitHub
  Releases, only after explicit user consent, only on first use of
  "Explicar".
- After download, inference is 100% local, same as the classifier.
- Feature is fully optional; the rest of NorthGate's protection (the
  classifier, nav guard) is completely unaffected if the user never opts
  in.

## Open items for future sub-projects (not blocking this one)

- Process isolation for the LLM runtime, once page content/JS (untrusted
  input) is fed to it.
- Prompt-injection resistance review for those sub-projects.
- Reusing `northgate-llm`'s model-loading/generation machinery for content
  analysis, script analysis, and the conversational assistant.
