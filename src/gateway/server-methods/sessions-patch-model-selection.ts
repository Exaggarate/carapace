import type { SessionsPatchParams } from "../../../packages/gateway-protocol/src/index.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveSessionModelRef } from "../../agents/session-model-ref.js";
import { persistStickyModelSelectionBestEffort } from "../../agents/sticky-model-selection.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { CarapaceConfig } from "../../config/types.carapace.js";
import { resolveGatewayModelSelectionPolicy } from "./session-model-selection-policy.js";

export function persistSessionPatchModelSelection(params: {
  callerScopes: readonly string[];
  cfg: CarapaceConfig;
  entry: SessionEntry;
  patch: SessionsPatchParams;
  sessionKey: string;
  targetAgentId: string;
}): void {
  if (typeof params.patch.model !== "string") {
    return;
  }
  const policy = resolveGatewayModelSelectionPolicy({
    callerScopes: params.callerScopes,
    cfg: params.cfg,
  });
  if (policy.target === "session") {
    return;
  }
  const agentId = resolveSessionAgentId({
    config: params.cfg,
    sessionKey: params.sessionKey,
    agentId: params.targetAgentId,
  });
  const resolved = resolveSessionModelRef(params.cfg, params.entry, agentId);
  persistStickyModelSelectionBestEffort({
    agentId,
    model: `${resolved.provider}/${resolved.model}`,
    target: policy.target === "agent" ? "agent" : "defaults",
  });
}
