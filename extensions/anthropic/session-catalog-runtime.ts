import { resolveEffectiveAgentRuntime } from "carapace/plugin-sdk/command-auth-native";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import type { CarapacePluginApi } from "carapace/plugin-sdk/plugin-entry";
import {
  listSessionCatalogEntries,
  type SessionCatalogEntrySnapshot,
} from "carapace/plugin-sdk/session-catalog";
import { isRecord } from "carapace/plugin-sdk/string-coerce-runtime";
import { CLAUDE_CLI_BACKEND_ID, CLAUDE_CLI_ROUTE_PROBE_MODEL_IDS } from "./cli-constants.js";
import { adoptedSourceKey, CLAUDE_LOCAL_SESSION_HOST_ID } from "./session-catalog-adoption.js";

export function currentClaudeSessionCatalogConfig(api: CarapacePluginApi): CarapaceConfig {
  return (api.runtime.config?.current?.() ?? api.config ?? {}) as CarapaceConfig;
}

function boundClaudeSource(
  pluginId: string,
  entry: {
    cliSessionBindings?: unknown;
    execHost?: string;
    execNode?: string;
    pluginOwnerId?: string;
    modelSelectionLocked?: boolean;
    pluginExtensions?: unknown;
  },
): { hostId: string; threadId: string } | undefined {
  const anthropic = isRecord(entry.pluginExtensions) ? entry.pluginExtensions.anthropic : undefined;
  const marker = isRecord(anthropic) ? anthropic.sessionCatalog : undefined;
  const hostId =
    isRecord(marker) && typeof marker.sourceHostId === "string"
      ? marker.sourceHostId
      : entry.execHost === "node" && typeof entry.execNode === "string" && entry.execNode.trim()
        ? `node:${entry.execNode.trim()}`
        : CLAUDE_LOCAL_SESSION_HOST_ID;
  const bindings = isRecord(entry.cliSessionBindings) ? entry.cliSessionBindings : undefined;
  const binding = bindings?.[CLAUDE_CLI_BACKEND_ID];
  if (isRecord(binding) && typeof binding.sessionId === "string" && binding.sessionId) {
    return { hostId, threadId: binding.sessionId };
  }
  if (entry.pluginOwnerId !== pluginId || entry.modelSelectionLocked !== true) {
    return undefined;
  }
  return isRecord(marker) && typeof marker.sourceThreadId === "string"
    ? { hostId, threadId: marker.sourceThreadId }
    : undefined;
}

export function listBoundClaudeSessions(
  api: CarapacePluginApi,
  agentId?: string,
  sessionEntries?: SessionCatalogEntrySnapshot,
): Map<string, string> {
  const config = currentClaudeSessionCatalogConfig(api);
  const bound = new Map<string, string>();
  for (const { sessionKey, entry } of listSessionCatalogEntries({
    agentId,
    config,
    runtime: api.runtime,
    sessionEntries,
  })) {
    const source = boundClaudeSource(api.id, entry);
    if (source) {
      bound.set(adoptedSourceKey(source.hostId, source.threadId), sessionKey);
    }
  }
  return bound;
}

/**
 * Resolve the Claude model an agent actually routes to the Claude CLI backend.
 * Callers must not assume the current default is routed: existing configs pin
 * older Claude models, and stamping the default onto their sessions would
 * select a model the operator never routed or allowed.
 */
export function resolveClaudeCliRoutedModelId(
  config: CarapaceConfig,
  agentId: string,
): string | undefined {
  return CLAUDE_CLI_ROUTE_PROBE_MODEL_IDS.find(
    (modelId) =>
      resolveEffectiveAgentRuntime({
        cfg: config,
        provider: "anthropic",
        modelId,
        agentId,
      }) === CLAUDE_CLI_BACKEND_ID,
  );
}
