import type { PluginCapabilityCatalog } from "carapace/plugin-sdk/plugin-entry";
import { buildAzureSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildAzureSpeechProvider()],
} satisfies PluginCapabilityCatalog;
