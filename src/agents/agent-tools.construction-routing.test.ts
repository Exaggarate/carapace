/**
 * Tests trigger and session routing during tool assembly.
 * Ensures cron runs scope cron tool behavior to self-removal of the current
 * job only.
 */
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  claimAgentRunDelegatedAuthority,
  releaseAgentRunDelegatedAuthority,
} from "../infra/agent-run-registry.js";
import { createTestAdmittedRunContext } from "./admitted-run-context.test-support.js";
import {
  createCronCreatorAuthorityCapability,
  runWithCronCreatorAuthorityCapability,
} from "./cron-creator-authority-context.js";
import type { AnyAgentTool } from "./tools/common.js";

const mocks = vi.hoisted(() => {
  const onToolExecute = vi.fn(async () => ({ content: [], details: {} }));
  const stubTool = (name: string) =>
    ({
      name,
      label: name,
      displaySummary: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: onToolExecute,
    }) satisfies AnyAgentTool;

  return {
    createCarapaceToolsOptions: vi.fn(),
    stubTool,
    onToolExecute,
  };
});

vi.mock("./carapace-tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./carapace-tools.js")>();
  return {
    createCarapaceTools: (options: unknown) => {
      mocks.createCarapaceToolsOptions(options);
      return [AUTOMATIONS_TOOL_NAME, "gateway"].map(mocks.stubTool);
    },
    filterToolsByClientCaps: actual.filterToolsByClientCaps,
  };
});

import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import { createCarapaceCodingTools } from "./agent-tools.js";
import { createAgentToolsSandboxContext } from "./test-helpers/agent-tools-sandbox-context.js";
import { AUTOMATIONS_TOOL_NAME } from "./tools/automations-tool-name.js";
import {
  getGatewayToolCallerIdentity,
  withGatewayToolCallerIdentity,
} from "./tools/gateway-caller-context.js";

function firstCarapaceToolsOptions(): { cronSelfRemoveOnlyJobId?: string } | undefined {
  return mocks.createCarapaceToolsOptions.mock.calls[0]?.[0] as
    | { cronSelfRemoveOnlyJobId?: string }
    | undefined;
}

describe("createCarapaceCodingTools cron scope", () => {
  beforeEach(() => {
    mocks.createCarapaceToolsOptions.mockClear();
  });

  it("scopes cron-triggered jobs to self-removal", () => {
    const tools = createCarapaceCodingTools({
      trigger: "cron",
      jobId: "job-current",
    });

    expect(tools.map((tool) => tool.name)).toContain(AUTOMATIONS_TOOL_NAME);
    expect(firstCarapaceToolsOptions()?.cronSelfRemoveOnlyJobId).toBe("job-current");
  });

  it("does not scope non-cron sessions", () => {
    createCarapaceCodingTools({
      trigger: "user",
      jobId: "job-current",
    });

    expect(firstCarapaceToolsOptions()?.cronSelfRemoveOnlyJobId).toBeUndefined();
  });

  it.each([false, true])(
    "admits only the automation tool for remote management authority=%s",
    async (controlUiAdmin) => {
      const runId = "remote-management-tools";
      const { operationalRunInstance } = createTestAdmittedRunContext(runId);
      const authority = claimAgentRunDelegatedAuthority(operationalRunInstance);
      onTestFinished(() => {
        releaseAgentRunDelegatedAuthority(authority);
      });
      const capability = createCronCreatorAuthorityCapability(
        runId,
        { kind: "unknown" },
        controlUiAdmin ? true : undefined,
      )!;
      const tools = await runWithCronCreatorAuthorityCapability(capability, () =>
        withGatewayToolCallerIdentity(
          {
            agentId: "main",
            sessionKey: "agent:main:control-ui",
            operationalRunInstance,
            approvalAuthority: authority,
          },
          () =>
            createCarapaceCodingTools({
              runId,
              senderIsOwner: false,
              wrapBeforeToolCallHook: false,
              toolConstructionPlan: {
                includeBaseCodingTools: false,
                includeShellTools: false,
                includeChannelTools: false,
                includeCarapaceTools: true,
                includePluginTools: false,
              },
            }),
        ),
      );
      const names = tools.map((tool) => tool.name);
      expect(names.includes(AUTOMATIONS_TOOL_NAME)).toBe(controlUiAdmin);
      expect(names).not.toContain("gateway");
    },
  );
});

