#!/usr/bin/env python3
"""Feature extraction for the NorthGate URL phishing classifier.

Turns a list of labelled URLs into a numeric feature table. Can be used as a
library (import `extract_features` / `enrich_domain_age`) or as a CLI:

    python features.py --input urls.csv --output features.csv [--whois]

The input CSV must contain at least a `url` column; a `label` column
(1 = phishing, 0 = legitimate) and a `source` column are carried through when
present.

Feature groups:
  - length      : url/hostname/path/query character counts
  - entropy     : Shannon entropy of the URL and of the hostname
  - host        : IP-literal host, subdomain count, TLD
  - lexical     : dots, hyphens, digits, special chars, '@', digit ratio
  - security    : HTTPS scheme, known URL-shortener host
  - keywords    : phishing-indicative keyword hits
  - age         : domain registration age in days via WHOIS (optional, -1 = unknown)
"""
import argparse
import json
import math
import re
import socket
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import tldextract
import whois

# Keywords frequently embedded in phishing URLs to impersonate brands/actions.
SUSPICIOUS_KEYWORDS = (
    "login", "log-in", "signin", "sign-in", "logon", "verify", "verification",
    "account", "secure", "security", "update", "confirm", "password", "passwd",
    "credential", "bank", "banking", "paypal", "ebay", "amazon", "apple",
    "icloud", "microsoft", "office365", "outlook", "wallet", "crypto", "bonus",
    "free", "gift", "prize", "winner", "suspended", "locked", "alert", "billing",
    "invoice", "payment", "recover", "unlock", "webscr", "cmd", "token", "auth",
    "support", "service", "customer", "refund", "delivery", "tracking",
)

# Common URL-shortener hosts (obfuscate the true destination).
SHORTENERS = frozenset({
    "bit.ly", "goo.gl", "tinyurl.com", "t.co", "ow.ly", "is.gd", "buff.ly",
    "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc",
})

_IPV4_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
_SPECIAL_RE = re.compile(r"[@?%=&#+;$!*',:~]")
_DIGIT_RE = re.compile(r"\d")

# Use the offline suffix-list snapshot bundled with tldextract for reproducibility.
_extract = tldextract.TLDExtract(suffix_list_urls=())

FEATURE_COLUMNS = (
    "url_length", "hostname_length", "path_length", "query_length",
    "url_entropy", "hostname_entropy", "has_ip", "num_subdomains", "num_dots",
    "num_hyphens", "num_digits", "num_special_chars", "digit_ratio",
    "has_at_symbol", "is_https", "is_shortened", "num_suspicious_keywords",
    "has_suspicious_keyword", "domain_age_days",
)


def shannon_entropy(text: str) -> float:
    """Shannon entropy (bits/char) of a string; 0 for empty input."""
    if not text:
        return 0.0
    counts = Counter(text)
    n = len(text)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def _normalize(url: str) -> str:
    url = (url or "").strip()
    if url and "://" not in url:
        url = "http://" + url
    return url


def is_ip_literal(host: str) -> bool:
    if not host:
        return False
    if host.startswith("[") and host.endswith("]"):
        return True  # bracketed IPv6
    return bool(_IPV4_RE.match(host))


def lexical_features(url: str) -> dict:
    """All cheap, offline features for a single URL."""
    url = _normalize(url)
    parsed = urlparse(url)
    host = parsed.hostname or ""
    ext = _extract(host)
    registered = ext.registered_domain or host
    subdomain = ext.subdomain
    num_subdomains = len([p for p in subdomain.split(".") if p]) if subdomain else 0

    lowered = url.lower()
    keyword_hits = sum(1 for kw in SUSPICIOUS_KEYWORDS if kw in lowered)
    num_digits = len(_DIGIT_RE.findall(url))

    return {
        "url": url,
        "registered_domain": registered,
        "tld": ext.suffix or "",
        "url_length": len(url),
        "hostname_length": len(host),
        "path_length": len(parsed.path or ""),
        "query_length": len(parsed.query or ""),
        "url_entropy": round(shannon_entropy(url), 4),
        "hostname_entropy": round(shannon_entropy(host), 4),
        "has_ip": int(is_ip_literal(host)),
        "num_subdomains": num_subdomains,
        "num_dots": url.count("."),
        "num_hyphens": url.count("-"),
        "num_digits": num_digits,
        "num_special_chars": len(_SPECIAL_RE.findall(url)),
        "digit_ratio": round(num_digits / len(url), 4) if url else 0.0,
        "has_at_symbol": int("@" in url),
        "is_https": int(parsed.scheme == "https"),
        "is_shortened": int(registered in SHORTENERS),
        "num_suspicious_keywords": keyword_hits,
        "has_suspicious_keyword": int(keyword_hits > 0),
        "domain_age_days": -1,
    }


