# Build Log - Phase 1 Verification

Verification pass run after the mechanical rebranding described in [REBRAND_LOG.md](REBRAND_LOG.md).

## 1. Status

**The build was not executed.** The host has no usable Firefox build environment, and the
fork ships no native-Windows build configuration. No object directory was ever produced
(`obj-*` does not exist), so there is no build time or compiler warning set to report.

What was done instead: a static audit of every rebranding touch point against `HEAD`, which
found and fixed three broken references and one packaging mismatch. Details in section 4.

## 2. Host environment

| Item | Value |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 |
| CPU | 16 logical cores |
| RAM | 31.6 GB |
| Free disk (C:) | 219 GB (a full build needs roughly 40 GB) |
| `python` on PATH | 3.10.3 |
| `py -3` | 3.14.4 |
| MozillaBuild | not installed |
| Visual Studio / MSVC | not installed |
| `rustc` | not installed |
| `~/.mozbuild` | contains only `srcdirs`, so `mach bootstrap` never completed |

## 3. Why the build is blocked

### 3.1 `mach` cannot initialize

```
$ py -3 ./mach environment
AssertionError: MozillaBuild was not found at "C:\mozilla-build".
  at build/mach_initialize.py:90 in _maybe_activate_mozillabuild_environment()
```

This aborts before any command runs, so `./mach bootstrap` is equally unreachable. MozillaBuild
must be installed first; `bootstrap` does not install it.

`mach` also warns that Python 3.14.4 is above its supported ceiling and asks for 3.12 or lower.
MozillaBuild ships its own Python, which resolves this.

### 3.2 `bootstrap` cannot supply the C++ toolchain

`mach bootstrap` fetches clang, rust, cbindgen, nasm and node. It does **not** install Visual
Studio. A native Windows build additionally requires VS 2022 Build Tools with the MSVC v143
toolset and the Windows 11 SDK (~10 GB), installed manually through Microsoft's interactive
installer.

### 3.3 The fork has no native-Windows mozconfig

[mozconfig-windows-x86_64](mozconfig-windows-x86_64) is a **cross-compilation** config intended
to run on a Linux host:

```
ac_add_options --target=x86_64-pc-windows-gnu
ac_add_options --with-toolchain-prefix=x86_64-w64-mingw32-
```

It targets the MinGW-w64 GNU ABI, not MSVC, and several of its options exist to work around
MinGW limitations (`--disable-zucchini` for missing SEH, `--disable-default-browser-agent`).
Pointing `MOZCONFIG` at this file from a Windows host will not produce a working build. Building
natively on Windows requires writing a new MSVC mozconfig; that file does not exist yet.

The supported path, and the one upstream uses, is a Linux host.

## 4. Static verification of the rebranding

Cross-checked every renamed path against its consumers, and compared each modified file against
`git show HEAD:<path>` to distinguish intentional edits from omissions.

### 4.1 Correct

