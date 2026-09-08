import type { ModelAliasIndex } from "../../agents/model-selection.js";
import type { CarapaceConfig } from "../../config/types.carapace.js";
import { markReplyConfigRuntimeMode } from "./reply-config-runtime-mode.js";

export function markCompleteReplyConfig<T extends CarapaceConfig>(
  config: T,
  options?: { runtimeMode?: "fast" | "full" },
): T {
  return markReplyConfigRuntimeMode(config, options?.runtimeMode ?? "fast");
}

export function withFastReplyConfig<T extends CarapaceConfig>(config: T): T {
  return markCompleteReplyConfig(config);
}

export function emptyAliasIndex(): ModelAliasIndex {
  return { byAlias: new Map(), byKey: new Map() };
}
