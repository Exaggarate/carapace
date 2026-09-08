import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../../config/types.carapace.js";
import type { CarapaceTestState } from "../../test-utils/carapace-test-state.js";
import { listAgentIds } from "../agent-scope-config.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedAcquireAgentRunPreparedModelRuntime,
  mockedBuildEmbeddedRunPayloads,
  mockedRunEmbeddedAttempt,
  createOverflowRunParams,
  resetSharedRunIntegrationHarnessMocks,
  useOpenAIPlatformAuthFixture,
} from "./run.overflow-compaction.harness.js";

const { runEmbeddedAgent } = await loadRunOverflowCompactionHarness();

function projectSetupExecutionConfig(source: CarapaceConfig): CarapaceConfig {
  return {
    ...source,
    agents: {
      ...source.agents,
      entries: {
        ...(source.agents?.entries ?? { main: {} }),
        carapace: {},
      },
    },
  };
}

let state: CarapaceTestState;

describe("embedded setup inference inherited auth owner", () => {
  // Provider-pinned runs stay on the mocked plugin harness, so no host-route
  // warmup is needed here; see createOverflowRunParams for the route trap.
  beforeEach(async () => {
    resetSharedRunIntegrationHarnessMocks();
    const { createCarapaceTestState } = await import("../../test-utils/carapace-test-state.js");
    state = await createCarapaceTestState({ label: "run.inherited-auth-owner" });
    useOpenAIPlatformAuthFixture();
  });

  afterEach(async () => {
    await state?.cleanup();
  });

  it.each([
    { name: "a pre-roster config", source: {} },
    { name: "a sole-agent config", source: { agents: { entries: { main: {} } } } },
  ] satisfies Array<{ name: string; source: CarapaceConfig }>)(
    "prepares the explicit main agent from $name",
    async ({ name, source }) => {
      const config = projectSetupExecutionConfig(source);
      expect(listAgentIds(config)).toEqual(["main", "carapace"]);

      mockedBuildEmbeddedRunPayloads.mockReturnValue([{ text: "OK" }]);
      mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ assistantTexts: ["OK"] }));

      await runEmbeddedAgent({
        ...createOverflowRunParams(state),
        // Auth-owner resolution is provider-agnostic. Route through the mocked
        // plugin harness so this shard does not compile the bundled Anthropic
        // provider policy from source just to assert an agent directory.
        provider: "openai",
        model: "gpt-5.6-luna",
        agentId: "main",
        config,
        runId: `run-setup-inference-owner-${name}`,
      });

      const preparedInput = mockedAcquireAgentRunPreparedModelRuntime.mock.calls[0]?.[0];
      expect(preparedInput).toMatchObject({ agentId: "main", config });
      expect(String(preparedInput?.inheritedAuthDir)).toSatisfy((value: string) =>
        value.endsWith(path.join("agents", "main", "agent")),
      );
      expect(mockedRunEmbeddedAttempt).toHaveBeenCalledOnce();
      // A silent fall-back to the built-in host harness would still pass the
      // auth-owner assertions; fail loudly on the route instead.
      expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ agentHarnessId: "codex" }),
      );
    },
  );
});