- `about:northgate-browser` is registered consistently across
  [AboutRedirector.cpp:167](browser/components/about/AboutRedirector.cpp#L167),
  [components.conf:15](browser/components/about/components.conf#L15),
  [DesktopActorRegistry.sys.mjs:112-125](browser/components/DesktopActorRegistry.sys.mjs#L112-L125)
  and [browser/components/moz.build:48](browser/components/moz.build#L48). No stale
  `about:mullvad-browser` remains outside of comments.
- [jar.mn](browser/components/northgate-browser/jar.mn) entries all resolve to files that exist
  in `content/`.
- `toolkit/locales/en-US/toolkit/global/northgate-browser.ftl` needs no packaging change: it is
  picked up by the `toolkit (%toolkit/**/*.ftl)` glob in `toolkit/locales/jar.mn`.
- Fluent message IDs match between the `.ftl` and every consumer, including the
  `mullvad-*`-prefixed IDs that were deliberately left unrenamed.

### 4.2 Broken references found and fixed

1. **`browser/base/content/aboutDialog.xhtml:39`** still loaded
   `toolkit/global/mullvad-browser.ftl`, which the rebranding renamed. The About dialog would
   have rendered with missing strings. Repointed to `northgate-browser.ftl`.

2. **`browser/branding/mb-alpha/content/aboutDialog.css:5`** and
   **`browser/branding/mb-nightly/content/aboutDialog.css:5`** still imported
   `chrome://branding/content/mullvad-branding.css`, renamed to `northgate-branding.css`.
   The `mb-release` copy has no such import, in `HEAD` either, so only the two alpha/nightly
   channels were affected. Both repointed.

3. **`MOZ_APP_NAME` / VisualElementsManifest mismatch.**
   [js/moz.configure:37](js/moz.configure#L37) derives `MOZ_APP_NAME` as
   `MOZ_APP_BASENAME.lower()`. The rebranding set `MOZ_APP_BASENAME=NorthGate`, which yields
   `northgate` and therefore `northgate.exe`, while the manifests were named
   `northgatebrowser.VisualElementsManifest.xml`. Windows only reads the manifest whose basename
   matches the executable, so the Start menu tile would have silently fallen back to the default.
   The mismatch is visible in [package-manifest.in:160-161](browser/installer/package-manifest.in#L160-L161),
   where `@MOZ_APP_NAME@.exe` sits next to the hardcoded manifest name.

   Fixed by setting `MOZ_APP_BASENAME=NorthGateBrowser` in
   [browser/config/mozconfigs/northgate-browser](browser/config/mozconfigs/northgate-browser),
   restoring the upstream convention (`MullvadBrowser` -> `mullvadbrowser.exe`, `Firefox` ->
   `firefox.exe`). This also sets `Name=` in `application.ini` and the profile directory name.

### 4.3 Repository state issues found and fixed

- The git index had been emptied, most likely by a `git rm -r --cached .`. `git status` reported
  465,171 staged deletions with the entire tree untracked, which made the rebranding impossible
  to review by diff. Restored with `git reset` (index only, working tree untouched). The real
  change set is 47 modified, 17 deleted, 13 untracked files.
- Three files unrelated to the rebranding were missing from the working tree and have been
  restored: `dom/base/crashtests/607222.html`, `dom/media/test/crashtests/2035081.mp4` and a
  `test262` file under `testing/web-platform/tests/third_party/`. The first two are
  crash-trigger fixtures and are plausible antivirus false positives; if they disappear again,
  add the repository to the Windows Defender exclusion list. The third failed to restore until
  `git config core.longpaths true` was set, which this checkout needs permanently.

### 4.4 Open, not build-blocking

- `imply_option("MOZ_APP_VENDOR", "Mullvad")` at
  [browser/moz.configure:16](browser/moz.configure#L16) is unchanged. It populates `Vendor=` in
  `application.ini` and Windows registry keys.
- User-facing copy in `toolkit/locales/en-US/toolkit/global/northgate-browser.ftl` still asserts
  a collaboration with the Tor Project and links to `mullvad.net`, and the About dialog still
  advertises `support@mullvadvpn.net`. These are factual claims about a third party, not just
  leftover branding, and should be rewritten before any public build.
- `trademarkInfo` in the three `brand.ftl` files still credits Mullvad VPN AB. This is likely
  intentional attribution; confirm against [NOTICE](NOTICE).
- Identifiers deliberately left as `MullvadBrowser` (Windows ProgIDs in
  `browser/components/shell/`, the `mullvadbrowser.migration.version` pref, the
  `LastMullvadBrowserVersion` compatibility key, `kVersionMullvadBrowser`). Renaming these
  breaks profile migration and default-browser registration continuity, so they should only
  change alongside a migration path.
- The wordmark file is still `mullvad-about-wordmark-en.ftl` with a matching message ID.
  Internally consistent, so cosmetic only.

## 5. Reproduction steps

### 5.1 Linux host (supported path)

```sh
# Prerequisites: ~40 GB free disk, git, python3, curl
./mach bootstrap --application-choice browser
ln -sf mozconfig-linux-x86_64 .mozconfig   # or: export MOZCONFIG=$PWD/mozconfig-linux-x86_64
./mach build
./mach run
```

Under WSL2, keep the checkout inside the Linux filesystem (`~/northgate-browser`), not under
`/mnt/c`. Building across the 9p mount is drastically slower.

For iterating on this rebranding specifically, `mozconfig-linux-x86_64-dev` is the better
starting point: it drops LTO and selects `--with-branding=browser/branding/mb-nightly`.

Front-end-only changes after the first full build:

```sh
./mach build faster
```

### 5.2 Windows host (needs work first)

1. Install VS 2022 Build Tools: "Desktop development with C++" workload, MSVC v143, Windows 11 SDK.
2. Install MozillaBuild 4.x to `C:\mozilla-build`, or set `MOZILLABUILD` to its location.
3. Launch `start-shell.bat` from MozillaBuild and run all `mach` commands from that shell.
4. `./mach bootstrap --application-choice browser`
5. **Write a native MSVC mozconfig.** `mozconfig-windows-x86_64` cannot be reused; it targets
   `x86_64-pc-windows-gnu` via MinGW. The new file should source
   `browser/config/mozconfigs/northgate-browser` and drop the MinGW-specific workarounds.
6. `./mach build && ./mach run`

## 6. Identity checks still pending

These require a successful build and are the remaining part of the verification:

- Window title and taskbar name read "NorthGate".
- `about:northgate-browser` loads as the home page and renders the wordmark.
- The About dialog shows NorthGate strings, i.e. the `northgate-browser.ftl` fix from 4.2 works.
- `application.ini` contains `Name=NorthGateBrowser` and the intended `Vendor=`.
- On Windows, `northgatebrowser.exe` ships next to `northgatebrowser.VisualElementsManifest.xml`
  and the Start menu tile picks it up.
