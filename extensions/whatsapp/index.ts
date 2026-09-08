// Whatsapp plugin entrypoint registers its Carapace integration.
import {
  defineBundledChannelEntry,
  loadBundledEntryExportSync,
} from "carapace/plugin-sdk/channel-entry-contract";
import type { CarapacePluginApi } from "carapace/plugin-sdk/channel-entry-contract";

function registerWhatsAppAgentTools(api: CarapacePluginApi): void {
  const registerTool = loadBundledEntryExportSync<(api: CarapacePluginApi) => void>(
    import.meta.url,
    {
      specifier: "./agent-tools-api.js",
      exportName: "registerWhatsAppAgentTools",
    },
  );
  registerTool(api);
}

export default defineBundledChannelEntry({
  id: "whatsapp",
  name: "WhatsApp",
  description: "WhatsApp channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "whatsappPlugin",
  },
  runtime: {
    specifier: "./runtime-setter-api.js",
    exportName: "setWhatsAppRuntime",
  },
  registerFull: registerWhatsAppAgentTools,
});
