import type { CarapaceConfig } from "../config/types.carapace.js";

/** Restores retired cron migration inputs that canonical config migration intentionally strips. */
export function withLegacyConfig(
  config: CarapaceConfig,
  legacyConfig: CarapaceConfig | undefined,
): CarapaceConfig {
  const legacyCron = legacyConfig?.cron as Record<string, unknown> | undefined;
  if (
    !legacyCron ||
    (!Object.hasOwn(legacyCron, "store") && !Object.hasOwn(legacyCron, "webhook"))
  ) {
    return config;
  }
  return {
    ...config,
    cron: {
      ...config.cron,
      ...(Object.hasOwn(legacyCron, "store") ? { store: legacyCron.store } : {}),
      ...(Object.hasOwn(legacyCron, "webhook") ? { webhook: legacyCron.webhook } : {}),
    },
  } as CarapaceConfig;
}

/** Isolates the trusted partition selector from a partially valid legacy config. */
export function retainStoreConfig(config: CarapaceConfig | undefined): CarapaceConfig | undefined {
  const cron = config?.cron as { store?: unknown; webhook?: unknown } | undefined;
  if (typeof cron?.store !== "string" || !cron.store.trim()) {
    return undefined;
  }
  return {
    cron: {
      store: cron.store,
      ...(Object.hasOwn(cron, "webhook") ? { webhook: cron.webhook } : {}),
    },
  } as CarapaceConfig;
}