def _whois_age_days(domain: str, timeout: float) -> int:
    """Registration age in days from WHOIS creation date; -1 when unknown."""
    if not domain:
        return -1
    socket.setdefaulttimeout(timeout)
    try:
        record = whois.whois(domain)
    except Exception:
        return -1
    created = record.creation_date if record else None
    if isinstance(created, list):
        created = next((c for c in created if c), None)
    if isinstance(created, str):
        try:
            created = datetime.fromisoformat(created)
        except ValueError:
            return -1
    if not isinstance(created, datetime):
        return -1
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - created).days
    return age if age >= 0 else -1


def enrich_domain_age(df: pd.DataFrame, workers: int = 24, timeout: float = 6.0,
                      limit: int | None = None, cache_path: Path | None = None) -> pd.DataFrame:
    """Fill `domain_age_days` via WHOIS, deduplicated per registered domain.

    Results are cached on disk so reruns are cheap. `limit` caps the number of
    *new* live lookups; domains beyond the cap keep -1 (unknown).
    """
    cache: dict[str, int] = {}
    if cache_path and cache_path.exists():
        cache = json.loads(cache_path.read_text())

    domains = [d for d in df["registered_domain"].unique() if d]
    to_query = [d for d in domains if d not in cache]
    if limit is not None:
        to_query = to_query[:limit]

    if to_query:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            ages = pool.map(lambda d: _whois_age_days(d, timeout), to_query)
            for domain, age in zip(to_query, ages):
                cache[domain] = age

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache))

    df["domain_age_days"] = df["registered_domain"].map(lambda d: cache.get(d, -1))
    return df


def extract_features(urls, labels=None, sources=None) -> pd.DataFrame:
    """Build the offline feature table for an iterable of URLs."""
    rows = [lexical_features(u) for u in urls]
    df = pd.DataFrame(rows)
    if labels is not None:
        df.insert(1, "label", list(labels))
    if sources is not None:
        df.insert(2, "source", list(sources))
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, type=Path,
                        help="CSV with a `url` column (plus optional label/source).")
    parser.add_argument("--output", required=True, type=Path,
                        help="Destination CSV for the feature table.")
    parser.add_argument("--whois", action="store_true",
                        help="Enrich rows with WHOIS domain age (slow, network).")
    parser.add_argument("--whois-limit", type=int, default=None,
                        help="Cap the number of new live WHOIS lookups.")
    parser.add_argument("--workers", type=int, default=24,
                        help="Thread pool size for WHOIS lookups.")
    parser.add_argument("--timeout", type=float, default=6.0,
                        help="Per-lookup WHOIS timeout in seconds.")
    args = parser.parse_args()

    src = pd.read_csv(args.input)
    labels = src["label"] if "label" in src.columns else None
    sources = src["source"] if "source" in src.columns else None
    df = extract_features(src["url"], labels, sources)

    if args.whois:
        cache = args.output.parent / "data" / "whois_cache.json"
        df = enrich_domain_age(df, workers=args.workers, timeout=args.timeout,
                               limit=args.whois_limit, cache_path=cache)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.output, index=False)
    print(f"Wrote {len(df)} rows x {len(df.columns)} cols -> {args.output}")


if __name__ == "__main__":
    main()
