#!/usr/bin/env python3
"""Collect raw URLs for the NorthGate phishing dataset.

Phishing (label 1):
  - OpenPhish community feed  (https://openphish.com/feed.txt)
  - PhishTank verified feed   (http://data.phishtank.com/data/online-valid.csv)

Legitimate (label 0):
  - Tranco top-sites list      (https://tranco-list.eu), turned into https:// URLs

Raw feeds are cached under data/raw/ so reruns don't re-hit the sources
(both phishing feeds are rate-limited). Outputs two CSVs consumed by
build_dataset.py:
    data/raw/phishing_urls.csv   (url, source)
    data/raw/legit_urls.csv      (url, source)
"""
import argparse
import csv
import io
from pathlib import Path

import requests

OPENPHISH_URL = "https://openphish.com/feed.txt"
PHISHTANK_URL = "http://data.phishtank.com/data/online-valid.csv"
TRANCO_LATEST = "https://tranco-list.eu/api/lists/date/latest"

HEADERS = {"User-Agent": "NorthGate-dataset-builder/1.0 (+security-research)"}
RAW_DIR = Path(__file__).parent / "data" / "raw"


def _get(url: str, timeout: int = 60) -> requests.Response:
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    return resp


def fetch_openphish() -> list[str]:
    cache = RAW_DIR / "openphish.txt"
    if cache.exists():
        text = cache.read_text(encoding="utf-8", errors="replace")
    else:
        text = _get(OPENPHISH_URL).text
        cache.write_text(text, encoding="utf-8")
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def fetch_phishtank() -> list[str]:
    cache = RAW_DIR / "phishtank.csv"
    if cache.exists():
        text = cache.read_text(encoding="utf-8", errors="replace")
    else:
        text = _get(PHISHTANK_URL).text
        cache.write_text(text, encoding="utf-8")
    urls = []
    for row in csv.DictReader(io.StringIO(text)):
        url = (row.get("url") or "").strip()
        if url:
            urls.append(url)
    return urls


def fetch_tranco(count: int) -> list[str]:
    cache = RAW_DIR / f"tranco_top{count}.csv"
    if cache.exists():
        text = cache.read_text(encoding="utf-8", errors="replace")
    else:
        list_id = _get(TRANCO_LATEST).json()["list_id"]
        text = _get(f"https://tranco-list.eu/download/{list_id}/{count}").text
        cache.write_text(text, encoding="utf-8")
    domains = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) >= 2 and row[1].strip():
            domains.append(row[1].strip())
    return [f"https://{d}/" for d in domains]


def _write(path: Path, urls: list[str], source: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["url", "source"])
        for url in urls:
            writer.writerow([url, source])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tranco-count", type=int, default=20000,
                        help="Number of top Tranco domains to pull as legit URLs.")
    args = parser.parse_args()

    openphish = fetch_openphish()
    phishtank = fetch_phishtank()
    print(f"OpenPhish: {len(openphish)}  PhishTank: {len(phishtank)}")

    phishing, seen = [], set()
    for url, source in [(u, "openphish") for u in openphish] + \
                       [(u, "phishtank") for u in phishtank]:
        if url not in seen:
            seen.add(url)
            phishing.append((url, source))

    legit = fetch_tranco(args.tranco_count)
    print(f"Tranco legit: {len(legit)}")

    with (RAW_DIR / "phishing_urls.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["url", "source"])
        writer.writerows(phishing)
    _write(RAW_DIR / "legit_urls.csv", legit, "tranco")

    print(f"Wrote {len(phishing)} phishing + {len(legit)} legit URLs to {RAW_DIR}")


if __name__ == "__main__":
    main()
