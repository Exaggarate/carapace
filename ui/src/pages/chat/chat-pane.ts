// Public custom-element entrypoint for the Control UI chat pane.
import { ChatPane } from "./chat-pane-render.ts";

if (!customElements.get("carapace-chat-pane")) {
  customElements.define("carapace-chat-pane", ChatPane);
}

declare global {
  interface HTMLElementTagNameMap {
    "carapace-chat-pane": ChatPane;
  }
}
