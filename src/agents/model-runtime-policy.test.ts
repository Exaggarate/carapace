// Covers model runtime policy precedence and private QA runtime overrides.
import { afterEach, describe, expect, it } from "vitest";
import { migratePersistedImplicitMainRoster } from "../config/legacy.roster.js";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { resolveModelRuntimePolicy as resolveModelRuntimePolicyBase } from "./model-runtime-policy.js";

const ORIGINAL_BUILD_PRIVATE_QA = process.env.CARAPACE_BUILD_PRIVATE_QA;
const ORIGINAL_QA_FORCE_RUNTIME = process.env.CARAPACE_QA_FORCE_RUNTIME;

function resolveModelRuntimePolicy(
  params: Parameters<typeof resolveModelRuntimePolicyBase>[0],
): ReturnType<typeof resolveModelRuntimePolicyBase> {
  return resolveModelRuntimePolicyBase({
    ...params,
    config: migratePersistedImplicitMainRoster(params.config).config as CarapaceConfig,
  });
}

const createModelConfig = (
  agentRuntimeId: string,
  modelId = "qwen-local",
): ModelDefinitionConfig => ({
  id: modelId,
  name: "Qwen Local",
  reasoning: false,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 32_768,
  maxTokens: 4096,
  agentRuntime: { id: agentRuntimeId },
});

function restoreEnv(
  name: "CARAPACE_BUILD_PRIVATE_QA" | "CARAPACE_QA_FORCE_RUNTIME",
  value: string | undefined,
): void {
  // Tests mutate private QA env gates; restore exact process state after each.
  if (value == null) {
    deleteTestEnvValue(name);
    return;
  }
  setTestEnvValue(name, value);
}

function makeProviderRuntimeConfig(runtime: string): CarapaceConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.example/v1",
          agentRuntime: { id: runtime },
          models: [],
        },
      },
    },
  } as CarapaceConfig;
}

afterEach(() => {
  restoreEnv("CARAPACE_BUILD_PRIVATE_QA", ORIGINAL_BUILD_PRIVATE_QA);
  restoreEnv("CARAPACE_QA_FORCE_RUNTIME", ORIGINAL_QA_FORCE_RUNTIME);
});

