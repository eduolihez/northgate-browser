/**
 * Actor child class for the about:northgate-browser page.
 */
export class AboutNorthGateBrowserChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded":
        this.sendQuery("AboutNorthGateBrowser:GetUpdateData").then(response => {
          if (response.delayed) {
            // Wait for DelayedUpdateData.
            return;
          }
          this.#dispatchUpdateData(response.updateData);
        });
        break;
    }
  }

  receiveMessage(message) {
    switch (message.name) {
      case "AboutNorthGateBrowser:DelayedUpdateData":
        this.#dispatchUpdateData(message.data);
        break;
    }
  }

  /**
   * Send the update data to the page.
   *
   * @param {object} data - The data to send.
   */
  #dispatchUpdateData(data) {
    const updateEvent = new this.contentWindow.CustomEvent("UpdateData", {
      detail: Cu.cloneInto(data, this.contentWindow),
    });
    this.contentWindow.dispatchEvent(updateEvent);
  }
}
