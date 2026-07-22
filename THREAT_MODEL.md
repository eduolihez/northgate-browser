# NorthGate Browser - Threat Model & Inherited Hardening

NorthGate is a fork of Mullvad Browser, which is itself Base Browser (the Tor Project's
de-Tor-ified fork of Firefox ESR) plus Mullvad's configuration. This document inventories the
privacy/security hardening **already inherited** from that lineage, states **what each control
mitigates and what it does not**, and marks the integration points for the future AI module
(phase 5) so that it can be added without regressing the posture below.

Sources audited:
[browser/app/profile/001-base-profile.js](browser/app/profile/001-base-profile.js) (Base Browser
hardening, ~1130 lines), [browser/app/profile/000-northgate-browser.js](browser/app/profile/000-northgate-browser.js)
(NorthGate/Mullvad overlay), the bundled extension integration under
[browser/extensions/](browser/extensions/) and
[toolkit/components/securitylevel/](toolkit/components/securitylevel/), and
[AMBIGUOUS_REFS.md](AMBIGUOUS_REFS.md).

Preference values marked **(locked)** cannot be overridden by the user in `about:config` nor by a
later `defaultPref`; several are additionally compiled out (`--disable-eme`,
`MOZ_CRASHREPORTER` off, ML engine excluded), so the pref is defense-in-depth on top of a
build-time removal.

---

## 1. Baseline assumptions

- **Everyone gets Private Browsing Mode, always.** `browser.privatebrowsing.autostart = true`.
  There is no "normal" mode; the browser is a single always-PBM profile. Most disk-persistence
  controls below follow from this.
- **NorthGate does not ship or embed Tor.** Unlike Tor Browser, traffic is *not* anonymized at the
  network layer by default. The intended deployment is "run it behind Mullvad VPN (or another
  trusted tunnel)". The browser hardens the *client*; it does not hide your IP by itself.
