# NorthGate Browser Privacy Policy

Last Updated: July 2026

At NorthGate, we believe privacy is a fundamental human right. This Privacy Policy details our data practices, explain how the local phishing classifier works, and outline our commitment to never collect or share your browsing activity.

---

## 1. Core Privacy Commitments
* **Zero Telemetry**: NorthGate Browser does not collect telemetry, usage metrics, crash logs, or browser metrics. We have disabled all telemetry hooks inherited from the upstream Firefox codebase.
* **No Central Servers**: There are no remote lookup servers, API endpoints, or search engine pings tracking your address bar keystrokes.
* **Zero Tracking**: We do not assign user IDs, session trackers, or fingerprinting profiles.

---

## 2. On-Device Phishing Classifier

Unlike traditional safe-browsing protections that look up URLs against remote databases, NorthGate Browser uses a **100% on-device local classifier**.

### 2.1 Data Processing
* **Local Inference**: When you navigate to a website, the browser scores the URL using an embedded scikit-learn Random Forest model compiled into the binary (`northgate_phishing.onnx`) running via the pure-Rust `tract-onnx` engine.
* **No Leakage**: The URL string, hostname, path, and security parameters are evaluated entirely in the memory space of your local browser process. They are **never sent over the network** to any server.
* **No External DNS/Pings**: The classifier does not perform DNS requests, domain lookups, or network pings to extract feature parameters. All evaluations are lexical.

### 2.2 Whitelisting & Bypass Choices
* If the browser blocks a site and you select the **"Permanently trust this website"** option:
  * The hostname is appended to your local preference file (`browser.northgate.whitelist`).
  * This list remains completely on your device. You can view or clear this list at any time through `about:config`.

---

## 3. Third-Party Integrations
* **Search Engine**: The default search engine is set to DuckDuckGo, which does not track your search history.
* **DNS-over-HTTPS (DoH)**: NorthGate defaults to encrypted DNS routing via Mullvad DoH (`https://dns.mullvad.net/dns-query`) to shield your DNS requests from local network snooping. You can change this DNS provider under the Network Settings.
* **Default Extensions**: NorthGate ships pre-configured with **uBlock Origin** and **NoScript** for ad, tracker, and script blocking. These extensions run locally; their blocklists are downloaded periodically from standard open-source repositories.

---

## 4. Updates
* **Browser Updates**: Software updates are fetched securely from our official releases page on GitHub. When checking for updates, only the standard User-Agent header (containing the OS version and browser name) is transmitted.

---

## 5. Contact & Audits
Since NorthGate is fully open-source, we encourage security researchers to audit our codebase, verify our zero-leak claims, and audit the Rust machine learning pipeline. For inquiries, you can open an issue on our GitHub repository.
