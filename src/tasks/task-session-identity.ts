import { normalizeOptionalString } from "@carapace/normalization-core/string-coerce";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { parseAgentSessionKey } from "../routing/session-key.js";

/** Retained rows with unresolved owners stay inaccessible without hiding other tasks. */
export function resolveTaskSessionAgentId(
  sessionKey: string | undefined,
  agentId?: string,
  cfg?: CarapaceConfig | (() => CarapaceConfig),
): string | undefined {
  const knownAgentId =
    normalizeOptionalString(agentId) ?? parseAgentSessionKey(sessionKey)?.agentId;
  if (knownAgentId || !sessionKey || !cfg) {
    return knownAgentId;
  }
  try {
    return resolveSessionAgentId({ sessionKey, config: typeof cfg === "function" ? cfg() : cfg });
  } catch {
    return undefined;
  }
}