describe("resolveModelRuntimePolicy", () => {
  it("ignores the QA force-runtime override when the private QA gate is unset", () => {
    deleteTestEnvValue("CARAPACE_BUILD_PRIVATE_QA");
    setTestEnvValue("CARAPACE_QA_FORCE_RUNTIME", "carapace");

    expect(
      resolveModelRuntimePolicy({
        config: makeProviderRuntimeConfig("codex"),
        provider: "openai",
        modelId: "gpt-5.5",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "provider",
    });
  });

  it("respects the QA force-runtime override when the private QA gate is set", () => {
    // The force-runtime override is intentionally gated to private QA builds so
    // normal users cannot accidentally change model runtime selection via env.
    setTestEnvValue("CARAPACE_BUILD_PRIVATE_QA", "1");
    setTestEnvValue("CARAPACE_QA_FORCE_RUNTIME", "carapace");

    expect(
      resolveModelRuntimePolicy({
        config: makeProviderRuntimeConfig("codex"),
        provider: "openai",
        modelId: "gpt-5.5",
      }),
    ).toEqual({
      policy: { id: "carapace" },
      source: "model",
      forcedByEnvironment: true,
    });
  });

  it("ignores invalid QA force-runtime values even when the private QA gate is set", () => {
    setTestEnvValue("CARAPACE_BUILD_PRIVATE_QA", "1");
    setTestEnvValue("CARAPACE_QA_FORCE_RUNTIME", "bogus");

    expect(
      resolveModelRuntimePolicy({
        config: makeProviderRuntimeConfig("codex"),
        provider: "openai",
        modelId: "gpt-5.5",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "provider",
    });
  });

  it("honors provider wildcard agent model runtime policy entries", () => {
    const config = {
      agents: {
        ownership: "explicit",
        entries: { ops: {}, research: {} },
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "carapace" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "carapace" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("honors provider wildcard agent model runtime policy entries without a concrete model id", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "carapace" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
      }),
    ).toEqual({
      policy: { id: "carapace" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("prefers exact agent model runtime policy entries over provider wildcards", () => {
    // Exact configured model refs beat provider wildcards to keep intentional
    // per-model runtime routing stable.
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "carapace" } },
            "vllm/qwen-local": { agentRuntime: { id: "codex" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("prefers exact provider model runtime policy over agent provider wildcards", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "carapace" } },
          },
        },
      },
      models: {
        providers: {
          vllm: {
            baseUrl: "http://127.0.0.1:11434/v1",
            models: [createModelConfig("codex")],
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "codex" },
      source: "model",
    });
  });

  it.each([
    {
      name: "provider-owned model id",
      modelId: "anthropic/claude-opus-4.6",
    },
    {
      name: "provider-qualified model id",
      modelId: "openrouter/anthropic/claude-opus-4.6",
    },
  ])("honors the OpenRouter agent model policy for a $name", ({ modelId }) => {
    const config = {
      agents: {
        defaults: {
          models: {
            "openrouter/anthropic/claude-opus-4.6": {
              agentRuntime: { id: "carapace" },
            },
            "anthropic/claude-opus-4.6": {
              agentRuntime: { id: "claude-cli" },
            },
          },
        },
      },
      models: {
        providers: {
          openrouter: {
            baseUrl: "https://openrouter.ai/api/v1",
            agentRuntime: { id: "codex" },
            models: [],
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "openrouter",
        modelId,
      }),
    ).toEqual({
      policy: { id: "carapace" },
      source: "model",
      matchedProvider: "openrouter",
    });
  });

  it.each([
    {
      name: "provider-owned model id",
      provider: "openrouter",
      modelId: "anthropic/claude-opus-4.6",
      matchedProvider: undefined,
    },
    {
      name: "provider-qualified model id",
      provider: "openrouter",
      modelId: "openrouter/anthropic/claude-opus-4.6",
      matchedProvider: undefined,
    },
    {
      name: "inferred provider and provider-owned model id",
      provider: "",
      modelId: "openrouter/anthropic/claude-opus-4.6",
      matchedProvider: "openrouter",
    },
  ])(
    "honors the OpenRouter provider model policy for a $name",
    ({ provider, modelId, matchedProvider }) => {
      const config = {
        models: {
          providers: {
            openrouter: {
              baseUrl: "https://openrouter.ai/api/v1",
              agentRuntime: { id: "codex" },
              models: [createModelConfig("carapace", "anthropic/claude-opus-4.6")],
            },
          },
        },
      } as CarapaceConfig;

      expect(resolveModelRuntimePolicy({ config, provider, modelId })).toEqual({
        policy: { id: "carapace" },
        source: "model",
        ...(matchedProvider ? { matchedProvider } : {}),
      });
    },
  );

  it("uses provider-qualified model ids to resolve provider model runtime policies", () => {
    const config = {
      models: {
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.example/v1",
            models: [createModelConfig("claude-cli", "claude-opus-4-7")],
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "anthropic/claude-opus-4-7",
      }),
    ).toEqual({
      policy: { id: "claude-cli" },
      source: "model",
      matchedProvider: "anthropic",
    });
  });

  it("uses provider-qualified model ids to resolve provider runtime policies", () => {
    const config = {
      models: {
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.example/v1",
            agentRuntime: { id: "claude-cli" },
            models: [],
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "anthropic/claude-opus-4-7",
      }),
    ).toEqual({
      policy: { id: "claude-cli" },
      source: "provider",
      matchedProvider: "anthropic",
    });
  });

  it("prefers provider-qualified agent entries over bare entries for inferred providers", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "claude-opus-4-7": { agentRuntime: { id: "carapace" } },
            "anthropic/claude-opus-4-7": { agentRuntime: { id: "claude-cli" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "anthropic/claude-opus-4-7",
      }),
    ).toEqual({
      policy: { id: "claude-cli" },
      source: "model",
      matchedProvider: "anthropic",
    });
  });

  it("prefers agent provider wildcard runtime policy over provider runtime policy", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "vllm/*": { agentRuntime: { id: "carapace" } },
          },
        },
      },
      models: {
        providers: {
          vllm: {
            baseUrl: "http://127.0.0.1:11434/v1",
            agentRuntime: { id: "codex" },
            models: [],
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
      }),
    ).toEqual({
      policy: { id: "carapace" },
      source: "model",
      matchedProvider: "vllm",
    });
  });

  it("matches a provider-prefixed agent model entry when the caller provider is empty", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus-4-7[1m]": { agentRuntime: { id: "claude-cli" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "claude-opus-4-7[1m]",
      }),
    ).toEqual({
      policy: { id: "claude-cli" },
      source: "model",
      matchedProvider: "anthropic",
    });
  });

  it("still rejects provider-prefixed entries whose provider disagrees with a non-empty caller provider", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "openrouter/claude-opus-4-7[1m]": { agentRuntime: { id: "openrouter-stream" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "anthropic",
        modelId: "claude-opus-4-7[1m]",
      }),
    ).toEqual({});
  });

  it("matches a provider wildcard agent model entry when the caller provider is empty", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "anthropic/*": { agentRuntime: { id: "claude-cli" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "claude-opus-4-7[1m]",
      }),
    ).toEqual({
      policy: { id: "claude-cli" },
      source: "model",
      matchedProvider: "anthropic",
    });
  });

  it("prefers an agent-specific model entry over a conflicting defaults entry when the caller provider is empty", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "openai/foo-1": { agentRuntime: { id: "codex" } },
          },
        },
        list: [
          {
            id: "main",
            models: {
              "anthropic/foo-1": { agentRuntime: { id: "claude-cli" } },
            },
          },
        ],
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "foo-1",
        agentId: "main",
      }),
    ).toEqual({
      policy: { id: "claude-cli" },
      source: "model",
      matchedProvider: "anthropic",
    });
  });

  it("uses the persisted owner model runtime policy for a bare session key", () => {
    const config = {
      session: { store: "/stores/shared.sqlite" },
      agents: {
        ownership: "explicit",
        defaults: {
          sessionStore: { agentId: "research" },
          models: {
            "vllm/qwen-local": { agentRuntime: { id: "codex" } },
          },
        },
        list: [
          { id: "ops" },
          {
            id: "research",
            models: {
              "vllm/qwen-local": { agentRuntime: { id: "carapace" } },
            },
          },
        ],
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
        sessionKey: "global",
      }),
    ).toEqual({
      policy: { id: "carapace" },
      source: "model",
      matchedProvider: "vllm",
    });
    expect(() =>
      resolveModelRuntimePolicy({
        config,
        provider: "vllm",
        modelId: "qwen-local",
        agentId: "ops",
        sessionKey: "global",
      }),
    ).toThrow(/belongs to "research"/);
  });

  it.each(["openai/gpt-5.5", "openai/*"])(
    "uses a prepared stored-row owner for %s without re-admitting global",
    (modelKey) => {
      const config: CarapaceConfig = {
        session: { store: "/synthetic/shared.sqlite" },
        agents: {
          ownership: "explicit",
          defaults: { sessionStore: { agentId: "ops" } },
          entries: {
            main: { models: { [modelKey]: { agentRuntime: { id: "carapace" } } } },
            ops: { models: { [modelKey]: { agentRuntime: { id: "codex" } } } },
          },
        },
      };
      expect(
        resolveModelRuntimePolicy({
          config,
          provider: "openai",
          modelId: "gpt-5.5",
          sessionKey: "global",
          agentScope: { kind: "prepared", agentId: "main" },
        }),
      ).toEqual({ policy: { id: "carapace" }, source: "model", matchedProvider: "openai" });
    },
  );

  it("fails closed for duplicate provider-prefixed bare-model policies", () => {
    const config = {
      agents: {
        defaults: {
          models: {
            "openai/foo-1": { agentRuntime: { id: "codex" } },
            "anthropic/foo-1": { agentRuntime: { id: "claude-cli" } },
            "anthropic/*": { agentRuntime: { id: "claude-cli" } },
          },
        },
      },
    } as CarapaceConfig;

    expect(
      resolveModelRuntimePolicy({
        config,
        provider: "",
        modelId: "foo-1",
      }),
    ).toEqual({});
  });
});
