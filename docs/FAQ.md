# NorthGate Browser FAQ

Frequently asked questions regarding the architecture, privacy model, and local phishing detection in NorthGate Browser.

---

## 1. Privacy & Data Handling

### Q: Does NorthGate send my URLs or browsing history to a server?
**No.** All feature extraction and classification happen locally on your computer. The machine learning model is embedded directly in the browser binary (`northgate_phishing.onnx`), and the inference engine (`tract-onnx`) runs entirely in-process. No network requests are made during URL scoring.

### Q: What data is stored locally when I bypass a warning?
When you choose "Ignore the warning and continue" and opt to permanently trust a site:
* The host name (e.g. `example.com`) is saved to your local profile preferences under `browser.northgate.whitelist`.
* This whitelist is entirely local to your device and is never sent to NorthGate or any third party.
* No session cookies, paths, query parameters, or POST data from blocked sites are ever written to history.

### Q: Why does the warning page show a risk percentage?
The classification score is the output probability of our Random Forest model (ranging from `0%` to `100%`). A higher percentage indicates that the URL has more structural features matching typical phishing campaigns (such as suspicious subdomains, keywords like "login" combined with third-party endings, or lack of HTTPS).

---

## 2. Technical Details

### Q: How does the classifier decide what to block?
The classifier checks 18 network-free characteristics of the URL:
1. **Length features**: URL, hostname, path, and query parameters length.
2. **Entropy**: Character distribution chaos in the URL and host.
3. **Lexical indicators**: Count of hyphens, dots, digits, and special symbols (like `@`).
4. **Keyword presence**: Brand/action words (e.g., "bank", "verify", "paypal", "signin").
5. **Infrastructure indicators**: Whether the host is a raw IP address or uses a known link shortener.
6. **Security status**: Whether the scheme is HTTPS.

### Q: Does the classifier slow down page loads?
**No.** The content policy intercepts loads synchronously, but the feature extraction and model execution are highly optimized. By migrating from `ort` (ONNX Runtime) to the pure-Rust `tract-onnx` framework, the model is evaluated in a fraction of a millisecond with negligible CPU/memory footprint.

### Q: How do I manage my allowed sites list?
If you permanently trusted a site and want to revoke that trust:
1. Navigate to `about:config` in the address bar.
2. Search for the preference `browser.northgate.whitelist`.
3. Double-click the preference value and remove the hostname from the list (or delete the entire value to clear all whitelisted domains).
