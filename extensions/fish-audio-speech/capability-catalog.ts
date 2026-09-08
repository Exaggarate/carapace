import type { PluginCapabilityCatalog } from "carapace/plugin-sdk/plugin-entry";
import { buildFishAudioSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildFishAudioSpeechProvider()],
} satisfies PluginCapabilityCatalog;
