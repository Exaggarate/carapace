// Novita plugin entrypoint registers its Carapace integration.
import { readConfiguredProviderCatalogEntries } from "carapace/plugin-sdk/provider-catalog-shared";
import { defineSingleProviderPluginEntry } from "carapace/plugin-sdk/provider-entry";
import { buildProviderReplayFamilyHooks } from "carapace/plugin-sdk/provider-model-shared";
import { buildProviderToolCompatFamilyHooks } from "carapace/plugin-sdk/provider-tools";
import manifest from "./carapace.plugin.json" with { type: "json" };

const PROVIDER_ID = "novita";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "NovitaAI Provider",
  description: "Official Carapace NovitaAI provider plugin",
  manifest,
  provider: {
    label: "NovitaAI",
    docsPath: "/providers/novita",
    aliases: ["novita-ai", "novitaai"],
    manifestAuth: {
      noteTitle: "NovitaAI",
      noteMessage: "Manage API keys at https://novita.ai/settings/key-management",
    },
    catalog: {
      discoveryMode: "strict",
      allowExplicitBaseUrl: true,
      liveModelDiscovery: true,
    },
    augmentModelCatalog: ({ config }) =>
      readConfiguredProviderCatalogEntries({
        config,
        providerId: PROVIDER_ID,
      }),
    ...buildProviderReplayFamilyHooks({
      family: "openai-compatible",
      dropReasoningFromHistory: false,
    }),
    ...buildProviderToolCompatFamilyHooks("openai"),
  },
});
