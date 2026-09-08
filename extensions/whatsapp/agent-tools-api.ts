// WhatsApp agent tool facade keeps the bundled entrypoint light during discovery.
import type { CarapacePluginApi } from "carapace/plugin-sdk/core";
import { registerWhatsAppCallTool } from "./src/agent-tools-call.js";
import { registerWhatsAppLoginTool } from "./src/agent-tools-login.js";

export function registerWhatsAppAgentTools(api: CarapacePluginApi): void {
  registerWhatsAppCallTool(api);
  registerWhatsAppLoginTool(api);
}
