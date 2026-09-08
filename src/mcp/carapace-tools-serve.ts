/**
 * Standalone MCP server for selected built-in Carapace tools.
 *
 * Run via: node --import tsx src/mcp/carapace-tools-serve.ts
 * Or: bun src/mcp/carapace-tools-serve.ts
 */
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AUTOMATIONS_TOOL_NAME } from "../agents/tools/automations-tool-name.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { createCronTool } from "../agents/tools/cron-tool.js";
import { createSystemAgentTool } from "../agents/tools/system-agent-tool.js";
import type { SystemAgentToolOptions } from "../agents/tools/system-agent-tool.js";
import { getRuntimeConfig } from "../config/config.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV,
  resolveToolsMcpAgentSessionKey,
  resolveToolsMcpAgentId,
  resolveToolsMcpSessionContext,
} from "./agent-session-env.js";
import {
  resolveCarapaceToolsMcpSystemAgentApproval,
  resolveCarapaceToolsMcpSystemAgentSurface,
  resolveCarapaceToolsMcpToolSelection,
  type CarapaceToolsMcpToolId,
} from "./carapace-tools-serve-config.js";
import { connectToolsMcpServerToStdio, createToolsMcpServer } from "./tools-stdio-server.js";

export {
  CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV,
  CARAPACE_TOOLS_MCP_TOOLS_ENV,
} from "./carapace-tools-serve-config.js";

export { CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV } from "./agent-session-env.js";

export function resolveCarapaceToolsMcpAgentSessionKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveToolsMcpAgentSessionKey(env);
}

export function resolveCarapaceToolsForMcp(
  params: {
    agentSessionKey?: string;
    agentId?: string;
    tools?: CarapaceToolsMcpToolId[];
    systemAgentSurface?: SystemAgentToolOptions["surface"];
    config?: CarapaceConfig;
  } = {},
): AnyAgentTool[] {
  const selection = params.tools ?? resolveCarapaceToolsMcpToolSelection();
  return selection.map((tool) => {
    if (tool === "carapace") {
      return createSystemAgentTool({
        agentId: params.agentId,
        surface: params.systemAgentSurface ?? resolveCarapaceToolsMcpSystemAgentSurface(),
        ...resolveCarapaceToolsMcpSystemAgentApproval(),
      });
    }
    const agentSessionKey = (
      params.agentSessionKey ?? resolveCarapaceToolsMcpAgentSessionKey()
    )?.trim();
    if (!agentSessionKey) {
      throw new Error(`${CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV} is required`);
    }
    const context = resolveToolsMcpSessionContext({ agentSessionKey, agentId: params.agentId });
    return createCronTool({
      agentSessionKey,
      agentId: context.agentId,
      // Same host-config resolution as plugin-tools-serve: the advertised cron
      // surface must reflect this deployment's cron.triggers.enabled gate.
      config: params.config ?? getRuntimeConfig(),
      creatorToolAllowlist: [{ name: AUTOMATIONS_TOOL_NAME }],
    });
  });
}

function createCarapaceToolsMcpServer(
  params: {
    tools?: AnyAgentTool[];
  } = {},
): Server {
  const tools = params.tools ?? resolveCarapaceToolsForMcp();
  return createToolsMcpServer({ name: "carapace-tools", tools });
}

async function serveCarapaceToolsMcp(): Promise<void> {
  const server = createCarapaceToolsMcpServer({
    tools: resolveCarapaceToolsForMcp({ agentId: resolveToolsMcpAgentId() }),
  });
  await connectToolsMcpServerToStdio(server);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  serveCarapaceToolsMcp().catch((err: unknown) => {
    process.stderr.write(`carapace-tools-serve: ${formatErrorMessage(err)}\n`);
    process.exit(1);
  });
}
