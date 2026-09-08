// Verifies Carapace tool registration, availability, and construction policy.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/config.js";
import { setEmbeddedMode } from "../infra/embedded-mode.js";
import { createPluginBoardWidgetContentKindRegistrar } from "../plugins/board-widget-content-kinds.js";
import { createPluginRecord } from "../plugins/loader-records.js";
import type { WidgetPresenter } from "../plugins/plugin-registration.types.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { withEnv } from "../test-utils/env.js";
import { isToolWrappedWithBeforeToolCallHook } from "./agent-tools.before-tool-call.js";
import { applyToolAvailabilityDescriptions } from "./agent-tools.deferred-followup.js";
import { createCarapaceCodingTools } from "./agent-tools.js";
import { resolveCoreToolFactoryFamily } from "./core-tool-factory-descriptors.js";
import {
  createCronCreatorAuthorityCapability,
  runWithCronCreatorAuthorityCapability,
} from "./cron-creator-authority-context.js";
import { createCarapaceTools } from "./carapace-tools.js";
import {
  collectPresentCarapaceTools,
  shouldIncludeAskUserToolForCarapaceTools,
  shouldIncludeProgressCardToolForCarapaceTools,
  shouldIncludeSecretsToolForCarapaceTools,
} from "./carapace-tools.registration.js";
import { textResult, type AnyAgentTool } from "./tools/common.js";
import { createPdfTool } from "./tools/pdf-tool.js";

vi.mock("./carapace-plugin-tools.js", () => ({
  resolveCarapacePluginToolsForOptions: () => [],
}));

type ProgressCardGatingParams = Parameters<typeof shouldIncludeProgressCardToolForCarapaceTools>[0];
type CreateCarapaceToolsOptions = NonNullable<Parameters<typeof createCarapaceTools>[0]>;

function withDefaultRoster(config: CarapaceConfig | undefined): CarapaceConfig {
  return {
    ...config,
    agents: config?.agents ?? { entries: { main: { default: true } } },
  };
}

function expectProgressCardEnabled(params: ProgressCardGatingParams, expected: boolean): void {
  expect(
    shouldIncludeProgressCardToolForCarapaceTools({
      ...params,
      config: withDefaultRoster(params.config),
    }),
  ).toBe(expected);
}

function toolNames(tools: ReturnType<typeof createCarapaceTools>): string[] {
  return tools.map((tool) => tool.name);
}

function createFastToolNames(options: CreateCarapaceToolsOptions): string[] {
  // Disable unrelated dynamic surfaces so registration assertions stay deterministic.
  return toolNames(
    createTestCarapaceTools({
      disableMessageTool: true,
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
      ...options,
    }),
  );
}

function createTestCarapaceTools(options: CreateCarapaceToolsOptions = {}) {
  return createCarapaceTools({
    ...options,
    config: withDefaultRoster(options.config),
  });
}

