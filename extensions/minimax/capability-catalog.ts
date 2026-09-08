import type { PluginCapabilityCatalogEntry } from "carapace/plugin-sdk/plugin-entry";
import { buildMinimaxSpeechProvider } from "./speech-provider-factory.js";

const catalog: PluginCapabilityCatalogEntry = (context) => ({
  speechProviders: [buildMinimaxSpeechProvider(context)],
});

export default catalog;
