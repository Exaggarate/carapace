// Verifies generated models.json preserves source secret markers from runtime snapshots.
import { expectDefined } from "@carapace/normalization-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { createFixtureSuite } from "../test-utils/fixture-suite.js";
import { NON_ENV_SECRETREF_MARKER } from "./model-auth-markers.js";
import {
  installModelsConfigTestHooks,
  MODELS_CONFIG_IMPLICIT_ENV_VARS,
  unsetEnv,
  withTempEnv,
} from "./models-config.e2e-harness.js";
import { enforceSourceManagedProviderSecrets } from "./models-config.providers.source-managed.js";

vi.mock("../plugins/manifest-registry.js", () => ({
  loadPluginManifestRegistryCore: () => ({ plugins: [] }),
}));

vi.mock("./model-auth-env-vars.js", () => ({
  listKnownProviderEnvApiKeyNames: () => ["OPENAI_API_KEY"],
  resolveProviderEnvAuthLookupMaps: () => ({
    aliasMap: {},
    envCandidateMap: { openai: ["OPENAI_API_KEY"] },
    authEvidenceMap: {},
  }),
}));

vi.mock("../plugins/provider-runtime.js", () => ({
  normalizeProviderConfigWithPlugin: () => undefined,
  resolveProviderConfigApiKeyWithPlugin: () => undefined,
  resolveProviderSyntheticAuthWithPlugin: () => undefined,
}));

vi.mock("./models-config.providers.js", async () => {
  const actual = await vi.importActual<typeof import("./models-config.providers.js")>(
    "./models-config.providers.js",
  );
  return {
    ...actual,
    resolveImplicitProviders: async () => ({}),
  };
});

installModelsConfigTestHooks();

let clearConfigCache: typeof import("../config/io.js").clearConfigCache;
let clearRuntimeConfigSnapshot: typeof import("../config/io.js").clearRuntimeConfigSnapshot;
let setRuntimeConfigSnapshot: typeof import("../config/io.js").setRuntimeConfigSnapshot;
let ensureCarapaceModelsJson: typeof import("./models-config.js").ensureCarapaceModelsJson;
let resetModelsJsonReadyCacheForTest: typeof import("./models-config-state.test-support.js").resetModelsJsonReadyCacheForTest;
let planCarapaceModelsJsonWithDeps: typeof import("./models-config.plan.test-support.js").planCarapaceModelsJsonWithDeps;
let readGeneratedModelsJson: typeof import("./models-config.test-utils.js").readGeneratedModelsJson;
const fixtureSuite = createFixtureSuite("carapace-models-runtime-source-");

beforeAll(async () => {
  await fixtureSuite.setup();
  ({ clearConfigCache, clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } =
    await import("../config/io.js"));
  ({ ensureCarapaceModelsJson } = await import("./models-config.js"));
  ({ resetModelsJsonReadyCacheForTest } = await import("./models-config-state.test-support.js"));
  ({ planCarapaceModelsJsonWithDeps } = await import("./models-config.plan.test-support.js"));
  ({ readGeneratedModelsJson } = await import("./models-config.test-utils.js"));
});

afterEach(() => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  resetModelsJsonReadyCacheForTest();
});

afterAll(async () => {
  await fixtureSuite.cleanup();
});

