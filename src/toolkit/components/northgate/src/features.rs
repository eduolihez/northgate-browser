//! Network-free feature extraction for the NorthGate phishing classifier.
//!
//! This mirrors, feature-for-feature and in the same order, the offline
//! training pipeline in `ml-model/dataset/features.py`. Only features
//! computable from the URL string alone are produced here; `domain_age_days`
//! (WHOIS) is deliberately absent so scoring never touches the network.
//!
//! The order of [`FEATURE_ORDER`] MUST match `model/feature_order.json`.

use url::{Host, Url};

pub const FEATURE_COUNT: usize = 18;

/// Human-readable order of the emitted feature vector, for cross-checking
/// against `model/feature_order.json`.
pub const FEATURE_ORDER: [&str; FEATURE_COUNT] = [
    "url_length", "hostname_length", "path_length", "query_length",
    "url_entropy", "hostname_entropy", "has_ip", "num_subdomains", "num_dots",
    "num_hyphens", "num_digits", "num_special_chars", "digit_ratio",
    "has_at_symbol", "is_https", "is_shortened", "num_suspicious_keywords",
    "has_suspicious_keyword",
];

// MUST stay in sync with SUSPICIOUS_KEYWORDS in ml-model/dataset/features.py:
// the model was trained on the counts these keywords produce, so any mismatch
// skews num_suspicious_keywords / has_suspicious_keyword at inference time.
const SUSPICIOUS_KEYWORDS: [&str; 50] = [
    "login", "log-in", "signin", "sign-in", "logon", "verify", "verification",
    "account", "secure", "security", "update", "confirm", "password", "passwd",
    "credential", "bank", "banking", "paypal", "ebay", "amazon", "apple",
    "icloud", "microsoft", "office365", "outlook", "wallet", "crypto", "bonus",
    "free", "gift", "prize", "winner", "suspended", "locked", "alert", "billing",
    "invoice", "payment", "recover", "unlock", "webscr", "cmd", "token", "auth",
    "support", "service", "customer", "refund", "delivery", "tracking",
];

const SHORTENERS: [&str; 13] = [
    "bit.ly", "goo.gl", "tinyurl.com", "t.co", "ow.ly", "is.gd", "buff.ly",
    "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc",
];

const SPECIAL_CHARS: &str = "@?%=&#+;$!*',:~";

/// Round to 4 decimals to match the training pipeline (features.py rounds
/// entropy and digit_ratio), keeping Rust inference bit-faithful to sklearn.
fn round4(value: f32) -> f32 {
    (value * 10_000.0).round() / 10_000.0
}

fn shannon_entropy(text: &str) -> f32 {
    if text.is_empty() {
        return 0.0;
    }
    // Count by Unicode scalar value, not by byte, to match the codepoint-based
    // Counter used by the Python training pipeline (features.py).
    let mut counts = std::collections::HashMap::new();
    let mut n = 0u32;
    for ch in text.chars() {
        *counts.entry(ch).or_insert(0u32) += 1;
        n += 1;
    }
    let n = n as f32;
    counts
        .values()
        .map(|&c| {
            let p = c as f32 / n;
            -p * p.log2()
        })
        .sum()
}

fn subdomain_count(host: &str) -> f32 {
    // Offline public-suffix lookup; `psl` embeds the list at compile time.
    let registrable = psl::domain_str(host).unwrap_or(host);
    if host == registrable {
        return 0.0;
    }
    let prefix = host
        .strip_suffix(registrable)
        .map(|p| p.trim_end_matches('.'))
        .unwrap_or("");
    if prefix.is_empty() {
        0.0
    } else {
        prefix.split('.').count() as f32
    }
}

/// Extract the ordered feature vector for a URL, or `None` if it cannot be
/// parsed. `www.` is not stripped, matching the training pipeline.
pub fn extract(raw: &str) -> Option<[f32; FEATURE_COUNT]> {
    let normalized = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    let parsed = Url::parse(&normalized).ok()?;

    let host = parsed.host_str().unwrap_or("").to_string();
    let is_ip = matches!(parsed.host(), Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)));
    let path = parsed.path();
    let query = parsed.query().unwrap_or("");

    let lowered = normalized.to_lowercase();
    let num_digits = normalized.chars().filter(|c| c.is_ascii_digit()).count();
    let num_special = normalized
        .chars()
        .filter(|c| SPECIAL_CHARS.contains(*c))
        .count();
    let keyword_hits = SUSPICIOUS_KEYWORDS
        .iter()
        .filter(|kw| lowered.contains(*kw))
        .count();
    let is_shortened = SHORTENERS.contains(host.strip_prefix("www.").unwrap_or(&host));
    let url_len = normalized.chars().count() as f32;

    Some([
        url_len,
        host.chars().count() as f32,
        path.chars().count() as f32,
        query.chars().count() as f32,
        round4(shannon_entropy(&normalized)),
        round4(shannon_entropy(&host)),
        is_ip as u8 as f32,
        subdomain_count(&host),
        normalized.matches('.').count() as f32,
        normalized.matches('-').count() as f32,
        num_digits as f32,
        num_special as f32,
        if url_len > 0.0 { round4(num_digits as f32 / url_len) } else { 0.0 },
        normalized.contains('@') as u8 as f32,
        (parsed.scheme() == "https") as u8 as f32,
        is_shortened as u8 as f32,
        keyword_hits as f32,
        (keyword_hits > 0) as u8 as f32,
    ])
}
