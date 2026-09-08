// Verifies optional media/PDF tool factory planning from plugin metadata and auth.
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { getCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-snapshot.js";
import { setCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata.test-support.js";
import { resolveInstalledPluginIndexPolicyHash } from "../plugins/installed-plugin-index-policy.js";
import type { PluginManifestRecord } from "../plugins/manifest-registry.js";
import { clearPluginMetadataLifecycleCaches } from "../plugins/plugin-metadata-lifecycle.js";
import { finalizePluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.js";
import { createPluginMetadataSnapshotFixture } from "../plugins/plugin-metadata.test-support.js";
import { resetPluginRuntimeStateForTest } from "../plugins/runtime.js";
import { clearSecretsRuntimeSnapshot } from "../secrets/runtime.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import {
  resolveImageToolFactoryAvailable,
  resolveOptionalMediaToolFactoryPlan,
} from "./carapace-tools.media-factory-plan.js";
import { DEFAULT_PLUGIN_TOOLS_ALLOWLIST_ENTRY } from "./tool-policy.js";
import { loadCapabilityMetadataSnapshot } from "./tools/manifest-capability-availability.js";
import * as pdfModelConfigModule from "./tools/pdf-tool.model-config.js";

type CreateCarapaceToolsOptions = Parameters<
  typeof import("./carapace-tools.js").createCarapaceTools
>[0];
let createCarapaceToolsForTestModule: typeof import("./carapace-tools.js").createCarapaceTools;
let legacyComfyToolNames: string[];

async function createCarapaceToolsForTest(options?: CreateCarapaceToolsOptions) {
  return createCarapaceToolsForTestModule(options);
}

function createAuthStore(providers: string[] = []): AuthProfileStore {
  // Auth facts are provider-key based; profile ids only need deterministic defaults.
  return {
    version: 1,
    profiles: Object.fromEntries(
      providers.map((provider) => [
        `${provider}:default`,
        {
          provider,
          type: "api_key",
          key: "test",
        },
      ]),
    ),
  };
}

function createPlugin(params: {
  id: string;
  origin?: PluginManifestRecord["origin"];
  contracts: NonNullable<PluginManifestRecord["contracts"]>;
  imageGenerationProviderMetadata?: PluginManifestRecord["imageGenerationProviderMetadata"];
  videoGenerationProviderMetadata?: PluginManifestRecord["videoGenerationProviderMetadata"];
  musicGenerationProviderMetadata?: PluginManifestRecord["musicGenerationProviderMetadata"];
  setupProviders?: Array<{ id: string; envVars?: string[] }>;
}): PluginManifestRecord {
  return {
    id: params.id,
    origin: params.origin ?? "bundled",
    rootDir: `/plugins/${params.id}`,
    source: `/plugins/${params.id}/index.js`,
    manifestPath: `/plugins/${params.id}/carapace.plugin.json`,
    channels: [],
    providers: [],
    cliBackends: [],
    skills: [],
    hooks: [],
    contracts: params.contracts,
    imageGenerationProviderMetadata: params.imageGenerationProviderMetadata,
    videoGenerationProviderMetadata: params.videoGenerationProviderMetadata,
    musicGenerationProviderMetadata: params.musicGenerationProviderMetadata,
    setup: params.setupProviders ? { providers: params.setupProviders } : undefined,
  };
}

function createExplicitMediaModelConfig(): CarapaceConfig {
  return {
    agents: {
      defaults: {
        mediaModels: {
          image: { primary: "image-owner/model" },
          video: { primary: "video-owner/model" },
          music: { primary: "music-owner/model" },
        },
        pdfModel: { primary: "media-owner/model" },
      },
    },
  };
}

function createStandardMediaPlugins(
  mediaProvider = "media-owner",
): [PluginManifestRecord, PluginManifestRecord, PluginManifestRecord, PluginManifestRecord] {
  const mediaEnvVar = mediaProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "MEDIA_OWNER_API_KEY";
  return [
    createPlugin({
      id: "image-owner",
      contracts: { imageGenerationProviders: ["image-owner"] },
      setupProviders: [{ id: "image-owner", envVars: ["IMAGE_OWNER_API_KEY"] }],
    }),
    createPlugin({
      id: "video-owner",
      contracts: { videoGenerationProviders: ["video-owner"] },
      setupProviders: [{ id: "video-owner", envVars: ["VIDEO_OWNER_API_KEY"] }],
    }),
    createPlugin({
      id: "music-owner",
      contracts: { musicGenerationProviders: ["music-owner"] },
      setupProviders: [{ id: "music-owner", envVars: ["MUSIC_OWNER_API_KEY"] }],
    }),
    createPlugin({
      id: "media-owner",
      contracts: { mediaUnderstandingProviders: [mediaProvider] },
      setupProviders: [{ id: mediaProvider, envVars: [mediaEnvVar] }],
    }),
  ];
}

function createImageAndPdfPlugins(): [PluginManifestRecord, PluginManifestRecord] {
  const plugins = createStandardMediaPlugins("anthropic");
  return [plugins[0], plugins[3]];
}

function createComfyPlugin(
  configSignals: NonNullable<
    PluginManifestRecord["imageGenerationProviderMetadata"]
  >[string]["configSignals"],
) {
  const metadata = { comfy: { configSignals } };
  return createPlugin({
    id: "comfy",
    contracts: {
      imageGenerationProviders: ["comfy"],
      videoGenerationProviders: ["comfy"],
      musicGenerationProviders: ["comfy"],
    },
    imageGenerationProviderMetadata: metadata,
    videoGenerationProviderMetadata: metadata,
    musicGenerationProviderMetadata: metadata,
  });
}

function legacyModelProviderConfig(provider: Record<string, unknown>): CarapaceConfig {
  return {
    models: {
      providers: {
        comfy: provider as never,
      },
    },
  };
}

function installSnapshot(
  config: CarapaceConfig,
  plugins: PluginManifestRecord[],
  workspaceDir?: string,
) {
  const prepared = createPluginMetadataSnapshotFixture({ plugins });
  const policyHash = resolveInstalledPluginIndexPolicyHash(config);
  const index = { ...prepared.index, policyHash };
  const snapshot = finalizePluginMetadataSnapshot({
    ...prepared,
    policyHash,
    ...(workspaceDir ? { workspaceDir } : {}),
    index,
    registryIndex: index,
  });
  setCurrentPluginMetadataSnapshot(snapshot, { config });
  return snapshot;
}

describe("optional media tool factory planning", () => {
  beforeAll(async () => {
    ({ createCarapaceTools: createCarapaceToolsForTestModule } =
      await import("./carapace-tools.js"));

    const config = legacyModelProviderConfig({
      workflow: { "1": { inputs: {} } },
      promptNodeId: "1",
    });
    vi.stubEnv("CARAPACE_BUNDLED_PLUGINS_DIR", path.join(process.cwd(), "extensions"));
    legacyComfyToolNames = (
      await createCarapaceToolsForTest({
        config,
        authProfileStore: createAuthStore(),
        pluginToolAllowlist: ["image_generate", "video_generate", "music_generate"],
      })
    ).map((tool) => tool.name);
    clearPluginMetadataLifecycleCaches();
    resetPluginRuntimeStateForTest();
    clearSecretsRuntimeSnapshot();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    resetPluginRuntimeStateForTest();
    clearSecretsRuntimeSnapshot();
  });

  afterEach(() => {
    clearPluginMetadataLifecycleCaches();
    resetPluginRuntimeStateForTest();
    clearSecretsRuntimeSnapshot();
    vi.unstubAllEnvs();
  });

  it("uses the prepared media family for image-tool availability", () => {
    const config: CarapaceConfig = {};
    const snapshot = installSnapshot(config, [
      createPlugin({
        id: "media-owner",
        contracts: { mediaUnderstandingProviders: ["media-owner"] },
        setupProviders: [{ id: "media-owner" }],
      }),
    ]);
    const base = {
      config,
      agentDir: "/agent",
      authStore: createAuthStore(["media-owner"]),
    };

    expect(
      resolveImageToolFactoryAvailable({
        ...base,
        preparedModelRuntime: {
          metadataSnapshot: snapshot,
          mediaCapabilityProviders: { mediaUnderstandingProviders: [] },
        } as never,
      }),
    ).toBe(false);
    expect(
      resolveImageToolFactoryAvailable({
        ...base,
        preparedModelRuntime: {
          metadataSnapshot: snapshot,
          mediaCapabilityProviders: {
            mediaUnderstandingProviders: [{ id: "media-owner", capabilities: ["image"] }],
          },
        } as never,
      }),
    ).toBe(true);
  });

  it("requires image capability and auth on the same prepared provider", () => {
    const config: CarapaceConfig = {};
    const snapshot = installSnapshot(config, [
      createPlugin({
        id: "media-owner",
        contracts: {
          mediaUnderstandingProviders: ["audio-auth", "image-no-auth"],
        },
        setupProviders: [{ id: "audio-auth" }, { id: "image-no-auth" }],
      }),
    ]);

    expect(
      resolveImageToolFactoryAvailable({
        config,
        agentDir: "/agent",
        authStore: createAuthStore(["audio-auth"]),
        preparedModelRuntime: {
          metadataSnapshot: snapshot,
          mediaCapabilityProviders: {
            mediaUnderstandingProviders: [
              { id: "audio-auth", capabilities: ["audio"] },
              { id: "image-no-auth", capabilities: ["image"] },
            ],
          },
        } as never,
      }),
    ).toBe(false);
  });

  it("keeps config vision routes while gating OpenAI subscription auth on prepared Codex", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const config = {
      models: {
        providers: {
          custom: {
            baseUrl: "https://vision.example/v1",
            models: [{ id: "vision", input: ["text", "image"] }],
          },
          openai: {
            baseUrl: "https://api.openai.com/v1",
            models: [{ id: "gpt-image", input: ["text", "image"] }],
          },
        },
      },
    } as unknown as CarapaceConfig;
    const snapshot = installSnapshot(config, []);
    const preparedModelRuntime = {
      metadataSnapshot: snapshot,
      mediaCapabilityProviders: { mediaUnderstandingProviders: [] },
    } as never;
    const oauthStore = createAuthStore();
    oauthStore.profiles["openai:default"] = {
      provider: "openai",
      type: "oauth",
      access: "test",
      refresh: "test",
      expires: Date.now() + 60_000,
    };

    expect(
      resolveImageToolFactoryAvailable({
        config,
        agentDir: "/agent",
        authStore: createAuthStore(["custom"]),
        preparedModelRuntime,
      }),
    ).toBe(true);
    expect(
      resolveImageToolFactoryAvailable({
        config,
        agentDir: "/agent",
        authStore: oauthStore,
        preparedModelRuntime,
      }),
    ).toBe(false);
    for (const [capabilities, expected] of [
      [["audio"], false],
      [["image"], true],
    ] as const) {
      expect(
        resolveImageToolFactoryAvailable({
          config,
          agentDir: "/agent",
          authStore: oauthStore,
          preparedModelRuntime: {
            metadataSnapshot: snapshot,
            mediaCapabilityProviders: {
              mediaUnderstandingProviders: [{ id: "codex", capabilities }],
            },
          } as never,
        }),
      ).toBe(expected);
    }
  });

  it("skips unavailable generation and PDF factories from snapshot and run auth facts", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, createStandardMediaPlugins());

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["github-copilot"]),
      }),
    ).toEqual({
      imageGenerate: false,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
  });

  it("does not plan media factories from workspace-scoped metadata without workspace context", () => {
    // Workspace snapshots are process-local facts and must not leak to unrelated runs.
    const config: CarapaceConfig = {};
    vi.stubEnv("CARAPACE_DISABLE_BUNDLED_PLUGINS", "1");
    installSnapshot(
      config,
      [
        createPlugin({
          id: "image-owner",
          contracts: { imageGenerationProviders: ["image-owner"] },
          setupProviders: [{ id: "image-owner", envVars: ["IMAGE_OWNER_API_KEY"] }],
        }),
      ],
      "/workspace/a",
    );
    expect(getCurrentPluginMetadataSnapshot({ config })).toBeUndefined();
    expect(
      getCurrentPluginMetadataSnapshot({ config, workspaceDir: "/workspace/a" }),
    ).toBeDefined();
    expect(
      loadCapabilityMetadataSnapshot({ config }).plugins.map((plugin) => plugin.id),
    ).not.toContain("image-owner");

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["image-owner"]),
      }).imageGenerate,
    ).toBe(false);
    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        workspaceDir: "/workspace/a",
        authStore: createAuthStore(["image-owner"]),
      }).imageGenerate,
    ).toBe(true);
  });

  it("keeps explicit model configs on the factory path", () => {
    const config = createExplicitMediaModelConfig();
    installSnapshot(config, []);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(),
      }),
    ).toEqual({
      imageGenerate: true,
      videoGenerate: true,
      musicGenerate: true,
      pdf: true,
    });
  });

  it("preserves implicit allow-all from alsoAllow-only policies for built-in media factories", async () => {
    const config = createExplicitMediaModelConfig();
    const allowlistFromAlsoAllowOnlyPolicy = ["group:memory", DEFAULT_PLUGIN_TOOLS_ALLOWLIST_ENTRY];
    installSnapshot(config, []);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(),
        toolAllowlist: allowlistFromAlsoAllowOnlyPolicy,
      }),
    ).toEqual({
      imageGenerate: true,
      videoGenerate: true,
      musicGenerate: true,
      pdf: true,
    });

    const toolNames = (
      await createCarapaceToolsForTest({
        config,
        agentDir: "/tmp/carapace-agent-main",
        authProfileStore: createAuthStore(),
        pluginToolAllowlist: allowlistFromAlsoAllowOnlyPolicy,
      })
    ).map((tool) => tool.name);
    expect(toolNames).toContain("image_generate");
    expect(toolNames).toContain("video_generate");
    expect(toolNames).toContain("music_generate");
    expect(toolNames).toContain("pdf");
  });

  it("keeps denylists authoritative when alsoAllow-only policies preserve factory construction", () => {
    const config = createExplicitMediaModelConfig();
    installSnapshot(config, []);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(),
        toolAllowlist: [DEFAULT_PLUGIN_TOOLS_ALLOWLIST_ENTRY],
        toolDenylist: ["video_generate", "pdf"],
      }),
    ).toEqual({
      imageGenerate: true,
      videoGenerate: false,
      musicGenerate: true,
      pdf: false,
    });
  });

  it("skips tools that the resolved allowlist cannot expose", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, createImageAndPdfPlugins());

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["image-owner", "anthropic"]),
        toolAllowlist: ["image_generate"],
      }),
    ).toEqual({
      imageGenerate: true,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
  });

  it("skips tools that the resolved denylist blocks", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, createImageAndPdfPlugins());

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["image-owner", "anthropic"]),
        toolDenylist: ["image_generate", "pdf"],
      }),
    ).toEqual({
      imageGenerate: false,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
  });

  it("applies global tool policy before optional media factories run", () => {
    const config: CarapaceConfig = { tools: { deny: ["pdf"] } };
    installSnapshot(config, [
      createPlugin({
        id: "media-owner",
        contracts: { mediaUnderstandingProviders: ["anthropic"] },
        setupProviders: [{ id: "anthropic", envVars: ["ANTHROPIC_API_KEY"] }],
      }),
    ]);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["anthropic"]),
      }).pdf,
    ).toBe(false);
  });

  it("applies wildcard deny patterns to optional factory planning", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, createStandardMediaPlugins("anthropic"));

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["image-owner", "video-owner", "music-owner", "anthropic"]),
        toolDenylist: ["*_generate", "p*"],
      }),
    ).toEqual({
      imageGenerate: false,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
  });

  it("keeps auth-backed providers on the factory path", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, createStandardMediaPlugins());
    vi.stubEnv("VIDEO_OWNER_API_KEY", "video-key");

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["image-owner", "music-owner", "media-owner"]),
      }),
    ).toEqual({
      imageGenerate: true,
      videoGenerate: true,
      musicGenerate: true,
      pdf: true,
    });
  });

  it("keeps manifest setup provider env vars on the music factory path", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, [
      createPlugin({
        id: "minimax",
        contracts: { musicGenerationProviders: ["minimax", "minimax-portal"] },
        setupProviders: [
          {
            id: "minimax",
            envVars: ["MINIMAX_CODE_PLAN_KEY", "MINIMAX_CODING_API_KEY", "MINIMAX_API_KEY"],
          },
          { id: "minimax-portal", envVars: ["MINIMAX_OAUTH_TOKEN", "MINIMAX_API_KEY"] },
        ],
      }),
    ]);
    vi.stubEnv("MINIMAX_API_KEY", "minimax-key");

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(),
      }).musicGenerate,
    ).toBe(true);
  });

  it("defers PDF model resolution from the tool-prep hot path", async () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, createImageAndPdfPlugins());
    const resolveSpy = vi.spyOn(pdfModelConfigModule, "resolvePdfModelConfigForTool");

    const tools = await createCarapaceToolsForTest({
      config,
      agentDir: "/tmp/carapace-agent-main",
      authProfileStore: createAuthStore(["anthropic"]),
    });

    expect(tools.map((tool) => tool.name)).toContain("pdf");
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("keeps enabled external manifest capability providers on the factory path", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, [
      createPlugin({
        id: "external-image",
        origin: "global",
        contracts: { imageGenerationProviders: ["external-image"] },
        setupProviders: [{ id: "external-image", envVars: ["EXTERNAL_IMAGE_API_KEY"] }],
      }),
      createPlugin({
        id: "external-video",
        origin: "global",
        contracts: { videoGenerationProviders: ["external-video"] },
        setupProviders: [{ id: "external-video", envVars: ["EXTERNAL_VIDEO_API_KEY"] }],
      }),
      createPlugin({
        id: "external-music",
        origin: "global",
        contracts: { musicGenerationProviders: ["external-music"] },
        setupProviders: [{ id: "external-music", envVars: ["EXTERNAL_MUSIC_API_KEY"] }],
      }),
      createPlugin({
        id: "external-media",
        origin: "global",
        contracts: { mediaUnderstandingProviders: ["external-media"] },
        setupProviders: [{ id: "external-media", envVars: ["EXTERNAL_MEDIA_API_KEY"] }],
      }),
    ]);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore([
          "external-image",
          "external-video",
          "external-music",
          "external-media",
        ]),
      }),
    ).toEqual({
      imageGenerate: true,
      videoGenerate: true,
      musicGenerate: true,
      pdf: true,
    });
  });

  it("rechecks workspace capability activation after the selected slot changes", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, [
      {
        ...createPlugin({
          id: "workspace-image",
          origin: "workspace",
          contracts: { imageGenerationProviders: ["workspace-image"] },
        }),
        kind: "context-engine",
      },
    ]);
    const authStore = createAuthStore(["workspace-image"]);
    const available = () =>
      resolveOptionalMediaToolFactoryPlan({ config, authStore }).imageGenerate;

    expect(available()).toBe(false);
    config.plugins = { slots: { contextEngine: "workspace-image" } };
    expect(available()).toBe(true);
    config.plugins = {};
    expect(available()).toBe(false);
  });

  it("keeps manifest-declared image provider auth aliases on the factory path", async () => {
    const config: CarapaceConfig = {};
    const plugins = [
      createPlugin({
        id: "openai",
        contracts: { imageGenerationProviders: ["openai"] },
        imageGenerationProviderMetadata: {
          openai: {
            aliases: ["openai"],
            authSignals: [
              {
                provider: "openai",
              },
              {
                provider: "openai",
                providerBaseUrl: {
                  provider: "openai",
                  defaultBaseUrl: "https://api.openai.com/v1",
                  allowedBaseUrls: ["https://api.openai.com/v1"],
                },
              },
            ],
          },
        },
      }),
    ];
    installSnapshot(config, plugins);

    const plan = resolveOptionalMediaToolFactoryPlan({
      config,
      authStore: createAuthStore(["openai"]),
    });
    expect(plan.imageGenerate).toBe(true);
    installSnapshot(config, plugins, process.cwd());
    expect(
      (
        await createCarapaceToolsForTest({
          config,
          workspaceDir: process.cwd(),
          authProfileStore: createAuthStore(["openai"]),
          pluginToolAllowlist: ["image_generate"],
        })
      ).map((tool) => tool.name),
    ).toContain("image_generate");
  });

  it("keeps manifest-declared config-only generation providers on the factory path", () => {
    const config: CarapaceConfig = {
      plugins: {
        entries: {
          comfy: {
            config: {
              mode: "local",
              workflow: { "1": { inputs: {} } },
              promptNodeId: "1",
            },
          },
        },
      },
    };
    const configSignals = [
      {
        rootPath: "plugins.entries.comfy.config",
        mode: {
          path: "mode",
          default: "local",
          allowed: ["local"],
        },
        requiredAny: ["workflow", "workflowPath"],
        required: ["promptNodeId"],
      },
    ];
    installSnapshot(config, [createComfyPlugin(configSignals)]);

    const plan = resolveOptionalMediaToolFactoryPlan({
      config,
      authStore: createAuthStore(),
    });
    expect(plan.imageGenerate).toBe(true);
    expect(plan.videoGenerate).toBe(true);
    expect(plan.musicGenerate).toBe(true);
  });

  it("does not expose manifest-backed generation providers when plugins are globally disabled", async () => {
    const config: CarapaceConfig = {
      plugins: {
        enabled: false,
        entries: {
          comfy: {
            config: {
              mode: "local",
              workflow: { "1": { inputs: {} } },
              promptNodeId: "1",
            },
          },
        },
      },
    };
    const configSignals = [
      {
        rootPath: "plugins.entries.comfy.config",
        mode: {
          path: "mode",
          default: "local",
          allowed: ["local"],
        },
        requiredAny: ["workflow", "workflowPath"],
        required: ["promptNodeId"],
      },
    ];
    installSnapshot(config, [createComfyPlugin(configSignals)]);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(),
      }),
    ).toEqual({
      imageGenerate: false,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
    const toolNames = (
      await createCarapaceToolsForTest({
        config,
        authProfileStore: createAuthStore(),
        pluginToolAllowlist: ["image_generate", "video_generate", "music_generate"],
      })
    ).map((tool) => tool.name);
    expect(toolNames).not.toContain("image_generate");
    expect(toolNames).not.toContain("video_generate");
    expect(toolNames).not.toContain("music_generate");
  });

  it("does not count unresolved SecretRef config signals as configured", async () => {
    vi.stubEnv("COMFY_TEST_API_KEY", "");
    const workspaceDir = process.cwd();
    const config: CarapaceConfig = {
      plugins: {
        entries: {
          comfy: {
            config: {
              mode: "cloud",
              apiKey: { source: "env", provider: "default", id: "COMFY_TEST_API_KEY" },
              workflow: { "1": { inputs: {} } },
              promptNodeId: "1",
            },
          },
        },
      },
    };
    const configSignals = [
      {
        rootPath: "plugins.entries.comfy.config",
        mode: {
          path: "mode",
          allowed: ["cloud"],
        },
        requiredAny: ["workflow", "workflowPath"],
        required: ["promptNodeId", "apiKey"],
      },
    ];
    installSnapshot(config, [createComfyPlugin(configSignals)], workspaceDir);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        workspaceDir,
        authStore: createAuthStore(),
      }),
    ).toEqual({
      imageGenerate: false,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
    const toolNames = (
      await createCarapaceToolsForTest({
        config,
        workspaceDir,
        authProfileStore: createAuthStore(),
        pluginToolAllowlist: ["image_generate", "video_generate", "music_generate"],
      })
    ).map((tool) => tool.name);
    expect(toolNames).not.toContain("image_generate");
    expect(toolNames).not.toContain("video_generate");
    expect(toolNames).not.toContain("music_generate");
  });

  it("counts configured non-env SecretRef config signals without resolving secrets", () => {
    const config: CarapaceConfig = {
      plugins: {
        entries: {
          comfy: {
            config: {
              mode: "cloud",
              apiKey: { source: "file", provider: "vault", id: "/comfy/api-key" },
              workflow: { "1": { inputs: {} } },
              promptNodeId: "1",
            },
          },
        },
      },
      secrets: {
        providers: {
          vault: {
            source: "file",
            path: "/tmp/carapace-secrets.json",
            mode: "json",
          },
        },
      },
    };
    const configSignals = [
      {
        rootPath: "plugins.entries.comfy.config",
        mode: {
          path: "mode",
          allowed: ["cloud"],
        },
        requiredAny: ["workflow", "workflowPath"],
        required: ["promptNodeId", "apiKey"],
      },
    ];
    installSnapshot(config, [createComfyPlugin(configSignals)]);

    const plan = resolveOptionalMediaToolFactoryPlan({
      config,
      authStore: createAuthStore(),
    });
    expect(plan.imageGenerate).toBe(true);
    expect(plan.videoGenerate).toBe(true);
    expect(plan.musicGenerate).toBe(true);
  });

  it("does not register the image tool without cheap vision availability evidence", async () => {
    const config: CarapaceConfig = {};
    const workspaceDir = "/tmp/carapace-workspace";
    vi.stubEnv("MEDIA_OWNER_API_KEY", "");
    installSnapshot(
      config,
      [
        createPlugin({
          id: "media-owner",
          contracts: { mediaUnderstandingProviders: ["media-owner"] },
          setupProviders: [{ id: "media-owner", envVars: ["MEDIA_OWNER_API_KEY"] }],
        }),
      ],
      workspaceDir,
    );

    expect(
      (
        await createCarapaceToolsForTest({
          config,
          agentDir: "/tmp/carapace-agent",
          workspaceDir,
          authProfileStore: createAuthStore(),
          disablePluginTools: true,
        })
      ).map((tool) => tool.name),
    ).not.toContain("view_image");
  });

  it.each([
    {
      name: "legacy local provider config",
      config: legacyModelProviderConfig({
        workflow: { "1": { inputs: {} } },
        promptNodeId: "1",
      }),
      expectedToolNames: () => legacyComfyToolNames,
    },
    {
      name: "plugin cloud API key config",
      config: {
        plugins: {
          entries: {
            comfy: {
              config: {
                mode: "cloud",
                apiKey: "cloud-key",
                workflow: { "1": { inputs: {} } },
                promptNodeId: "1",
              },
            },
          },
        },
      } satisfies CarapaceConfig,
      expectedToolNames: undefined,
    },
    {
      name: "legacy cloud API key config",
      config: legacyModelProviderConfig({
        mode: "cloud",
        apiKey: "cloud-key",
        workflow: { "1": { inputs: {} } },
        promptNodeId: "1",
      }),
      expectedToolNames: undefined,
    },
  ])(
    "registers generation tools from Comfy $name without a current metadata snapshot",
    async ({ config, expectedToolNames }) => {
      const toolNames = expectedToolNames
        ? expectedToolNames()
        : (
            await createCarapaceToolsForTest({
              config,
              authProfileStore: createAuthStore(),
              pluginToolAllowlist: ["image_generate", "video_generate", "music_generate"],
            })
          ).map((tool) => tool.name);

      expect(toolNames).toContain("image_generate");
      expect(toolNames).toContain("video_generate");
      expect(toolNames).toContain("music_generate");
    },
  );

  it("honors manifest-declared image provider auth alias base-url guards", () => {
    const config: CarapaceConfig = {
      models: {
        providers: {
          openai: {
            baseUrl: "http://localhost:11434/v1",
            models: [],
          },
        },
      },
    };
    installSnapshot(config, [
      createPlugin({
        id: "openai",
        contracts: { imageGenerationProviders: ["openai"] },
        imageGenerationProviderMetadata: {
          openai: {
            aliases: ["openai"],
            authSignals: [
              {
                provider: "openai",
                providerBaseUrl: {
                  provider: "openai",
                  defaultBaseUrl: "https://api.openai.com/v1",
                  allowedBaseUrls: ["https://api.openai.com/v1"],
                },
              },
            ],
          },
        },
      }),
    ]);

    const plan = resolveOptionalMediaToolFactoryPlan({
      config,
      authStore: createAuthStore(["openai"]),
    });
    expect(plan.imageGenerate).toBe(false);
  });

  it("ignores external manifest capability providers excluded by plugin policy", () => {
    const config: CarapaceConfig = {
      plugins: {
        allow: ["other-plugin"],
      },
    };
    installSnapshot(config, [
      createPlugin({
        id: "external-image",
        origin: "global",
        contracts: { imageGenerationProviders: ["external-image"] },
        setupProviders: [{ id: "external-image", envVars: ["EXTERNAL_IMAGE_API_KEY"] }],
      }),
    ]);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(["external-image"]),
      }),
    ).toEqual({
      imageGenerate: false,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
  });

  it("does not use a generic factory plan when metadata has no availability proof", () => {
    const config: CarapaceConfig = {};
    installSnapshot(config, []);

    expect(
      resolveOptionalMediaToolFactoryPlan({
        config,
        authStore: createAuthStore(),
      }),
    ).toEqual({
      imageGenerate: false,
      videoGenerate: false,
      musicGenerate: false,
      pdf: false,
    });
  });
});