function createOpenAiApiKeySourceConfig(): CarapaceConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" }, // pragma: allowlist secret
          api: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createOpenAiApiKeyRuntimeConfig(): CarapaceConfig {
  // Runtime config simulates already-resolved secrets that must not be persisted.
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-runtime-resolved", // pragma: allowlist secret
          api: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createCustomProviderApiKeySourceConfig(): CarapaceConfig {
  return {
    models: {
      providers: {
        litellm: {
          baseUrl: "https://litellm.example/v1",
          apiKey: {
            source: "env",
            provider: "default",
            id: "CARAPACE_MODEL_LITELLM_API_KEY", // pragma: allowlist secret
          },
          api: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createCustomProviderApiKeyRuntimeConfig(): CarapaceConfig {
  return {
    models: {
      providers: {
        litellm: {
          baseUrl: "https://litellm.example/v1",
          apiKey: "sk-litellm-runtime-secret", // pragma: allowlist secret
          api: "openai-completions" as const,
          models: [],
        },
      },
    },
  };
}

function createOpenAiHeaderSourceConfig(): CarapaceConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-completions" as const,
          headers: {
            Authorization: {
              source: "env",
              provider: "default",
              id: "OPENAI_HEADER_TOKEN", // pragma: allowlist secret
            },
            "X-Tenant-Token": {
              source: "file",
              provider: "vault",
              id: "/providers/openai/tenantToken",
            },
          },
          models: [],
        },
      },
    },
  };
}

function createOpenAiHeaderRuntimeConfig(): CarapaceConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-completions" as const,
          headers: {
            Authorization: "Bearer runtime-openai-token",
            "X-Tenant-Token": "runtime-tenant-token",
          },
          models: [],
        },
      },
    },
  };
}

function getOpenAiProvider(config: CarapaceConfig) {
  return expectDefined(config.models?.providers?.openai, "OpenAI provider config");
}

function createOpenAiSourceConfigWithHeadersAndApiKey(): CarapaceConfig {
  const config = createOpenAiHeaderSourceConfig();
  getOpenAiProvider(config).apiKey = {
    source: "env",
    provider: "default",
    id: "OPENAI_API_KEY", // pragma: allowlist secret
  };
  return config;
}

function createOpenAiRuntimeConfigWithHeadersAndApiKey(): CarapaceConfig {
  const config = createOpenAiHeaderRuntimeConfig();
  getOpenAiProvider(config).apiKey = "sk-runtime-resolved"; // pragma: allowlist secret
  return config;
}

function withGatewayTokenMode(config: CarapaceConfig): CarapaceConfig {
  return {
    ...config,
    gateway: {
      auth: {
        mode: "token",
      },
    },
  };
}

async function expectGeneratedProviderApiKey(
  agentDir: string,
  providerId: string,
  expected: string,
) {
  const parsed = await readGeneratedModelsJson<{
    providers: Record<string, { apiKey?: string }>;
  }>(agentDir);
  expect(parsed.providers[providerId]?.apiKey).toBe(expected);
}

async function planGeneratedProviders(params: {
  config: CarapaceConfig;
  sourceConfigForSecrets: CarapaceConfig;
}) {
  // Planner assertions avoid filesystem noise for marker-projection cases.
  const plan = await planCarapaceModelsJsonWithDeps(
    {
      cfg: params.config,
      sourceConfigForSecrets: params.sourceConfigForSecrets,
      agentDir: "/tmp/carapace-models-plan",
      env: {},
      existingRaw: "",
      existingParsed: null,
    },
    {
      resolveImplicitProviders: async () => ({}),
    },
  );
  expect(plan.action).toBe("write");
  if (plan.action !== "write") {
    throw new Error(`expected models.json write plan, got ${plan.action}`);
  }
  return JSON.parse(plan.contents).providers as Record<
    string,
    { apiKey?: string; headers?: Record<string, string> }
  >;
}

function expectOpenAiHeaderMarkers(
  providers: Record<string, { headers?: Record<string, string> }>,
) {
  // Env header refs keep their id; non-env refs collapse to the shared sentinel.
  expect(providers.openai?.headers?.Authorization).toBe(
    "secretref-env:OPENAI_HEADER_TOKEN", // pragma: allowlist secret
  );
  expect(providers.openai?.headers?.["X-Tenant-Token"]).toBe(NON_ENV_SECRETREF_MARKER);
}

