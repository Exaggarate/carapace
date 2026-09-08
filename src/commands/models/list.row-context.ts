import type { CarapaceConfig } from "../../config/types.carapace.js";
import type { PluginMetadataSnapshot } from "../../plugins/plugin-metadata-snapshot.types.js";
import type { ModelListAuthIndex } from "./list.auth-index.js";
import type { ConfiguredEntry } from "./list.types.js";

type RowFilter = {
  provider?: string;
  local?: boolean;
};

/** Context shared by every model-list row source builder. */
export type RowBuilderContext = {
  cfg: CarapaceConfig;
  agentId?: string;
  agentDir: string;
  inheritedAuthDir?: string;
  authIndex: ModelListAuthIndex;
  canonicalizeProvider: (provider: string) => string;
  providerDiscoveryProviderIds?: readonly string[];
  providerRuntimeDiscoveryProviderIds?: readonly string[];
  providerManifestFallbackProviderIds?: readonly string[];
  availableKeys?: Set<string>;
  configuredByKey: Map<string, ConfiguredEntry>;
  discoveredKeys: Set<string>;
  filter: RowFilter;
  metadataSnapshot?: PluginMetadataSnapshot;
  workspaceDir?: string;
};
