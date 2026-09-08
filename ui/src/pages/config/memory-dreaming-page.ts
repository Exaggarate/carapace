// Dreams tab host. Agent selection is owned by the parent Memory page.
import { html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { CarapaceLightDomElement } from "../../lit/carapace-element.ts";
import "../agents/memory/memory-panel.ts";

class MemoryDreamingSettings extends CarapaceLightDomElement {
  @property() agentId: string | null = null;

  override render() {
    return html`
      ${
        this.agentId
          ? html`<carapace-agent-memory-panel
              .agentId=${this.agentId}
            ></carapace-agent-memory-panel>`
          : nothing
      }
    `;
  }
}

if (!customElements.get("carapace-memory-dreaming")) {
  customElements.define("carapace-memory-dreaming", MemoryDreamingSettings);
}
