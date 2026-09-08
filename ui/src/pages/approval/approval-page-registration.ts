import { ApprovalPage } from "./approval-page.ts";

if (!customElements.get("carapace-approval-page")) {
  customElements.define("carapace-approval-page", ApprovalPage);
}
