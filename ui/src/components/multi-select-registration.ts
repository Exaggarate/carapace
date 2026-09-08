import { MultiSelect } from "./multi-select.ts";

if (!customElements.get("carapace-multi-select")) {
  customElements.define("carapace-multi-select", MultiSelect);
}

declare global {
  interface HTMLElementTagNameMap {
    "carapace-multi-select": MultiSelect;
  }
}