- **The anti-fingerprinting goal is a large anonymity set, not per-user uniqueness.** The design
  intent (inherited from Tor Browser's RFP) is that all NorthGate users on a platform look
  identical, not that each user is individually cloaked. This only holds if users do not customize
  fingerprintable surfaces (window size, fonts, extensions).

---

## 2. Inherited hardening, by threat

### 2.1 Browser fingerprinting (cross-site linkability without cookies)

| Control | Pref(s) | Effect |
| --- | --- | --- |
| Resist Fingerprinting (RFP) | `privacy.resistFingerprinting = true` **(locked in release)** | Master Tor-Browser anti-fingerprinting: spoofed UA/platform, timezone forced to UTC, reduced timer precision, spoofed screen/`devicePixelRatio`, one audio+one video device reported, locale spoofing, canvas/WebGL readback poisoning. |
| Canvas noise | `privacy.resistFingerprinting.randomDataOnCanvasExtract = true` **(locked)** | Canvas `getImageData`/`toDataURL` reads return per-session randomized data instead of a stable device signature. |
| Letterboxing | `privacy.resistFingerprinting.letterboxing = true` (+ `.vcenter`, `.gradient`) | Content viewport is rounded to fixed steps so exact inner window size is not a fingerprinting vector. |
| Locale spoofing | `privacy.spoof_english = 2`, `intl.locale.requested = ""` | Sites see `en-US` regardless of OS locale; `Accept-Language` normalized. |
| Bundled fonts + whitelist | `gfx.bundled-fonts.activate = 1`, per-platform `font.system.whitelist` | Font enumeration yields a fixed set, defeating installed-font fingerprinting. |
| WebGL / WebGPU / offscreen canvas | `webgl.enable-webgl2 = false`, `dom.webgpu.enabled = false`, `gfx.offscreencanvas.enabled = false`, `webgl.disable-fail-if-major-performance-caveat = true` | Removes GPU-model / driver / performance-tier fingerprints. |
| Sensor / hardware APIs off | `dom.webmidi.enabled`, `dom.vr.enabled`, `dom.netinfo.enabled`, `media.devices.enumerate.legacy.enabled`, `dom.text-recognition.enabled` all `false` | Eliminates MIDI/VR/network-quality/device-id surfaces. |
| Media codec normalization | `media.hevc.enabled = false`, `media.benchmark.vp9.threshold = 0` | Hides hardware codec support differences. |
| Add-on manager shielded from content | `privacy.resistFingerprinting.block_mozAddonManager = true` | Pages cannot probe installed add-ons via `mozAddonManager`. |
| Theme / accent leaks | `browser.display.document_color_use = 1`, `widget.non-native-theme.use-theme-accent = false`, `widget.wayland.vsync.enabled = false`, `widget.wayland.fractional-scale.enabled = false` | Prevents OS theme / accent color / refresh-rate / scaling from leaking. |

**Mitigates:** stateless cross-site tracking, re-identification after cookie clearing, canvas/WebGL/font/hardware fingerprinting.
**Does NOT protect against:** a user who resizes the window off the letterbox grid, installs extra
extensions, or changes RFP-governed settings (each shrinks the anonymity set); server-side
**behavioral** fingerprinting (typing cadence, scroll, mouse dynamics); network-layer identification
(your IP — that is the VPN's job); fingerprinting by a site you have logged into (you told them who
you are).

### 2.2 Disk / local forensic leakage

`browser.cache.disk.enable = false`, `permissions.memory_only = true`, `security.nocertdb = true`,
`browser.sessionstore.privacy_level = 2`, `browser.download.start_downloads_in_tmp_dir = true` +
`browser.download.useDownloadDir = false`, `browser.helperApps.deleteTempFileOnExit = true`,
`browser.pagethumbnails.capturing_disabled = true`, `browser.sessionstore.resume_from_crash = false`,
`signon.rememberSignons = false` **(locked)**, `browser.formfill.enable = false` **(locked)**,
`browser.privatebrowsing.forceMediaMemoryCache = true`, `browser.backup.enabled = false`,
clipboard scrubbing (`browser.privatebrowsing.preserveClipboard = false`,
`clipboard.copyPrivateDataToClipboardCloudOrHistory = false`).

**Mitigates:** a local adversary (shared/seized machine, forensic imaging) recovering browsing
history, cached pages, saved passwords, cert history, or downloaded-file traces after the session.
**Does NOT protect against:** an adversary present *during* the live session (RAM contains the
session); files the user deliberately saves; OS-level artifacts outside the browser's control
(swap/hibernation, filesystem journaling, shell history); a compromised OS or keylogger.

### 2.3 Network-level tracking & data exfiltration to third parties

| Control | Pref(s) |
| --- | --- |
| Third-party cookies blocked | `network.cookie.cookieBehavior = 1` (+ `.pbmode`) |
| First-party isolation | `privacy.firstparty.isolate = true` |
| URL query-param stripping | `privacy.query_stripping.enabled = true` (+ strip-on-share) |
| Referer minimization | `network.http.referer.XOriginTrimmingPolicy = 2`, `defaultPolicy = 2`, `.hideOnionSource` |
| Global Privacy Control | `privacy.globalprivacycontrol.enabled = true` |
| Prefetch / speculative connections off | `network.predictor.enabled`, `network.prefetch-next`, `network.dns.disablePrefetch = true`, `network.http.speculative-parallel-limit = 0`, `browser.places.speculativeConnect.enabled = false` |
| Hyperlink auditing off | `browser.send_pings = false` |
| Geolocation off | `geo.enabled = false` (+ all providers blanked) |
| Search/urlbar suggestions & telemetry off | `browser.search.suggest.enabled = false`, all `browser.urlbar.suggest.*` / `quicksuggest` / Pocket / trending / weather gates off |

**Mitigates:** third-party cookie tracking, referrer leakage, click-tracking redirect params, DNS
prefetch leaks, sending your queries/URLs to Mozilla or search partners.
**Does NOT protect against:** first-party tracking by sites you visit; server-side IP+timing
correlation; tracking via login identity; a determined first party colluding with third parties
server-side (CNAME cloaking is partially addressed by uBlock, see 3.1, not by these prefs).

### 2.4 Transport security

`dom.security.https_only_mode = true` (+ `.pbm`), `security.ssl.require_safe_negotiation = true`,
`security.tls.version.enable-deprecated = false` **(locked)**, `security.ssl.disable_session_identifiers = true`,
`security.cert_pinning.enforcement_level = 2`, `security.enterprise_roots.enabled = false`,
`security.osclientcerts.autoload = false`, `security.certerrors.mitm.*` disabled,
weak DHE ciphers `(locked) false`.

**Mitigates:** passive downgrade to plaintext, TLS renegotiation MitM (CVE-2009-3555), TLS session-ID
linkability, MitM via injected enterprise/OS root CAs, deprecated TLS versions.
**Does NOT protect against:** a CA that mis-issues for a domain NorthGate does not pin; endpoint
compromise; a network that blocks HTTPS-Only exceptions the user manually accepts.

### 2.5 Telemetry, phone-home, and "engagement" surfaces

Unified telemetry off and **canary'd** (`toolkit.telemetry.enabled = false (locked)`,
cached client/profile IDs forced to fixed canary UUIDs **(locked)**), health report / Normandy /
Shield / Nimbus rollouts / experiments all disabled, crash reporting off, Safe Browsing fully
disabled with blanked provider URLs, captive-portal and connectivity checks off, Firefox Suggest /
Pocket / CFR recommendations off, `browser.preonboarding.enabled = false`, `browser.aboutwelcome.enabled = false`.

