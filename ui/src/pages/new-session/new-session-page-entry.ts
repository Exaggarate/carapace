import { html } from "lit";
import { NewSessionPage } from "./new-session-page.ts";

if (!customElements.get("carapace-new-session-page")) {
  customElements.define("carapace-new-session-page", NewSessionPage);
}

export const render = (data: unknown) =>
  html`<carapace-new-session-page .data=${data}></carapace-new-session-page>`;
