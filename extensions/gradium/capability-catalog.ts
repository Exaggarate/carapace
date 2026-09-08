import type { PluginCapabilityCatalog } from "carapace/plugin-sdk/plugin-entry";
import { buildGradiumSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildGradiumSpeechProvider()],
} satisfies PluginCapabilityCatalog;
