/**
 * Shared contract between the carapace-tools MCP stdio entry and the callers
 * that inject it into CLI harness runs. Keep this module free of MCP SDK and
 * tool-runtime imports so CLI-runner prepare paths can build server configs
 * without loading the server.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { SystemAgentToolOptions } from "../agents/tools/system-agent-tool.js";
import { resolveCarapacePackageRootSync } from "../infra/carapace-root.js";
import type { BundleMcpConfig } from "../plugins/bundle-mcp.js";

export const CARAPACE_TOOLS_MCP_TOOLS_ENV = "CARAPACE_TOOLS_MCP_TOOLS";
export const CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV =
  "CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE";
export const CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV =
  "CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED";
export const CARAPACE_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV =
  "CARAPACE_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL";
// Delegation and chat consent are mutually exclusive. Keep both in the existing
// per-turn transport value so native transcript resume identity stays stable.
const APPROVAL_ARMED_OPERATOR_ONLY_VALUE = "operator-only";

const CARAPACE_TOOLS_MCP_TOOL_IDS = ["cron", "carapace"] as const;
export type CarapaceToolsMcpToolId = (typeof CARAPACE_TOOLS_MCP_TOOL_IDS)[number];

function isCarapaceToolsMcpToolId(value: string): value is CarapaceToolsMcpToolId {
  return (CARAPACE_TOOLS_MCP_TOOL_IDS as readonly string[]).includes(value);
}

/** Parse the served tool selection; the default stays cron for acpx bridges. */
export function resolveCarapaceToolsMcpToolSelection(
  env: NodeJS.ProcessEnv = process.env,
): CarapaceToolsMcpToolId[] {
  const raw = env[CARAPACE_TOOLS_MCP_TOOLS_ENV]?.trim();
  if (!raw) {
    return ["cron"];
  }
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const selection = entries.filter(isCarapaceToolsMcpToolId);
  if (selection.length === 0 || selection.length !== entries.length) {
    throw new Error(
      `${CARAPACE_TOOLS_MCP_TOOLS_ENV} must be a comma list of: ${CARAPACE_TOOLS_MCP_TOOL_IDS.join(", ")}`,
    );
  }
  return selection;
}

/** Parse the Carapace surface for served carapace tools; defaults to cli. */
export function resolveCarapaceToolsMcpSystemAgentSurface(
  env: NodeJS.ProcessEnv = process.env,
): SystemAgentToolOptions["surface"] {
  const raw = env[CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]?.trim();
  if (!raw || raw === "cli") {
    return "cli";
  }
  if (raw === "gateway") {
    return "gateway";
  }
  throw new Error(`${CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV} must be "cli" or "gateway"`);
}

/**
 * Reconstruct per-turn approval state for the served carapace tool. The
 * stdio server runs out of process, so the host passes the armed bit and the
 * pending proposal hash through env; the host mirrors transitions back from
 * tool events (see mirrorSystemAgentToolStateFromEvents in agent-turn.ts).
 */
export function resolveCarapaceToolsMcpSystemAgentApproval(env: NodeJS.ProcessEnv = process.env): {
  approvalArmed: boolean;
  proposalRef: { current?: string };
  operatorApprovalOnly?: boolean;
} {
  const pendingProposal = env[CARAPACE_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV]?.trim();
  const armedValue = env[CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]?.trim();
  return {
    approvalArmed: armedValue === "1",
    proposalRef: pendingProposal ? { current: pendingProposal } : {},
    ...(armedValue === APPROVAL_ARMED_OPERATOR_ONLY_VALUE ? { operatorApprovalOnly: true } : {}),
  };
}

function resolveTsxImportSpecifier(): string {
  try {
    return createRequire(import.meta.url).resolve("tsx");
  } catch {
    return "tsx";
  }
}

function resolveCarapaceToolsServeCommand(): { command: string; args: string[] } {
  const packageRoot = resolveCarapacePackageRootSync({
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
  });
  if (!packageRoot) {
    throw new Error("carapace-tools MCP: could not resolve the Carapace package root");
  }
  const distEntry = path.join(packageRoot, "dist", "mcp", "carapace-tools-serve.js");
  if (fs.existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry] };
  }
  const sourceEntry = path.join(packageRoot, "src", "mcp", "carapace-tools-serve.ts");
  if (!fs.existsSync(sourceEntry)) {
    throw new Error(`carapace-tools MCP: no serve entry under ${packageRoot}`);
  }
  // Bun executes TypeScript entries directly; Node source checkouts need tsx.
  if (process.versions.bun) {
    return { command: process.execPath, args: [sourceEntry] };
  }
  return {
    command: process.execPath,
    args: ["--import", resolveTsxImportSpecifier(), sourceEntry],
  };
}

/**
 * Carapace CLI-harness runs get exactly one MCP server: this stdio entry
 * serving the ring-zero carapace tool. The server keeps the "carapace" name
 * so backend tool pre-approvals (e.g. Claude's --allowedTools mcp__carapace__*)
 * apply without per-backend argument surgery.
 */
export function buildSystemAgentToolsMcpServerConfig(
  options: SystemAgentToolOptions,
): BundleMcpConfig {
  const entry = resolveCarapaceToolsServeCommand();
  const pendingProposal = options.proposalRef?.current;
  return {
    mcpServers: {
      carapace: {
        command: entry.command,
        args: options.agentId
          ? [...entry.args, "--carapace-agent-id", options.agentId]
          : entry.args,
        env: {
          [CARAPACE_TOOLS_MCP_TOOLS_ENV]: "carapace" satisfies CarapaceToolsMcpToolId,
          [CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]: options.surface,
          // Per-turn approval state travels with the per-run MCP config; the
          // host mirrors proposal transitions back from tool events.
          ...(options.operatorApprovalOnly === true
            ? {
                [CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]:
                  APPROVAL_ARMED_OPERATOR_ONLY_VALUE,
              }
            : options.approvalArmed === true
              ? { [CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]: "1" }
              : {}),
          ...(pendingProposal
            ? { [CARAPACE_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV]: pendingProposal }
            : {}),
        },
      },
    },
  };
}
