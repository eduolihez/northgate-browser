/**
 * Actor parent for the about:northgate privacy/security dashboard.
 *
 * Runs in the parent process where it can read the currently browsed site's
 * content-blocking log, run the phishing classifier, derive a privacy score,
 * and keep a per-session history of alerts.
 */
const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  NorthGateClassifier:
    "moz-src:///browser/components/northgate-browser/NorthGateClassifier.sys.mjs",
  northGateLLMManager:
    "moz-src:///browser/components/northgate-browser/NorthGateLLMManager.sys.mjs",
});

// Content-blocking states that count as a blocked tracker, grouped by the
// category surfaced in the dashboard.
const TRACKER_CATEGORIES = {
  tracking: () => Ci.nsIWebProgressListener.STATE_BLOCKED_TRACKING_CONTENT,
  fingerprinting: () =>
    Ci.nsIWebProgressListener.STATE_BLOCKED_FINGERPRINTING_CONTENT,
  cryptomining: () =>
    Ci.nsIWebProgressListener.STATE_BLOCKED_CRYPTOMINING_CONTENT,
  social: () =>
    Ci.nsIWebProgressListener.STATE_BLOCKED_SOCIALTRACKING_CONTENT,
  cookies: () =>
    Ci.nsIWebProgressListener.STATE_COOKIES_BLOCKED_TRACKER |
    Ci.nsIWebProgressListener.STATE_COOKIES_BLOCKED_SOCIALTRACKER,
};

// Gates the "Explain with local AI" feature. Off by default until the llama.cpp
// decode loop in northgate-llm's engine.rs is implemented.
const LLM_EXPLAIN_PREF = "browser.northgate.llmExplain.enabled";

// Fixed English text for each classifier reason id, used as LLM prompt input.
// Only these strings can ever reach the prompt; unknown ids are dropped.
const LLM_REASON_TEXT = {
  "ngate-reason-ip-literal": "Uses a raw IP address instead of a domain name.",
  "ngate-reason-no-https": "Connection is not encrypted (no HTTPS).",
  "ngate-reason-at-symbol":
    "Contains an @ symbol, which can hide the real destination.",
  "ngate-reason-punycode": "Uses punycode, which can imitate a trusted brand.",
  "ngate-reason-shortener":
    "Uses a link shortener that hides the real destination.",
  "ngate-reason-keywords":
    "Contains words often used to imitate logins or brands.",
  "ngate-reason-subdomains": "Has an unusually deep chain of subdomains.",
  "ngate-reason-long-url": "The web address is unusually long.",
  "ngate-reason-hyphens": "The domain name uses many hyphens.",
  "ngate-reason-random-host": "The host name looks randomly generated.",
  "ngate-reason-risky-tld":
    "Uses a top-level domain frequently abused for phishing.",
};

function llmExplainEnabled() {
  return Services.prefs.getBoolPref(LLM_EXPLAIN_PREF, false);
}

// Alert when a page carries at least this many blocked trackers.
const HEAVY_TRACKING_THRESHOLD = 10;
// Cap on retained per-session alerts.
const MAX_ALERTS = 50;

/**
 * Per-session alert history. Module state is a process singleton, so it is
 * shared across every about:northgate tab and cleared only on restart.
 * Keyed by `${type}|${url}` so repeat visits refresh rather than duplicate.
 */
const sessionAlerts = new Map();

function recordAlert(type, severity, host, extra = {}) {
  // Keyed and stored by host only: full URLs (which can carry session tokens in
  // the path/query) are never retained in the session history.
  const key = `${type}|${host}`;
  sessionAlerts.set(key, {
    type,
    severity,
    host,
    time: Date.now(),
    ...extra,
  });
  // Trim oldest entries beyond the cap.
  if (sessionAlerts.size > MAX_ALERTS) {
    const oldest = [...sessionAlerts.entries()].sort(
      (a, b) => a[1].time - b[1].time
    )[0];
    sessionAlerts.delete(oldest[0]);
  }
}

function alertList() {
  return [...sessionAlerts.values()].sort((a, b) => b.time - a.time);
}

