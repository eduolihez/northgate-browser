/**
 * Actor child for the about:northgate dashboard. Relays page requests to the
 * parent and forwards the resulting data back to the page as a DOM event.
 */
export class AboutNorthGateChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded":
      case "NorthGate:Refresh":
        this.#send("AboutNorthGate:GetData");
        break;
      case "NorthGate:ClearAlerts":
        this.#send("AboutNorthGate:ClearAlerts");
        break;
    }
  }

  #send(query) {
    this.sendQuery(query).then(data => this.#dispatch(data));
  }

  #dispatch(data) {
    const event = new this.contentWindow.CustomEvent("NorthGate:Data", {
      detail: Cu.cloneInto(data, this.contentWindow),
    });
    this.contentWindow.dispatchEvent(event);
  }
}
