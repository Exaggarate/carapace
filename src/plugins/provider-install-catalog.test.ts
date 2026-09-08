// Covers provider install catalog entries from plugin metadata.
import { beforeEach, describe, expect, it, vi } from "vitest";

type LoadPluginRegistrySnapshot = typeof import("./plugin-registry.js").loadPluginRegistrySnapshot;
type ResolveManifestProviderAuthChoices =
  typeof import("./provider-auth-choices.js").resolveManifestProviderAuthChoices;
type ListOfficialExternalProviderCatalogEntries =
  typeof import("./official-external-plugin-catalog.js").listOfficialExternalProviderCatalogEntries;
type PluginInstallSourceInfo = import("./install-source-info.js").PluginInstallSourceInfo;
type InstalledPluginInstallRecordInfo =
  import("./installed-plugin-index.js").InstalledPluginInstallRecordInfo;
type InstalledPluginIndexRecord = import("./installed-plugin-index.js").InstalledPluginIndexRecord;

const loadPluginRegistrySnapshot = vi.hoisted(() =>
  vi.fn<LoadPluginRegistrySnapshot>(() => ({
    version: 1,
    hostContractVersion: "test",
    compatRegistryVersion: "test",
    migrationVersion: 1,
    policyHash: "test",
    generatedAtMs: 0,
    installRecords: {},
    plugins: [],
    diagnostics: [],
  })),
);
vi.mock("./plugin-registry.js", () => ({
  loadPluginRegistrySnapshot,
}));

const resolveManifestProviderAuthChoices = vi.hoisted(() =>
  vi.fn<ResolveManifestProviderAuthChoices>(() => []),
);
vi.mock("./provider-auth-choices.js", () => ({
  resolveManifestProviderAuthChoices,
}));

const listOfficialExternalProviderCatalogEntries = vi.hoisted(() =>
  vi.fn<ListOfficialExternalProviderCatalogEntries>(() => []),
);
vi.mock("./official-external-plugin-catalog.js", async () => {
  const actual = await vi.importActual<typeof import("./official-external-plugin-catalog.js")>(
    "./official-external-plugin-catalog.js",
  );
  return {
    ...actual,
    listOfficialExternalProviderCatalogEntries,
  };
});

import {
  resolveDeprecatedProviderInstallCatalogEntry,
  resolveProviderInstallCatalogEntries,
  resolveProviderInstallCatalogEntry,
} from "./provider-install-catalog.js";

function registrySnapshot(
  overrides: {
    installRecords?: Record<string, InstalledPluginInstallRecordInfo>;
    plugins?: InstalledPluginIndexRecord[];
  } = {},
) {
  return {
    version: 1 as const,
    hostContractVersion: "test",
    compatRegistryVersion: "test",
    migrationVersion: 1 as const,
    policyHash: "test",
    generatedAtMs: 0,
    installRecords: overrides.installRecords ?? {},
    plugins: overrides.plugins ?? [],
    diagnostics: [],
  };
}

function vllmPluginWithPackageInstall(): InstalledPluginIndexRecord {
  return {
    pluginId: "vllm",
    origin: "global",
    manifestPath: "/Users/test/.carapace/plugins/vllm/carapace.plugin.json",
    manifestHash: "hash",
    rootDir: "/Users/test/.carapace/plugins/vllm",
    enabled: true,
    startup: {
      sidecar: false,
      memory: false,
      agentHarnesses: [],
    },
    compat: [],
    packageName: "@carapace/vllm",
    packageInstall: {
      npm: {
        spec: "@carapace/vllm-fork@1.0.0",
        packageName: "@carapace/vllm-fork",
        selector: "1.0.0",
        selectorKind: "exact-version",
        exactVersion: true,
        expectedIntegrity: "sha512-old",
        pinState: "exact-with-integrity",
      },
      warnings: [],
    },
  };
}

function mockVllmAuthChoice() {
  resolveManifestProviderAuthChoices.mockReturnValue([
    {
      pluginId: "vllm",
      providerId: "vllm",
      methodId: "server",
      choiceId: "vllm",
      choiceLabel: "vLLM",
      groupLabel: "vLLM",
    },
  ]);
}

