// LongCat provider module implements model/runtime integration.
import { buildManifestModelProviderConfig } from "carapace/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "carapace/plugin-sdk/provider-model-shared";
import manifest from "./carapace.plugin.json" with { type: "json" };

export function buildLongCatProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "longcat",
    catalog: manifest.modelCatalog.providers.longcat,
  });
}
