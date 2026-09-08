import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";

export const CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV = "CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY";

/** Private generated-helper argv selects context, never approval or execution authority. */
export function resolveToolsMcpAgentId(
  argv: readonly string[] = process.argv.slice(2),
): string | undefined {
  const index = argv.indexOf("--carapace-agent-id");
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--") || argv.includes("--carapace-agent-id", index + 1)) {
    throw new Error("--carapace-agent-id requires one Carapace agent owner");
  }
  return normalizeAgentId(value);
}

export function resolveToolsMcpSessionContext(params: {
  agentSessionKey?: string;
  agentId?: string;
}): { sessionKey?: string; agentId?: string } {
  const sessionKey = (params.agentSessionKey ?? resolveToolsMcpAgentSessionKey())?.trim();
  const encodedOwner = sessionKey ? parseAgentSessionKey(sessionKey)?.agentId : undefined;
  const agentId = params.agentId?.trim() ? normalizeAgentId(params.agentId) : encodedOwner;
  if (
    (sessionKey && !agentId) ||
    (encodedOwner && encodedOwner !== agentId) ||
    (!sessionKey && agentId)
  ) {
    throw new Error(
      `${CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV} must be a canonical agent session key or have a matching explicit Carapace owner`,
    );
  }
  return sessionKey ? { sessionKey, agentId } : {};
}

export function resolveToolsMcpAgentSessionKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV]?.trim() || undefined;
}
