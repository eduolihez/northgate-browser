# NorthGate Browser

NorthGate is an open-source, privacy-focused web browser designed as a portfolio project for security researchers and blue teamers. It is a fork of **Mullvad Browser** (which builds on Firefox ESR and Tor Browser hardening).

This browser aims to provide state-of-the-art fingerprinting protections and anti-tracking capabilities, serving as a platform for future AI-assisted security features.

---

## Threat Model

NorthGate inherits the hardening of Mullvad/Tor Browser (Base Browser). Highlights:
- **Anti-Fingerprinting**: Resist Fingerprinting (RFP) is on and locked in release builds — spoofed user agent, UTC timezone, standardized screen size via letterboxing, bundled-font whitelist, and canvas/WebGL readback poisoning. WebGL2, WebGPU and offscreen canvas are disabled. The goal is a large shared anonymity set, so customizing window size, fonts, or extensions makes you *more* identifiable.
- **Always Private Browsing**: the browser runs in permanent PBM with disk cache, history, saved passwords, and cert history disabled, to minimize local forensic traces.
- **Zero Telemetry**: telemetry is disabled and *locked*, with client/profile IDs forced to fixed canary values; Normandy/Shield/Nimbus experiments, Safe Browsing, and crash reporting are off.
- **Leak Protection**: DNS-over-HTTPS in TRR-only mode (Mullvad resolver) with no plaintext fallback; proxy-bypass is locked off. NorthGate does **not** ship Tor — it hardens the client and expects to run behind Mullvad VPN or a trusted tunnel; it does not hide your IP by itself. Note WebRTC is enabled by default and its IP-leak safety rests entirely on the ICE relay-only prefs.
- **Bundled, non-removable extensions**: uBlock Origin (default filter lists) and NoScript are shipped and cannot be uninstalled. NoScript is driven by the **Security Level** slider (default: Standard); it is not maxed out by default.

The full inventory of controls — what each one mitigates, what it explicitly does **not** protect against, and the constraints on the future AI module — is in **[THREAT_MODEL.md](THREAT_MODEL.md)**.

---

## Build Instructions

To build NorthGate from source:

1. **System Requirements**: Follow the standard Mozilla build requirements for your OS (Windows/macOS/Linux).
2. **Configuration**: Sourced configurations are located in `browser/config/mozconfigs/`. Select the target configuration for your platform (e.g. `mozconfig-windows-x86_64` or `mozconfig-linux-x86_64` which automatically sources the `northgate-browser` branding base).
3. **Build**:
   ```bash
   ./mach build
   ```
4. **Run**:
   ```bash
   ./mach run
   ```

---

## Roadmap

- **Phase 1 (Rebranding)**: Rebrand Mullvad Browser assets, paths, settings, locales, and identifiers to NorthGate. (Current Phase)
- **Phase 2 (Applied AI & Blue Team integrations)**: Integrate client-side AI analysis, local LLM tooling for suspicious script parsing, and advanced network diagnostics indicators for blue team analysis.

---

## License

This software is subject to the terms of the **Mozilla Public License, v. 2.0 (MPL-2.0)**. See the `LICENSE` and `NOTICE` files for details and attribution credits.