function expectToolNamed(
  tools: ReturnType<typeof createCarapaceTools>,
  name: string,
): ReturnType<typeof createCarapaceTools>[number] {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Expected tool ${name} to be registered`);
  }
  return tool;
}

describe("carapace-tools progress_card gating", () => {
  afterEach(() => {
    setEmbeddedMode(false);
  });

  it("keeps concrete Carapace tool names in the factory descriptor catalog", () => {
    const emittedNames = createFastToolNames({
      agentSessionKey: "agent:main:main",
      config: {
        tools: { allow: ["update_plan"] },
        transcripts: { enabled: true },
      } as CarapaceConfig,
      cwd: "/repo",
      enableHeartbeatTool: true,
      taskSuggestionDeliveryMode: "gateway",
    });

    expect(
      emittedNames.filter((name) => resolveCoreToolFactoryFamily(name) !== "carapace"),
    ).toEqual([]);
  });

  it("enables progress_card by default", () => {
    expectProgressCardEnabled({ config: {} as CarapaceConfig }, true);
  });

  it("exposes progress_card from default tool construction for every embedded model", () => {
    const defaultTools = createFastToolNames({
      config: {} as CarapaceConfig,
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });

    expect(defaultTools).toContain("progress_card");
    expect(defaultTools).not.toContain("ask_user");
  });

  it("keeps human-question tools on permitted primary sessions", () => {
    for (const includeTool of [
      shouldIncludeAskUserToolForCarapaceTools,
      shouldIncludeSecretsToolForCarapaceTools,
    ]) {
      expect(includeTool({})).toBe(false);
      expect(includeTool({ agentSessionKey: "agent:main:main" })).toBe(true);
      expect(includeTool({ agentSessionKey: "agent:main:subagent:worker" })).toBe(false);
      expect(includeTool({ agentSessionKey: "agent:main:acp:worker" })).toBe(false);
    }
    expect(
      shouldIncludeSecretsToolForCarapaceTools({
        agentSessionKey: "agent:main:main",
        pluginToolDenylist: ["secrets"],
      }),
    ).toBe(false);
    // ask_user must not depend on the TUI embedded-host flag; normal gateway
    // runs are the primary consumer.
    expect(
      createFastToolNames({
        config: {} as CarapaceConfig,
        runSessionKey: "agent:main:non-embedded",
      }),
    ).toEqual(expect.arrayContaining(["ask_user", "secrets"]));
    setEmbeddedMode(true);

    expect(
      createFastToolNames({
        config: {} as CarapaceConfig,
        agentSessionKey: "agent:main:subagent:worker",
      }),
    ).not.toContain("ask_user");
    expect(
      createFastToolNames({
        config: {} as CarapaceConfig,
        runSessionKey: "agent:main:run",
      }),
    ).toContain("ask_user");
  });

  it("wraps constructed tools with before-tool-call hooks by default", () => {
    const tools = createTestCarapaceTools({
      config: {} as CarapaceConfig,
      disablePluginTools: true,
    });
    const unwrappedTools = createTestCarapaceTools({
      config: {} as CarapaceConfig,
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
    });

    expect(isToolWrappedWithBeforeToolCallHook(expectToolNamed(tools, "sessions_list"))).toBe(true);
    expect(
      isToolWrappedWithBeforeToolCallHook(expectToolNamed(unwrappedTools, "sessions_list")),
    ).toBe(false);
  });

  it("injects reachable Control UI session links into all session lookup tools", () => {
    const tools = createTestCarapaceTools({
      config: {
        gateway: {
          publicOrigin: "http://127.0.0.1:18789",
          controlUi: { basePath: " /control/// " },
        },
      } as CarapaceConfig,
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
    });
    const guidance =
      "When pointing the user at a session, cite its Control UI URL: main session -> `http://127.0.0.1:18789/control/chat/<agentId>`; any other display session key -> `http://127.0.0.1:18789/control/chat/<agentId>/~key/` + key minus `agent:<agentId>:`, with `:` replaced by `/`.";

    for (const name of ["sessions_list", "sessions_history", "sessions_search"]) {
      expect(expectToolNamed(tools, name).description).toContain(guidance);
    }
  });

  it("keeps message tool in embedded message-tool-only completions", () => {
    setEmbeddedMode(true);
    const tools = createTestCarapaceTools({
      config: {} as CarapaceConfig,
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
      sourceReplyDeliveryMode: "message_tool_only",
    });

    expect(toolNames(tools)).toContain("message");
  });

  it("exposes delegation only to regular unsandboxed gateway agents", () => {
    const regular = createFastToolNames({
      config: {} as CarapaceConfig,
      agentSessionKey: "agent:main:main",
    });
    const sandboxed = createFastToolNames({
      config: {} as CarapaceConfig,
      agentSessionKey: "agent:main:main",
      sandboxed: true,
    });
    const system = createFastToolNames({
      config: {} as CarapaceConfig,
      agentSessionKey: "agent:carapace:main",
    });
    setEmbeddedMode(true);
    const embedded = createFastToolNames({
      config: {} as CarapaceConfig,
      agentSessionKey: "agent:main:main",
    });

    expect(regular).toContain("carapace");
    expect(sandboxed).not.toContain("carapace");
    expect(system).not.toContain("carapace");
    expect(embedded).not.toContain("carapace");
  });

  it("registers transcripts for an active local operator with an explicit global opt-out", () => {
    const capability = createCronCreatorAuthorityCapability("run-local", { kind: "local" })!;
    const { defaultTools, disabledTools } = runWithCronCreatorAuthorityCapability(
      capability,
      () => ({
        defaultTools: createFastToolNames({
          config: {} as CarapaceConfig,
          runId: "run-local",
        }),
        disabledTools: createFastToolNames({
          config: { transcripts: { enabled: false } } as CarapaceConfig,
          runId: "run-local",
        }),
      }),
    );

    expect(defaultTools).toContain("transcripts");
    expect(disabledTools).not.toContain("transcripts");
  });

  it("registers task suggestions only for sessions with an actionable gateway sink", () => {
    const withoutSession = createFastToolNames({
      config: {} as CarapaceConfig,
      cwd: "/repo",
      taskSuggestionDeliveryMode: "gateway",
    });
    const withoutSink = createFastToolNames({
      config: {} as CarapaceConfig,
      agentSessionKey: "agent:main:main",
      cwd: "/repo",
    });
    const withSink = createFastToolNames({
      config: {} as CarapaceConfig,
      agentSessionKey: "agent:main:main",
      cwd: "/repo",
      taskSuggestionDeliveryMode: "gateway",
    });

    expect(withoutSession).not.toContain("suggest_task");
    expect(withoutSession).not.toContain("dismiss_task");
    expect(withoutSink).not.toContain("suggest_task");
    expect(withoutSink).not.toContain("dismiss_task");
    expect(withSink).toEqual(expect.arrayContaining(["suggest_task", "dismiss_task"]));
  });

  it("keeps explicitly allowed message tool in embedded completions", () => {
    setEmbeddedMode(true);
    const fromRuntimeAllowlist = createTestCarapaceTools({
      config: {} as CarapaceConfig,
      disablePluginTools: true,
      pluginToolAllowlist: ["message"],
      wrapBeforeToolCallHook: false,
    });
    const fromGlobalAlsoAllow = createTestCarapaceTools({
      config: { tools: { profile: "minimal", alsoAllow: ["message"] } } as CarapaceConfig,
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
    });
    const denied = createTestCarapaceTools({
      config: {} as CarapaceConfig,
      disablePluginTools: true,
      pluginToolAllowlist: ["message"],
      pluginToolDenylist: ["message"],
      wrapBeforeToolCallHook: false,
    });

    expect(toolNames(fromRuntimeAllowlist)).toContain("message");
    expect(toolNames(fromGlobalAlsoAllow)).toContain("message");
    expect(toolNames(denied)).not.toContain("message");
  });

  it("keeps subagent spawn available for trusted embedded gateway-bound runs", () => {
    setEmbeddedMode(true);
    const defaultTools = createFastToolNames({
      config: {} as CarapaceConfig,
    });
    const gatewayBoundTools = createFastToolNames({
      config: {} as CarapaceConfig,
      allowGatewaySubagentBinding: true,
    });

    expect(defaultTools).not.toContain("sessions_spawn");
    expect(defaultTools).not.toContain("sessions_send");
    expect(gatewayBoundTools).toContain("sessions_spawn");
    expect(gatewayBoundTools).not.toContain("sessions_send");
  });

  it("advertises sessions_spawn from agents_list only when spawn is available", () => {
    setEmbeddedMode(true);
    const createTools = (allowGatewaySubagentBinding: boolean) =>
      applyToolAvailabilityDescriptions(
        createTestCarapaceTools({
          allowGatewaySubagentBinding,
          config: {} as CarapaceConfig,
          disableMessageTool: true,
          disablePluginTools: true,
          wrapBeforeToolCallHook: false,
        }),
      );
    const withoutSpawn = createTools(false);
    const withSpawn = createTools(true);

    expect(toolNames(withoutSpawn)).not.toContain("sessions_spawn");
    expect(expectToolNamed(withoutSpawn, "agents_list").description).not.toContain(
      "sessions_spawn",
    );
    expect(toolNames(withSpawn)).toContain("sessions_spawn");
    expect(expectToolNamed(withSpawn, "agents_list").description).toContain("sessions_spawn");
  });

  it("registers progress_card when explicitly enabled", () => {
    const config = { tools: { updatePlan: true } } as CarapaceConfig;

    expectProgressCardEnabled({ config }, true);
  });

  it("maps the shipped update_plan allowlist name to progress_card", () => {
    const tools = createFastToolNames({
      config: {} as CarapaceConfig,
      pluginToolAllowlist: ["update_plan"],
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });

    expect(tools).toContain("progress_card");
  });

  it("includes progress_card when a config allowlist group includes it", () => {
    const includeProgressCard = shouldIncludeProgressCardToolForCarapaceTools({
      config: { tools: { allow: ["group:agents"] } } as CarapaceConfig,
    });

    expect(includeProgressCard).toBe(true);
  });

  it.each([
    {
      name: "a configured profile",
      options: { config: { tools: { profile: "messaging" as const } } },
    },
    {
      name: "the runtime allowlist",
      options: { runtimeToolAllowlist: ["read"] },
    },
  ])("omits progress_card when $name excludes it", ({ options }) => {
    expect(
      createFastToolNames({
        ...options,
        modelProvider: "openai",
        modelId: "gpt-5.6-sol",
      }),
    ).not.toContain("progress_card");
  });

  it("leaves normal deny policy enforcement to the assembled tool set", () => {
    const tools = createFastToolNames({
      config: {} as CarapaceConfig,
      pluginToolAllowlist: ["group:agents"],
      pluginToolDenylist: ["update_plan"],
      modelProvider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });

    expect(tools).not.toContain("progress_card");
  });

  it("lets an explicit updatePlan false override an allowlist that includes the tool", () => {
    expectProgressCardEnabled(
      { config: { tools: { updatePlan: false, allow: ["update_plan"] } } as CarapaceConfig },
      false,
    );
  });
});

