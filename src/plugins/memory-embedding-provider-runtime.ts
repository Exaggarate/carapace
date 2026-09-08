import type { CarapaceConfig } from "../config/types.carapace.js";
import { getEmbeddingProvider, listEmbeddingProviders } from "./embedding-provider-runtime.js";
import { listRegisteredEmbeddingProviders } from "./embedding-providers.js";
import type { MemoryEmbeddingProviderAdapter } from "./memory-embedding-providers.js";

/** Lists registered memory embedding provider adapters without registry metadata. */
export function listRegisteredMemoryEmbeddingProviderAdapters(): MemoryEmbeddingProviderAdapter[] {
  return listRegisteredEmbeddingProviders().map((entry) => entry.adapter);
}

/** Lists memory embedding providers from runtime config and registered adapters. */
export function listMemoryEmbeddingProviders(
  cfg?: CarapaceConfig,
): MemoryEmbeddingProviderAdapter[] {
  return listEmbeddingProviders(cfg);
}

/** Resolves one memory embedding provider by id, alias, or configured API owner. */
export function getMemoryEmbeddingProvider(
  id: string,
  cfg?: CarapaceConfig,
): MemoryEmbeddingProviderAdapter | undefined {
  return getEmbeddingProvider(id, cfg);
}
