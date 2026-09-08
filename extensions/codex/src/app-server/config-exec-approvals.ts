import {
  execPolicy,
  type EmbeddedRunAttemptParamsV2,
} from "carapace/plugin-sdk/agent-harness-runtime";
import { resolveAgentConfig } from "carapace/plugin-sdk/agent-scope-runtime";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import {
  resolveExecApprovalsFromFile,
  type ExecApprovalsFile,
} from "carapace/plugin-sdk/exec-approvals-runtime";
import type {
  CarapaceExecApprovalFloorsForCodexAppServer,
  CarapaceExecMode,
  CarapaceExecPolicy,
  CarapaceExecPolicyForCodexAppServer,
} from "./config-contracts.js";
import { readExecAsk, readExecSecurity, readRecord } from "./config-utils.js";

function resolveCarapaceExecPolicyFromConfig(params: {
  config?: CarapaceConfig;
  agentId?: string;
}): CarapaceExecPolicy {
  const globalExec = readRecord(params.config?.tools?.exec);
  const globalPolicy = applyCarapaceExecPolicyLayer(createDefaultCarapaceExecPolicy(), globalExec);
  const agentId = params.agentId?.trim();
  const agentExec = agentId
    ? readRecord(resolveAgentConfig(params.config ?? {}, agentId)?.tools?.exec)
    : undefined;
  return applyCarapaceExecPolicyLayer(globalPolicy, agentExec);
}

export function resolveCarapaceExecPolicyForCodexAppServer(params: {
  permissionMode?: EmbeddedRunAttemptParamsV2["permissionMode"];
  execOverrides?: {
    mode?: unknown;
    security?: unknown;
    ask?: unknown;
  };
  approvals?: ExecApprovalsFile;
  config?: CarapaceConfig;
  agentId?: string;
}): CarapaceExecPolicyForCodexAppServer {
  if (params.permissionMode === "full") {
    return { ...resolveCarapaceExecPolicyForMode("full"), touched: true };
  }
  const basePolicy = resolveCarapaceExecPolicyFromConfig({
    config: params.config,
    agentId: params.agentId,
  });
  const overridePolicy = applyCarapaceExecPolicyLayer(basePolicy, params.execOverrides);
  const approvalFloors = resolveCarapaceExecApprovalFloorsForCodexAppServer({
    approvals: params.approvals,
    agentId: params.agentId,
    policy: overridePolicy,
  });
  return applyCarapaceExecApprovalFloors(overridePolicy, approvalFloors);
}

function createDefaultCarapaceExecPolicy(): CarapaceExecPolicy {
  return {
    ...resolveCarapaceExecPolicyForMode("full"),
    touched: false,
  };
}

function applyCarapaceExecPolicyLayer(
  base: CarapaceExecPolicy,
  exec?: { mode?: unknown; security?: unknown; ask?: unknown },
): CarapaceExecPolicy {
  if (!exec) {
    return base;
  }
  const mode = readExecMode(exec.mode);
  if (mode !== undefined) {
    return {
      ...resolveCarapaceExecPolicyForMode(mode),
      touched: true,
    };
  }
  const security = readExecSecurity(exec.security);
  const ask = readExecAsk(exec.ask);
  if (security === undefined && ask === undefined) {
    return base;
  }
  const nextSecurity = security ?? base.security;
  const nextAsk = ask ?? base.ask;
  return {
    mode: execPolicy.resolveExecModePolicy({ security: nextSecurity, ask: nextAsk }).mode,
    security: nextSecurity,
    ask: nextAsk,
    touched: true,
  };
}

function resolveCarapaceExecApprovalFloorsForCodexAppServer(params: {
  approvals?: ExecApprovalsFile;
  agentId?: string;
  policy: CarapaceExecPolicy;
}): CarapaceExecApprovalFloorsForCodexAppServer | undefined {
  if (!params.approvals) {
    return undefined;
  }
  return resolveExecApprovalsFromFile({
    file: params.approvals,
    agentId: params.agentId,
    overrides: {
      security: params.policy.security,
      ask: params.policy.ask,
    },
  }).agent;
}

function applyCarapaceExecApprovalFloors(
  base: CarapaceExecPolicy,
  approvalFloors?: CarapaceExecApprovalFloorsForCodexAppServer,
): CarapaceExecPolicy {
  if (!approvalFloors) {
    return base;
  }
  const nextSecurity = approvalFloors.security
    ? execPolicy.minSecurity(base.security, approvalFloors.security)
    : base.security;
  const nextAsk = approvalFloors.ask ? execPolicy.maxAsk(base.ask, approvalFloors.ask) : base.ask;
  if (nextSecurity === base.security && nextAsk === base.ask) {
    return base;
  }
  return {
    mode: execPolicy.resolveExecModePolicy({ security: nextSecurity, ask: nextAsk }).mode,
    security: nextSecurity,
    ask: nextAsk,
    touched: true,
  };
}

function resolveCarapaceExecPolicyForMode(
  mode: CarapaceExecMode,
): Omit<CarapaceExecPolicy, "touched"> {
  const { security, ask } = execPolicy.resolveExecModePolicy({
    mode,
    security: "full",
    ask: "off",
  });
  return { mode, security, ask };
}

function readExecMode(value: unknown): CarapaceExecMode | undefined {
  return value === "deny" ||
    value === "allowlist" ||
    value === "ask" ||
    value === "auto" ||
    value === "full"
    ? value
    : undefined;
}
