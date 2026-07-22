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
ngate-reason-ip-literal = Uses a raw IP address instead of a domain name.
ngate-reason-no-https = Connection is not encrypted (no HTTPS).
ngate-reason-at-symbol = Contains an “@” symbol, which can hide the real destination.
ngate-reason-punycode = Uses punycode, which can imitate a trusted brand.
ngate-reason-shortener = Uses a link shortener that hides the real destination.
ngate-reason-keywords = Contains words often used to imitate logins or brands.
ngate-reason-subdomains = Has an unusually deep chain of subdomains.
ngate-reason-long-url = The web address is unusually long.
ngate-reason-hyphens = The domain name uses many hyphens.
ngate-reason-random-host = The host name looks randomly generated.
ngate-reason-risky-tld = Uses a top-level domain frequently abused for phishing.

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
