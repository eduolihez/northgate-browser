/**
 * Actor child for the NorthGate navigation guard.
 *
 * Bridges the about:northgate-blocked interstitial to the parent: forwards the
 * "proceed anyway" action and offers a `scoreURL` helper that content can use
 * to query a URL's phishing score before navigating.
 */
export class NorthGateGuardChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "NorthGateBlocked:Proceed":
        this.sendAsyncMessage("NorthGateGuard:AllowOnce", {
          url: event.detail.url,
          permanent: event.detail.permanent,
        });
        break;
    }
  }

  /**
   * Internal API: estimate the phishing score of a URL via the parent-process
   * on-device classifier. Returns `{ score, threshold }`.
   */
  scoreURL(url) {
    return this.sendQuery("NorthGateGuard:Score", { url });
  }
}
