import { afterEach, expect, it, vi } from "vitest";
import { getGatewayToolCallerIdentity } from "../agents/tools/gateway-caller-context.js";
import { resolveToolsMcpAgentId, resolveToolsMcpSessionContext } from "./agent-session-env.js";
import { resolveCarapaceToolsForMcp } from "./carapace-tools-serve.js";
const { callGatewayTool } = vi.hoisted(() => ({ callGatewayTool: vi.fn() }));
vi.mock("../config/config.js", async (original) => ({
  ...(await original<typeof import("../config/config.js")>()),
  getRuntimeConfig: () => ({ agents: { ownership: "explicit", entries: { main: {}, work: {} } } }),
}));
vi.mock("../agents/tools/gateway.js", async (original) => ({
  ...(await original<typeof import("../agents/tools/gateway.js")>()),
  callGatewayTool,
}));
afterEach(() => {
  vi.clearAllMocks();
});

it("carries the private argv owner and exact logical key into the real automations tool", async () => {
  const agentId = resolveToolsMcpAgentId(["--carapace-agent-id", "work"]);
  expect(resolveToolsMcpSessionContext({ agentId, agentSessionKey: "global" })).toEqual({
    agentId: "work",
    sessionKey: "global",
  });
  const [tool] = resolveCarapaceToolsForMcp({ agentId, agentSessionKey: "global" });
  callGatewayTool.mockImplementationOnce(async () => {
    expect(getGatewayToolCallerIdentity()).toMatchObject({
      agentId: "work",
      sessionKey: "global",
    });
    return { enabled: true };
  });
  await tool!.execute("owner-proof", { action: "status" });
  expect(callGatewayTool).toHaveBeenCalledOnce();
  expect(() =>
    resolveCarapaceToolsForMcp({ agentId: "main", agentSessionKey: "agent:work:main" }),
  ).toThrow("matching explicit");
});

it("rejects missing or duplicate private argv owners", () => {
  expect(() => resolveToolsMcpAgentId(["--carapace-agent-id"])).toThrow("requires one");
  expect(() =>
    resolveToolsMcpAgentId(["--carapace-agent-id", "work", "--carapace-agent-id", "main"]),
  ).toThrow("requires one");
});
