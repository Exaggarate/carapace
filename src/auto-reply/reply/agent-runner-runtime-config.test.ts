// Tests agent runner runtime config assembly from command and session state.
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/runtime-snapshot.js";
import type { CarapaceConfig } from "../../config/types.carapace.js";
import { buildEmbeddedRunBaseParams } from "./agent-runner-run-params.js";
import type { FollowupRun } from "./queue.js";

function makeRun(config: CarapaceConfig): FollowupRun["run"] {
  return {
    sessionId: "session-1",
    agentId: "agent-1",
    config,
    provider: "openai",
    model: "gpt-4.1",
    agentDir: "/tmp/agent",
    sessionKey: "agent:test:session",
    sessionFile: "/tmp/session.json",
    workspaceDir: "/tmp/workspace",
    skillsSnapshot: [],
    ownerNumbers: ["+15550001"],
    enforceFinalTag: false,
    skipProviderRuntimeHints: true,
    thinkingCatalog: [
      {
        provider: "openai",
        id: "gpt-4.1-mini",
        input: ["text"],
        baseUrl: "https://api.openai.com/v1",
      },
    ],
    thinkLevel: "medium",
    verboseLevel: "off",
    reasoningLevel: "none",
    execOverrides: {},
    bashElevated: false,
    timeoutMs: 60_000,
  } as unknown as FollowupRun["run"];
}

afterEach(() => {
  clearRuntimeConfigSnapshot();
});

describe("buildEmbeddedRunBaseParams runtime config", () => {
  it("keeps an already-resolved run config instead of reverting to a stale runtime snapshot", async () => {
    const staleSnapshot: CarapaceConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: {
              source: "env",
              provider: "default",
              id: "OPENAI_API_KEY",
            },
            models: [],
          },
        },
      },
    };
    const resolvedRunConfig: CarapaceConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "resolved-runtime-key",
            models: [],
          },
        },
      },
    };
    setRuntimeConfigSnapshot(staleSnapshot, staleSnapshot);

    const resolved = await buildEmbeddedRunBaseParams({
      run: makeRun(resolvedRunConfig),
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-1",
      authProfile: {},
    });

    expect(resolved.config).toBe(resolvedRunConfig);
  });

  it("carries out-of-band tool bindings into the embedded run", async () => {
    const run = makeRun({});
    run.toolBindings = { browser: { kind: "tab", targetId: "target-1" } };

    const resolved = await buildEmbeddedRunBaseParams({
      run,
      provider: "openai",
      model: "gpt-4.1-mini",
      runId: "run-1",
      authProfile: {},
    });

    expect(resolved.toolBindings).toEqual(run.toolBindings);
  });
});
