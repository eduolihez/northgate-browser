/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/// The classifier's already-computed verdict for one page, exactly as shown
/// today in about:northgate. No raw URL, HTML, or script content is ever
/// part of this — only categorical/numeric signals already surfaced to the
/// user.
pub struct Verdict {
    pub label: String,
    pub probability: f64,
    pub reasons: Vec<String>,
}

pub fn build_prompt(verdict: &Verdict) -> String {
    let percent = (verdict.probability * 100.0).round() as i64;
    let reasons = if verdict.reasons.is_empty() {
        "no specific suspicious traits were flagged".to_string()
    } else {
        verdict
            .reasons
            .iter()
            .map(|r| format!("- {r}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "You are a browser security assistant. A local phishing classifier \
         scored a web address as \"{label}\" ({percent}% estimated phishing \
         probability). The signals it detected were:\n{reasons}\n\n\
         In 2-3 short sentences, explain in plain language why this address \
         got this verdict. Do not invent additional signals beyond the ones \
         listed. Do not mention that you are an AI model.",
        label = verdict.label,
        percent = percent,
        reasons = reasons,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_deterministic_prompt_for_dangerous_verdict() {
        let verdict = Verdict {
            label: "dangerous".to_string(),
            probability: 0.87,
            reasons: vec![
                "Uses a raw IP address instead of a domain name.".to_string(),
                "Contains words often used to imitate logins or brands.".to_string(),
            ],
        };
        let prompt = build_prompt(&verdict);
        assert!(prompt.contains("dangerous"));
        assert!(prompt.contains("87%"));
        assert!(prompt.contains("Uses a raw IP address instead of a domain name."));
        assert!(prompt.contains("Contains words often used to imitate logins or brands."));
    }

    #[test]
    fn builds_prompt_with_no_reasons() {
        let verdict = Verdict {
            label: "safe".to_string(),
            probability: 0.02,
            reasons: vec![],
        };
        let prompt = build_prompt(&verdict);
        assert!(prompt.contains("safe"));
        assert!(prompt.contains("no specific suspicious traits"));
    }
}
