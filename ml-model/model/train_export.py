#!/usr/bin/env python3
"""Train the NorthGate phishing classifier and export it to ONNX.

The deployed model runs inside the browser at navigation time and must make
**zero network calls**, so it is trained only on features computable from the
URL string alone. In particular `domain_age_days` (WHOIS) is intentionally
excluded here even though it exists in the dataset.

Outputs (into ml-model/model/):
    northgate_phishing.onnx   the exported model
    feature_order.json        exact feature order + block threshold (Rust reads this)
    metrics.json              held-out test metrics
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from skl2onnx import to_onnx

HERE = Path(__file__).parent
DATASET = HERE.parent / "dataset"

# Network-free features only (excludes domain_age_days / WHOIS).
FEATURES = [
    "url_length", "hostname_length", "path_length", "query_length",
    "url_entropy", "hostname_entropy", "has_ip", "num_subdomains", "num_dots",
    "num_hyphens", "num_digits", "num_special_chars", "digit_ratio",
    "has_at_symbol", "is_https", "is_shortened", "num_suspicious_keywords",
    "has_suspicious_keyword",
]


def load(name):
    df = pd.read_csv(DATASET / f"{name}.csv")
    return df[FEATURES].to_numpy(np.float32), df["label"].to_numpy(np.int64)


def evaluate(model, X, y):
    proba = model.predict_proba(X)[:, 1]
    pred = (proba >= 0.5).astype(int)
    return {
        "accuracy": round(accuracy_score(y, pred), 4),
        "precision": round(precision_score(y, pred), 4),
        "recall": round(recall_score(y, pred), 4),
        "f1": round(f1_score(y, pred), 4),
        "roc_auc": round(roc_auc_score(y, proba), 4),
    }


def pick_block_threshold(model, X, y, target_precision=0.99):
    """Lowest threshold whose precision meets the target (few false blocks)."""
    proba = model.predict_proba(X)[:, 1]
    prec, _, thr = precision_recall_curve(y, proba)
    for p, t in zip(prec[:-1], thr):
        if p >= target_precision:
            return float(round(t, 4))
    return 0.9


def main():
    Xtr, ytr = load("train")
    Xva, yva = load("val")
    Xte, yte = load("test")

    candidates = {
        "logreg": make_pipeline(
            StandardScaler(), LogisticRegression(max_iter=1000)
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=200, max_depth=12, random_state=42, n_jobs=-1
        ),
    }

    scored = {}
    for name, model in candidates.items():
        model.fit(Xtr, ytr)
        val = evaluate(model, Xva, yva)
        scored[name] = val
        print(f"{name:14s} val {val}")

    best_name = max(scored, key=lambda n: (scored[n]["roc_auc"], scored[n]["f1"]))
    best = candidates[best_name]
    print(f"\nSelected: {best_name}")

    test_metrics = evaluate(best, Xte, yte)
    cm = confusion_matrix(yte, (best.predict_proba(Xte)[:, 1] >= 0.5).astype(int))
    threshold = pick_block_threshold(best, Xva, yva)
    print(f"test {test_metrics}")
    print(f"confusion matrix [[TN FP][FN TP]]:\n{cm}")
    print(f"block threshold (val precision>=0.99): {threshold}")

    # Export to ONNX. zipmap=False gives a plain probability tensor output.
    onnx_model = to_onnx(
        best, Xtr[:1], options={"zipmap": False}, target_opset=17
    )
    onnx_path = HERE / "northgate_phishing.onnx"
    onnx_path.write_bytes(onnx_model.SerializeToString())

    (HERE / "feature_order.json").write_text(
        json.dumps(
            {"features": FEATURES, "block_threshold": threshold, "model": best_name},
            indent=2,
        )
    )
    (HERE / "metrics.json").write_text(
        json.dumps(
            {
                "selected_model": best_name,
                "validation": scored,
                "test": test_metrics,
                "confusion_matrix": cm.tolist(),
                "block_threshold": threshold,
            },
            indent=2,
        )
    )
    print(f"\nWrote {onnx_path.name} ({onnx_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
