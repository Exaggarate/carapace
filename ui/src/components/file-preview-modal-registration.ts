import { CarapaceFilePreviewModal } from "./file-preview-modal.ts";

if (!customElements.get("carapace-file-preview-modal")) {
  customElements.define("carapace-file-preview-modal", CarapaceFilePreviewModal);
}