export class AboutNorthGateParent extends JSWindowActorParent {
  receiveMessage(message) {
    switch (message.name) {
      case "AboutNorthGate:GetData":
        return Promise.resolve(this.#buildPayload());
      case "AboutNorthGate:ClearAlerts":
        sessionAlerts.clear();
        return Promise.resolve(this.#buildPayload());
      case "AboutNorthGate:LLMState":
        return this.#llmState();
      case "AboutNorthGate:LLMDownload":
        return this.#downloadModel(message.data);
      case "AboutNorthGate:LLMExplain":
        return this.#explainVerdict(message.data);
    }
    return undefined;
  }

  async #llmState() {
    if (!llmExplainEnabled()) {
      return { enabled: false, state: "disabled" };
    }
    return {
      enabled: true,
      state: await lazy.northGateLLMManager.getDisplayState(),
    };
  }

  /**
   * @param {object} [data]
   * @param {boolean} [data.allowNetwork] True only once the user has confirmed
   *   the download consent prompt; otherwise only a cached model is accepted.
   */
  async #downloadModel(data) {
    if (!llmExplainEnabled()) {
      return { state: "disabled" };
    }
    const allowNetwork = data?.allowNetwork === true;
    try {
      await lazy.northGateLLMManager.ensureDownloaded(
        fraction => {
          try {
            this.sendAsyncMessage("AboutNorthGate:LLMProgress", { fraction });
          } catch (_e) {
            // The dashboard went away; keep downloading regardless.
          }
        },
        { allowNetwork }
      );
      return { state: "ready" };
    } catch (e) {
      const state = lazy.northGateLLMManager.getState();
      return {
        state: state === "not-downloaded" ? "not-downloaded" : "error",
        message: String(e),
      };
    }
  }

