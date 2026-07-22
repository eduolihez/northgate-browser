# NorthGate phishing URL dataset

A clean, balanced, labelled dataset of phishing and legitimate URLs plus the
feature-extraction pipeline used to build it. Intended for training a
URL-based phishing classifier for NorthGate.

## Layout

```
ml-model/dataset/
  collect_sources.py   # download raw phishing + legit URLs
  features.py          # URL -> feature table (library + CLI)
  build_dataset.py     # clean, balance, split -> dataset.csv + train/val/test
  requirements.txt
  dataset.csv          # full labelled + featurized dataset
  train.csv / val.csv / test.csv   # stratified 70/15/15 split
  data/raw/            # cached raw feed downloads (git-ignored)
  data/whois_cache.json  # cached WHOIS ages (git-ignored)
```

## Sources

| Class | Source | Feed |
|-------|--------|------|
| Phishing (`label=1`) | OpenPhish community | `https://openphish.com/feed.txt` |
| Phishing (`label=1`) | PhishTank verified | `http://data.phishtank.com/data/online-valid.csv` |
| Legitimate (`label=0`) | Tranco top sites | `https://tranco-list.eu` |

Legitimate URLs are the `https://<domain>/` form of the top-ranked Tranco
domains. Both phishing feeds are rate-limited, so `collect_sources.py` caches
raw downloads under `data/raw/` and reuses them on reruns.

## Features

Every row carries reference columns (`url`, `label`, `source`,
`registered_domain`, `tld`) and the numeric feature matrix:

| Feature | Description |
|---------|-------------|
| `url_length`, `hostname_length`, `path_length`, `query_length` | Character counts |
| `url_entropy`, `hostname_entropy` | Shannon entropy (bits/char) — flags random-looking strings |
| `has_ip` | Host is an IPv4/IPv6 literal instead of a domain |
| `num_subdomains` | Subdomain label count (via the public-suffix list) |
| `num_dots`, `num_hyphens`, `num_digits`, `num_special_chars` | Lexical counts |
| `digit_ratio` | Digits / URL length |
| `has_at_symbol` | Presence of `@` (credential-embedding trick) |
| `is_https` | Scheme is HTTPS |
| `is_shortened` | Host is a known URL shortener |
| `num_suspicious_keywords`, `has_suspicious_keyword` | Phishing keyword hits (`login`, `verify`, `paypal`, ...) |
| `domain_age_days` | Registration age from WHOIS; `-1` = unknown |

Registered domain and subdomain counts use `tldextract` against its bundled
offline public-suffix snapshot, so results are reproducible and correct for
multi-label TLDs (e.g. `example.co.uk`).

## Usage

```bash
pip install -r requirements.txt

python collect_sources.py --tranco-count 20000     # -> data/raw/*.csv
python build_dataset.py --per-class 2500            # -> dataset.csv + splits
```

Feature extraction is also usable standalone or as a library:

```bash
python features.py --input urls.csv --output feats.csv --whois
```

```python
import features
row = features.lexical_features("http://paypal.verify-account.example/login")
```

### Key flags (`build_dataset.py`)

- `--per-class N` — rows per class after balancing (default 2500).
- `--no-whois` — skip WHOIS enrichment (fast; `domain_age_days` stays -1).
- `--whois-limit N` — cap new live WHOIS lookups (results are cached).
- `--workers` / `--timeout` — WHOIS concurrency and per-lookup timeout.

## Notes and caveats

- **Class balance** is exact after `_balance` (equal phishing/legit), and the
  70/15/15 train/val/test split is stratified on `label` with a fixed seed
  (42) for reproducibility.
- **Construction bias (important).** Legitimate URLs are the `https://<domain>/`
  homepage form of Tranco domains, while phishing URLs are full deep links from
  the feeds. As a result several features separate the classes partly by *URL
  shape* rather than by maliciousness: `is_https` is ~100% for the legit class
  by construction, and `url_length`, `path_length`, `num_digits` and
  `digit_ratio` are inflated for phishing simply because those URLs carry deep
  paths. Treat this dataset as a *URL-form* baseline. For a harder, more
  realistic benchmark, source full legitimate URLs (e.g. Common Crawl or real
  browsing history) instead of bare homepages, and consider dropping or
  regularizing `is_https`.
- **Label noise from abused hosting** is inherent to real feeds: phishing URLs
  hosted on `docs.google.com`, `weebly.com`, `*.pages.dev`, etc. carry a
  legitimate registered domain. This is left as-is (it reflects reality);
  URL/path/entropy features still separate the classes. Avoid training a model
  that keys solely on `registered_domain`.
- **`domain_age_days = -1`** means WHOIS returned no creation date (privacy
  registrars, exotic TLDs, subdomain-only hosts, or timeouts). Treat -1 as a
  distinct "unknown" category rather than a numeric age — for many ephemeral
  phishing hosts, "unknown age" is itself signal.
- **Freshness**: phishing feeds are live and change constantly. Delete
  `data/raw/` to pull fresh URLs; delete `data/whois_cache.json` to refresh
  ages.
- **Ethics/scope**: URLs are collected for defensive classifier training only.
  Do not visit them. WHOIS lookups are rate-limited by registrars; keep
  `--workers` modest to stay polite.
```
