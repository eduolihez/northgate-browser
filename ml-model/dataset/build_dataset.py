#!/usr/bin/env python3
"""Build the clean, balanced, split NorthGate phishing dataset.

Pipeline:
  1. Load raw phishing/legit URLs from data/raw/ (run collect_sources.py first).
  2. Clean: trim, drop blanks, drop duplicate URLs, drop cross-class overlaps.
  3. Featurize a shuffled sample and drop unparseable hosts.
  4. Balance both classes to an equal count.
  5. Enrich with WHOIS domain age (unless --no-whois).
  6. Write dataset.csv and a stratified 70/15/15 train/val/test split.

    python build_dataset.py --per-class 2500
"""
import argparse
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

import features as F

HERE = Path(__file__).parent
RAW_DIR = HERE / "data" / "raw"
SEED = 42

# Reference columns first, then the numeric feature matrix.
COLUMN_ORDER = ["url", "label", "source", "registered_domain", "tld", *F.FEATURE_COLUMNS]


def _load(name: str, label: int) -> pd.DataFrame:
    df = pd.read_csv(RAW_DIR / name)
    df["url"] = df["url"].astype(str).str.strip()
    df = df[df["url"].str.len() > 0].drop_duplicates("url")
    df["label"] = label
    return df[["url", "source", "label"]]


def _clean(per_class: int, buffer: float) -> pd.DataFrame:
    phish = _load("phishing_urls.csv", 1)
    legit = _load("legit_urls.csv", 0)

    overlap = set(phish["url"]) & set(legit["url"])
    if overlap:
        phish = phish[~phish["url"].isin(overlap)]
        legit = legit[~legit["url"].isin(overlap)]

    take = int(per_class * buffer)
    phish = phish.sample(min(take, len(phish)), random_state=SEED)
    legit = legit.sample(min(take, len(legit)), random_state=SEED)
    return pd.concat([phish, legit], ignore_index=True)


def _featurize(raw: pd.DataFrame) -> pd.DataFrame:
    feats = F.extract_features(raw["url"], raw["label"], raw["source"])
    # Drop rows we could not parse into a real host (keep valid IP-literal hosts).
    valid = (feats["registered_domain"].str.len() > 0) | (feats["has_ip"] == 1)
    return feats[valid].reset_index(drop=True)


def _balance(df: pd.DataFrame, per_class: int) -> pd.DataFrame:
    n = min(per_class, df["label"].value_counts().min())
    parts = [g.sample(n, random_state=SEED) for _, g in df.groupby("label")]
    return pd.concat(parts, ignore_index=True).sample(frac=1, random_state=SEED)


def _split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    train, temp = train_test_split(df, test_size=0.30, stratify=df["label"],
                                   random_state=SEED)
    val, test = train_test_split(temp, test_size=0.50, stratify=temp["label"],
                                 random_state=SEED)
    return train, val, test


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-class", type=int, default=2500,
                        help="Target rows per class after balancing.")
    parser.add_argument("--buffer", type=float, default=1.25,
                        help="Oversample factor before dropping invalid rows.")
    parser.add_argument("--no-whois", action="store_true",
                        help="Skip WHOIS domain-age enrichment (leaves -1).")
    parser.add_argument("--whois-limit", type=int, default=None,
                        help="Cap the number of new live WHOIS lookups.")
    parser.add_argument("--workers", type=int, default=30)
    parser.add_argument("--timeout", type=float, default=8.0)
    args = parser.parse_args()

    raw = _clean(args.per_class, args.buffer)
    print(f"Cleaned pool: {len(raw)} URLs")

    feats = _featurize(raw)
    dataset = _balance(feats, args.per_class)
    print(f"Balanced: {len(dataset)} rows "
          f"({dict(dataset['label'].value_counts().sort_index())})")

    if not args.no_whois:
        dataset = F.enrich_domain_age(
            dataset, workers=args.workers, timeout=args.timeout,
            limit=args.whois_limit, cache_path=HERE / "data" / "whois_cache.json")
        known = (dataset["domain_age_days"] >= 0).mean()
        print(f"WHOIS domain age known for {known:.0%} of rows")

    dataset = dataset[COLUMN_ORDER]
    # IP-literal / unparseable hosts have no registrable domain or TLD; use an
    # explicit sentinel so the delivered CSV is free of empty/NaN cells.
    dataset[["registered_domain", "tld"]] = (
        dataset[["registered_domain", "tld"]].replace("", "none").fillna("none")
    )
    dataset.to_csv(HERE / "dataset.csv", index=False)

    train, val, test = _split(dataset)
    for name, part in [("train", train), ("val", val), ("test", test)]:
        part.to_csv(HERE / f"{name}.csv", index=False)
        print(f"{name}: {len(part)} rows ({dict(part['label'].value_counts().sort_index())})")

    print(f"Done -> {HERE / 'dataset.csv'}")


if __name__ == "__main__":
    main()
