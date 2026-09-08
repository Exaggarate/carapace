// Deepgram plugin entrypoint registers its Carapace integration.
import { definePluginEntry } from "carapace/plugin-sdk/plugin-entry";
import { deepgramMediaUnderstandingProvider } from "./media-understanding-provider.js";
import { buildDeepgramRealtimeTranscriptionProvider } from "./realtime-transcription-provider-factory.js";

export default definePluginEntry({
  id: "deepgram",
  name: "Deepgram Media Understanding",
  description: "Bundled Deepgram audio transcription provider",
  register(api) {
    api.registerMediaUnderstandingProvider(deepgramMediaUnderstandingProvider);
    api.registerRealtimeTranscriptionProvider(buildDeepgramRealtimeTranscriptionProvider);
  },
});
