import { AgentSelect } from "./agent-select.ts";

if (!customElements.get("carapace-agent-select")) {
  customElements.define("carapace-agent-select", AgentSelect);
}

declare global {
  interface HTMLElementTagNameMap {
    "carapace-agent-select": AgentSelect;
  }
}
