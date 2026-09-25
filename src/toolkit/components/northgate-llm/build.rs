/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Deliberately does NOT cmake-build `vendor/llama.cpp` itself, unlike the
//! sketch in this task's brief. Reason, discovered while implementing this
//! task (verified against `llama-cpp-sys-2` 0.1.158's `build.rs` on
//! https://github.com/utilityai/llama-cpp-rs on 2026-09-25, not exercised
//! by an actual build in this environment):
//!
//! `llama-cpp-2` depends on `llama-cpp-sys-2`, which ships its OWN bundled
//! copy of the llama.cpp C/C++ sources inside the published crate and
//! compiles THAT copy itself, from ITS OWN `build.rs`, via the `cmake`
//! crate. It hardcodes the source path as `<its manifest dir>/llama.cpp`
//! and documents no environment variable or Cargo feature for pointing it
//! at an externally supplied llama.cpp tree instead.
//!
//! That means a `build.rs` in *this* crate has no supported way to make
//! `llama-cpp-sys-2` build against our pinned `vendor/llama.cpp` (v0.5.0)
//! submodule rather than its own internal copy. If this build.rs cmake-built
//! `vendor/llama.cpp` and emitted `cargo:rustc-link-lib=static=llama` itself
//! (as the brief's sketch does), that would link a *second*, independently
//! built `llama`/`ggml` static lib into the final binary alongside the one
//! `llama-cpp-sys-2` already produces and generated its Rust bindings
//! against via bindgen -- at best a wasted build, at worst duplicate-symbol
//! link errors or (if the linker picks the wrong one) an ABI mismatch
//! between `llama-cpp-2`'s bindings and the actual linked library. Neither
//! outcome is something to commit without being able to build and observe
//! which one actually happens, so this file does not attempt it.
//!
//! `vendor/llama.cpp` is kept as the audited, pinned reference copy Task
//! 8's brief asked for and as the documented source of truth for which
//! llama.cpp version this component targets, but reconciling it with
//! `llama-cpp-sys-2`'s own internal copy (e.g. via a `[patch]` in the
//! workspace `Cargo.toml` that replaces `llama-cpp-sys-2` with a vendored,
//! locally-patched copy whose build.rs points at `vendor/llama.cpp`, or by
//! dropping this submodule in favor of `llama-cpp-sys-2`'s bundled one and
//! keeping only a version pin here) needs hands-on iteration against the
//! real crate and `./mach vendor rust` output, which the standing
//! `./mach build` blocker in this environment rules out. See Task 8's
//! report for details.
//!
//! What this build.rs does do: a fail-fast sanity check that the submodule
//! was actually checked out (an uninitialized submodule directory is empty
//! and would otherwise fail much more confusingly, deep inside whatever
//! future step actually reads `vendor/llama.cpp`), plus a `cargo:warning`
//! restating the above so it's visible in build output, not just source.

fn main() {
    let vendored_cmakelists = std::path::Path::new("vendor/llama.cpp/CMakeLists.txt");
    if !vendored_cmakelists.exists() {
        panic!(
            "toolkit/components/northgate-llm/vendor/llama.cpp looks empty \
             (missing CMakeLists.txt) -- the git submodule was probably not \
             checked out. From the repository root, run:\n\n  \
             git submodule update --init \
             toolkit/components/northgate-llm/vendor/llama.cpp\n"
        );
    }

    println!(
        "cargo:warning=northgate_llm: vendor/llama.cpp (pinned tag v0.5.0) is present but is \
         NOT what actually gets compiled into this binary -- llama-cpp-sys-2 bundles and \
         cmake-builds its own internal copy of llama.cpp. See build.rs's module comment and \
         this task's report for why, and what reconciling them would take."
    );
}
