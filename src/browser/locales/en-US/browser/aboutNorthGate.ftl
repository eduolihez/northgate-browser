# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

### Strings for the about:northgate privacy and security dashboard.

ngate-page-title = NorthGate Privacy Dashboard
ngate-title = Privacy & Security
ngate-subtitle = A snapshot of protections for the site you are viewing.

ngate-current-site = Current site:
ngate-no-site = No website open
ngate-refresh = Refresh
ngate-empty = Open a website in another tab, then come back to see its privacy report.

ngate-scheme-https = HTTPS
ngate-scheme-http = Not secure

## Privacy score

ngate-score-heading = Privacy score
ngate-score-desc-a = Excellent. This site follows strong privacy practices.
ngate-score-desc-b = Good. Minor privacy concerns on this site.
ngate-score-desc-c = Fair. This site has some privacy concerns.
ngate-score-desc-d = Poor. This site raises several privacy concerns.
ngate-score-desc-f = Very poor. Be careful with what you share here.

## Trackers

ngate-trackers-heading = Trackers blocked
ngate-trackers-sublabel = { -brand-short-name } blocked these on this page.
ngate-category-tracking = Tracking content
ngate-category-fingerprinting = Fingerprinters
ngate-category-cryptomining = Cryptominers
ngate-category-social = Social media trackers
ngate-category-cookies = Cross-site tracking cookies

## AI classifier

ngate-classifier-heading = AI safety check
ngate-verdict-safe = Looks safe
ngate-verdict-suspicious = Looks suspicious
ngate-verdict-dangerous = Looks dangerous
ngate-explain-safe = Our on-device classifier found no strong signs of phishing in this address.
ngate-explain-suspicious = This address has a few traits often seen in phishing links. Proceed with caution.
ngate-explain-dangerous = This address has several traits common to phishing links. Avoid entering personal information.
ngate-risk-caption = Estimated phishing risk:
# Variables:
#   $percent (number) - Estimated phishing probability, 0-100.
ngate-risk-percent = { $percent }%

ngate-reason-none = No suspicious traits detected in the web address.
    .detail = The address looks normal and conforms to standard naming patterns.
ngate-reason-ip-literal = Uses a raw IP address instead of a domain name.
    .detail = Legitimate sites use names like google.com. Raw IP numbers (like 192.168.1.1) are often used by attackers to hide their domain identity.
ngate-reason-no-https = Connection is not encrypted (no HTTPS).
    .detail = Data sent to this site is not encrypted and could be intercepted by others on your network.
ngate-reason-at-symbol = Contains an “@” symbol, which can hide the real destination.
    .detail = The “@” character in a URL makes the browser ignore everything before it, which attackers use to disguise malicious links.
ngate-reason-punycode = Uses punycode, which can imitate a trusted brand.
    .detail = Punycode (e.g. xn--) is used for international domains, but can be abused to create lookalike names using lookalike symbols.
ngate-reason-shortener = Uses a link shortener that hides the real destination.
    .detail = Shortened links (like bit.ly) redirect you to another site, hiding the final destination until you click.
ngate-reason-keywords = Contains words often used to imitate logins or brands.
    .detail = Words like “login”, “verify”, “secure”, or bank names in the address are typical in phishing links trying to look official.
ngate-reason-subdomains = Has an unusually deep chain of subdomains.
    .detail = Having many subdomains (e.g. bank.security.login.domain.com) is often used to deceive users into thinking they are on the real site.
ngate-reason-long-url = The web address is unusually long.
    .detail = Phishing links are sometimes padded with long random strings or subdomains to push the real domain name off the screen.
ngate-reason-hyphens = The domain name uses many hyphens.
    .detail = Attackers often use hyphens to combine names of popular brands (e.g. secure-paypal-login.com) to appear authentic.
ngate-reason-random-host = The host name looks randomly generated.
    .detail = A domain made of chaotic characters (e.g. ax83jd.com) suggests a disposable website set up for a short-lived campaign.
ngate-reason-risky-tld = Uses a top-level domain frequently abused for phishing.
    .detail = Some domain endings (like .tk, .xyz, .top) are very cheap or free, making them disproportionately popular with malicious actors.

ngate-llm-explain-button = Explain with local AI
ngate-llm-consent = This downloads a small AI model (about 1 GB) from NorthGate's GitHub releases the first time you use this. After that, explanations are generated fully offline. Continue?
ngate-llm-consent-confirm = Download and explain
ngate-llm-consent-cancel = Cancel
ngate-llm-loading = Generating explanation…
ngate-llm-error-generic = Couldn't generate an explanation right now.
# Variables:
#   $percent (number) - Download progress, 0-100.
ngate-llm-downloading = Downloading model… { $percent }%

## Session alerts

ngate-alerts-heading = Alerts this session
ngate-clear = Clear
ngate-alerts-empty = No alerts yet. NorthGate will list phishing and heavy-tracking warnings here.
# Variables:
#   $host (string) - The host name that triggered the alert.
ngate-alert-phishing = Possible phishing site flagged on { $host }
# Variables:
#   $host (string) - The host name that triggered the alert.
#   $count (number) - Number of trackers blocked.
ngate-alert-trackers = Heavy tracking on { $host } — { $count } trackers blocked