function findCarapaceTool(name: string, modelHasVision?: boolean) {
  return createTestCarapaceTools({ modelHasVision }).find((tool) => tool.name === name);
}

describe("model capability registration", () => {
  it("omits computer input for models that cannot see the reference frame", () => {
    expect(findCarapaceTool("computer", false)).toBeUndefined();
  });

  it("keeps computer when vision is supported or not yet resolved", () => {
    expect(findCarapaceTool("computer", true)).toBeDefined();
    expect(findCarapaceTool("computer")).toBeDefined();
  });

  it("keeps computer screenshots on the direct model-visible tool surface", () => {
    expect(findCarapaceTool("computer", true)?.catalogMode).toBe("direct-only");
  });

  it("registers mobile UI independent of model vision", () => {
    expect(findCarapaceTool("mobile_ui", false)).toBeDefined();
    expect(findCarapaceTool("mobile_ui", true)).toBeDefined();
    expect(findCarapaceTool("mobile_ui")).toBeDefined();
  });

  it("keeps mobile UI one-action-at-a-time execution explicit", () => {
    expect(findCarapaceTool("mobile_ui")?.executionMode).toBe("sequential");
  });
});

function stubAgentTool(name: string): AnyAgentTool {
  return {
    label: name,
    name,
    description: `${name} stub`,
    parameters: { type: "object", properties: {} },
    async execute() {
      return textResult("ok", {});
    },
  };
}