describe("provider install catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadPluginRegistrySnapshot.mockReturnValue({
      version: 1,
      hostContractVersion: "test",
      compatRegistryVersion: "test",
      migrationVersion: 1,
      policyHash: "test",
      generatedAtMs: 0,
      installRecords: {},
      plugins: [],
      diagnostics: [],
    });
    resolveManifestProviderAuthChoices.mockReturnValue([]);
    listOfficialExternalProviderCatalogEntries.mockReturnValue([]);
  });

  it("merges manifest auth-choice metadata with registry install metadata", () => {
    loadPluginRegistrySnapshot.mockReturnValue({
      version: 1,
      hostContractVersion: "test",
      compatRegistryVersion: "test",
      migrationVersion: 1,
      policyHash: "test",
      generatedAtMs: 0,
      installRecords: {},
      plugins: [
        {
          pluginId: "openai",
          origin: "bundled",
          manifestPath: "/repo/extensions/openai/carapace.plugin.json",
          manifestHash: "hash",
          rootDir: "/repo/extensions/openai",
          enabled: true,
          startup: {
            sidecar: false,
            memory: false,
            agentHarnesses: [],
          },
          compat: [],
          packageName: "@carapace/openai",
          packageInstall: {
            defaultChoice: "npm",
            npm: {
              spec: "@carapace/openai@1.2.3",
              packageName: "@carapace/openai",
              selector: "1.2.3",
              selectorKind: "exact-version",
              exactVersion: true,
              expectedIntegrity: "sha512-openai",
              pinState: "exact-with-integrity",
            },
            local: {
              path: "extensions/openai",
            },
            warnings: [],
          },
        },
      ],
      diagnostics: [],
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "openai",
        providerId: "openai",
        methodId: "api-key",
        choiceId: "openai-api-key",
        choiceLabel: "OpenAI API key",
        groupId: "openai",
        groupLabel: "OpenAI",
      },
    ]);

    expect(resolveProviderInstallCatalogEntries()).toEqual([
      {
        pluginId: "openai",
        providerId: "openai",
        methodId: "api-key",
        choiceId: "openai-api-key",
        choiceLabel: "OpenAI API key",
        groupId: "openai",
        groupLabel: "OpenAI",
        label: "OpenAI",
        origin: "bundled",
        install: {
          npmSpec: "@carapace/openai@1.2.3",
          localPath: "extensions/openai",
          defaultChoice: "npm",
          expectedIntegrity: "sha512-openai",
        },
        installSource: {
          defaultChoice: "npm",
          npm: {
            spec: "@carapace/openai@1.2.3",
            packageName: "@carapace/openai",
            selector: "1.2.3",
            selectorKind: "exact-version",
            exactVersion: true,
            expectedIntegrity: "sha512-openai",
            pinState: "exact-with-integrity",
          },
          local: {
            path: "extensions/openai",
          },
          warnings: [],
        },
      },
    ]);
  });

  it("prefers durable install records over package-authored install intent", () => {
    loadPluginRegistrySnapshot.mockReturnValue(
      registrySnapshot({
        installRecords: {
          vllm: {
            source: "npm",
            spec: "@carapace/vllm",
            resolvedSpec: "@carapace/vllm@2.0.0",
            integrity: "sha512-vllm",
          },
        },
        plugins: [vllmPluginWithPackageInstall()],
      }),
    );
    mockVllmAuthChoice();

    expect(resolveProviderInstallCatalogEntry("vllm")).toEqual({
      pluginId: "vllm",
      providerId: "vllm",
      methodId: "server",
      choiceId: "vllm",
      choiceLabel: "vLLM",
      groupLabel: "vLLM",
      label: "vLLM",
      origin: "global",
      install: {
        npmSpec: "@carapace/vllm@2.0.0",
        expectedIntegrity: "sha512-vllm",
        defaultChoice: "npm",
      },
      installSource: {
        defaultChoice: "npm",
        npm: {
          spec: "@carapace/vllm@2.0.0",
          packageName: "@carapace/vllm",
          selector: "2.0.0",
          selectorKind: "exact-version",
          exactVersion: true,
          expectedIntegrity: "sha512-vllm",
          pinState: "exact-with-integrity",
        },
        warnings: [],
      },
    });
  });

  it("preserves durable ClawHub install records for provider setup reinstall hints", () => {
    loadPluginRegistrySnapshot.mockReturnValue(
      registrySnapshot({
        installRecords: {
          vllm: {
            source: "clawhub",
            spec: "clawhub:carapace/vllm@2026.5.2",
            integrity: "sha256-clawpack",
            clawhubPackage: "carapace/vllm",
          },
        },
        plugins: [vllmPluginWithPackageInstall()],
      }),
    );
    mockVllmAuthChoice();

    expect(resolveProviderInstallCatalogEntry("vllm")).toEqual({
      pluginId: "vllm",
      providerId: "vllm",
      methodId: "server",
      choiceId: "vllm",
      choiceLabel: "vLLM",
      groupLabel: "vLLM",
      label: "vLLM",
      origin: "global",
      install: {
        clawhubSpec: "clawhub:carapace/vllm@2026.5.2",
        defaultChoice: "clawhub",
      },
      installSource: {
        defaultChoice: "clawhub",
        clawhub: {
          spec: "clawhub:carapace/vllm@2026.5.2",
          packageName: "carapace/vllm",
          version: "2026.5.2",
          exactVersion: true,
        },
        warnings: [],
      },
    });
  });

  it("does not expose untrusted global package install intent without an install record", () => {
    loadPluginRegistrySnapshot.mockReturnValue({
      version: 1,
      hostContractVersion: "test",
      compatRegistryVersion: "test",
      migrationVersion: 1,
      policyHash: "test",
      generatedAtMs: 0,
      installRecords: {},
      plugins: [
        {
          pluginId: "demo-provider",
          origin: "global",
          manifestPath: "/Users/test/.carapace/plugins/demo-provider/carapace.plugin.json",
          manifestHash: "hash",
          rootDir: "/Users/test/.carapace/plugins/demo-provider",
          enabled: true,
          startup: {
            sidecar: false,
            memory: false,
            agentHarnesses: [],
          },
          compat: [],
          packageName: "@vendor/demo-provider",
          packageInstall: {
            npm: {
              spec: "@vendor/demo-provider@1.2.3",
              packageName: "@vendor/demo-provider",
              selector: "1.2.3",
              selectorKind: "exact-version",
              exactVersion: true,
              expectedIntegrity: "sha512-demo",
              pinState: "exact-with-integrity",
            },
            warnings: [],
          },
        },
      ],
      diagnostics: [],
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "demo-provider",
        providerId: "demo-provider",
        methodId: "api-key",
        choiceId: "demo-provider-api-key",
        choiceLabel: "Demo Provider API key",
      },
    ]);

    expect(resolveProviderInstallCatalogEntries()).toStrictEqual([]);
  });

  it("ignores malformed persisted package install metadata", () => {
    loadPluginRegistrySnapshot.mockReturnValue({
      version: 1,
      hostContractVersion: "test",
      compatRegistryVersion: "test",
      migrationVersion: 1,
      policyHash: "test",
      generatedAtMs: 0,
      installRecords: {},
      plugins: [
        {
          pluginId: "openai",
          origin: "bundled",
          manifestPath: "/repo/extensions/openai/carapace.plugin.json",
          manifestHash: "hash",
          rootDir: "/repo/extensions/openai",
          enabled: true,
          startup: {
            sidecar: false,
            memory: false,
            agentHarnesses: [],
          },
          compat: [],
          packageName: "@carapace/openai",
          packageInstall: {
            defaultChoice: "npm",
            npm: {
              spec: 12,
              packageName: "@carapace/openai",
              selectorKind: "exact-version",
              exactVersion: true,
              pinState: "exact-with-integrity",
            },
            warnings: [],
          } as unknown as PluginInstallSourceInfo,
        },
      ],
      diagnostics: [],
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "openai",
        providerId: "openai",
        methodId: "api-key",
        choiceId: "openai-api-key",
        choiceLabel: "OpenAI API key",
      },
    ]);

    expect(resolveProviderInstallCatalogEntries()).toStrictEqual([]);
  });

  it("skips untrusted workspace package install metadata when the plugin is disabled", () => {
    loadPluginRegistrySnapshot.mockReturnValue({
      version: 1,
      hostContractVersion: "test",
      compatRegistryVersion: "test",
      migrationVersion: 1,
      policyHash: "test",
      generatedAtMs: 0,
      installRecords: {},
      plugins: [
        {
          pluginId: "demo-provider",
          origin: "workspace",
          manifestPath: "/repo/extensions/demo-provider/carapace.plugin.json",
          manifestHash: "hash",
          rootDir: "/repo/extensions/demo-provider",
          enabled: false,
          startup: {
            sidecar: false,
            memory: false,
            agentHarnesses: [],
          },
          compat: [],
          packageInstall: {
            local: {
              path: "extensions/demo-provider",
            },
            warnings: [],
          },
        },
      ],
      diagnostics: [],
    });
    resolveManifestProviderAuthChoices.mockReturnValue([
      {
        pluginId: "demo-provider",
        providerId: "demo-provider",
        methodId: "api-key",
        choiceId: "demo-provider-api-key",
        choiceLabel: "Demo Provider API key",
      },
    ]);

    expect(
      resolveProviderInstallCatalogEntries({
        config: {
          plugins: {
            enabled: false,
          },
        },
        includeUntrustedWorkspacePlugins: false,
      }),
    ).toStrictEqual([]);
  });

  it("surfaces official external provider install metadata when the provider plugin is not installed", () => {
    listOfficialExternalProviderCatalogEntries.mockReturnValue([
      {
        name: "@carapace/codex",
        source: "official",
        kind: "provider",
        carapace: {
          plugin: { id: "codex", label: "Codex" },
          providers: [
            {
              id: "codex",
              name: "Codex",
              authChoices: [
                {
                  method: "app-server",
                  choiceId: "codex",
                  choiceLabel: "Codex app-server",
                  choiceHint: "Use the Codex app-server runtime.",
                  groupId: "codex",
                  groupLabel: "Codex",
                  onboardingScopes: ["text-inference"],
                },
              ],
            },
          ],
          install: {
            npmSpec: "@carapace/codex",
            defaultChoice: "npm",
          },
        },
      },
    ]);

    expect(resolveProviderInstallCatalogEntry("codex")).toEqual({
      pluginId: "codex",
      providerId: "codex",
      methodId: "app-server",
      choiceId: "codex",
      choiceLabel: "Codex app-server",
      choiceHint: "Use the Codex app-server runtime.",
      groupId: "codex",
      groupLabel: "Codex",
      onboardingScopes: ["text-inference"],
      label: "Codex",
      origin: "bundled",
      install: {
        npmSpec: "@carapace/codex",
        defaultChoice: "npm",
      },
      installSource: {
        defaultChoice: "npm",
        npm: {
          spec: "@carapace/codex",
          packageName: "@carapace/codex",
          selectorKind: "none",
          exactVersion: false,
          pinState: "floating-without-integrity",
        },
        warnings: ["npm-spec-floating", "npm-spec-missing-integrity"],
      },
    });
  });

  it("preserves official external provider aliases for configured-plugin repair", () => {
    listOfficialExternalProviderCatalogEntries.mockReturnValue([
      {
        name: "@carapace/gmi-provider",
        source: "official",
        kind: "provider",
        carapace: {
          plugin: { id: "gmi", label: "GMI Cloud" },
          providers: [
            {
              id: "gmi",
              aliases: ["gmi-cloud", "gmicloud"],
              name: "GMI Cloud",
              authChoices: [
                {
                  method: "api-key",
                  choiceId: "gmi-api-key",
                  choiceLabel: "GMI Cloud API key",
                },
              ],
            },
          ],
          install: {
            npmSpec: "@carapace/gmi-provider",
            defaultChoice: "npm",
          },
        },
      },
    ]);

    expect(resolveProviderInstallCatalogEntry("gmi-api-key")).toMatchObject({
      pluginId: "gmi",
      providerId: "gmi",
      providerAliases: ["gmi-cloud", "gmicloud"],
    });
  });

  it("resolves deprecated official external auth choices before their plugin is installed", () => {
    listOfficialExternalProviderCatalogEntries.mockReturnValue([
      {
        name: "@carapace/qwen-provider",
        source: "official",
        kind: "provider",
        carapace: {
          plugin: { id: "qwen", label: "Qwen Cloud" },
          providers: [
            {
              id: "qwen",
              name: "Qwen Cloud",
              authChoices: [
                {
                  method: "api-key",
                  choiceId: "qwen-api-key",
                  deprecatedChoiceIds: ["modelstudio-api-key"],
                  choiceLabel: "Qwen Cloud API key",
                },
              ],
            },
          ],
          install: {
            npmSpec: "@carapace/qwen-provider",
            defaultChoice: "npm",
          },
        },
      },
    ]);

    expect(resolveDeprecatedProviderInstallCatalogEntry("modelstudio-api-key")).toMatchObject({
      pluginId: "qwen",
      choiceId: "qwen-api-key",
    });
  });
});
