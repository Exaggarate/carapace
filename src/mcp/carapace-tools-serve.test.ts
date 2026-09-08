// Carapace MCP tools tests cover core tool server startup and registration.
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashSystemAgentOperation } from "../system-agent/operator-approval.js";
import { resolveToolsMcpAgentId } from "./agent-session-env.js";
import {
  buildSystemAgentToolsMcpServerConfig,
  CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV,
  CARAPACE_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV,
  CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV,
  CARAPACE_TOOLS_MCP_TOOLS_ENV,
  resolveCarapaceToolsMcpSystemAgentSurface,
  resolveCarapaceToolsMcpToolSelection,
} from "./carapace-tools-serve-config.js";
import {
  CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV,
  resolveCarapaceToolsForMcp,
  resolveCarapaceToolsMcpAgentSessionKey,
} from "./carapace-tools-serve.js";
import { createPluginToolsMcpHandlers } from "./plugin-tools-handlers.js";

vi.mock("../system-agent/overview.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../system-agent/overview.js")>();
  const config = {
    agents: {
      ownership: "explicit" as const,
      entries: {
        work: { model: "openai/gpt-5.6-luna" },
        other: { model: "example/other" },
      },
    },
    gateway: { port: 1 },
  };
  return {
    ...actual,
    loadSystemAgentOverview: (options?: Parameters<typeof actual.loadSystemAgentOverview>[0]) =>
      actual.loadSystemAgentOverview({
        ...options,
        deps: {
          readConfigFileSnapshot: async () => ({
            path: "/tmp/carapace-mcp-owner.json",
            exists: true,
            valid: true,
            raw: null,
            parsed: config,
            sourceConfig: config,
            resolved: config,
            runtimeConfig: config,
            config,
            issues: [],
            warnings: [],
            legacyIssues: [],
          }),
          probeLocalCommand: async (command) => ({ command, found: false }),
          probeGatewayUrl: async (url) => ({ url, reachable: false }),
        },
      }),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Carapace tools MCP server", () => {
  it("exposes cron", async () => {
    const handlers = createPluginToolsMcpHandlers(
      resolveCarapaceToolsForMcp({ agentSessionKey: "agent:worker:main" }),
    );

    const listed = await handlers.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain("automations");
  });

  it("gates cron trigger surfaces by the host config", () => {
    const jobKeys = (config: unknown) => {
      const [tool] = resolveCarapaceToolsForMcp({
        agentSessionKey: "agent:worker:main",
        config: config as never,
      });
      if (!tool) {
        throw new Error("expected the automations tool to be resolved");
      }
      const parameters = tool.parameters as unknown as {
        properties: { job: { properties: Record<string, unknown> } };
      };
      return Object.keys(parameters.properties.job.properties);
    };

    expect(jobKeys({ cron: { triggers: { enabled: false } } })).not.toContain("trigger");
    // Absent config means enabled; only an explicit false narrows the surface.
    expect(jobKeys({ cron: {} })).toContain("trigger");
    expect(jobKeys({ cron: { triggers: { enabled: true } } })).toContain("trigger");
  });

  it("requires the managed bridge to pass a real agent session key", () => {
    expect(() => resolveCarapaceToolsForMcp({ agentSessionKey: "" })).toThrow(
      CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV,
    );
  });

  it("reads the managed bridge agent session key from env", () => {
    expect(
      resolveCarapaceToolsMcpAgentSessionKey({
        [CARAPACE_TOOLS_MCP_AGENT_SESSION_KEY_ENV]: " agent:worker:main ",
      }),
    ).toBe("agent:worker:main");
  });

  it("serves the ring-zero carapace tool without an agent session key", async () => {
    const handlers = createPluginToolsMcpHandlers(
      resolveCarapaceToolsForMcp({ tools: ["carapace"], systemAgentSurface: "cli" }),
    );

    const listed = await handlers.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["carapace"]);
  });

  it("keeps the generated helper owner through MCP diagnostic actions", async () => {
    const config = buildSystemAgentToolsMcpServerConfig({ surface: "gateway", agentId: "work" });
    const server = config.mcpServers.carapace as { args: string[] };
    const handlers = createPluginToolsMcpHandlers(
      resolveCarapaceToolsForMcp({
        tools: ["carapace"],
        systemAgentSurface: "gateway",
        agentId: resolveToolsMcpAgentId(server.args),
      }),
    );

    const result = await handlers.callTool({ name: "carapace", arguments: { action: "models" } });

    expect(JSON.stringify(result)).toContain("Default model: openai/gpt-5.6-luna");
    expect(result.isError).not.toBe(true);
  });

  it("returns approved CLI MCP mutations to the host instead of applying them", async () => {
    const operation = { kind: "config-set", path: "gateway.port", value: "19001" } as const;
    vi.stubEnv(CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV, "1");
    vi.stubEnv(CARAPACE_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV, hashSystemAgentOperation(operation));
    const handlers = createPluginToolsMcpHandlers(
      resolveCarapaceToolsForMcp({ tools: ["carapace"], systemAgentSurface: "cli" }),
    );

    const result = await handlers.callTool({
      name: "carapace",
      arguments: {
        action: "config_set",
        path: "gateway.port",
        value: "19001",
        approved: true,
      },
    });

    expect(JSON.stringify(result)).toContain("directive:approved-operation:");
  });

  it("parses the served tool selection from env and defaults to cron", () => {
    expect(resolveCarapaceToolsMcpToolSelection({})).toEqual(["cron"]);
    expect(
      resolveCarapaceToolsMcpToolSelection({
        [CARAPACE_TOOLS_MCP_TOOLS_ENV]: " carapace , cron ",
      }),
    ).toEqual(["carapace", "cron"]);
    expect(() =>
      resolveCarapaceToolsMcpToolSelection({ [CARAPACE_TOOLS_MCP_TOOLS_ENV]: "exec" }),
    ).toThrow(CARAPACE_TOOLS_MCP_TOOLS_ENV);
  });

  it("parses the carapace surface from env and defaults to cli", () => {
    expect(resolveCarapaceToolsMcpSystemAgentSurface({})).toBe("cli");
    expect(
      resolveCarapaceToolsMcpSystemAgentSurface({
        [CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]: "gateway",
      }),
    ).toBe("gateway");
    expect(() =>
      resolveCarapaceToolsMcpSystemAgentSurface({
        [CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]: "remote",
      }),
    ).toThrow(CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV);
  });

  it("builds a carapace-only stdio server config under the carapace name", () => {
    const config = buildSystemAgentToolsMcpServerConfig({ surface: "gateway" });

    expect(Object.keys(config.mcpServers)).toEqual(["carapace"]);
    const server = config.mcpServers.carapace as {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    expect(server.command).toBe(process.execPath);
    expect(server.args?.at(-1)).toMatch(/carapace-tools-serve\.(js|ts)$/);
    expect(server.env).toEqual({
      [CARAPACE_TOOLS_MCP_TOOLS_ENV]: "carapace",
      [CARAPACE_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]: "gateway",
    });
  });

  it("serializes operator-approval-only through the native CLI MCP config", () => {
    const config = buildSystemAgentToolsMcpServerConfig({
      surface: "cli",
      operatorApprovalOnly: true,
      proposalRef: { current: "deadbeef" },
    });
    const server = config.mcpServers.carapace as { env?: Record<string, string> };
    expect(server.env?.[CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]).toBe("operator-only");

    // Non-delegated configs must not arm approval (direct sessions keep the
    // interactive "reply yes" approval flow until the host arms a turn).
    const direct = buildSystemAgentToolsMcpServerConfig({ surface: "cli" });
    const directServer = direct.mcpServers.carapace as { env?: Record<string, string> };
    expect(directServer.env).not.toHaveProperty(CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV);

    // A host-armed direct turn uses "1", distinct from the delegated value.
    const armed = buildSystemAgentToolsMcpServerConfig({ surface: "cli", approvalArmed: true });
    const armedServer = armed.mcpServers.carapace as { env?: Record<string, string> };
    expect(armedServer.env?.[CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]).toBe("1");
  });

  it("reconstructs delegated proposal staging from env on the native CLI MCP tool", async () => {
    const operation = {
      kind: "config-set",
      path: "agents.defaults.subagents.thinking",
      value: "high",
    } as const;
    vi.stubEnv(CARAPACE_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV, "operator-only");
    vi.stubEnv(CARAPACE_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV, hashSystemAgentOperation(operation));
    const handlers = createPluginToolsMcpHandlers(
      resolveCarapaceToolsForMcp({ tools: ["carapace"], systemAgentSurface: "cli" }),
    );

    const result = await handlers.callTool({
      name: "carapace",
      arguments: {
        action: "config_set",
        path: "agents.defaults.subagents.thinking",
        value: "high",
        approved: true,
      },
    });

    const text = JSON.stringify(result);
    expect(text).toContain("needs-approval:");
    expect(text).toContain("requesting session's permission policy");
    expect(text).toContain("returns the final outcome");
    expect(text).not.toContain("Carapace operator UI");
    expect(text).not.toContain("ask the user to reply yes");
  });
});