describe.each([
  { suite: "image", toolName: "image_generate", article: "an", label: "image-generation tool" },
  { suite: "video", toolName: "video_generate", article: "a", label: "video-generation tool" },
])("carapace tools $suite generation registration", ({ toolName, article, label }) => {
  it(`registers ${toolName} when ${article} ${label} is present`, () => {
    const tool = stubAgentTool(toolName);
    expect(collectPresentCarapaceTools([tool])).toEqual([tool]);
  });

  it(`omits ${toolName} when ${article} ${label} is absent`, () => {
    expect(collectPresentCarapaceTools([null]).map((tool) => tool.name)).not.toContain(toolName);
  });
});

describe("PDF registration", () => {
  it("includes the pdf tool when the pdf factory returns a tool", () => {
    const pdfTool = createPdfTool({
      agentDir: "/tmp/carapace-agent-main",
      config: {
        agents: { defaults: { pdfModel: { primary: "openai/gpt-5.4-mini" } } },
      },
    });

    expect(pdfTool?.name).toBe("pdf");
    expect(collectPresentCarapaceTools([pdfTool]).map((tool) => tool.name)).toEqual(["pdf"]);
  });
});

describe("sessions_yield completion ownership", () => {
  const controllerSessionKey = "agent:main:telegram:default:direct:1234";

  it.each([
    ["the durable run owner", "agent:main:main", "agent:main:main"],
    ["a trimmed durable run owner", "  agent:main:main  ", "agent:main:main"],
    ["the controller when the run owner is blank", "   ", controllerSessionKey],
    ["the controller when the run owner is absent", undefined, controllerSessionKey],
  ] as const)("records yield intent against %s", async (_, runSessionKey, expectedSessionKey) => {
    const registry = await import("./subagents/registry/subagent-registry.js");
    const markRequesterTurnYielded = vi
      .spyOn(registry, "markRequesterTurnYielded")
      .mockReturnValue(1);
    const onYield = vi.fn(async () => undefined);

    try {
      const tool = expectToolNamed(
        createTestCarapaceTools({
          agentSessionKey: controllerSessionKey,
          runSessionKey,
          sessionId: "requester-session",
          runId: "run-requester",
          onYield,
          disableMessageTool: true,
          disablePluginTools: true,
          wrapBeforeToolCallHook: false,
        }),
        "sessions_yield",
      );

      const result = await tool.execute("yield-requester", {});

      expect(result.details).toMatchObject({ status: "yielded" });
      expect(markRequesterTurnYielded).toHaveBeenCalledExactlyOnceWith({
        requesterAgentId: "main",
        requesterSessionKey: expectedSessionKey,
        requesterTurnRunId: "run-requester",
      });
      expect(onYield).toHaveBeenCalledOnce();
      expect(markRequesterTurnYielded.mock.invocationCallOrder[0]).toBeLessThan(
        onYield.mock.invocationCallOrder[0]!,
      );
    } finally {
      markRequesterTurnYielded.mockRestore();
    }
  });

  it("keeps the turn active when it owns no pending child completion", async () => {
    const registry = await import("./subagents/registry/subagent-registry.js");
    const markRequesterTurnYielded = vi
      .spyOn(registry, "markRequesterTurnYielded")
      .mockReturnValue(0);
    const onYield = vi.fn(async () => undefined);

    try {
      const tool = expectToolNamed(
        createTestCarapaceTools({
          agentSessionKey: controllerSessionKey,
          runSessionKey: "agent:main:main",
          sessionId: "requester-session",
          runId: "run-requester",
          onYield,
          disableMessageTool: true,
          disablePluginTools: true,
          wrapBeforeToolCallHook: false,
        }),
        "sessions_yield",
      );

      const result = await tool.execute("yield-requester", {});

      expect(result.details).toMatchObject({
        status: "error",
        error:
          "No pending child completion is owned by this turn. Continue working because independent background operations complete separately.",
      });
      expect(markRequesterTurnYielded).toHaveBeenCalledOnce();
      expect(onYield).not.toHaveBeenCalled();
    } finally {
      markRequesterTurnYielded.mockRestore();
    }
  });

  it("accepts a subagent self-yield without a pending child completion", async () => {
    const registry = await import("./subagents/registry/subagent-registry.js");
    const markRequesterTurnYielded = vi
      .spyOn(registry, "markRequesterTurnYielded")
      .mockReturnValue(0);
    const onYield = vi.fn(async () => undefined);

    try {
      const tool = expectToolNamed(
        createTestCarapaceTools({
          agentSessionKey: "agent:main:subagent:worker",
          sessionId: "subagent-session",
          runId: "run-subagent",
          onYield,
          disableMessageTool: true,
          disablePluginTools: true,
          wrapBeforeToolCallHook: false,
        }),
        "sessions_yield",
      );

      await expect(tool.execute("yield-subagent", {})).resolves.toMatchObject({
        details: { status: "yielded" },
      });
      expect(markRequesterTurnYielded).toHaveBeenCalledExactlyOnceWith({
        requesterAgentId: "main",
        requesterSessionKey: "agent:main:subagent:worker",
        requesterTurnRunId: "run-subagent",
      });
      expect(onYield).toHaveBeenCalledOnce();
    } finally {
      markRequesterTurnYielded.mockRestore();
    }
  });

  it("accepts a runtime completion owner while recording the registry claim", async () => {
    const registry = await import("./subagents/registry/subagent-registry.js");
    const markRequesterTurnYielded = vi
      .spyOn(registry, "markRequesterTurnYielded")
      .mockReturnValue(0);
    const claimYieldCompletion = vi.fn(() => true);
    const onYield = vi.fn(async () => undefined);

    try {
      const tool = expectToolNamed(
        createTestCarapaceTools({
          agentSessionKey: controllerSessionKey,
          sessionId: "requester-session",
          runId: "run-requester",
          claimYieldCompletion,
          onYield,
          disableMessageTool: true,
          disablePluginTools: true,
          wrapBeforeToolCallHook: false,
        }),
        "sessions_yield",
      );

      await expect(tool.execute("yield-requester", {})).resolves.toMatchObject({
        details: { status: "yielded" },
      });
      expect(markRequesterTurnYielded).toHaveBeenCalledOnce();
      expect(claimYieldCompletion).toHaveBeenCalledOnce();
      expect(onYield).toHaveBeenCalledOnce();
      expect(claimYieldCompletion.mock.invocationCallOrder[0]).toBeLessThan(
        markRequesterTurnYielded.mock.invocationCallOrder[0]!,
      );
    } finally {
      markRequesterTurnYielded.mockRestore();
    }
  });

  it("fails before registry side effects when the runtime completion claimant throws", async () => {
    const registry = await import("./subagents/registry/subagent-registry.js");
    const markRequesterTurnYielded = vi
      .spyOn(registry, "markRequesterTurnYielded")
      .mockReturnValue(1);
    const failure = new Error("runtime completion owner failed");
    const claimYieldCompletion = vi.fn(() => {
      throw failure;
    });
    const onYield = vi.fn(async () => undefined);

    try {
      const tool = expectToolNamed(
        createTestCarapaceTools({
          agentSessionKey: controllerSessionKey,
          sessionId: "requester-session",
          runId: "run-requester",
          claimYieldCompletion,
          onYield,
          disableMessageTool: true,
          disablePluginTools: true,
          wrapBeforeToolCallHook: false,
        }),
        "sessions_yield",
      );

      await expect(tool.execute("yield-requester", {})).rejects.toBe(failure);
      expect(markRequesterTurnYielded).not.toHaveBeenCalled();
      expect(claimYieldCompletion).toHaveBeenCalledOnce();
      expect(onYield).not.toHaveBeenCalled();
    } finally {
      markRequesterTurnYielded.mockRestore();
    }
  });
});