const createLazyExecToolMock = vi.hoisted(() => vi.fn());

vi.mock("./lazy-exec-tool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lazy-exec-tool.js")>();
  return {
    ...actual,
    createLazyExecTool: (defaults: unknown) => {
      createLazyExecToolMock(defaults);
      return {
        name: "exec",
        description: "exec stub",
        parameters: { type: "object", properties: {} },
        execute: vi.fn(),
      };
    },
  };
});

describe("createCarapaceCodingTools exec notification routing", () => {
  it("binds native tool approval requests to the constructed permission generation", async () => {
    const generation = new AbortController();
    let approvalScope: AbortSignal | undefined;
    mocks.onToolExecute.mockImplementationOnce(async () => {
      approvalScope = AbortSignal.any([...(getGatewayToolCallerIdentity()?.approvalSignals ?? [])]);
      return { content: [], details: {} };
    });
    const tools = createCarapaceCodingTools({
      agentId: "main",
      sessionKey: "agent:main:scope",
      abortSignal: generation.signal,
      wrapBeforeToolCallHook: false,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeCarapaceTools: true,
        includePluginTools: false,
      },
    });
    const tool = tools.find((candidate) => candidate.name === AUTOMATIONS_TOOL_NAME);
    if (!tool) {
      throw new Error("Expected automation tool");
    }
    await tool.execute("call", {});
    generation.abort();
    expect(approvalScope?.aborted).toBe(true);
  });

  it.each([undefined, "agent:main:runtime-policy"])(
    "keeps live process ownership when the policy session is %s",
    (policySessionKey) => {
      const liveSessionKey = "agent:main:channel:group:example:thread:25";

      createCarapaceCodingTools({
        sessionKey: policySessionKey ?? liveSessionKey,
        runSessionKey: liveSessionKey,
        toolConstructionPlan: {
          includeBaseCodingTools: false,
          includeShellTools: true,
          includeChannelTools: false,
          includeCarapaceTools: false,
          includePluginTools: false,
        },
      });

      expect(createLazyExecToolMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scopeKey: liveSessionKey,
          sessionKey: policySessionKey ?? liveSessionKey,
          notifySessionKey: liveSessionKey,
        }),
      );
    },
  );

  it("preserves an explicit process scope override", () => {
    createCarapaceCodingTools({
      sessionKey: "agent:main:policy",
      runSessionKey: "agent:worker:live",
      exec: { scopeKey: "explicit-process-owner" },
    });

    expect(createLazyExecToolMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopeKey: "explicit-process-owner" }),
    );
  });
});

describe("createCarapaceCodingTools sandbox filesystem ownership", () => {
  const sandbox = createAgentToolsSandboxContext({ workspaceDir: "/managed/workspace" });

  it("keeps host-owned tools available when no sandbox filesystem family is requested", () => {
    mocks.createCarapaceToolsOptions.mockClear();

    const tools = createCarapaceCodingTools({
      sandbox,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeCarapaceTools: true,
        includePluginTools: true,
      },
    });

    expect(tools.map((tool) => tool.name)).toContain(AUTOMATIONS_TOOL_NAME);
    expect(mocks.createCarapaceToolsOptions).toHaveBeenCalledOnce();
  });

  it.each([
    { includeBaseCodingTools: true, includeShellTools: false },
    { includeBaseCodingTools: false, includeShellTools: true },
  ])("rejects sandbox filesystem families without their bridge: %o", (families) => {
    expect(() =>
      createCarapaceCodingTools({
        sandbox,
        toolConstructionPlan: {
          ...families,
          includeChannelTools: false,
          includeCarapaceTools: false,
          includePluginTools: false,
        },
      }),
    ).toThrow("Sandbox filesystem bridge is unavailable.");
  });
});
