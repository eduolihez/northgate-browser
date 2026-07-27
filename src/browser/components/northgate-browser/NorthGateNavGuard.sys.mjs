/**
 * NorthGateNavGuard
 *
 * An `nsIContentPolicy` that gates top-level document navigations. For each
 * top-level http(s) load it asks the on-device classifier
 * (`@mozilla.org/northgate/classifier;1`, backed by the embedded ONNX model)
 * for a phishing score. When the score is at or above the model's block
 * threshold and the URL has not been allow-listed for this session, the load
 * is rejected and the docshell is redirected to the about:northgate-blocked
 * interstitial.
 *
 * Design notes:
 *  - Registered in the "content-policy" category (see components.conf).
 *  - Only TYPE_DOCUMENT top-level http(s) loads are ever scored; everything
 *    else returns ACCEPT immediately (this is a very hot path).
 *  - Any failure falls through to ACCEPT: the guard must never break normal
 *    navigation.
 *  - The session allow-list is owned by the parent process and distributed to
 *    content processes via `sharedData` (see NorthGateGuardParent).
 */
const ACCEPT = Ci.nsIContentPolicy.ACCEPT;
const REJECT_REQUEST = Ci.nsIContentPolicy.REJECT_REQUEST;
const TYPE_DOCUMENT = Ci.nsIContentPolicy.TYPE_DOCUMENT;
const ALLOWLIST_KEY = "northgate:allowlist";

// Parent-process authoritative allow-list of trusted hosts (not full URLs, to
// minimize retained data); content processes read the mirror published through
// sharedData.
export const NorthGateAllowList = new Set();

function isAllowed(host) {
  if (NorthGateAllowList.has(host)) {
    return true;
  }
  try {
    const mirror = Services.cpmm?.sharedData.get(ALLOWLIST_KEY);
    if (mirror instanceof Set && mirror.has(host)) {
      return true;
    }
  } catch (_e) {}
  try {
    const whitelist = Services.prefs.getCharPref("browser.northgate.whitelist", "");
    if (whitelist) {
      const hosts = whitelist.split(",").map(h => h.trim());
      if (hosts.includes(host)) {
        return true;
      }
    }
  } catch (_e) {}
  return false;
}

function getActiveThreshold(baseThreshold) {
  try {
    const slider = Services.prefs.getIntPref(
      "browser.security_level.security_slider",
      4
    );
    if (slider === 1) {
      return baseThreshold * 0.4; // Safest: 60% more sensitive (~0.097)
    } else if (slider === 2) {
      return baseThreshold * 0.7; // Safer: 30% more sensitive (~0.170)
    }
  } catch (_e) {}
  return baseThreshold; // Standard (slider = 4)
}

export class NorthGateNavGuard {
  QueryInterface = ChromeUtils.generateQI(["nsIContentPolicy"]);

  #classifier = null;
  #classifierChecked = false;

  // The native ONNX classifier service is not present in every build. Resolve
  // it lazily and remember its absence, so the guard silently no-ops instead of
  // throwing (and logging) on every navigation when it is unavailable.
  get classifier() {
    if (!this.#classifierChecked) {
      this.#classifierChecked = true;
      try {
        this.#classifier = Cc[
          "@mozilla.org/northgate/classifier;1"
        ]?.getService(Ci.nsINorthGateClassifier);
      } catch (_e) {
        this.#classifier = null;
      }
    }
    return this.#classifier;
  }

  shouldLoad(contentLocation, loadInfo) {
    try {
      if (loadInfo.externalContentPolicyType !== TYPE_DOCUMENT) {
        return ACCEPT;
      }
      if (
        !contentLocation.schemeIs("http") &&
        !contentLocation.schemeIs("https")
      ) {
        return ACCEPT;
      }
      // Top-level documents only (no subframes/iframes).
      const bc = loadInfo.browsingContext;
      if (!bc || bc.parent) {
        return ACCEPT;
      }

      // Allow-list is keyed by host: once the user proceeds past the warning
      // for a site, the whole site is trusted for the session.
      if (isAllowed(contentLocation.host)) {
        return ACCEPT;
      }

      const classifier = this.classifier;
      if (!classifier) {
        return ACCEPT;
      }

      const spec = contentLocation.spec;
      const score = classifier.scoreURL(spec);
      const threshold = getActiveThreshold(classifier.blockThreshold);
      if (score >= threshold) {
        this.#redirectToInterstitial(bc, spec, score);
        return REJECT_REQUEST;
      }
    } catch (error) {
      // The guard must never break navigation; log and allow.
      console.error("NorthGateNavGuard.shouldLoad:", error);
    }
    return ACCEPT;
  }

  shouldProcess() {
    return ACCEPT;
  }

  #redirectToInterstitial(bc, spec, score) {
    const target =
      "about:northgate-blocked?url=" +
      encodeURIComponent(spec) +
      "&score=" +
      score.toFixed(4);
    const uri = Services.io.newURI(target);
    const principal = Services.scriptSecurityManager.getSystemPrincipal();

    // Cannot navigate from within shouldLoad; defer to the next tick.
    Services.tm.dispatchToMainThread(() => {
      try {
        const webNav = bc.docShell?.QueryInterface(Ci.nsIWebNavigation);
        if (webNav) {
          webNav.loadURI(uri, { triggeringPrincipal: principal });
        } else {
          // Parent-process browsing context (e.g. under Fission).
          bc.loadURI(uri, { triggeringPrincipal: principal });
        }
      } catch (error) {
        console.error("NorthGateNavGuard.redirect:", error);
      }
    });
  }
}