function hasTool(tools: readonly { name: string }[], name: string): boolean {
  return tools.some((tool) => tool.name === name);
}

describe("gateway client capability tool filtering", () => {
  it.each([
    { name: "no gateway client caps exist", clientCaps: undefined },
    { name: "a required cap is absent", clientCaps: ["tool-events"] },
  ])("excludes capability-gated tools when $name", ({ clientCaps }) => {
    expect(hasTool(createCarapaceTools({ clientCaps }), "show_widget")).toBe(false);
  });

  it("includes capability-gated tools when the client caps are a superset", () => {
    expect(
      hasTool(
        createCarapaceTools({ clientCaps: ["tool-events", "inline-widgets"] }),
        "show_widget",
      ),
    ).toBe(true);
  });

  it("keeps the core widget tool available to inline-capable Discord clients", () => {
    expect(
      hasTool(
        createCarapaceTools({ agentChannel: "discord", clientCaps: ["inline-widgets"] }),
        "show_widget",
      ),
    ).toBe(true);
  });

  it("exposes one core widget tool for a matching current-channel presenter", async () => {
    const registry = createEmptyPluginRegistry();
    const present = vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: "message" as const,
        receipt: {
          primaryPlatformMessageId: "discord-message-1",
          platformMessageIds: ["discord-message-1"],
          parts: [],
          sentAt: 1,
        },
      },
    }));
    const presenter: WidgetPresenter = {
      target: "current_channel",
      description: "Post in the current Discord channel",
      capabilities: { sourceKinds: ["html"] },
      match: (context) =>
        context.messageChannel === "discord" && context.accountId === "configured",
      availability: async () => ({ ok: true, value: { available: true } }),
      present,
    };
    registry.widgetPresenters.push({
      pluginId: "discord",
      pluginName: "Discord",
      presenter,
      source: "discord-fixture",
    });
    setActivePluginRegistry(registry);

    try {
      const tools = createCarapaceTools({
        agentChannel: "discord",
        agentAccountId: "configured",
        nativeChannelId: "channel-1",
        agentSessionKey: "agent:main:discord",
      });
      const widgetTools = tools.filter((tool) => tool.name === "show_widget");

      expect(widgetTools).toHaveLength(1);
      expect(widgetTools[0]?.requiredClientCaps).toBeUndefined();
      const result = await widgetTools[0]?.execute("discord-widget", {
        title: "Status",
        widget_code: "<p>ready</p>",
      });
      expect(result?.details).toMatchObject({
        kind: "widget",
        presentation: {
          target: "current_channel",
          receipt: { primaryPlatformMessageId: "discord-message-1" },
        },
      });
      expect(present).toHaveBeenCalledOnce();
    } finally {
      resetPluginRuntimeStateForTest();
    }
  });

  it("hides current-channel widgets when no presenter matches the trusted run facts", () => {
    const registry = createEmptyPluginRegistry();
    const presenter: WidgetPresenter = {
      target: "current_channel",
      description: "Post in the current configured Discord channel",
      capabilities: { sourceKinds: ["html"] },
      match: (context) =>
        context.messageChannel === "discord" && context.accountId === "configured",
      availability: async () => ({ ok: true, value: { available: true } }),
      present: async () => {
        throw new Error("present must not run");
      },
    };
    registry.widgetPresenters.push({
      pluginId: "discord",
      presenter,
      source: "discord-fixture",
    });
    setActivePluginRegistry(registry);

    try {
      expect(
        hasTool(
          createCarapaceTools({ agentChannel: "discord", agentAccountId: "unconfigured" }),
          "show_widget",
        ),
      ).toBe(false);
      expect(hasTool(createCarapaceTools({ agentChannel: "slack" }), "show_widget")).toBe(false);
    } finally {
      resetPluginRuntimeStateForTest();
    }
  });

  it("fails closed when current-channel presenter matching is ambiguous", () => {
    const registry = createEmptyPluginRegistry();
    const presenter = (pluginId: string): WidgetPresenter => ({
      target: "current_channel",
      description: `Present through ${pluginId}`,
      capabilities: { sourceKinds: ["html"] },
      match: (context) => context.messageChannel === "discord",
      availability: async () => ({ ok: true, value: { available: true } }),
      present: async () => {
        throw new Error("present must not run");
      },
    });
    registry.widgetPresenters.push(
      { pluginId: "first", presenter: presenter("first"), source: "first-fixture" },
      { pluginId: "second", presenter: presenter("second"), source: "second-fixture" },
    );
    setActivePluginRegistry(registry);

    try {
      expect(hasTool(createCarapaceTools({ agentChannel: "discord" }), "show_widget")).toBe(false);
    } finally {
      resetPluginRuntimeStateForTest();
    }
  });

  it("keeps the core widget tool out when Canvas host config disables it", () => {
    expect(
      hasTool(
        createCarapaceTools({
          clientCaps: ["inline-widgets"],
          config: {
            plugins: { entries: { canvas: { config: { host: { enabled: false } } } } },
          },
        }),
        "show_widget",
      ),
    ).toBe(false);
  });

  it("keeps registered board widgets available without promising inline delivery", () => {
    const registry = createEmptyPluginRegistry();
    const record = createPluginRecord({
      id: "diagram",
      source: "diagram-fixture",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    createPluginBoardWidgetContentKindRegistrar(registry)(record, {
      kind: "diagram",
      label: "Diagram",
      resources: { surface: "diagram", paths: ["/__carapace__/diagram/app.js"] },
      validateSource() {},
      composeDocument: ({ source }) => source,
    });
    setActivePluginRegistry(registry);

    try {
      const tool = expectToolNamed(
        createCarapaceTools({
          agentSessionKey: "agent:main:main",
          clientCaps: ["inline-widgets"],
          config: {
            plugins: { entries: { canvas: { config: { host: { enabled: false } } } } },
          },
        }),
        "show_widget",
      );

      expect(tool.description).toContain(
        "Inline hosting is disabled; set pin=true to place it on this session's dashboard",
      );
    } finally {
      resetPluginRuntimeStateForTest();
    }
  });

  it("keeps the core widget tool out when CARAPACE_SKIP_CANVAS_HOST is set", () => {
    withEnv({ CARAPACE_SKIP_CANVAS_HOST: "1" }, () => {
      expect(hasTool(createCarapaceTools({ clientCaps: ["inline-widgets"] }), "show_widget")).toBe(
        false,
      );
    });
  });

  it("only exposes screen to UI-command clients", () => {
    expect(hasTool(createCarapaceTools(), "screen")).toBe(false);
    expect(hasTool(createCarapaceTools({ clientCaps: ["ui-commands"] }), "screen")).toBe(true);
  });

  it("exposes GitHub publication only from a prepared session capability", () => {
    expect(hasTool(createCarapaceTools(), "github_publish")).toBe(false);
    expect(hasTool(createCarapaceTools(), "github_identity_status")).toBe(false);
    expect(
      hasTool(createCarapaceTools({ githubPublicationAvailable: false }), "github_publish"),
    ).toBe(false);
    expect(
      hasTool(createCarapaceTools({ githubPublicationAvailable: false }), "github_identity_status"),
    ).toBe(true);
    expect(
      hasTool(createCarapaceTools({ githubPublicationAvailable: true }), "github_publish"),
    ).toBe(true);
  });

  it("omits host UI runtime tools for sandboxed agents", () => {
    expect(hasTool(createCarapaceTools({ agentSessionKey: "agent:main:main" }), "terminal")).toBe(
      true,
    );
    expect(hasTool(createCarapaceTools({ agentSessionKey: "agent:main:main" }), "portal")).toBe(
      true,
    );
    expect(
      hasTool(
        createCarapaceTools({ agentSessionKey: "agent:main:main", sandboxed: true }),
        "terminal",
      ),
    ).toBe(false);
    expect(
      hasTool(
        createCarapaceTools({ agentSessionKey: "agent:main:main", sandboxed: true }),
        "portal",
      ),
    ).toBe(false);
  });

  it("does not let tools.allow resurrect a gated tool for a channel run", () => {
    const tools = createCarapaceCodingTools({
      messageProvider: "telegram",
      disableMessageTool: true,
      config: { tools: { allow: ["show_widget"] } },
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeCarapaceTools: true,
        includePluginTools: true,
      },
    });

    expect(hasTool(tools, "show_widget")).toBe(false);
  });

  it("does not add the core widget tool to plugin-only construction plans", () => {
    const plan = {
      includeBaseCodingTools: false,
      includeShellTools: false,
      includeChannelTools: false,
      includeCarapaceTools: false,
      includePluginTools: true,
    };

    expect(
      hasTool(
        createCarapaceCodingTools({ messageProvider: "telegram", toolConstructionPlan: plan }),
        "show_widget",
      ),
    ).toBe(false);
    expect(
      hasTool(
        createCarapaceCodingTools({
          messageProvider: "webchat",
          clientCaps: ["inline-widgets"],
          toolConstructionPlan: plan,
        }),
        "show_widget",
      ),
    ).toBe(false);
    expect(
      hasTool(
        createCarapaceCodingTools({ messageProvider: "webchat", toolConstructionPlan: plan }),
        "progress_card",
      ),
    ).toBe(false);
  });
});
