// Plugin location bridge tests cover CLI plugin path bridging between install surfaces.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPluginStartupInfo } from "../plugins/installed-plugin-index-types.js";
import type { InstalledPluginIndex } from "../plugins/installed-plugin-index.js";
import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";

const readPersistedInstalledPluginIndexMock = vi.fn();
const loadPluginManifestRegistryForInstalledIndexMock = vi.fn();

const startupInfo: InstalledPluginStartupInfo = {
  sidecar: false,
  memory: false,
  agentHarnesses: [],
};

vi.mock("../plugins/installed-plugin-index-store.js", () => ({
  readPersistedInstalledPluginIndex: (...args: unknown[]) =>
    readPersistedInstalledPluginIndexMock(...args),
}));

vi.mock("../plugins/manifest-registry-installed.js", () => ({
  loadPluginManifestRegistryForInstalledIndex: (...args: unknown[]) =>
    loadPluginManifestRegistryForInstalledIndexMock(...args),
}));

const { listPersistedBundledPluginLocationBridges, listPersistedBundledPluginRecoveryLocations } =
  await import("./plugins-location-bridges.js");

function makeIndex(record: InstalledPluginIndex["plugins"][number]): InstalledPluginIndex {
  return {
    version: 1,
    hostContractVersion: "2026.5.2",
    compatRegistryVersion: "test",
    migrationVersion: 1,
    policyHash: "test",
    generatedAtMs: 1,
    refreshReason: "manual",
    installRecords: {},
    plugins: [record],
    diagnostics: [],
  };
}

function makeRegistry(pluginId: string, channels: string[] = [pluginId]): PluginManifestRegistry {
  return {
    plugins: [
      {
        id: pluginId,
        name: pluginId,
        rootDir: `/app/dist/extensions/${pluginId}`,
        source: `/app/dist/extensions/${pluginId}/index.js`,
        origin: "bundled",
        channels,
        providers: [],
        cliBackends: [],
        syntheticAuthRefs: [],
        nonSecretAuthMarkers: [],
        skills: [],
        settingsFiles: [],
        hooks: [],
        configContracts: [],
        activation: {},
        startup: {},
        packageInstall: {
          clawhubSpec: `clawhub:@carapace/${pluginId}`,
          npmSpec: `@carapace/${pluginId}`,
          defaultChoice: "clawhub",
        },
      },
    ],
    diagnostics: [],
  } as unknown as PluginManifestRegistry;
}

