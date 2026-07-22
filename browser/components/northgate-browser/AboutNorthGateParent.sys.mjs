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
    }
    return undefined;
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