describe("models-config runtime source snapshot", () => {
  it("uses runtime source snapshot markers when passed the active runtime config", () => {
    const sourceConfig: CarapaceConfig = {
      models: {
        providers: {
          openai: getOpenAiProvider(createOpenAiApiKeySourceConfig()),
          moonshot: {
            baseUrl: "https://api.moonshot.ai/v1",
            apiKey: { source: "file", provider: "vault", id: "/moonshot/apiKey" },
            api: "openai-completions" as const,
            models: [],
          },
        },
      },
    };
    const runtimeConfig: CarapaceConfig = {
      models: {
        providers: {
          openai: getOpenAiProvider(createOpenAiApiKeyRuntimeConfig()),
          moonshot: {
            baseUrl: "https://api.moonshot.ai/v1",
            apiKey: "sk-runtime-moonshot", // pragma: allowlist secret
            api: "openai-completions" as const,
            models: [],
          },
        },
      },
    };
    const providers = enforceSourceManagedProviderSecrets({
      providers: runtimeConfig.models!.providers!,
      sourceConfigForSecrets: sourceConfig,
    })!;
    expect(providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
    expect(providers.moonshot?.apiKey).toBe(NON_ENV_SECRETREF_MARKER);
  });

  it("projects cloned runtime configs onto source snapshot when preserving provider auth", async () => {
    const agentDir = await fixtureSuite.createCaseDir("agent");
    await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
      unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
      const sourceConfig = createOpenAiApiKeySourceConfig();
      const runtimeConfig = createOpenAiApiKeyRuntimeConfig();
      const clonedRuntimeConfig: CarapaceConfig = {
        ...runtimeConfig,
        agents: {
          defaults: {
            imageModel: "openai/gpt-image-1",
          },
        },
      };

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        await ensureCarapaceModelsJson(clonedRuntimeConfig, agentDir);
        await expectGeneratedProviderApiKey(agentDir, "openai", "OPENAI_API_KEY"); // pragma: allowlist secret
      } finally {
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("preserves source markers for custom-provider api keys after models status secret resolution", async () => {
    const agentDir = await fixtureSuite.createCaseDir("agent");
    await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
      unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
      const sourceConfig = createCustomProviderApiKeySourceConfig();
      const runtimeConfig = createCustomProviderApiKeyRuntimeConfig();

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        await ensureCarapaceModelsJson(runtimeConfig, agentDir);
        await expectGeneratedProviderApiKey(agentDir, "litellm", "CARAPACE_MODEL_LITELLM_API_KEY"); // pragma: allowlist secret
      } finally {
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("invalidates cached readiness when projected config changes under the same runtime snapshot", async () => {
    const agentDir = await fixtureSuite.createCaseDir("agent");
    await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
      unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
      const sourceConfig = createOpenAiApiKeySourceConfig();
      const runtimeConfig = createOpenAiApiKeyRuntimeConfig();
      const firstCandidate: CarapaceConfig = {
        ...runtimeConfig,
        models: {
          providers: {
            openai: {
              ...getOpenAiProvider(runtimeConfig),
              baseUrl: "https://api.openai.com/v1",
              headers: {
                "X-Carapace-Test": "one",
              },
            },
          },
        },
      };
      const secondCandidate: CarapaceConfig = {
        ...runtimeConfig,
        models: {
          providers: {
            openai: {
              ...getOpenAiProvider(runtimeConfig),
              baseUrl: "https://mirror.example/v1",
              headers: {
                "X-Carapace-Test": "two",
              },
            },
          },
        },
      };

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        await ensureCarapaceModelsJson(firstCandidate, agentDir);
        let parsed = await readGeneratedModelsJson<{
          providers: Record<
            string,
            { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }
          >;
        }>(agentDir);
        expect(parsed.providers.openai?.baseUrl).toBe("https://api.openai.com/v1");
        expect(parsed.providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
        expect(parsed.providers.openai?.headers?.["X-Carapace-Test"]).toBe("one");

        // Header changes still rewrite models.json, but merge mode preserves the existing baseUrl.
        await ensureCarapaceModelsJson(secondCandidate, agentDir);
        parsed = await readGeneratedModelsJson<{
          providers: Record<
            string,
            { baseUrl?: string; apiKey?: string; headers?: Record<string, string> }
          >;
        }>(agentDir);
        expect(parsed.providers.openai?.baseUrl).toBe("https://api.openai.com/v1");
        expect(parsed.providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
        expect(parsed.providers.openai?.headers?.["X-Carapace-Test"]).toBe("two");
      } finally {
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("uses header markers from runtime source snapshot instead of resolved runtime values", async () => {
    const providers = await planGeneratedProviders({
      config: createOpenAiHeaderRuntimeConfig(),
      sourceConfigForSecrets: createOpenAiHeaderSourceConfig(),
    });
    expectOpenAiHeaderMarkers(providers);
  });

  it("keeps source markers when runtime projection is skipped for incompatible top-level shape", async () => {
    const providers = await planGeneratedProviders({
      config: createOpenAiRuntimeConfigWithHeadersAndApiKey(),
      sourceConfigForSecrets: withGatewayTokenMode(createOpenAiSourceConfigWithHeadersAndApiKey()),
    });
    expect(providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
    expectOpenAiHeaderMarkers(providers);
  });

  it("reapplies source markers when sourceConfigForSecrets uses mixed-case provider keys", async () => {
    // Regression: provider keys in sourceConfigForSecrets may arrive as "OpenAI" while the
    // merge boundary canonicalizes to "openai". The source-managed marker lookup must use the
    // same provider-id normalizer, otherwise the resolved runtime apiKey leaks into models.json.
    const mixedCaseSourceConfig: CarapaceConfig = {
      models: {
        providers: {
          OpenAI: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" }, // pragma: allowlist secret
            api: "openai-completions" as const,
            models: [],
          },
        },
      },
    };
    const providers = await planGeneratedProviders({
      config: createOpenAiApiKeyRuntimeConfig(),
      sourceConfigForSecrets: mixedCaseSourceConfig,
    });
    expect(Object.keys(providers).toSorted()).toEqual(["openai"]);
    expect(providers.OpenAI).toBeUndefined();
    expect(providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
  });

  it("reapplies source header markers when sourceConfigForSecrets uses mixed-case provider keys", async () => {
    const sourceConfig: CarapaceConfig = {
      models: {
        providers: {
          " OpenAI ": {
            baseUrl: "https://api.openai.com/v1",
            api: "openai-completions" as const,
            apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" }, // pragma: allowlist secret
            headers: {
              Authorization: {
                source: "env",
                provider: "default",
                id: "OPENAI_HEADER_TOKEN", // pragma: allowlist secret
              },
              "X-Tenant-Token": {
                source: "file",
                provider: "vault",
                id: "/providers/openai/tenantToken",
              },
            },
            models: [],
          },
        },
      },
    };
    const providers = await planGeneratedProviders({
      config: createOpenAiRuntimeConfigWithHeadersAndApiKey(),
      sourceConfigForSecrets: sourceConfig,
    });
    expect(Object.keys(providers).toSorted()).toEqual(["openai"]);
    expect(providers.OpenAI).toBeUndefined();
    expect(providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
    expectOpenAiHeaderMarkers(providers);
  });

  it.each([
    ["before", true],
    ["after", false],
  ])(
    "prefers canonical source secret ownership when it appears %s a case variant",
    async (_position, first) => {
      const canonical = getOpenAiProvider(createOpenAiApiKeySourceConfig());
      const caseVariant = {
        ...canonical,
        apiKey: {
          source: "env" as const,
          provider: "default",
          id: "OPENAI_CASE_VARIANT",
        },
      };
      const sourceProviders = first
        ? { openai: canonical, OpenAI: caseVariant }
        : { OpenAI: caseVariant, openai: canonical };
      const providers = await planGeneratedProviders({
        config: createOpenAiApiKeyRuntimeConfig(),
        sourceConfigForSecrets: { models: { providers: sourceProviders } },
      });

      expect(Object.keys(providers)).toEqual(["openai"]);
      expect(providers.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
    },
  );

  it("uses a valid case alias when the canonical source entry is not a provider record", () => {
    const runtimeConfig = createOpenAiApiKeyRuntimeConfig();
    const sourceProviders = {
      openai: null,
      OpenAI: getOpenAiProvider(createOpenAiApiKeySourceConfig()),
    } as unknown as NonNullable<NonNullable<CarapaceConfig["models"]>["providers"]>;

    const providers = enforceSourceManagedProviderSecrets({
      providers: runtimeConfig.models!.providers!,
      sourceConfigForSecrets: { models: { providers: sourceProviders } },
    });

    expect(providers?.openai?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
  });
});
