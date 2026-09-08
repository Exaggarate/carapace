import {
  resolveStickyModelSelectionPolicy,
  type StickyModelSelectionPolicy,
} from "../../agents/sticky-model-selection.js";
import { resolveIsNixMode } from "../../config/paths.js";
import type { ModelSelectionScope } from "../../config/types.agent-defaults.js";
import type { CarapaceConfig } from "../../config/types.carapace.js";
import { ADMIN_SCOPE } from "../operator-scopes.js";

export function resolveGatewayModelSelectionPolicy(params: {
  callerScopes: readonly string[];
  cfg: CarapaceConfig;
  scope?: ModelSelectionScope;
}): StickyModelSelectionPolicy {
  return resolveStickyModelSelectionPolicy({
    canPersistConfig: params.callerScopes.includes(ADMIN_SCOPE) && !resolveIsNixMode(process.env),
    cfg: params.cfg,
    ...(params.scope ? { scope: params.scope } : {}),
  });
}
