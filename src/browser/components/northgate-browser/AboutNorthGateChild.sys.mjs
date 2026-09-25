/**
 * Actor child for the about:northgate dashboard. Relays page requests to the
 * parent and forwards the resulting data back to the page as a DOM event.
 *
 * Replies always use a different event name than the request (e.g.
 * NorthGate:LLMState -> NorthGate:LLMStateResult); only request names are
 * registered for this actor, so a reply can never re-trigger a request.
 */
export class AboutNorthGateChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded":
      case "NorthGate:Refresh":
        this.#send("AboutNorthGate:GetData", "NorthGate:Data");
        break;
      case "NorthGate:ClearAlerts":
        this.#send("AboutNorthGate:ClearAlerts", "NorthGate:Data");
        break;
      case "NorthGate:LLMState":
        this.#send("AboutNorthGate:LLMState", "NorthGate:LLMStateResult");
        break;
      case "NorthGate:LLMDownload":
        this.#send(
          "AboutNorthGate:LLMDownload",
          "NorthGate:LLMDownloadResult",
          event.detail
        );
        break;
      case "NorthGate:LLMExplain":
        this.#send(
          "AboutNorthGate:LLMExplain",
          "NorthGate:LLMExplainResult",
          event.detail
        );
        break;
    }
  }

  receiveMessage(message) {
    if (message.name === "AboutNorthGate:LLMProgress") {
      this.#dispatch("NorthGate:LLMProgress", message.data);
    }
  }

  #send(query, eventName, data) {
    this.sendQuery(query, data).then(result =>
      this.#dispatch(eventName, result)
    );
  }

  #dispatch(eventName, data) {
    const event = new this.contentWindow.CustomEvent(eventName, {
      detail: Cu.cloneInto(data, this.contentWindow),
    });
    this.contentWindow.dispatchEvent(event);
  }
}
