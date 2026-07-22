/**
 * Actor parent for the NorthGate navigation guard.
 *
 * Exposes the internal "score a URL" API to content (the message-based
 * parent/content channel required before navigation) and handles the
 * interstitial's "proceed anyway" action by adding the URL to the session
 * allow-list, mirroring it to content processes, and continuing the load.
 */
import { NorthGateAllowList } from "moz-src:///browser/components/northgate-browser/NorthGateNavGuard.sys.mjs";

function publishAllowList() {
  // Mirror the parent-owned allow-list to all content processes so the
  // content-policy guard there stops blocking the approved URL.
  Services.ppmm.sharedData.set("northgate:allowlist", new Set(NorthGateAllowList));
  Services.ppmm.sharedData.flush();
}

export class NorthGateGuardParent extends JSWindowActorParent {
  receiveMessage(message) {
    switch (message.name) {
      case "NorthGateGuard:Score":
        return Promise.resolve(this.#score(message.data.url));
      case "NorthGateGuard:AllowOnce":
        return Promise.resolve(this.#allowOnce(message.data.url));
    }
    return undefined;
  }

  #score(url) {
    try {
      const classifier = Cc[
        "@mozilla.org/northgate/classifier;1"
      ].getService(Ci.nsINorthGateClassifier);
      return {
        score: classifier.scoreURL(url),
        threshold: classifier.blockThreshold,
      };
    } catch (error) {
      return { score: 0, threshold: 1, error: String(error) };
    }
  }

  #allowOnce(url) {
    let uri;
    try {
      uri = Services.io.newURI(url);
    } catch (_e) {
      return { ok: false };
    }
    // Only ever continue to real web pages. The interstitial URL is reachable
    // by untrusted content, so a `url` of javascript:/file:/chrome:/data: must
    // never be navigated to (that would be a privilege escalation).
    if (!uri.schemeIs("http") && !uri.schemeIs("https")) {
      return { ok: false };
    }
    NorthGateAllowList.add(uri.host);
    publishAllowList();
    try {
      this.browsingContext.top.loadURI(uri, {
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    return { ok: true };
  }
}