**Mitigates:** background pings to Mozilla/Google that reveal usage, IP, and install; Safe Browsing
URL hash leakage; experiment-driven remote config changing behavior silently.
**Does NOT protect against:** DNS resolution itself revealing destinations (mitigated separately by
DoH, see 4); a network observer seeing TLS SNI / IP; update checks (these still contact the update
server by design, see 4).

### 2.6 Attack surface reduction

ServiceWorkers off (`dom.serviceWorkers.enabled = false`), Push off (`dom.push.enabled = false`,
server URL blanked), WebRTC hardened (see below), WebAuthn off (`security.webauth.webauthn = false`),
XSLT off (`dom.xslt.enabled = false`), SharedArrayBuffer-with-COOP/COEP off, EME/DRM/Widevine
disabled and GMP provider neutralized, `pdfjs.enableScripting = false`,
`network.file.disable_unc_paths = true`, `network.file.path_blacklist = /net`,
`network.socket.ip_addr_any.disabled = true` (blocks `0.0.0.0`), external protocol handlers off by
default, `dom.private-attribution.submission.enabled = false`.

**WebRTC note (NorthGate-specific risk):** unlike Tor Browser, **WebRTC is enabled by default**
([001-base-profile.js:649](browser/app/profile/001-base-profile.js#L649)). The IP-leak defenses are
therefore *first line*, not defense-in-depth: `media.peerconnection.ice.relay_only = true`,
`.default_address_only = true`, `.no_host = true`, `.obfuscate_host_addresses = true`,
`.proxy_only_if_behind_proxy = true`. **Mitigates** the classic WebRTC local/public-IP leak. **Does
NOT** fully eliminate WebRTC as a surface; if a future change relaxes any of these, IP leakage
returns immediately.

### 2.7 Local AI / ML features (currently disabled by policy)

This section matters most for phase 5. Base Browser removed or disabled Firefox's on-device ML stack
([001-base-profile.js:343-386](browser/app/profile/001-base-profile.js#L343-L386), tor-browser#44045):

| Pref | Value | Governs |
| --- | --- | --- |
| `browser.ml.enable` | `false` **(locked)** | Master switch for the internal inference process (ONNX/transformers.js runtime). [EngineProcess.sys.mjs:1120](toolkit/components/ml/content/EngineProcess.sys.mjs#L1120) refuses to spawn the ML process when false. |
| `browser.ml.chat.enabled` | `false` **(locked)** | Third-party AI chatbot sidebar. |
| `browser.ml.linkPreview.enabled` | `false` **(locked)** | ML link previews. |
| `extensions.ml.enabled` | `false` **(locked)** | ModelHub / `trialML` API exposure to WebExtensions. |
| `browser.ai.control.default` | `"blocked"` **(locked)** | `about:preferences` global AI opt-out state; UI reacts to it. |
| `browser.translations.enable` | `false` **(locked)** | Local translation engine (models RemoteSettings also emptied). |
| `browser.tabs.groups.smart.*`, `browser.urlbar.quicksuggest.mlEnabled`, `places.semanticHistory.featureGate` | `false` **(locked)** | Smart tab groups, ML urlbar suggestions, semantic history. |
| `pdfjs.enableAltText*`, `pdfjs.enableGuessAltText` | `false` **(locked)** | ML alt-text generation in the PDF viewer. |

Beyond the locks, the comments state the **ML engine is excluded from the build** and the
`translations-models` RemoteSettings collection is empty, so even unlocking the prefs would not
produce a working local model without a rebuild.

**Mitigates:** silent local model downloads, on-device inference over page content, an AI feature
becoming a new telemetry/network channel, and extensions gaining ML capabilities.
**Does NOT protect against:** a *first-party* feature we deliberately add (phase 5) — that is exactly
what section 5 governs.

---

## 3. Bundled extensions

The `.xpi` payloads for uBlock Origin and NoScript are **not** in this gecko tree; they are injected
at packaging time by `tor-browser-build`. This repository carries the *integration* that makes them
first-class, security-critical components rather than optional add-ons.

### 3.1 uBlock Origin (`uBlock0@raymondhill.net`)
- **Uninstall/disable protection:** [XPIDatabase.sys.mjs](toolkit/mozapps/extensions/internal/XPIDatabase.sys.mjs)
  hard-codes uBlock (and NoScript) as non-removable (mullvad-browser#163). Users cannot turn it off,
  so its content/ad/tracker blocking is part of the guaranteed baseline.
- **Role:** blocks ads, trackers, and known-malicious domains; provides CNAME-uncloaking and
  cosmetic filtering that the network prefs in 2.3 cannot do on their own.

### 3.2 NoScript
- **Bound to the Security Level slider:** [SecurityLevel.sys.mjs](toolkit/components/securitylevel/SecurityLevel.sys.mjs)
  drives NoScript's per-level policy. Slider default is index 4 = **Standard** (all enabled);
  **Safer** disables JIT and some content; **Safest** blocks JS on non-HTTPS (and more). The UI
  string set lives in [base-browser.ftl](toolkit/locales/en-US/toolkit/global/base-browser.ftl).
- **UI prefs:** `extensions.hideNoScript = true` and `extensions.hideUnifiedWhenEmpty = true`
  ([001-base-profile.js:315](browser/app/profile/001-base-profile.js#L315)) hide the raw NoScript
  button in favor of the Security Level control.
- **Role:** the user-facing security/permissiveness dial (script/JIT/media gating), and a per-site
  script permission enforcer.

### 3.3 Mozilla system add-ons present in-tree
These are shipped by Firefox and kept (or neutralized) by the fork; they are hidden system add-ons
(`hidden: true`, `*@mozilla.com`, loaded via `SCOPE_APPLICATION`), the same delivery pattern the AI
module should follow (see 5.1):
- [`data-leak-blocker`](browser/extensions/data-leak-blocker/) — `dataAbuseDetection` experiment API.
- [`search-detection`](browser/extensions/search-detection/) — detects add-ons hijacking search
  (`<all_urls>`, `webRequestBlocking`).
- [`ipp-activator`](browser/extensions/ipp-activator/) — IP Protection activator; **feature disabled**
  in this branch (HEAD = "fixup! BB 44528: Disable the IP Protection feature"). Present but inert.

### 3.4 Extension-loading policy (applies to any add-on, including ours)
`extensions.enabledScopes = 5` (PROFILE | APPLICATION only — **not** user/system dirs or Windows
registry), `extensions.autoDisableScopes = 0`, `extensions.webextensions.restrictedDomains = ""`
(so NoScript works on `addons.mozilla.org`), `extensions.postDownloadThirdPartyPrompt = false`,
`extensions.getAddons.showPane = false`, recommendations/discovery off.

**Mitigates:** sideloaded/registry-injected malicious extensions, AMO-advertised third-party add-ons
gaining privilege.
**Does NOT protect against:** a malicious extension the user installs deliberately; supply-chain
compromise of uBlock/NoScript upstream (they are auto-trusted and non-removable).

---

## 4. Intentionally preserved outbound connections (Mullvad infrastructure)

These are the *only* endpoints the hardened default configuration will contact without user action.
They are catalogued in [AMBIGUOUS_REFS.md](AMBIGUOUS_REFS.md) and set in
[000-northgate-browser.js](browser/app/profile/000-northgate-browser.js):

- **DoH resolver:** `network.trr.mode = 3` (TRR-only, no plaintext fallback), `network.trr.uri =
  https://dns.mullvad.net/dns-query`, heuristics disabled. All DNS goes to Mullvad over HTTPS.
- **Update / support / feedback URLs:** `mullvad.net/...` and
  `github.com/mullvad/mullvad-browser/releases`.

**Threat-model consequence:** Mullvad (or whoever controls those hostnames) sees your DNS queries
and update checks. This is a deliberate trust delegation, not a leak — but it **is** a centralization
point and should be stated plainly in the README. For NorthGate these still point at Mullvad
infrastructure; rebranding them is a policy decision, not a code bug (see AMBIGUOUS_REFS.md).

---

## 5. Phase 5 (AI module) integration points — preserving the posture above

The hardening in section 2.7 means the internal Firefox ML runtime is **locked off and compiled
out**. An AI module therefore has three viable shapes; each interacts with the existing controls
differently.

### 5.1 Recommended: first-party system add-on + chrome component (remote inference)
Ship the AI module the way `data-leak-blocker` / `ipp-activator` are shipped, and the way the
`about:northgate-browser` page is wired:
- A **system add-on** under `browser/extensions/<ai-module>/` (`hidden: true`, `id
  @northgate`/`@mozilla.com`, `experiment_apis` for any privileged parent API). It loads via
  `SCOPE_APPLICATION` under the existing `extensions.enabledScopes = 5` with **no change** to scopes.
- UI surfaces via a **`moz-src` component + actor** registered in
  [DesktopActorRegistry.sys.mjs](browser/components/DesktopActorRegistry.sys.mjs), exactly like
  `AboutNorthGateBrowser`.
- Inference runs **remotely** (e.g., an HTTPS API), *not* on the disabled local ML stack.

Why this shape: it does not require unlocking `browser.ml.*`, so the "no local model download, no
on-device inference over page content" guarantee (2.7) stays intact.

### 5.2 Constraints any AI module MUST respect

1. **Do not unlock `browser.ml.enable` / `browser.ai.control.default` / `extensions.ml.enabled`.**
   If local inference is genuinely required, that is a separate, loud decision that reverses a
   tor-browser#44045 guarantee and needs its own threat-model entry — do not flip it as a side
   effect. Prefer remote inference behind a documented endpoint.
2. **Route egress through the existing network policy.** Any AI endpoint's DNS resolves via Mullvad
   DoH (`network.trr.mode = 3`) and connections must honor the proxy: `network.proxy.allow_bypass`
   and `network.proxy.failover_direct` are **locked false**. A chrome-privileged `fetch` that
   bypasses the proxy would be a hard regression (proxy-bypass is an explicit Base Browser invariant).
3. **Treat the AI endpoint as a new correlation surface (section 2.3/2.4).** It is an additional
   destination that sees whatever content is sent. Minimize payloads, never attach identifiers, and
   document it in section 4 as a preserved outbound connection. Consider making it opt-in given the
   always-PBM, telemetry-canary posture.
4. **Do not reintroduce telemetry.** Many telemetry prefs are locked/canary'd (2.5). The module must
   not add pings, and any `metrics.yaml`/`pings.yaml` (as the system add-ons have) must stay inert.
5. **Respect RFP boundaries.** Do not enable WebGPU/WebGL2/offscreen-canvas for local acceleration
   (all disabled in 2.1); do not expose high-resolution timers or device info to content through the
   module.
6. **Keep extension scopes and non-removability semantics unchanged.** Add the module to
   `SCOPE_APPLICATION`; do not add SCOPE_USER/SYSTEM. If it should be non-removable like uBlock,
   extend the [XPIDatabase.sys.mjs](toolkit/mozapps/extensions/internal/XPIDatabase.sys.mjs)
   allowlist explicitly rather than loosening scope policy.
7. **Content isolation.** ServiceWorkers and Push are off (2.6); the module cannot rely on them.
   Privileged↔content messaging should go through the actor framework, not `postMessage` into pages.

### 5.3 New threats the AI module introduces (to be filled in during phase 5)
- **Prompt/content exfiltration:** page or user text sent to inference leaves the machine — the
  single biggest new leak vector; scope and consent must be explicit.
- **Endpoint linkability:** a per-install API key or a unique endpoint reintroduces the
  cross-session identifier that 2.1/2.5 work to remove.
- **Local model artifacts (if 5.1 is not followed):** on-device models/caches would create new disk
  artifacts, conflicting with 2.2's memory-only posture.

---

## 6. Summary of residual risk (what NorthGate does NOT claim)

- **Not anonymity.** No Tor; your IP is exposed unless you supply your own tunnel (Mullvad VPN). DNS
  and update checks go to Mullvad by design.
- **Not protection from sites you log into**, nor from server-side behavioral fingerprinting.
- **Not protection from a compromised endpoint/OS**, keyloggers, or an adversary present during the
  live session.
- **Anonymity-set fragility:** customizing window size, fonts, or extensions makes the user *more*
  identifiable, not less.
- **WebRTC is on** — IP-leak safety depends entirely on the five ICE prefs in 2.6 staying set.
- **Trust delegated to uBlock/NoScript upstream** (auto-trusted, non-removable) and to **Mullvad**
  (DoH + updates).
