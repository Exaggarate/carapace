/**
 * Gateway loopback delegation-capability tests.
 *
 * The loopback surface is the tool universe for CLI backends, so a fallback
 * completion-report turn must lose its delegation launchers here exactly as it
 * does on the embedded attempt path.
 */
import { describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";

const hoisted = vi.hoisted(() => {
  function makeTool(name: string, execute = vi.fn(async () => ({ content: [], details: {} }))) {
    return {
      name,
      description: `${name} tool`,
      parameters: { type: "object", properties: {} },
      execute,
    };
  }
  const cronExecute = vi.fn(async () => ({ content: [], details: {} }));
  return {
    makeTool,
    cronExecute,
    createCarapaceToolsMock: vi.fn(
      (_options?: {
        inheritedToolAllowlist?: string[];
        cronCreatorToolAllowlist?: Array<{ name: string }>;
      }) => [
        makeTool("read"),
        makeTool("sessions_spawn"),
        makeTool("sessions_send"),
        makeTool("cron", cronExecute),
        makeTool("gateway"),
        makeTool("nodes"),
      ],
    ),
  };
});

vi.mock("../agents/carapace-tools.js", () => ({
  createCarapaceTools: (options: Parameters<typeof hoisted.createCarapaceToolsMock>[0]) =>
    hoisted.createCarapaceToolsMock(options),
}));

vi.mock("../agents/agent-tools.js", () => ({
  createCarapaceCodingTools: () => [],
}));

vi.mock("../agents/lazy-exec-tool.js", () => ({
  createLazyExecTool: vi.fn(),
  resolveExecToolConfig: vi.fn(() => ({})),
}));

import { resolveGatewayScopedTools } from "./tool-resolution.js";

function resolveLoopbackTools(delegationCapability?: "full" | "report_only") {
  return resolveGatewayScopedTools({
    cfg: {} as CarapaceConfig,
    sessionKey: "agent:main:direct:test",
    surface: "loopback",
    senderIsOwner: true,
    ...(delegationCapability ? { delegationCapability } : {}),
  });
}

describe("resolveGatewayScopedTools delegationCapability", () => {
  it("keeps the full loopback surface when the capability is unset or full", () => {
    const unset = resolveLoopbackTools().tools.map((tool) => tool.name);
    const full = resolveLoopbackTools("full").tools.map((tool) => tool.name);

    expect(unset).toEqual(["read", "sessions_spawn", "sessions_send", "cron", "gateway", "nodes"]);
    expect(full).toEqual(unset);
  });

  it("removes delegation launchers from a report-only loopback grant", () => {
    const tools = resolveLoopbackTools("report_only").tools.map((tool) => tool.name);

    expect(tools).toEqual(["read", "cron", "gateway", "nodes"]);
    expect(tools).not.toContain("sessions_spawn");
    expect(tools).not.toContain("sessions_send");
  });

  it("captures report-only derived authority from the gated loopback surface", () => {
    hoisted.createCarapaceToolsMock.mockClear();
    resolveGatewayScopedTools({
      cfg: {
        tools: {
          allow: ["read", "sessions_spawn", "sessions_send", "cron", "gateway", "nodes"],
        },
      } as CarapaceConfig,
      sessionKey: "agent:main:direct:test",
      surface: "loopback",
      senderIsOwner: true,
      delegationCapability: "report_only",
    });

    const options = hoisted.createCarapaceToolsMock.mock.calls.at(-1)?.[0];
    expect(options?.inheritedToolAllowlist).toEqual(["read", "automations", "gateway", "nodes"]);
    expect(options?.cronCreatorToolAllowlist).toEqual([
      { name: "read" },
      { name: "automations" },
      { name: "gateway" },
      { name: "nodes" },
    ]);
  });

  it("narrows report-only loopback tools to their status actions", async () => {
    hoisted.cronExecute.mockClear();
    const cron = resolveLoopbackTools("report_only").tools.find((tool) => tool.name === "cron");

    await expect(cron?.execute("cron-status", { action: "status" })).resolves.toEqual({
      content: [],
      details: {},
    });
    await expect(cron?.execute("cron-add", { action: "add" })).rejects.toThrow(
      "New delegation is unavailable",
    );
    expect(hoisted.cronExecute).toHaveBeenCalledTimes(1);
  });
});