  /**
   * Classification of the site the dashboard currently describes, re-derived
   * here so nothing the page sends can influence the LLM prompt.
   *
   * @returns {{host: string, verdict: string, probability: number,
   *   reasons: string[]}?}
   */
  #currentClassificationForLLM() {
    const browser = this.#currentSiteBrowser();
    if (!browser) {
      return null;
    }
    const uri = browser.currentURI;
    let host = "";
    try {
      host = uri.host;
    } catch (_e) {
      host = uri.spec;
    }
    const { verdict, probability, reasons } = lazy.NorthGateClassifier.classify(
      uri.spec
    );
    return {
      host,
      verdict,
      probability,
      reasons: reasons
        .filter(id => Object.hasOwn(LLM_REASON_TEXT, id))
        .map(id => LLM_REASON_TEXT[id]),
    };
  }

  /**
   * @param {object} [data]
   * @param {string} [data.host] Host the page is currently displaying. Only
   *   compared against the re-derived site, never passed to the model.
   */
  #explainVerdict(data) {
    if (!llmExplainEnabled()) {
      return Promise.resolve({ ok: false, message: "disabled" });
    }
    const current = this.#currentClassificationForLLM();
    if (!current) {
      return Promise.resolve({ ok: false, message: "no site" });
    }
    const { host, verdict, probability, reasons } = current;
    if (data?.host !== host) {
      return Promise.resolve({
        ok: false,
        siteChanged: true,
        host,
        message: "site changed",
      });
    }

    return new Promise(resolve => {
      let service;
      try {
        service = Cc["@mozilla.org/northgate/llm;1"].getService(
          Ci.nsINorthGateLLM
        );
      } catch (e) {
        resolve({ ok: false, host, message: "LLM service unavailable" });
        return;
      }

      try {
        service.explainVerdict(
          verdict,
          probability,
          reasons,
          lazy.northGateLLMManager.modelPath(),
          {
            QueryInterface: ChromeUtils.generateQI(["nsINorthGateLLMCallback"]),
            onResult: explanation => resolve({ ok: true, host, explanation }),
            onError: message => resolve({ ok: false, host, message }),
          }
        );
      } catch (e) {
        resolve({ ok: false, host, message: String(e) });
      }
    });
  }

  /**
   * The <browser> hosting the dashboard, used to reach its chrome window.
   */
  get #dashboardBrowser() {
    return this.browsingContext.top.embedderElement;
  }

  /**
   * Pick the site the dashboard should describe: the selected tab when it is a
   * web page, otherwise the most recently accessed web tab in the window.
   *
   * @returns {MozBrowser?}
   */
  #currentSiteBrowser() {
    const self = this.#dashboardBrowser;
    const gBrowser = self?.ownerGlobal?.gBrowser;
    if (!gBrowser) {
      return null;
    }
    const isWeb = browser => {
      const uri = browser?.currentURI;
      return !!uri && (uri.schemeIs("http") || uri.schemeIs("https"));
    };

    const selected = gBrowser.selectedBrowser;
    if (selected !== self && isWeb(selected)) {
      return selected;
    }

    let best = null;
    for (const tab of gBrowser.tabs) {
      const browser = tab.linkedBrowser;
      if (browser === self || !isWeb(browser)) {
        continue;
      }
      if (!best || tab.lastAccessed > best.lastAccessed) {
        best = { browser, lastAccessed: tab.lastAccessed };
      }
    }
    return best?.browser ?? null;
  }

  /**
   * Count blocked trackers on a browser, broken down by category.
   */
  #countTrackers(browser) {
    const byCategory = {
      tracking: 0,
      fingerprinting: 0,
      cryptomining: 0,
      social: 0,
      cookies: 0,
    };
    let total = 0;
    let log;
    try {
      log = JSON.parse(browser.getContentBlockingLog());
    } catch (_e) {
      return { total, byCategory };
    }

    for (const events of Object.values(log)) {
      for (const [state, blocked, count] of events) {
        if (!blocked) {
          continue;
        }
        const hits = count || 1;
        for (const [category, maskFn] of Object.entries(TRACKER_CATEGORIES)) {
          if (state & maskFn()) {
            byCategory[category] += hits;
            total += hits;
          }
        }
      }
    }
    return { total, byCategory };
  }

  /**
   * Derive a 0-100 privacy score and letter grade from the site signals.
   */
  #privacyScore(site, trackers, classification) {
    let score = 100;
    if (!site.isHttps) {
      score -= 30;
    }
    if (classification.verdict === "dangerous") {
      score -= 40;
    } else if (classification.verdict === "suspicious") {
      score -= 20;
    }
    score -= Math.min(trackers.total * 2, 20);
    score = Math.max(0, Math.min(100, Math.round(score)));

    let grade = "A";
    if (score < 50) {
      grade = "F";
    } else if (score < 65) {
      grade = "D";
    } else if (score < 80) {
      grade = "C";
    } else if (score < 90) {
      grade = "B";
    }
    return { value: score, grade };
  }

  #buildPayload() {
    const browser = this.#currentSiteBrowser();
    if (!browser) {
      return { hasSite: false, alerts: alertList() };
    }

    const uri = browser.currentURI;
    let host = "";
    try {
      host = uri.host;
    } catch (_e) {
      host = uri.spec;
    }
    // Only the host and scheme leave the parent; the full URL (with any
    // path/query secrets) is used for local scoring and never sent or stored.
    const site = { host, isHttps: uri.schemeIs("https") };

    const trackers = this.#countTrackers(browser);
    const classification = lazy.NorthGateClassifier.classify(uri.spec);
    const privacyScore = this.#privacyScore(site, trackers, classification);

    // Never retain private-browsing activity in the session alert history.
    const isPrivate = browser.browsingContext?.usePrivateBrowsing ?? false;
    if (!isPrivate) {
      if (classification.verdict !== "safe") {
        recordAlert("phishing", classification.verdict, host, {
          probability: classification.probability,
        });
      }
      if (trackers.total >= HEAVY_TRACKING_THRESHOLD) {
        recordAlert("trackers", "info", host, { count: trackers.total });
      }
    }

    return {
      hasSite: true,
      site,
      trackers,
      classification,
      privacyScore,
      alerts: alertList(),
    };
  }
}
