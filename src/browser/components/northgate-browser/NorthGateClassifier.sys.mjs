/**
 * NorthGateClassifier
 *
 * Transparent, dependency-free URL phishing classifier used by the
 * about:northgate dashboard to produce an "AI classifier" verdict with a plain
 * explanation.
 *
 * It mirrors the lexical features of the offline training pipeline in
 * ml-model/dataset/ (URL length, entropy, IP-literal host, subdomains, HTTPS,
 * suspicious keywords, ...). It is intentionally a heuristic stand-in: once the
 * trained model is exported, replace the body of `classify()` with a call into
 * the model runtime and keep the returned shape identical. Everything
 * downstream (actor, page) depends only on that shape:
 *
 *   {
 *     probability: number,          // 0..1 estimated phishing probability
 *     verdict: "safe"|"suspicious"|"dangerous",
 *     reasons: string[],            // Fluent ids explaining the verdict
 *   }
 */

const SUSPICIOUS_KEYWORDS = [
  "login", "log-in", "signin", "sign-in", "logon", "verify", "verification",
  "account", "secure", "security", "update", "confirm", "password", "passwd",
  "credential", "bank", "banking", "paypal", "ebay", "amazon", "apple",
  "icloud", "microsoft", "office365", "outlook", "wallet", "crypto", "bonus",
  "gift", "prize", "winner", "suspended", "locked", "billing", "invoice",
  "payment", "recover", "unlock", "webscr", "auth", "refund",
];

const SHORTENERS = new Set([
  "bit.ly", "goo.gl", "tinyurl.com", "t.co", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc",
]);

// TLDs disproportionately abused for phishing / throwaway domains.
const RISKY_TLDS = new Set([
  "zip", "mov", "tk", "gq", "ml", "cf", "ga", "top", "xyz", "click", "link",
  "country", "kim", "work", "party", "gdn", "review", "loan",
]);

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

// Verdict thresholds on the estimated phishing probability.
const SUSPICIOUS_AT = 0.35;
const DANGEROUS_AT = 0.65;

function shannonEntropy(text) {
  if (!text) {
    return 0;
  }
  const counts = new Map();
  for (const ch of text) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isIpLiteral(host) {
  return IPV4_RE.test(host) || (host.startsWith("[") && host.endsWith("]"));
}

function subdomainCount(host) {
  try {
    const base = Services.eTLD.getBaseDomainFromHost(host);
    if (host === base) {
      return 0;
    }
    const prefix = host.slice(0, host.length - base.length).replace(/\.$/, "");
    return prefix ? prefix.split(".").length : 0;
  } catch (_e) {
    return 0;
  }
}

function tldOf(host) {
  const dot = host.lastIndexOf(".");
  return dot === -1 ? "" : host.slice(dot + 1).toLowerCase();
}

export const NorthGateClassifier = {
  /**
   * Classify a URL string.
   *
   * @param {string} urlString - The absolute URL to score.
   * @returns {{probability: number, verdict: string, reasons: string[]}}
   */
  classify(urlString) {
    let nativeClassifier = null;
    try {
      nativeClassifier = Cc["@mozilla.org/northgate/classifier;1"]?.getService(
        Ci.nsINorthGateClassifier
      );
    } catch (_e) {}

    let probability = null;
    let verdict = "safe";

    if (nativeClassifier) {
      try {
        probability = nativeClassifier.scoreURL(urlString);
        const threshold = nativeClassifier.blockThreshold;
        if (probability >= threshold) {
          verdict = "dangerous";
        } else if (probability >= threshold / 2) {
          verdict = "suspicious";
        }
      } catch (e) {
        probability = null;
      }
    }

    let url;
    try {
      url = new URL(urlString);
    } catch (_e) {
      return { probability: 0, verdict: "safe", reasons: [] };
    }

    const host = url.hostname;
    const lowered = urlString.toLowerCase();
    const reasons = [];

    if (isIpLiteral(host)) {
      reasons.push("ngate-reason-ip-literal");
    }
    if (url.protocol !== "https:") {
      reasons.push("ngate-reason-no-https");
    }
    if (urlString.includes("@")) {
      reasons.push("ngate-reason-at-symbol");
    }
    if (host.includes("xn--")) {
      reasons.push("ngate-reason-punycode");
    }
    if (SHORTENERS.has(host.replace(/^www\./, ""))) {
      reasons.push("ngate-reason-shortener");
    }

    const keywordHits = SUSPICIOUS_KEYWORDS.filter(kw =>
      lowered.includes(kw)
    ).length;
    if (keywordHits) {
      reasons.push("ngate-reason-keywords");
    }

    const subdomains = subdomainCount(host);
    if (subdomains >= 3) {
      reasons.push("ngate-reason-subdomains");
    }

    if (urlString.length > 75) {
      reasons.push("ngate-reason-long-url");
    }

    if ((host.match(/-/g) || []).length >= 3) {
      reasons.push("ngate-reason-hyphens");
    }

    if (shannonEntropy(host) > 3.6) {
      reasons.push("ngate-reason-random-host");
    }

    if (RISKY_TLDS.has(tldOf(host))) {
      reasons.push("ngate-reason-risky-tld");
    }

    if (probability === null) {
      let score = 0;
      if (isIpLiteral(host)) {
        score += 0.35;
      }
      if (url.protocol !== "https:") {
        score += 0.1;
      }
      if (urlString.includes("@")) {
        score += 0.2;
      }
      if (host.includes("xn--")) {
        score += 0.15;
      }
      if (SHORTENERS.has(host.replace(/^www\./, ""))) {
        score += 0.1;
      }
      if (keywordHits) {
        score += Math.min(keywordHits * 0.08, 0.24);
      }
      if (subdomains >= 3) {
        score += 0.15;
      }
      if (urlString.length > 75) {
        score += 0.1;
      }
      if ((host.match(/-/g) || []).length >= 3) {
        score += 0.08;
      }
      if (shannonEntropy(host) > 3.6) {
        score += 0.12;
      }
      if (RISKY_TLDS.has(tldOf(host))) {
        score += 0.1;
      }

      probability = Math.max(0, Math.min(1, score));
      verdict = "safe";
      if (probability >= DANGEROUS_AT) {
        verdict = "dangerous";
      } else if (probability >= SUSPICIOUS_AT) {
        verdict = "suspicious";
      }
    }

    return { probability, verdict, reasons };
  },
};
