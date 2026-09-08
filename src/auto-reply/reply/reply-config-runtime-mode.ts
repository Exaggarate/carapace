import type { CarapaceConfig } from "../../config/types.carapace.js";

// Reply completeness is process-local metadata. Keep it off config objects so
// frozen runtime snapshots and identity-keyed caches remain valid.
const replyConfigRuntimeModes = new WeakMap<CarapaceConfig, "fast" | "full">();

export function markReplyConfigRuntimeMode<T extends CarapaceConfig>(
  config: T,
  runtimeMode: "fast" | "full",
): T {
  replyConfigRuntimeModes.set(config, runtimeMode);
  return config;
}

export function isCompleteReplyConfig(config: unknown): config is CarapaceConfig {
  return Boolean(
    config && typeof config === "object" && replyConfigRuntimeModes.has(config as CarapaceConfig),
  );
}

export function usesFullReplyRuntime(config: unknown): boolean {
  if (!config || typeof config !== "object") {
    return false;
  }
  const mode = replyConfigRuntimeModes.get(config as CarapaceConfig);
  return mode === "full";
}