describe("listPersistedBundledPluginLocationBridges", () => {
  beforeEach(() => {
    readPersistedInstalledPluginIndexMock.mockReset();
    loadPluginManifestRegistryForInstalledIndexMock.mockReset();
  });

  it("keeps persisted bundled relocations npm-first for launch", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-otel",
        manifestPath: "/app/dist/extensions/diagnostics-otel/carapace.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/diagnostics-otel/index.js",
        rootDir: "/app/dist/extensions/diagnostics-otel",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          defaultChoice: "clawhub",
          clawhub: {
            spec: "clawhub:@carapace/diagnostics-otel",
            packageName: "@carapace/diagnostics-otel",
            exactVersion: false,
          },
          npm: {
            spec: "@carapace/diagnostics-otel",
            packageName: "@carapace/diagnostics-otel",
            selectorKind: "none",
            exactVersion: false,
            pinState: "floating-without-integrity",
          },
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(
      makeRegistry("diagnostics-otel"),
    );

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
      {
        bundledPluginId: "diagnostics-otel",
        pluginId: "diagnostics-otel",
        npmSpec: "@carapace/diagnostics-otel",
        clawhubSpec: "clawhub:@carapace/diagnostics-otel",
        channelIds: ["diagnostics-otel"],
      },
    ]);
  });

  it("uses official external catalog metadata when the persisted bundled row lacks npm metadata", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-otel",
        manifestPath: "/app/dist/extensions/diagnostics-otel/carapace.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/diagnostics-otel/index.js",
        rootDir: "/app/dist/extensions/diagnostics-otel",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          defaultChoice: "clawhub",
          clawhub: {
            spec: "clawhub:@carapace/diagnostics-otel",
            packageName: "@carapace/diagnostics-otel",
            exactVersion: false,
          },
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(
      makeRegistry("diagnostics-otel"),
    );

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
      {
        bundledPluginId: "diagnostics-otel",
        pluginId: "diagnostics-otel",
        npmSpec: "@carapace/diagnostics-otel",
        clawhubSpec: "clawhub:@carapace/diagnostics-otel",
        channelIds: ["diagnostics-otel"],
      },
    ]);
  });

  it("targets the renamed official plugin id when externalizing a bundled plugin", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "qqbot",
        manifestPath: "/app/dist/extensions/qqbot/carapace.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/qqbot/index.js",
        rootDir: "/app/dist/extensions/qqbot",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
        packageInstall: { warnings: [] },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(makeRegistry("qqbot"));

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
      {
        bundledPluginId: "qqbot",
        pluginId: "carapace-qqbot",
        npmSpec: "@tencent-connect/carapace-qqbot@2.0.3",
        expectedIntegrity:
          "sha512-yngu/2cPeZjJfIfHWCXWB2/6KlDHrb9vpOUjKLdQxePLSp6wCn3CFOALcBIVq/9o6jlYz9WTU9idW6nfX1xpFA==",
        channelIds: ["qqbot"],
      },
    ]);
  });

  it.each([
    ["byteplus", "@carapace/byteplus-provider", true],
    ["duckduckgo", "@carapace/duckduckgo-plugin", false],
    ["mistral", "@carapace/mistral-provider", true],
    ["novita", "@carapace/novita-provider", true],
    ["opencode", "@carapace/opencode-provider", true],
    ["opencode-go", "@carapace/opencode-go-provider", true],
    ["synthetic", "@carapace/synthetic-provider", true],
    ["teams-meetings", "@carapace/teams-meetings", true],
    ["volcengine", "@carapace/volcengine-provider", true],
    ["voyage", "@carapace/voyage-provider", true],
    ["vydra", "@carapace/vydra-provider", true],
    ["xiaomi", "@carapace/xiaomi-provider", true],
    ["zoom-meetings", "@carapace/zoom-meetings", true],
  ] as const)(
    "externalizes the shipped bundled %s plugin using official install metadata",
    async (pluginId, npmSpec, enabledByDefault) => {
      readPersistedInstalledPluginIndexMock.mockResolvedValue(
        makeIndex({
          pluginId,
          manifestPath: `/app/dist/extensions/${pluginId}/carapace.plugin.json`,
          manifestHash: "hash",
          source: `/app/dist/extensions/${pluginId}/index.js`,
          rootDir: `/app/dist/extensions/${pluginId}`,
          origin: "bundled",
          enabled: true,
          ...(enabledByDefault ? { enabledByDefault: true } : {}),
          startup: startupInfo,
          compat: [],
          packageInstall: {
            warnings: [],
          },
        }),
      );
      loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(makeRegistry(pluginId, []));

      await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
        {
          bundledPluginId: pluginId,
          pluginId,
          npmSpec,
          clawhubSpec: `clawhub:${npmSpec}`,
          ...(enabledByDefault ? { enabledByDefault: true } : {}),
        },
      ]);
    },
  );

  it("externalizes the shipped bundled ComfyUI plugin while preserving default enablement", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "comfy",
        manifestPath: "/app/dist/extensions/comfy/carapace.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/comfy/index.js",
        rootDir: "/app/dist/extensions/comfy",
        origin: "bundled",
        enabled: true,
        enabledByDefault: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(makeRegistry("comfy", []));

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
      {
        bundledPluginId: "comfy",
        pluginId: "comfy",
        npmSpec: "@carapace/comfy-provider",
        clawhubSpec: "clawhub:@carapace/comfy-provider",
        enabledByDefault: true,
      },
    ]);
  });

  it("externalizes the shipped bundled iMessage channel while preserving default enablement", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "imessage",
        manifestPath: "/app/dist/extensions/imessage/carapace.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/imessage/index.js",
        rootDir: "/app/dist/extensions/imessage",
        origin: "bundled",
        enabled: true,
        enabledByDefault: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(makeRegistry("imessage"));

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toEqual([
      {
        bundledPluginId: "imessage",
        pluginId: "imessage",
        npmSpec: "@carapace/imessage",
        clawhubSpec: "clawhub:@carapace/imessage",
        enabledByDefault: true,
        channelIds: ["imessage"],
      },
    ]);
  });

  it("does not create a relocation bridge without persisted or official install metadata", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "local-only",
        manifestPath: "/app/dist/extensions/local-only/carapace.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/local-only/index.js",
        rootDir: "/app/dist/extensions/local-only",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
        packageInstall: {
          warnings: [],
        },
      }),
    );
    loadPluginManifestRegistryForInstalledIndexMock.mockReturnValue(makeRegistry("local-only"));

    await expect(listPersistedBundledPluginLocationBridges({})).resolves.toStrictEqual([]);
  });
});

describe("listPersistedBundledPluginRecoveryLocations", () => {
  beforeEach(() => {
    readPersistedInstalledPluginIndexMock.mockReset();
    loadPluginManifestRegistryForInstalledIndexMock.mockReset();
  });

  it("includes exact packaged and legacy paths for disabled bundled records", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-otel",
        manifestPath: "/app/dist/extensions/diagnostics-otel/carapace.plugin.json",
        manifestHash: "hash",
        source: "/app/dist/extensions/diagnostics-otel/index.js",
        rootDir: "/app/dist/extensions/diagnostics-otel",
        origin: "bundled",
        enabled: false,
        startup: startupInfo,
        compat: [],
      }),
    );

    await expect(listPersistedBundledPluginRecoveryLocations({})).resolves.toEqual([
      {
        pluginId: "diagnostics-otel",
        loadPaths: ["/app/dist/extensions/diagnostics-otel", "/app/extensions/diagnostics-otel"],
      },
    ]);
  });

  it("does not use a relative persisted bundled root as ownership proof", async () => {
    readPersistedInstalledPluginIndexMock.mockResolvedValue(
      makeIndex({
        pluginId: "diagnostics-otel",
        manifestPath: "extensions/diagnostics-otel/carapace.plugin.json",
        manifestHash: "hash",
        source: "extensions/diagnostics-otel/index.js",
        rootDir: "extensions/diagnostics-otel",
        origin: "bundled",
        enabled: true,
        startup: startupInfo,
        compat: [],
      }),
    );
    await expect(listPersistedBundledPluginRecoveryLocations({})).resolves.toStrictEqual([]);
  });
});
