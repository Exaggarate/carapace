// Synthetic plugin entrypoint registers its Carapace integration.
import { defineSingleProviderPluginEntry } from "carapace/plugin-sdk/provider-entry";
import { applySyntheticConfig, SYNTHETIC_DEFAULT_MODEL_REF } from "./onboard.js";
import manifest from "./carapace.plugin.json" with { type: "json" };
import { buildSyntheticProvider, SYNTHETIC_MODEL_DISCOVERY } from "./provider-catalog.js";

const PROVIDER_ID = "synthetic";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Synthetic Provider",
  description: "Synthetic provider plugin",
  manifest,
  provider: {
    label: "Synthetic",
    docsPath: "/providers/synthetic",
    manifestAuth: {
      defaultModel: SYNTHETIC_DEFAULT_MODEL_REF,
      applyConfig: applySyntheticConfig,
    },
    catalog: {
      discoveryMode: "strict",
      buildProvider: buildSyntheticProvider,
      buildStaticProvider: buildSyntheticProvider,
      allowExplicitBaseUrl: true,
      liveModelDiscovery: SYNTHETIC_MODEL_DISCOVERY,
    },
  },
});
