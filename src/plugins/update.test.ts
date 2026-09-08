import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectDefined } from "@carapace/normalization-core";
import { bundledPluginRootAt } from "carapace/plugin-sdk/test-fixtures";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/config.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import type { SpawnResult } from "../process/exec.js";
import { withEnvAsync } from "../test-utils/env.js";
import { resolvePluginArtifactDeclaredSurface } from "./capability-artifact.js";
import { computeDeclaredSurfaceHash } from "./capability-summary.js";
import { resolvePluginInstallOwnerMigrations } from "./install-transaction.js";
import { makeTrackedTempDir } from "./test-helpers/fs-fixtures.js";

const APP_ROOT = "/app";

type NpmInstallIntegrityDrift = {
  spec: string;
  expectedIntegrity: string;
  actualIntegrity: string;
  resolution: {
    integrity?: string;
    resolvedSpec?: string;
    version?: string;
  };
};

const appBundledPluginRoot = (pluginId: string) => bundledPluginRootAt(APP_ROOT, pluginId);

function requireExpectedPluginId(params: { expectedPluginId?: string }): string {
  if (!params.expectedPluginId) {
    throw new Error("Expected npm install params to include expectedPluginId");
  }
  return params.expectedPluginId;
}

function requirePluginPackageName(
  plugins: Array<{ pluginId: string; packageName: string }>,
  pluginId: string,
): string {
  const plugin = plugins.find((candidate) => candidate.pluginId === pluginId);
  if (!plugin) {
    throw new Error(`Expected plugin fixture ${pluginId}`);
  }
  return plugin.packageName;
}

const installPluginFromNpmSpecMock = vi.fn();
const installPluginFromMarketplaceMock = vi.fn();
const installPluginFromClawHubMock = vi.fn();
const installPluginFromGitSpecMock = vi.fn();
const resolveBundledPluginSourcesMock = vi.fn();
const runCommandWithTimeoutMock = vi.fn();
const failedNpmVersionQueryResult: SpawnResult = {
  code: 1,
  stdout: "",
  stderr: "npm version query failed",
  signal: null,
  killed: false,
  termination: "exit",
};
const validatePackageExtensionEntriesForInstallMock = vi.fn();
const markClawPackageIndependentlyOwnedMock = vi.fn();
const withClawPackageLifecycleLeaseMock = vi.fn(
  async (_artifact: unknown, operation: () => Promise<unknown>, _options?: unknown) =>
    await operation(),
);
const tempDirs: string[] = [];
const capabilityConsentMode = vi.hoisted(() => ({ real: false }));

vi.mock("./capability-consent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./capability-consent.js")>();
  return {
    ...actual,
    // Channel routing fixtures stub installers; update-channel.consent.test.ts owns staged proof.
    prepareManagedPluginArtifactConsentHandler: async () => ({
      onBeforePluginArtifactCommit: async () => {},
      applyAcceptedSurface: <T extends PluginInstallRecord>(_pluginId: string, record: T): T =>
        record,
    }),
  };
});

vi.mock("./update-capability-consent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./update-capability-consent.js")>();
  return {
    preparePluginUpdateCapabilityConsent: (
      params: Parameters<typeof actual.preparePluginUpdateCapabilityConsent>[0],
    ) => {
      // Routing fixtures stub installers; capability cases below exercise the real staged owner.
      if (capabilityConsentMode.real) {
        return actual.preparePluginUpdateCapabilityConsent(params);
      }
      return {
        onBeforePluginArtifactCommit: async () => {},
        acceptInstallRecord: <T extends PluginInstallRecord>(record: T): T => record,
      };
    },
  };
});

vi.mock("./install.js", () => ({
  installPluginFromNpmSpec: (...args: unknown[]) => installPluginFromNpmSpecMock(...args),
  resolvePluginInstallDir: (pluginId: string, extensionsDir = "/tmp") => {
    const separator = process.platform === "win32" ? "\\" : "/";
    return `${extensionsDir.replace(/[\\/]+$/, "")}${separator}${pluginId}`;
  },
  PLUGIN_INSTALL_ERROR_CODE: {
    NPM_METADATA_FAILURE: "npm_metadata_failure",
    NPM_PACKAGE_NOT_FOUND: "npm_package_not_found",
  },
}));

vi.mock("./git-install.js", () => ({
  installPluginFromGitSpec: (...args: unknown[]) => installPluginFromGitSpecMock(...args),
}));

vi.mock("./marketplace.js", () => ({
  installPluginFromMarketplace: (...args: unknown[]) => installPluginFromMarketplaceMock(...args),
}));

vi.mock("./clawhub.js", () => ({
  CLAWHUB_INSTALL_ERROR_CODE: {
    PACKAGE_NOT_FOUND: "package_not_found",
    VERSION_NOT_FOUND: "version_not_found",
    ARTIFACT_UNAVAILABLE: "artifact_unavailable",
    ARCHIVE_INTEGRITY_MISMATCH: "archive_integrity_mismatch",
    ARTIFACT_DOWNLOAD_UNAVAILABLE: "artifact_download_unavailable",
    CLAWHUB_SECURITY_UNAVAILABLE: "clawhub_security_unavailable",
    CLAWHUB_DOWNLOAD_BLOCKED: "clawhub_download_blocked",
  },
  installPluginFromClawHub: (...args: unknown[]) => installPluginFromClawHubMock(...args),
}));

vi.mock("../state/claw-package-adoption.js", () => ({
  markClawPackageIndependentlyOwned: (...args: unknown[]) =>
    markClawPackageIndependentlyOwnedMock(...args),
}));

vi.mock("../state/claw-package-lifecycle-lease.js", () => ({
  withClawPackageLifecycleLease: (
    artifact: unknown,
    operation: () => Promise<unknown>,
    options?: unknown,
  ) => withClawPackageLifecycleLeaseMock(artifact, operation, options),
}));

vi.mock("./bundled-sources.js", () => ({
  resolveBundledPluginSources: (...args: unknown[]) => resolveBundledPluginSourcesMock(...args),
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

vi.mock("./package-entry-resolution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./package-entry-resolution.js")>();
  return {
    ...actual,
    validatePackageExtensionEntriesForInstall: async (
      ...args: Parameters<typeof actual.validatePackageExtensionEntriesForInstall>
    ) => {
      validatePackageExtensionEntriesForInstallMock(...args);
      return await actual.validatePackageExtensionEntriesForInstall(...args);
    },
  };
});

const { syncPluginsForUpdateChannel, updateNpmInstalledPlugins } = await import("./update.js");

function createSuccessfulNpmUpdateResult(params?: {
  pluginId?: string;
  targetDir?: string;
  version?: string;
  npmResolution?: {
    name: string;
    version: string;
    resolvedSpec: string;
  };
}) {
  return {
    ok: true,
    pluginId: params?.pluginId ?? "opik-carapace",
    targetDir: params?.targetDir ?? "/tmp/opik-carapace",
    version: params?.version ?? "0.2.6",
    extensions: ["index.ts"],
    ...(params?.npmResolution ? { npmResolution: params.npmResolution } : {}),
  };
}

function createSuccessfulClawHubUpdateResult(params?: {
  pluginId?: string;
  targetDir?: string;
  version?: string;
  clawhubPackage?: string;
}) {
  return {
    ok: true,
    pluginId: params?.pluginId ?? "legacy-chat",
    targetDir: params?.targetDir ?? "/tmp/carapace-plugins/legacy-chat",
    version: params?.version ?? "2026.5.1-beta.2",
    extensions: ["index.ts"],
    packageName: params?.clawhubPackage ?? "legacy-chat",
    clawhub: {
      source: "clawhub" as const,
      clawhubUrl: "https://clawhub.ai",
      clawhubPackage: params?.clawhubPackage ?? "legacy-chat",
      clawhubFamily: "code-plugin" as const,
      clawhubChannel: "official" as const,
      version: params?.version ?? "2026.5.1-beta.2",
      integrity: "sha256-clawpack",
      resolvedAt: "2026-05-01T00:00:00.000Z",
      artifactKind: "npm-pack" as const,
      artifactFormat: "tgz" as const,
      npmIntegrity: "sha512-clawpack",
      npmShasum: "2".repeat(40),
      npmTarballName: `${params?.clawhubPackage ?? "legacy-chat"}-${params?.version ?? "2026.5.1-beta.2"}.tgz`,
      clawpackSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      clawpackSpecVersion: 1,
      clawpackManifestSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      clawpackSize: 4096,
    },
  };
}

function createNpmInstallConfig(params: {
  pluginId: string;
  spec: string;
  installPath: string;
  integrity?: string;
  shasum?: string;
  installedAt?: string;
  resolvedAt?: string;
  resolvedName?: string;
  resolvedSpec?: string;
  resolvedVersion?: string;
}): CarapaceConfig {
  return {
    plugins: {
      installs: {
        [params.pluginId]: {
          source: "npm" as const,
          spec: params.spec,
          installPath: params.installPath,
          ...(params.integrity ? { integrity: params.integrity } : {}),
          ...(params.shasum ? { shasum: params.shasum } : {}),
          ...(params.resolvedName ? { resolvedName: params.resolvedName } : {}),
          ...(params.resolvedSpec ? { resolvedSpec: params.resolvedSpec } : {}),
          ...(params.resolvedVersion ? { resolvedVersion: params.resolvedVersion } : {}),
          ...(params.installedAt ? { installedAt: params.installedAt } : {}),
          ...(params.resolvedAt ? { resolvedAt: params.resolvedAt } : {}),
        },
      },
    },
  };
}

function createMarketplaceInstallConfig(params: {
  pluginId: string;
  installPath: string;
  marketplaceSource: string;
  marketplacePlugin: string;
  marketplaceName?: string;
}): CarapaceConfig {
  return {
    plugins: {
      installs: {
        [params.pluginId]: {
          source: "marketplace" as const,
          installPath: params.installPath,
          marketplaceSource: params.marketplaceSource,
          marketplacePlugin: params.marketplacePlugin,
          ...(params.marketplaceName ? { marketplaceName: params.marketplaceName } : {}),
        },
      },
    },
  };
}

function createClawHubInstallConfig(
  params: {
    pluginId?: string;
    installPath?: string;
    clawhubUrl?: string;
    clawhubPackage?: string;
    clawhubFamily?: "bundle-plugin" | "code-plugin";
    clawhubChannel?: "community" | "official" | "private";
    spec?: string;
  } = {},
): CarapaceConfig {
  const pluginId = params.pluginId ?? "demo";
  const clawhubPackage = params.clawhubPackage ?? pluginId;
  return {
    plugins: {
      installs: {
        [pluginId]: {
          source: "clawhub" as const,
          spec: params.spec ?? `clawhub:${clawhubPackage}`,
          installPath: params.installPath ?? `/tmp/${pluginId}`,
          clawhubUrl: params.clawhubUrl ?? "https://clawhub.ai",
          clawhubPackage,
          clawhubFamily: params.clawhubFamily ?? "code-plugin",
          clawhubChannel: params.clawhubChannel ?? "official",
        },
      },
    },
  };
}

function createEnabledDemoClawHubInstallConfig(): CarapaceConfig {
  const installPath = createInstalledPackageDir({
    name: "demo",
    version: "1.2.3",
  });
  const config = createClawHubInstallConfig({ installPath });
  config.plugins = {
    ...config.plugins,
    entries: {
      demo: {
        enabled: true,
        config: { preserved: true },
      },
    },
    allow: ["demo"],
    slots: {
      memory: "demo",
    },
  };
  return config;
}

function createGitInstallConfig(params: {
  pluginId: string;
  spec: string;
  installPath: string;
  commit?: string;
}): CarapaceConfig {
  return {
    plugins: {
      installs: {
        [params.pluginId]: {
          source: "git" as const,
          spec: params.spec,
          installPath: params.installPath,
          ...(params.commit ? { gitCommit: params.commit } : {}),
        },
      },
    },
  };
}

function createBundledPathInstallConfig(params: {
  loadPaths: string[];
  installPath: string;
  sourcePath?: string;
  spec?: string;
}): CarapaceConfig {
  return {
    plugins: {
      load: { paths: params.loadPaths },
      installs: {
        feishu: {
          source: "path",
          sourcePath: params.sourcePath ?? appBundledPluginRoot("feishu"),
          installPath: params.installPath,
          ...(params.spec ? { spec: params.spec } : {}),
        },
      },
    },
  };
}

function createCodexAppServerInstallConfig(params: {
  spec: string;
  resolvedName?: string;
  resolvedSpec?: string;
}) {
  return {
    plugins: {
      installs: {
        "carapace-codex-app-server": {
          source: "npm" as const,
          spec: params.spec,
          installPath: "/tmp/carapace-codex-app-server",
          ...(params.resolvedName ? { resolvedName: params.resolvedName } : {}),
          ...(params.resolvedSpec ? { resolvedSpec: params.resolvedSpec } : {}),
        },
      },
    },
  };
}

function createInstalledPackageDir(params: {
  name?: string;
  version: string;
  peerDependencies?: Record<string, string>;
  runnable?: boolean;
  installPath?: string;
}): string {
  const dir =
    params.installPath ?? fs.mkdtempSync(path.join(os.tmpdir(), "carapace-plugin-update-test-"));
  if (params.installPath) {
    fs.mkdirSync(dir, { recursive: true });
  } else {
    tempDirs.push(dir);
  }
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: params.name ?? "test-plugin",
        version: params.version,
        ...(params.peerDependencies ? { peerDependencies: params.peerDependencies } : {}),
        ...(params.runnable ? { carapace: { extensions: ["./index.js"] } } : {}),
      },
      null,
      2,
    ),
  );
  if (params.runnable) {
    fs.writeFileSync(path.join(dir, "index.js"), "export default function register() {}\n");
  }
  return dir;
}

function createCapabilityConsentPackage(params: {
  pluginId: string;
  version: string;
  childProviders: string[];
}): string {
  const packageName = `@acme/${params.pluginId}`;
  const rootDir = createInstalledPackageDir({ name: packageName, version: params.version });
  const childDir = path.join(rootDir, "children", "addon");
  fs.mkdirSync(childDir, { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({
      name: packageName,
      version: params.version,
      carapace: { extensions: ["./index.js", "./children/addon/addon.js"] },
    }),
  );
  fs.writeFileSync(path.join(rootDir, "index.js"), "export default () => {};\n");
  fs.writeFileSync(path.join(childDir, "addon.js"), "export default () => {};\n");
  fs.writeFileSync(
    path.join(rootDir, "carapace.plugin.json"),
    JSON.stringify({
      id: params.pluginId,
      name: "Consent fixture",
      version: params.version,
      providers: ["root-provider"],
      configSchema: { type: "object" },
    }),
  );
  fs.writeFileSync(
    path.join(childDir, "carapace.plugin.json"),
    JSON.stringify({
      id: `${params.pluginId}-addon`,
      providers: params.childProviders,
      configSchema: { type: "object" },
    }),
  );
  return rootDir;
}

function createCarapacePeerLinkFixtures(plugins: Array<{ pluginId: string; packageName: string }>) {
  const stateDir = makeTrackedTempDir("carapace-plugin-update-owner", tempDirs);
  const peerTarget = fs.realpathSync(process.cwd());
  const installPaths = Object.fromEntries(
    plugins.map(({ pluginId, packageName }) => [
      pluginId,
      createInstalledPackageDir({
        name: packageName,
        version: "2026.5.4",
        peerDependencies: { carapace: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", pluginId),
      }),
    ]),
  );
  const peerLinkPath = (pluginId: string) =>
    path.join(
      expectDefined(installPaths[pluginId], "installPaths[pluginId] test invariant"),
      "node_modules",
      "carapace",
    );
  const linkPeer = (pluginId: string) => {
    fs.mkdirSync(path.dirname(peerLinkPath(pluginId)), { recursive: true });
    fs.symlinkSync(peerTarget, peerLinkPath(pluginId), "junction");
  };
  return { stateDir, installPaths, peerLinkPath, linkPeer };
}

function createPeerLinkInstallConfig(params: {
  plugins: Array<{ pluginId: string; packageName: string }>;
  installPaths: Record<string, string>;
  extraInstalls?: Record<string, PluginInstallRecord>;
}): CarapaceConfig {
  return {
    plugins: {
      installs: {
        ...params.extraInstalls,
        ...Object.fromEntries(
          params.plugins.map(({ pluginId, packageName }) => [
            pluginId,
            {
              source: "npm",
              spec: packageName,
              installPath: params.installPaths[pluginId],
              resolvedName: packageName,
              resolvedVersion: "2026.5.4",
              resolvedSpec: `${packageName}@2026.5.4`,
              integrity: "sha512-same",
              shasum: "same",
            },
          ]),
        ),
      },
    },
  };
}

function mockNpmViewMetadata(params: {
  name: string;
  version: string;
  integrity?: string;
  shasum?: string;
  carapace?: Record<string, unknown>;
}) {
  runCommandWithTimeoutMock.mockResolvedValueOnce({
    code: 0,
    stdout: JSON.stringify({
      name: params.name,
      version: params.version,
      ...(params.integrity ? { "dist.integrity": params.integrity } : {}),
      ...(params.shasum ? { "dist.shasum": params.shasum } : {}),
      ...(params.carapace ? { carapace: params.carapace } : {}),
    }),
    stderr: "",
  });
}

function createNpmUpdateFixture(params: {
  pluginId: string;
  packageName: string;
  installedVersion: string;
  registryVersion?: string;
  registryIntegrity?: string;
  registryShasum?: string;
  registryCarapace?: Record<string, unknown>;
  spec?: string;
  resolvedSpec?: string;
  integrity?: string;
  shasum?: string;
  installedAt?: string;
  resolvedAt?: string;
  installerVersion?: string;
  installerResolvedSpec?: string;
  peerDependencies?: Record<string, string>;
}) {
  const installPath = createInstalledPackageDir({
    name: params.packageName,
    version: params.installedVersion,
    ...(params.peerDependencies ? { peerDependencies: params.peerDependencies } : {}),
  });
  if (params.registryVersion) {
    mockNpmViewMetadata({
      name: params.packageName,
      version: params.registryVersion,
      ...(params.registryIntegrity ? { integrity: params.registryIntegrity } : {}),
      ...(params.registryShasum ? { shasum: params.registryShasum } : {}),
      ...(params.registryCarapace ? { carapace: params.registryCarapace } : {}),
    });
  }
  if (params.installerVersion) {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: params.pluginId,
        targetDir: installPath,
        version: params.installerVersion,
        ...(params.installerResolvedSpec
          ? {
              npmResolution: {
                name: params.packageName,
                version: params.installerVersion,
                resolvedSpec: params.installerResolvedSpec,
              },
            }
          : {}),
      }),
    );
  }
  return {
    installPath,
    config: createNpmInstallConfig({
      pluginId: params.pluginId,
      spec: params.spec ?? params.packageName,
      installPath,
      resolvedName: params.packageName,
      resolvedSpec: params.resolvedSpec ?? `${params.packageName}@${params.installedVersion}`,
      resolvedVersion: params.installedVersion,
      ...(params.integrity ? { integrity: params.integrity } : {}),
      ...(params.shasum ? { shasum: params.shasum } : {}),
      ...(params.installedAt ? { installedAt: params.installedAt } : {}),
      ...(params.resolvedAt ? { resolvedAt: params.resolvedAt } : {}),
    }),
  };
}

function npmInstallCall(index = 0): Record<string, unknown> | undefined {
  const calls = installPluginFromNpmSpecMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[index]?.[0];
}

function clawHubInstallCall(index = 0): Record<string, unknown> | undefined {
  const calls = installPluginFromClawHubMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[index]?.[0];
}

function marketplaceInstallCall(index = 0): Record<string, unknown> | undefined {
  const calls = installPluginFromMarketplaceMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[index]?.[0];
}

function gitInstallCall(index = 0): Record<string, unknown> | undefined {
  const calls = installPluginFromGitSpecMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[index]?.[0];
}

function npmViewCall(): [unknown, Record<string, unknown>] | undefined {
  const calls = runCommandWithTimeoutMock.mock.calls as unknown as Array<
    [unknown, Record<string, unknown>]
  >;
  return calls.find(([argv]) => Array.isArray(argv) && argv[0] === "npm" && argv[1] === "view");
}

function expectRecordFields(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual?.[key]).toEqual(value);
  }
}

function expectNpmUpdateCall(params: {
  spec: string;
  expectedIntegrity?: string;
  expectedPluginId?: string;
  timeoutMs?: number;
}) {
  const call = npmInstallCall();
  expect(call?.spec).toBe(params.spec);
  expect(call?.expectedIntegrity).toBe(params.expectedIntegrity);
  if (params.expectedPluginId) {
    expect(call?.expectedPluginId).toBe(params.expectedPluginId);
  }
  if (params.timeoutMs) {
    expect(call?.timeoutMs).toBe(params.timeoutMs);
  }
}

const QQBOT_EXPECTED_INTEGRITY =
  "sha512-yngu/2cPeZjJfIfHWCXWB2/6KlDHrb9vpOUjKLdQxePLSp6wCn3CFOALcBIVq/9o6jlYz9WTU9idW6nfX1xpFA==";

function createBundledSource(params?: { pluginId?: string; localPath?: string; npmSpec?: string }) {
  const pluginId = params?.pluginId ?? "feishu";
  return {
    pluginId,
    localPath: params?.localPath ?? appBundledPluginRoot(pluginId),
    npmSpec: params?.npmSpec ?? `@carapace/${pluginId}`,
  };
}

type ExternalizedPluginBridge = NonNullable<
  Parameters<typeof syncPluginsForUpdateChannel>[0]["externalizedBundledPluginBridges"]
>[number];
function createDisabledPluginConfig(install: PluginInstallRecord): CarapaceConfig {
  return {
    plugins: {
      entries: { demo: { enabled: false, config: { preserved: true } } },
      installs: { demo: install },
    },
  };
}

function createExternalizedPluginBridge(
  overrides: Partial<ExternalizedPluginBridge> = {},
): ExternalizedPluginBridge {
  return {
    bundledPluginId: "legacy-chat",
    npmSpec: "@carapace/legacy-chat",
    channelIds: ["legacy-chat"],
    ...overrides,
  };
}

function createExternalizedPluginConfig(params?: {
  pluginId?: string;
  channelEnabled?: boolean;
  entryEnabled?: boolean;
  includeLoad?: boolean;
  loadPaths?: string[];
  install?: PluginInstallRecord;
}): CarapaceConfig {
  const pluginId = params?.pluginId ?? "legacy-chat";
  const bundledRoot = appBundledPluginRoot(pluginId);
  return {
    ...(params?.channelEnabled === false ? {} : { channels: { [pluginId]: { enabled: true } } }),
    plugins: {
      ...(params?.entryEnabled === undefined
        ? {}
        : { entries: { [pluginId]: { enabled: params.entryEnabled } } }),
      ...(params?.includeLoad === false
        ? {}
        : { load: { paths: params?.loadPaths ?? [bundledRoot] } }),
      installs: {
        [pluginId]:
          params?.install ??
          ({ source: "path", sourcePath: bundledRoot, installPath: bundledRoot } as const),
      },
    },
  };
}

function syncExternalizedPlugin(params: {
  config?: CarapaceConfig;
  bridge?: Partial<ExternalizedPluginBridge>;
  channel?: "stable" | "beta" | "extended-stable";
  coreVersion?: string;
}) {
  return syncPluginsForUpdateChannel({
    channel: params.channel ?? "stable",
    ...(params.coreVersion ? { coreVersion: params.coreVersion } : {}),
    externalizedBundledPluginBridges: [createExternalizedPluginBridge(params.bridge)],
    config: params.config ?? createExternalizedPluginConfig(),
  });
}

function mockBundledSources(...sources: ReturnType<typeof createBundledSource>[]) {
  resolveBundledPluginSourcesMock.mockReturnValue(
    new Map(sources.map((source) => [source.pluginId, source])),
  );
}

function expectBundledPathInstall(params: {
  install: Record<string, unknown> | undefined;
  sourcePath: string;
  installPath: string;
  spec?: string;
}) {
  expect(params.install?.source).toBe("path");
  expect(params.install?.sourcePath).toBe(params.sourcePath);
  expect(params.install?.installPath).toBe(params.installPath);
  if (params.spec) {
    expect(params.install?.spec).toBe(params.spec);
  }
}

function expectCodexAppServerInstallState(params: {
  result: Awaited<ReturnType<typeof updateNpmInstalledPlugins>>;
  spec: string;
  version: string;
  resolvedSpec?: string;
}) {
  const install = params.result.config.plugins?.installs?.["carapace-codex-app-server"];
  expect(install?.source).toBe("npm");
  expect(install?.spec).toBe(params.spec);
  expect(install?.installPath).toBe("/tmp/carapace-codex-app-server");
  expect(install?.version).toBe(params.version);
  if (params.resolvedSpec) {
    expect(install?.resolvedSpec).toBe(params.resolvedSpec);
  }
}

type UpdateInstalledPluginParams = Parameters<typeof updateNpmInstalledPlugins>[0];

function updatePlugin(
  config: CarapaceConfig,
  pluginId: string,
  params: Omit<UpdateInstalledPluginParams, "config" | "pluginIds"> = {},
) {
  return updateNpmInstalledPlugins({ config, pluginIds: [pluginId], ...params });
}

function createDuplicateQqbotConfig(
  params: {
    canonicalFirst?: boolean;
    canonicalInstallPath?: string;
  } = {},
): CarapaceConfig {
  const qqbot = {
    source: "npm",
    spec: "@carapace/qqbot@1.9.0",
    resolvedName: "@carapace/qqbot",
    resolvedSpec: "@carapace/qqbot@1.9.0",
    installPath: "/tmp/carapace-qqbot-legacy",
  } satisfies PluginInstallRecord;
  const canonical = {
    source: "npm",
    spec: "@tencent-connect/carapace-qqbot@2.0.1",
    resolvedName: "@tencent-connect/carapace-qqbot",
    resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.1",
    installPath: params.canonicalInstallPath ?? "/tmp/carapace-qqbot-canonical",
  } satisfies PluginInstallRecord;
  return {
    plugins: {
      entries: { qqbot: { enabled: true } },
      installs: params.canonicalFirst
        ? { "carapace-qqbot": canonical, qqbot }
        : { qqbot, "carapace-qqbot": canonical },
    },
  };
}

describe("updateNpmInstalledPlugins", () => {
  let timeoutBudgetCase: {
    installCall: Record<string, unknown> | undefined;
    npmViewTimeoutMs: unknown;
  };

  beforeAll(async () => {
    installPluginFromNpmSpecMock.mockReset();
    installPluginFromMarketplaceMock.mockReset();
    installPluginFromClawHubMock.mockReset();
    installPluginFromGitSpecMock.mockReset();
    resolveBundledPluginSourcesMock.mockReset();
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    runCommandWithTimeoutMock.mockReset();
    validatePackageExtensionEntriesForInstallMock.mockReset();
    markClawPackageIndependentlyOwnedMock.mockReset();
    withClawPackageLifecycleLeaseMock
      .mockReset()
      .mockImplementation(
        async (_artifact: unknown, operation: () => Promise<unknown>) => await operation(),
      );
    const { config } = createNpmUpdateFixture({
      pluginId: "lossless-claw",
      packageName: "@martian-engineering/lossless-claw",
      installedVersion: "0.9.0",
      registryVersion: "0.10.0",
      registryIntegrity: "sha512-next",
      installerVersion: "0.10.0",
    });
    await updatePlugin(config, "lossless-claw", { timeoutMs: 1_800_000 });

    timeoutBudgetCase = {
      installCall: npmInstallCall(),
      npmViewTimeoutMs: npmViewCall()?.[1]?.timeoutMs,
    };
  });

  beforeEach(() => {
    installPluginFromNpmSpecMock.mockReset();
    installPluginFromMarketplaceMock.mockReset();
    installPluginFromClawHubMock.mockReset();
    installPluginFromGitSpecMock.mockReset();
    resolveBundledPluginSourcesMock.mockReset();
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    runCommandWithTimeoutMock.mockReset();
    validatePackageExtensionEntriesForInstallMock.mockReset();
  });

  it.each<{
    label: string;
    nextProviders: string[];
    review: string;
    priorAcceptance: string;
    rejected: boolean;
    ownerEnabled: boolean;
    childEnabled: boolean;
    previousPayload?: string;
    disableOnFailure?: boolean;
    omitStageReview?: boolean;
    reviewRetryStage?: boolean;
  }>([
    {
      label: "rejects widened sibling capabilities before replacing the installed artifact",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review: "none",
      priorAcceptance: "valid",
      rejected: true,
      ownerEnabled: false,
      childEnabled: true,
    },
    {
      label: "accepts widened sibling capabilities and refreshes the artifact-bound acceptance",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review: "accept",
      priorAcceptance: "valid",
      rejected: false,
      ownerEnabled: true,
      childEnabled: false,
    },
    {
      label: "silently refreshes existing acceptance when package capabilities are unchanged",
      nextProviders: ["existing-child-provider"],
      review: "none",
      priorAcceptance: "valid",
      rejected: false,
      ownerEnabled: true,
      childEnabled: false,
    },
    {
      label: "asks for consent when an enabled legacy record lacks artifact acceptance",
      nextProviders: ["existing-child-provider"],
      review: "accept",
      priorAcceptance: "missing",
      rejected: false,
      ownerEnabled: true,
      childEnabled: false,
    },
    {
      label: "defers missing artifact acceptance for a disabled legacy record",
      nextProviders: ["existing-child-provider"],
      review: "none",
      priorAcceptance: "missing",
      rejected: false,
      ownerEnabled: false,
      childEnabled: false,
    },
    {
      label: "rejects an unchanged replacement when prior acceptance has no artifact integrity",
      nextProviders: ["existing-child-provider"],
      review: "none",
      priorAcceptance: "unanchored",
      rejected: true,
      ownerEnabled: true,
      childEnabled: false,
    },
    {
      label: "accepts an unchanged unanchored replacement only after reviewing its token",
      nextProviders: ["existing-child-provider"],
      review: "accept",
      priorAcceptance: "unanchored",
      rejected: false,
      ownerEnabled: true,
      childEnabled: false,
    },
    {
      label: "rejects staged capabilities changed while the operator reviews the artifact",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review: "mutate",
      priorAcceptance: "valid",
      rejected: true,
      ownerEnabled: true,
      childEnabled: false,
    },
    {
      label: "preserves the previous enabled artifact when automatic update needs consent",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review: "none",
      priorAcceptance: "valid",
      rejected: true,
      ownerEnabled: true,
      childEnabled: false,
      disableOnFailure: true,
    },
    ...(["missing", "corrupt"] as const).map((previousPayload) => ({
      label: `repairs a ${previousPayload} previous payload only after fresh staged consent`,
      nextProviders: ["existing-child-provider"],
      review: "accept",
      priorAcceptance: "valid",
      rejected: false,
      ownerEnabled: true,
      childEnabled: false,
      previousPayload,
    })),
    {
      label: "keeps a missing-payload repair pending when no consent handler is available",
      nextProviders: ["existing-child-provider"],
      review: "none",
      priorAcceptance: "valid",
      rejected: true,
      ownerEnabled: true,
      childEnabled: false,
      previousPayload: "missing",
      disableOnFailure: true,
    },
    {
      label: "repairs a disabled missing payload without retaining unverifiable acceptance",
      nextProviders: ["existing-child-provider"],
      review: "none",
      priorAcceptance: "valid",
      rejected: false,
      ownerEnabled: false,
      childEnabled: false,
      previousPayload: "missing",
    },
    {
      label: "rejects a missing-payload replacement that omitted staged artifact review",
      nextProviders: ["existing-child-provider"],
      review: "none",
      priorAcceptance: "valid",
      rejected: false,
      ownerEnabled: true,
      childEnabled: false,
      previousPayload: "missing",
      omitStageReview: true,
    },
    {
      label: "does not carry acceptance from an earlier stage into a widened disabled retry",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review: "none",
      priorAcceptance: "valid",
      rejected: false,
      ownerEnabled: false,
      childEnabled: false,
      reviewRetryStage: true,
    },
    ...(["throw", "throw-undefined"] as const).map((review) => ({
      label: `preserves the original consent callback failure (${review})`,
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review,
      priorAcceptance: "valid",
      rejected: false,
      ownerEnabled: true,
      childEnabled: false,
      disableOnFailure: true,
    })),
  ])(
    "$label",
    async ({
      nextProviders,
      review,
      priorAcceptance,
      rejected,
      ownerEnabled,
      childEnabled,
      previousPayload,
      disableOnFailure = false,
      omitStageReview = false,
      reviewRetryStage = false,
    }) => {
      capabilityConsentMode.real = true;
      const pluginId = "consent-fixture";
      const rootPluginId = `${pluginId}/index`;
      const packageName = `@acme/${pluginId}`;
      const installedDir = createCapabilityConsentPackage({
        pluginId,
        version: "1.0.0",
        childProviders: ["existing-child-provider"],
      });
      const stagedDir = createCapabilityConsentPackage({
        pluginId,
        version: "2.0.0",
        childProviders: nextProviders,
      });
      const load = { paths: [path.join(installedDir, "children", "addon", "addon.js")] };
      const previousDeclared = resolvePluginArtifactDeclaredSurface(installedDir, process.env, {
        config: { plugins: { load } },
      });
      const previousAcceptedAt = "2026-01-01T00:00:00.000Z";
      const childManifestPath = path.join(
        installedDir,
        "children",
        "addon",
        "carapace.plugin.json",
      );
      const previousChildManifest = fs.readFileSync(childManifestPath, "utf8");
      const config = {
        plugins: {
          load,
          entries: {
            [rootPluginId]: { enabled: ownerEnabled },
            [`${pluginId}-addon`]: { enabled: childEnabled },
          },
          installs: {
            [pluginId]: {
              source: "npm" as const,
              spec: packageName,
              installPath: installedDir,
              ...(priorAcceptance !== "unanchored" ? { integrity: "sha512-previous" } : {}),
              ...(priorAcceptance !== "missing"
                ? {
                    acceptedSurface: previousDeclared,
                    acceptedSurfaceHash: computeDeclaredSurfaceHash(previousDeclared),
                    acceptedSurfaceAt: previousAcceptedAt,
                    ...(priorAcceptance !== "unanchored"
                      ? { acceptedSurfaceIntegrity: "sha512-previous" }
                      : {}),
                  }
                : {}),
            },
          },
        },
      } satisfies CarapaceConfig;
      if (previousPayload === "missing") {
        fs.rmSync(installedDir, { recursive: true, force: true });
      } else if (previousPayload === "corrupt") {
        fs.writeFileSync(path.join(installedDir, "carapace.plugin.json"), "{");
      }
      mockNpmViewMetadata({ name: packageName, version: "2.0.0", integrity: "sha512-next" });
      installPluginFromNpmSpecMock.mockImplementationOnce(
        async (options: {
          onBeforePluginArtifactCommit?: (request: {
            pluginId: string;
            currentArtifactDir: string;
            stagedArtifactDir: string;
            mode: "update";
          }) => Promise<void>;
        }) => {
          if (reviewRetryStage) {
            await options.onBeforePluginArtifactCommit?.({
              pluginId,
              currentArtifactDir: installedDir,
              stagedArtifactDir: createCapabilityConsentPackage({
                pluginId,
                version: "1.0.0",
                childProviders: ["existing-child-provider"],
              }),
              mode: "update",
            });
          }
          if (!omitStageReview) {
            await options.onBeforePluginArtifactCommit?.({
              pluginId,
              currentArtifactDir: installedDir,
              stagedArtifactDir: stagedDir,
              mode: "update",
            });
          }
          fs.cpSync(stagedDir, installedDir, { recursive: true });
          return {
            ok: true,
            pluginId,
            targetDir: installedDir,
            version: "2.0.0",
            extensions: ["index.js"],
            npmResolution: {
              name: packageName,
              version: "2.0.0",
              resolvedSpec: `${packageName}@2.0.0`,
              integrity: "sha512-next",
            },
          };
        },
      );

      const callbackFailure =
        review === "throw-undefined" ? undefined : new Error("consent guard cancelled");
      const beforePersistentEffect = vi.fn();
      let reviewed = false;
      const onCapabilityConsent: UpdateInstalledPluginParams["onCapabilityConsent"] =
        review === "none"
          ? undefined
          : async (details) => {
              expect(beforePersistentEffect).not.toHaveBeenCalled();
              reviewed = true;
              if (review === "throw" || review === "throw-undefined") {
                // oxlint-disable-next-line typescript/only-throw-error -- JavaScript callbacks may throw undefined; preserve that exact failure.
                throw callbackFailure;
              }
              expect(details.reviewToken).toBe(computeDeclaredSurfaceHash(details.declared));
              expect(details.source?.integrity).not.toBe("sha512-previous");
              if (review === "mutate") {
                fs.writeFileSync(
                  path.join(stagedDir, "children", "addon", "carapace.plugin.json"),
                  JSON.stringify({
                    id: `${pluginId}-addon`,
                    providers: [...nextProviders, "changed-during-review"],
                    configSchema: { type: "object" },
                  }),
                );
              }
              return { reviewToken: details.reviewToken };
            };
      const pendingUpdate = updatePlugin(config, pluginId, {
        onCapabilityConsent,
        beforePersistentEffect,
        disableOnFailure,
        packagePluginIds: { [pluginId]: [rootPluginId, `${pluginId}-addon`] },
      });
      if (omitStageReview) {
        await expect(pendingUpdate).rejects.toThrow("did not expose its verified artifact");
        return;
      }
      if (review === "throw" || review === "throw-undefined") {
        await expect(pendingUpdate).rejects.toBe(callbackFailure);
        expect(fs.readFileSync(childManifestPath, "utf8")).toBe(previousChildManifest);
        expect(config.plugins.entries[rootPluginId].enabled).toBe(ownerEnabled);
        return;
      }
      const result = await pendingUpdate;
      expect(reviewed).toBe(review !== "none");

      if (rejected) {
        expect(result.changed).toBe(false);
        expect(result.outcomes).toEqual([
          expect.objectContaining({
            pluginId,
            status: "error",
            message: expect.stringContaining("--accept-capabilities"),
            code: "PLUGIN_CAPABILITY_CONSENT_REQUIRED",
          }),
        ]);
        if (previousPayload === "missing") {
          expect(fs.existsSync(installedDir)).toBe(false);
        } else {
          expect(fs.readFileSync(childManifestPath, "utf8")).toBe(previousChildManifest);
        }
        expect(result.config).toBe(config);
        expect(result.config.plugins?.installs?.[pluginId]).toBe(config.plugins.installs[pluginId]);
        return;
      }

      const install = result.config.plugins?.installs?.[pluginId];
      expect(beforePersistentEffect).toHaveBeenCalledTimes(reviewRetryStage ? 2 : 1);
      expect(result.outcomes).toEqual([expect.objectContaining({ pluginId, status: "updated" })]);
      if (!ownerEnabled && !childEnabled) {
        expect(result.config.plugins?.entries).toEqual(config.plugins.entries);
        expect(install?.acceptedSurface).toBeUndefined();
        expect(install?.acceptedSurfaceHash).toBeUndefined();
        expect(install?.acceptedSurfaceAt).toBeUndefined();
        expect(install?.acceptedSurfaceIntegrity).toBeUndefined();
        return;
      }
      expect(install?.acceptedSurface?.providers).toEqual(
        ["root-provider", ...nextProviders].toSorted(),
      );
      expect(install?.acceptedSurfaceHash).toBe(
        computeDeclaredSurfaceHash(
          resolvePluginArtifactDeclaredSurface(installedDir, process.env, {
            config: result.config,
          }),
        ),
      );
      expect(install?.acceptedSurfaceAt).not.toBe(previousAcceptedAt);
      expect(install?.acceptedSurfaceIntegrity).toBe("sha512-next");
    },
  );

  it("moves only the replaced npm plugin's exact explicit load path", async () => {
    const previousInstallPath = createInstalledPackageDir({
      name: "@acme/demo",
      version: "1.0.0",
    });
    const nextInstallPath = createInstalledPackageDir({
      name: "@acme/demo",
      version: "2.0.0",
    });
    const adjacentInstallPath = createInstalledPackageDir({
      name: "@acme/adjacent",
      version: "1.0.0",
    });
    const customPath = path.join(previousInstallPath, "custom-child");
    mockNpmViewMetadata({ name: "@acme/demo", version: "2.0.0" });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "demo",
        targetDir: nextInstallPath,
        version: "2.0.0",
        npmResolution: {
          name: "@acme/demo",
          version: "2.0.0",
          resolvedSpec: "@acme/demo@2.0.0",
        },
      }),
    );
    const adjacentRecord = {
      source: "npm" as const,
      spec: "@acme/adjacent@1.0.0",
      installPath: adjacentInstallPath,
    };

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          load: {
            paths: [customPath, previousInstallPath, adjacentInstallPath],
          },
          installs: {
            demo: {
              source: "npm",
              spec: "@acme/demo@1.0.0",
              installPath: previousInstallPath,
              resolvedName: "@acme/demo",
              resolvedSpec: "@acme/demo@1.0.0",
              resolvedVersion: "1.0.0",
            },
            adjacent: adjacentRecord,
          },
        },
      },
      pluginIds: ["demo"],
    });

    expect(result.changed).toBe(true);
    expect(result.config.plugins?.load?.paths).toEqual([
      customPath,
      nextInstallPath,
      adjacentInstallPath,
    ]);
    expect(result.config.plugins?.installs?.adjacent).toEqual(adjacentRecord);
  });

  it("preserves explicit load paths when the npm replacement fails", async () => {
    const previousInstallPath = createInstalledPackageDir({
      name: "@acme/demo",
      version: "1.0.0",
    });
    const customPath = "/tmp/custom-demo";
    mockNpmViewMetadata({ name: "@acme/demo", version: "2.0.0" });
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "npm install failed",
    });
    const config = {
      plugins: {
        load: { paths: [previousInstallPath, customPath] },
        installs: {
          demo: {
            source: "npm" as const,
            spec: "@acme/demo@1.0.0",
            installPath: previousInstallPath,
            resolvedName: "@acme/demo",
            resolvedSpec: "@acme/demo@1.0.0",
            resolvedVersion: "1.0.0",
          },
        },
      },
    } satisfies CarapaceConfig;

    const result = await updateNpmInstalledPlugins({ config, pluginIds: ["demo"] });

    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.config.plugins?.load?.paths).toEqual([previousInstallPath, customPath]);
  });

  afterEach(() => {
    capabilityConsentMode.real = false;
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat inherited prototype names as install records", async () => {
    const config: CarapaceConfig = { plugins: { installs: {} } };

    const result = await updatePlugin(config, "constructor");

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "constructor",
        status: "skipped",
        message: 'No install record for "constructor".',
      },
    ]);
  });

  it.each([
    {
      name: "skips integrity drift checks for unpinned npm specs during dry-run updates",
      config: createNpmInstallConfig({
        pluginId: "opik-carapace",
        spec: "@opik/opik-carapace",
        integrity: "sha512-old",
        installPath: "/tmp/opik-carapace",
      }),
      pluginIds: ["opik-carapace"],
      dryRun: true,
      expectedCall: {
        spec: "@opik/opik-carapace",
        expectedIntegrity: undefined,
      },
    },
    {
      name: "keeps integrity drift checks for exact-version npm specs during dry-run updates",
      config: createNpmInstallConfig({
        pluginId: "opik-carapace",
        spec: "@opik/opik-carapace@0.2.5",
        integrity: "sha512-old",
        installPath: "/tmp/opik-carapace",
      }),
      pluginIds: ["opik-carapace"],
      dryRun: true,
      expectedCall: {
        spec: "@opik/opik-carapace@0.2.5",
        expectedIntegrity: "sha512-old",
      },
    },
    {
      name: "skips recorded integrity checks when an explicit npm version override changes the spec",
      config: createNpmInstallConfig({
        pluginId: "carapace-codex-app-server",
        spec: "carapace-codex-app-server@0.2.0-beta.3",
        integrity: "sha512-old",
        installPath: "/tmp/carapace-codex-app-server",
      }),
      pluginIds: ["carapace-codex-app-server"],
      specOverrides: {
        "carapace-codex-app-server": "carapace-codex-app-server@0.2.0-beta.4",
      },
      installerResult: createSuccessfulNpmUpdateResult({
        pluginId: "carapace-codex-app-server",
        targetDir: "/tmp/carapace-codex-app-server",
        version: "0.2.0-beta.4",
      }),
      expectedCall: {
        spec: "carapace-codex-app-server@0.2.0-beta.4",
        expectedIntegrity: undefined,
      },
    },
  ] as const)(
    "$name",
    async ({ config, pluginIds, dryRun, specOverrides, installerResult, expectedCall }) => {
      installPluginFromNpmSpecMock.mockResolvedValue(
        installerResult ?? createSuccessfulNpmUpdateResult(),
      );

      await updateNpmInstalledPlugins({
        config,
        pluginIds: [...pluginIds],
        ...(dryRun ? { dryRun: true } : {}),
        ...(specOverrides ? { specOverrides } : {}),
      });

      expectNpmUpdateCall(expectedCall);
    },
  );

  it("passes timeout budget to npm plugin metadata checks and installs", async () => {
    expect(timeoutBudgetCase.npmViewTimeoutMs).toBe(1_800_000);
    expectRecordFields(timeoutBudgetCase.installCall, {
      spec: "@martian-engineering/lossless-claw",
      expectedPluginId: "lossless-claw",
      timeoutMs: 1_800_000,
    });
  });

  it("trusts official catalog npm updates when the installed package matches the catalog", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@carapace/acpx",
      installedVersion: "2026.5.2-beta.1",
      registryVersion: "2026.5.2-beta.2",
      installerVersion: "2026.5.2-beta.2",
      installerResolvedSpec: "@carapace/acpx@2026.5.2-beta.2",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce(failedNpmVersionQueryResult);

    const result = await updatePlugin(config, "acpx", { syncOfficialPluginInstalls: true });

    expect(npmInstallCall()?.spec).toBe("@carapace/acpx");
    expect(npmInstallCall()?.expectedPluginId).toBe("acpx");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.config.plugins?.installs?.acpx?.spec).toBe("@carapace/acpx");
  });

  it.each([
    {
      name: "inferred beta",
      channel: "beta" as const,
      configuredChannel: undefined,
      registryVersion: "2026.5.3-beta.1",
      expectedSpec: "@carapace/codex@2026.5.3-beta.1",
    },
    {
      name: "inferred stable",
      channel: "stable" as const,
      configuredChannel: undefined,
      registryVersion: "2026.5.3",
      expectedSpec: "@carapace/codex",
    },
    {
      name: "configured stable over inferred beta",
      channel: "beta" as const,
      configuredChannel: "stable" as const,
      registryVersion: "2026.5.3",
      expectedSpec: "@carapace/codex",
    },
  ])(
    "uses the $name channel for a targeted floating official npm update",
    async ({ channel, configuredChannel, registryVersion, expectedSpec }) => {
      const { config } = createNpmUpdateFixture({
        pluginId: "codex",
        packageName: "@carapace/codex",
        installedVersion: "2026.5.2",
        registryVersion,
        installerVersion: registryVersion,
        installerResolvedSpec: `@carapace/codex@${registryVersion}`,
      });
      if (channel === "beta" && !configuredChannel) {
        mockNpmViewMetadata({ name: "@carapace/codex", version: "2026.5.2" });
      }

      const result = await updatePlugin(config, "codex", {
        officialPluginUpdateChannel: channel,
        ...(configuredChannel ? { updateChannel: configuredChannel } : {}),
      });

      expect(npmInstallCall()?.spec).toBe(expectedSpec);
      expect(result.config.plugins?.installs?.codex?.spec).toBe("@carapace/codex");
      expect(result.config.plugins?.installs?.codex?.resolvedSpec).toBe(
        `@carapace/codex@${registryVersion}`,
      );
    },
  );

  it.each([undefined, "2026.8.1-beta.3"])(
    "selects latest before installing a targeted official update with a stale beta tag (core=%s)",
    async (coreVersion) => {
      mockNpmViewMetadata({ name: "@carapace/codex", version: "2026.9.1-beta.1" });
      mockNpmViewMetadata({ name: "@carapace/codex", version: "2026.9.2" });
      installPluginFromNpmSpecMock.mockResolvedValue(
        createSuccessfulNpmUpdateResult({
          pluginId: "codex",
          targetDir: "/tmp/codex",
          version: "2026.9.2",
          npmResolution: {
            name: "@carapace/codex",
            version: "2026.9.2",
            resolvedSpec: "@carapace/codex@2026.9.2",
          },
        }),
      );
      const config = createNpmInstallConfig({
        pluginId: "codex",
        spec: "@carapace/codex",
        installPath: "/tmp/codex",
        resolvedName: "@carapace/codex",
      });

      const result = await updatePlugin(config, "codex", {
        officialPluginUpdateChannel: "beta",
        coreVersion,
      });

      expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
      expect(npmInstallCall()?.spec).toBe("@carapace/codex@2026.9.2");
      expect(result.config.plugins?.installs?.codex?.spec).toBe("@carapace/codex");
      expect(result.config.plugins?.installs?.codex?.resolvedSpec).toBe("@carapace/codex@2026.9.2");
    },
  );

  it.each(["@carapace/codex", "@carapace/codex@latest", "@carapace/codex@2026.9.3"])(
    "targets the activated core for version-bound post-update plugins while preserving %s",
    async (spec) => {
      const targetVersion = spec.endsWith("@2026.9.3") ? "2026.9.3" : "2026.9.4";
      const { config } = createNpmUpdateFixture({
        pluginId: "codex",
        packageName: "@carapace/codex",
        installedVersion: "2026.9.2",
        spec,
        installerVersion: targetVersion,
        installerResolvedSpec: `@carapace/codex@${targetVersion}`,
      });
      runCommandWithTimeoutMock.mockImplementation(async (argv) => ({
        code: 0,
        stdout: JSON.stringify({
          name: "@carapace/codex",
          version: argv.includes(`@carapace/codex@${targetVersion}`) ? targetVersion : "2026.9.2",
        }),
        stderr: "",
      }));
      await updatePlugin(config, "codex", {
        updateChannel: "stable",
        coreVersion: "2026.9.4",
        versionBoundPluginIds: new Set(["codex"]),
        syncOfficialPluginInstalls: true,
      });
      expect(npmInstallCall()?.spec).toBe(`@carapace/codex@${targetVersion}`);
    },
  );

  it("preserves floating official npm records during official sync", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@carapace/acpx",
      installedVersion: "2026.5.2",
      registryVersion: "2026.5.2",
      registryIntegrity: "sha512-old",
      integrity: "sha512-old",
      installedAt: "2026-05-01T00:00:00.000Z",
      resolvedAt: "2026-05-01T00:00:01.000Z",
    });
    const result = await updatePlugin(config, "acpx", { syncOfficialPluginInstalls: true });

    expect(result.changed).toBe(false);
    expect(result.outcomes[0]?.status).toBe("unchanged");
    expect(result.config.plugins?.installs?.acpx?.spec).toBe("@carapace/acpx");
    expect(result.config.plugins?.installs?.acpx?.installedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(result.config.plugins?.installs?.acpx?.resolvedAt).toBe("2026-05-01T00:00:01.000Z");
    expect(npmInstallCall()).toBeUndefined();
  });

  it.each(["@carapace/codex", "@carapace/codex@beta"])(
    "converges after one beta-channel update when latest is newer and preserves %s",
    async (spec) => {
      const packageName = "@carapace/codex";
      const { config, installPath } = createNpmUpdateFixture({
        pluginId: "codex",
        packageName,
        spec,
        installedVersion: "2026.9.1-beta.1",
      });
      installPluginFromNpmSpecMock.mockImplementation(async () => {
        createInstalledPackageDir({
          name: packageName,
          version: "2026.9.2",
          installPath,
        });
        return createSuccessfulNpmUpdateResult({
          pluginId: "codex",
          targetDir: installPath,
          version: "2026.9.2",
          npmResolution: {
            name: packageName,
            version: "2026.9.2",
            resolvedSpec: `${packageName}@2026.9.2`,
          },
        });
      });
      const updateOptions = {
        updateChannel: "beta" as const,
        syncOfficialPluginInstalls: true,
        coreVersion: "2026.9.2",
      };
      mockNpmViewMetadata({ name: packageName, version: "2026.9.1-beta.1" });
      mockNpmViewMetadata({ name: packageName, version: "2026.9.2" });

      const updated = await updatePlugin(config, "codex", updateOptions);

      expect(updated.outcomes[0]?.status).toBe("updated");
      expect(npmInstallCall()?.spec).toBe(`${packageName}@2026.9.2`);
      expect(updated.config.plugins?.installs?.codex?.spec).toBe(spec);
      mockNpmViewMetadata({ name: packageName, version: "2026.9.1-beta.1" });
      mockNpmViewMetadata({ name: packageName, version: "2026.9.2" });

      const repeated = await updatePlugin(updated.config, "codex", updateOptions);

      expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
      expect(repeated.changed).toBe(false);
      expect(repeated.config).toBe(updated.config);
      expect(repeated.outcomes[0]).toMatchObject({
        status: "unchanged",
        currentVersion: "2026.9.2",
        nextVersion: "2026.9.2",
      });
    },
  );

  it.each(["stable", "beta", "extended-stable"] as const)(
    "preserves official exact pins and integrity during %s bulk sync",
    async (channel) => {
      const { config } = createNpmUpdateFixture({
        pluginId: "acpx",
        packageName: "@carapace/acpx",
        installedVersion: "2026.5.2",
        registryVersion: "2026.5.2",
        registryIntegrity: "sha512-new",
        spec: "@carapace/acpx@2026.5.2",
        integrity: "sha512-old",
        installerVersion: "2026.5.2",
        installerResolvedSpec: "@carapace/acpx@2026.5.2",
      });
      await updatePlugin(config, "acpx", {
        syncOfficialPluginInstalls: true,
        updateChannel: channel,
        coreVersion: "2026.7.33",
      });
      expectNpmUpdateCall({
        spec: "@carapace/acpx@2026.5.2",
        expectedPluginId: "acpx",
        expectedIntegrity: "sha512-old",
      });
      expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    },
  );

  it("keeps third-party moving npm specs when their updates resolve exact artifacts", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "lossless-claw",
      packageName: "@martian-engineering/lossless-claw",
      installedVersion: "0.9.0",
      registryVersion: "0.9.1",
      installerVersion: "0.9.1",
      installerResolvedSpec: "@martian-engineering/lossless-claw@0.9.1",
    });
    const result = await updatePlugin(config, "lossless-claw");

    expect(result.config.plugins?.installs?.["lossless-claw"]?.spec).toBe(
      "@martian-engineering/lossless-claw",
    );
    expect(result.config.plugins?.installs?.["lossless-claw"]?.resolvedSpec).toBe(
      "@martian-engineering/lossless-claw@0.9.1",
    );
  });

  it("does not apply a targeted official beta channel to third-party npm specs", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "lossless-claw",
      packageName: "@martian-engineering/lossless-claw",
      installedVersion: "0.9.0",
      registryVersion: "0.9.1",
      installerVersion: "0.9.1",
      installerResolvedSpec: "@martian-engineering/lossless-claw@0.9.1",
    });
    await updatePlugin(config, "lossless-claw", {
      officialPluginUpdateChannel: "beta",
    });

    expect(npmInstallCall()?.spec).toBe("@martian-engineering/lossless-claw");
  });

  it("does not skip trusted official default updates when latest resolves to the installed prerelease", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@carapace/acpx",
      installedVersion: "2026.5.2-beta.2",
      registryVersion: "2026.5.2-beta.2",
      registryIntegrity: "sha512-beta",
      registryShasum: "beta",
      spec: "@carapace/acpx",
      integrity: "sha512-beta",
      shasum: "beta",
      installerVersion: "2026.5.2",
      installerResolvedSpec: "@carapace/acpx@2026.5.2",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce(failedNpmVersionQueryResult);
    const result = await updatePlugin(config, "acpx", { syncOfficialPluginInstalls: true });

    expect(npmInstallCall()?.spec).toBe("@carapace/acpx");
    expect(npmInstallCall()?.expectedIntegrity).toBeUndefined();
    expect(npmInstallCall()?.expectedPluginId).toBe("acpx");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.outcomes[0]?.pluginId).toBe("acpx");
    expect(result.outcomes[0]?.status).toBe("updated");
    expect(result.outcomes[0]?.currentVersion).toBe("2026.5.2-beta.2");
    expect(result.outcomes[0]?.nextVersion).toBe("2026.5.2");
  });

  it("updates trusted official npm plugins when latest resolves to a stable correction release", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@carapace/acpx",
      installedVersion: "2026.5.3",
      registryVersion: "2026.5.3-1",
      registryIntegrity: "sha512-correction",
      registryShasum: "correction",
      installerVersion: "2026.5.3-1",
      installerResolvedSpec: "@carapace/acpx@2026.5.3-1",
    });
    const result = await updatePlugin(config, "acpx");

    expect(npmInstallCall()?.spec).toBe("@carapace/acpx");
    expect(npmInstallCall()?.expectedPluginId).toBe("acpx");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.outcomes[0]?.pluginId).toBe("acpx");
    expect(result.outcomes[0]?.status).toBe("updated");
    expect(result.outcomes[0]?.currentVersion).toBe("2026.5.3");
    expect(result.outcomes[0]?.nextVersion).toBe("2026.5.3-1");
  });

  it("does not trust official npm updates when the install record package mismatches", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@vendor/acpx-fork",
      installedVersion: "1.0.0",
      registryVersion: "1.0.1",
      installerVersion: "1.0.1",
    });
    await updatePlugin(config, "acpx");

    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).not.toBe(true);
  });

  it("skips npm reinstall and config rewrite when the installed artifact is unchanged", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "lossless-claw",
      packageName: "@martian-engineering/lossless-claw",
      installedVersion: "0.9.0",
      registryVersion: "0.9.0",
      registryIntegrity: "sha512-same",
      registryShasum: "same",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

    const result = await updatePlugin(config, "lossless-claw");

    expect(npmViewCall()?.[0]).toEqual([
      "npm",
      "view",
      "@martian-engineering/lossless-claw",
      "name",
      "version",
      "dist.integrity",
      "dist.shasum",
      "carapace",
      "--json",
    ]);
    if (npmViewCall()?.[1] === undefined) {
      throw new Error("Expected npm view command options");
    }
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "lossless-claw",
        status: "unchanged",
        currentVersion: "0.9.0",
        nextVersion: "0.9.0",
        message: "lossless-claw is up to date (0.9.0).",
      },
    ]);
  });

  it.each(
    [
      {
        name: "latest",
        updateChannel: undefined,
        registryVersion: "1.2.4",
      },
      {
        name: "beta",
        updateChannel: "beta" as const,
        registryVersion: "1.3.0-beta.1",
      },
    ].flatMap((release) => [
      {
        ...release,
        pluginId: "demo",
        packageName: "@acme/demo",
        syncOfficialPluginInstalls: false,
      },
      {
        ...release,
        pluginId: "acpx",
        packageName: "@carapace/acpx",
        syncOfficialPluginInstalls: true,
      },
    ]),
  )(
    "reports newer $name releases for exact-pinned $pluginId records (official sync=$syncOfficialPluginInstalls)",
    async ({
      updateChannel,
      registryVersion,
      pluginId,
      packageName,
      syncOfficialPluginInstalls,
    }) => {
      const registrySpec = updateChannel === "beta" ? `${packageName}@beta` : packageName;
      const overrideSpec = `${packageName}@${updateChannel === "beta" ? "beta" : "latest"}`;
      const { config } = createNpmUpdateFixture({
        pluginId,
        packageName,
        installedVersion: "1.2.3",
        registryVersion: "1.2.3",
        registryIntegrity: "sha512-same",
        registryShasum: "same",
        spec: `${packageName}@1.2.3`,
        integrity: "sha512-same",
        shasum: "same",
        installedAt: "2026-07-01T00:00:00.000Z",
        resolvedAt: "2026-07-01T00:00:01.000Z",
      });
      mockNpmViewMetadata({
        name: packageName,
        version: registryVersion,
      });
      if (updateChannel === "beta") {
        mockNpmViewMetadata({ name: packageName, version: "1.2.4" });
      }
      installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

      const result = await updatePlugin(config, pluginId, {
        updateChannel,
        syncOfficialPluginInstalls,
      });

      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expect(runCommandWithTimeoutMock.mock.calls).toHaveLength(updateChannel === "beta" ? 3 : 2);
      expect(runCommandWithTimeoutMock.mock.calls[1]?.[0]).toEqual([
        "npm",
        "view",
        registrySpec,
        "name",
        "version",
        "dist.integrity",
        "dist.shasum",
        "carapace",
        "--json",
      ]);
      expect(result.changed).toBe(false);
      expect(result.config).toBe(config);
      expect(result.outcomes).toEqual([
        {
          pluginId,
          status: "unchanged",
          currentVersion: "1.2.3",
          nextVersion: registryVersion,
          message:
            `${pluginId} is pinned to ${packageName}@1.2.3 (installed 1.2.3); ` +
            `registry ${updateChannel === "beta" ? "beta" : "latest"} resolves to ${registryVersion}. ` +
            `Pass \`carapace plugins update ${overrideSpec}\` to replace this version pin.`,
        },
      ]);
    },
  );

  it.each([
    {
      updateChannel: "extended-stable" as const,
      coreVersion: "2026.7.33",
      newerVersion: "2026.7.34",
      dryRun: false,
    },
    {
      updateChannel: "extended-stable" as const,
      coreVersion: "2026.7.33",
      newerVersion: "2026.7.34",
      dryRun: true,
    },
  ])(
    "reports core-aligned floating $updateChannel updates as current (dryRun=$dryRun)",
    async ({ updateChannel, coreVersion, newerVersion, dryRun }) => {
      const { config } = createNpmUpdateFixture({
        pluginId: "acpx",
        packageName: "@carapace/acpx",
        installedVersion: coreVersion,
        registryVersion: dryRun ? newerVersion : coreVersion,
        registryIntegrity: "sha512-same",
        registryShasum: "same",
        integrity: "sha512-same",
        shasum: "same",
        installerVersion: coreVersion,
        installerResolvedSpec: `@carapace/acpx@${coreVersion}`,
      });
      if (!dryRun) {
        mockNpmViewMetadata({ name: "@carapace/acpx", version: newerVersion });
      }

      const result = await updatePlugin(config, "acpx", {
        dryRun,
        officialPluginUpdateChannel: updateChannel,
        coreVersion,
      });

      expect(result.outcomes).toEqual([
        {
          pluginId: "acpx",
          status: "unchanged",
          currentVersion: coreVersion,
          nextVersion: coreVersion,
          message: `acpx is up to date (${coreVersion}).`,
        },
      ]);
      expect(result.config.plugins?.installs?.acpx?.spec).toBe("@carapace/acpx");
      expect(runCommandWithTimeoutMock).toHaveBeenCalledTimes(dryRun ? 0 : 1);
    },
  );

  it("reports a newer latest release when the beta line for an exact pin is unavailable", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "demo",
      packageName: "@acme/demo",
      installedVersion: "1.2.3",
      registryVersion: "1.2.3",
      registryIntegrity: "sha512-same",
      registryShasum: "same",
      spec: "@acme/demo@1.2.3",
      integrity: "sha512-same",
      shasum: "same",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "npm error code E404",
    });
    mockNpmViewMetadata({
      name: "@acme/demo",
      version: "1.2.4",
    });
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

    const result = await updatePlugin(config, "demo", { updateChannel: "beta" });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(runCommandWithTimeoutMock.mock.calls).toHaveLength(3);
    expect(runCommandWithTimeoutMock.mock.calls[2]?.[0]).toEqual([
      "npm",
      "view",
      "@acme/demo@latest",
      "name",
      "version",
      "dist.integrity",
      "dist.shasum",
      "carapace",
      "--json",
    ]);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "unchanged",
        currentVersion: "1.2.3",
        nextVersion: "1.2.4",
        message:
          "demo is pinned to @acme/demo@1.2.3 (installed 1.2.3); registry latest resolves to 1.2.4. " +
          "Pass `carapace plugins update @acme/demo@latest` to replace this version pin.",
      },
    ]);
  });

  it.each([
    {
      name: "does not skip unchanged npm plugins when package metadata requires a newer plugin API",
      compatibility: { compat: { pluginApi: ">=2026.5.28-beta.4" } },
      assertFullOutcome: true,
    },
    {
      name: "does not skip unchanged npm plugins when package metadata requires a newer host",
      compatibility: { install: { minHostVersion: ">=2026.5.28-beta.4" } },
      assertFullOutcome: false,
    },
  ] as const)("$name", async ({ compatibility, assertFullOutcome }) => {
    vi.stubEnv("CARAPACE_COMPATIBILITY_HOST_VERSION", "2026.5.28-beta.3");
    const { config } = createNpmUpdateFixture({
      pluginId: "msteams",
      packageName: "@carapace/msteams",
      installedVersion: "2026.5.28-beta.4",
      registryVersion: "2026.5.28-beta.4",
      registryIntegrity: "sha512-newer",
      registryShasum: "newer",
      registryCarapace: { extensions: ["./dist/index.js"], ...compatibility },
      integrity: "sha512-newer",
      shasum: "newer",
      installerVersion: "2026.5.28-beta.3",
      installerResolvedSpec: "@carapace/msteams@2026.5.28-beta.3",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce(failedNpmVersionQueryResult);

    const result = await updatePlugin(config, "msteams");

    expect(npmInstallCall()?.spec).toBe("@carapace/msteams");
    expect(npmInstallCall()?.mode).toBe("update");
    if (assertFullOutcome) {
      expect(npmInstallCall()?.expectedPluginId).toBe("msteams");
    }
    expect(result.changed).toBe(true);
    expectRecordFields(result.config.plugins?.installs?.msteams, {
      source: "npm",
      version: "2026.5.28-beta.3",
      resolvedName: "@carapace/msteams",
      resolvedVersion: "2026.5.28-beta.3",
      resolvedSpec: "@carapace/msteams@2026.5.28-beta.3",
    });
    if (assertFullOutcome) {
      expect(result.outcomes).toEqual([
        {
          pluginId: "msteams",
          status: "updated",
          currentVersion: "2026.5.28-beta.4",
          nextVersion: "2026.5.28-beta.3",
          message: "Downgraded msteams: 2026.5.28-beta.4 -> 2026.5.28-beta.3.",
        },
      ]);
    }
  });

  it("repairs missing carapace peer links before skipping unchanged npm plugins", async () => {
    const installPath = createInstalledPackageDir({
      name: "@carapace/codex",
      version: "2026.5.3",
      peerDependencies: { carapace: ">=2026.5.3" },
    });
    mockNpmViewMetadata({
      name: "@carapace/codex",
      version: "2026.5.3",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "codex",
        targetDir: installPath,
        version: "2026.5.3",
        npmResolution: {
          name: "@carapace/codex",
          version: "2026.5.3",
          resolvedSpec: "@carapace/codex@2026.5.3",
        },
      }),
    );
    const config: CarapaceConfig = {
      plugins: {
        installs: {
          codex: {
            source: "npm",
            spec: "@carapace/codex",
            installPath,
            resolvedName: "@carapace/codex",
            resolvedVersion: "2026.5.3",
            resolvedSpec: "@carapace/codex@2026.5.3",
            integrity: "sha512-same",
            shasum: "same",
          },
        },
      },
    };

    const result = await updatePlugin(config, "codex");

    expect(npmInstallCall()?.spec).toBe("@carapace/codex");
    expect(npmInstallCall()?.mode).toBe("update");
    expect(npmInstallCall()?.expectedPluginId).toBe("codex");
    expect(result.changed).toBe(true);
    expect(result.outcomes).toEqual([
      {
        pluginId: "codex",
        status: "unchanged",
        currentVersion: "2026.5.3",
        nextVersion: "2026.5.3",
        message: "codex already at 2026.5.3.",
      },
    ]);
  });

  it("skips unchanged npm plugins when the carapace peer link already resolves", async () => {
    const installPath = createInstalledPackageDir({
      name: "@carapace/codex",
      version: "2026.5.3",
      peerDependencies: { carapace: ">=2026.5.3" },
    });
    fs.mkdirSync(path.join(installPath, "node_modules"), { recursive: true });
    fs.symlinkSync(
      fs.realpathSync(process.cwd()),
      path.join(installPath, "node_modules", "carapace"),
      "junction",
    );
    mockNpmViewMetadata({
      name: "@carapace/codex",
      version: "2026.5.3",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          installs: {
            codex: {
              source: "npm",
              spec: "@carapace/codex",
              installPath,
              resolvedName: "@carapace/codex",
              resolvedVersion: "2026.5.3",
              resolvedSpec: "@carapace/codex@2026.5.3",
              integrity: "sha512-same",
              shasum: "same",
            },
          },
        },
      },
      pluginIds: ["codex"],
    });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.outcomes).toEqual([
      {
        pluginId: "codex",
        status: "unchanged",
        currentVersion: "2026.5.3",
        nextVersion: "2026.5.3",
        message: "codex is up to date (2026.5.3).",
      },
    ]);
  });

  it.each(["peerDependencies", "dependencies"] as const)(
    "repairs every copied stale %s host for unchanged npm plugins without reinstalling them",
    async (dependencyField) => {
      const stateDir = makeTrackedTempDir("carapace-plugin-update-legacy", tempDirs);
      const plugins = ["email", "calendar"].map((pluginId) => {
        const packageName = `@clawemail/${pluginId}`;
        const installPath = path.join(stateDir, "extensions", pluginId);
        const staleHostDir = path.join(installPath, "node_modules", "carapace");
        fs.mkdirSync(staleHostDir, { recursive: true });
        fs.writeFileSync(
          path.join(installPath, "package.json"),
          JSON.stringify({
            name: packageName,
            version: "2026.7.1",
            [dependencyField]: { carapace: ">=2026.7.1" },
          }),
        );
        fs.writeFileSync(
          path.join(staleHostDir, "package.json"),
          JSON.stringify({ name: "carapace", version: "2026.7.1-beta.2" }),
        );
        mockNpmViewMetadata({
          name: packageName,
          version: "2026.7.1",
          integrity: "sha512-same",
          shasum: "same",
        });
        return { pluginId, packageName, installPath, staleHostDir };
      });
      installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

      const result = await withEnvAsync({ CARAPACE_STATE_DIR: stateDir }, async () =>
        updateNpmInstalledPlugins({
          config: {
            plugins: {
              installs: Object.fromEntries(
                plugins.map(({ pluginId, packageName, installPath }) => [
                  pluginId,
                  {
                    source: "npm" as const,
                    spec: packageName,
                    installPath,
                    resolvedName: packageName,
                    resolvedVersion: "2026.7.1",
                    resolvedSpec: `${packageName}@2026.7.1`,
                    integrity: "sha512-same",
                    shasum: "same",
                  },
                ]),
              ),
            },
          },
          pluginIds: plugins.map(({ pluginId }) => pluginId),
        }),
      );

      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      for (const { staleHostDir } of plugins) {
        expect(fs.lstatSync(staleHostDir).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(staleHostDir)).toBe(fs.realpathSync(process.cwd()));
      }
      expect(result.changed).toBe(true);
      expect(result.outcomes.map(({ pluginId, status }) => ({ pluginId, status }))).toEqual(
        plugins.map(({ pluginId }) => ({ pluginId, status: "unchanged" })),
      );
    },
  );

  it("repairs carapace peer links after batch npm updates prune earlier plugin links", async () => {
    const plugins = [
      { pluginId: "brave", packageName: "@carapace/brave-plugin" },
      { pluginId: "codex", packageName: "@carapace/codex" },
      { pluginId: "discord", packageName: "@carapace/discord" },
    ];
    const { stateDir, installPaths, peerLinkPath, linkPeer } =
      createCarapacePeerLinkFixtures(plugins);
    for (const { packageName } of plugins) {
      mockNpmViewMetadata({
        name: packageName,
        version: "2026.5.5",
        integrity: "sha512-same",
        shasum: "same",
      });
    }
    installPluginFromNpmSpecMock.mockImplementation(
      (params: { expectedPluginId?: string; spec: string }) => {
        const pluginId = requireExpectedPluginId(params);
        for (const { pluginId: installedPluginId } of plugins) {
          fs.rmSync(peerLinkPath(installedPluginId), { recursive: true, force: true });
        }
        linkPeer(pluginId);
        const packageName = requirePluginPackageName(plugins, pluginId);
        return Promise.resolve(
          createSuccessfulNpmUpdateResult({
            pluginId,
            targetDir: installPaths[pluginId],
            version: "2026.5.5",
            npmResolution: {
              name: packageName,
              version: "2026.5.5",
              resolvedSpec: `${packageName}@2026.5.5`,
            },
          }),
        );
      },
    );

    const result = await withEnvAsync({ CARAPACE_STATE_DIR: stateDir }, async () =>
      updateNpmInstalledPlugins({
        config: createPeerLinkInstallConfig({ plugins, installPaths }),
        pluginIds: plugins.map((plugin) => plugin.pluginId),
      }),
    );

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(3);
    for (const { pluginId } of plugins) {
      expect(fs.existsSync(peerLinkPath(pluginId))).toBe(true);
    }
    expect(result.outcomes).toEqual(
      plugins.map(({ pluginId }) => ({
        pluginId,
        status: "updated",
        currentVersion: "2026.5.4",
        nextVersion: "2026.5.5",
        message: `Updated ${pluginId}: 2026.5.4 -> 2026.5.5.`,
      })),
    );
  });

  it("repairs sibling carapace peer links after a targeted npm update prunes the shared install tree", async () => {
    const plugins = [
      { pluginId: "brave", packageName: "@carapace/brave-plugin" },
      { pluginId: "codex", packageName: "@carapace/codex" },
      { pluginId: "discord", packageName: "@carapace/discord" },
    ];
    const { stateDir, installPaths, peerLinkPath, linkPeer } =
      createCarapacePeerLinkFixtures(plugins);
    linkPeer("brave");
    linkPeer("discord");
    mockNpmViewMetadata({
      name: "@carapace/codex",
      version: "2026.5.5",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockImplementation(() => {
      for (const { pluginId } of plugins) {
        fs.rmSync(peerLinkPath(pluginId), { recursive: true, force: true });
      }
      linkPeer("codex");
      return Promise.resolve(
        createSuccessfulNpmUpdateResult({
          pluginId: "codex",
          targetDir: installPaths.codex,
          version: "2026.5.5",
          npmResolution: {
            name: "@carapace/codex",
            version: "2026.5.5",
            resolvedSpec: "@carapace/codex@2026.5.5",
          },
        }),
      );
    });

    await withEnvAsync({ CARAPACE_STATE_DIR: stateDir }, async () =>
      updateNpmInstalledPlugins({
        config: createPeerLinkInstallConfig({ plugins, installPaths }),
        pluginIds: ["codex"],
      }),
    );

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    for (const { pluginId } of plugins) {
      expect(fs.existsSync(peerLinkPath(pluginId))).toBe(true);
    }
  });

  it.runIf(process.platform !== "win32")(
    "never repairs external, developer-owned, or aliased host packages after an npm update",
    async () => {
      const plugins = [
        { pluginId: "sibling", packageName: "@acme/sibling" },
        { pluginId: "updated", packageName: "@acme/updated" },
      ];
      const { stateDir, installPaths, peerLinkPath, linkPeer } =
        createCarapacePeerLinkFixtures(plugins);
      linkPeer("sibling");

      const outsideInstallPath = createInstalledPackageDir({
        name: "@acme/outside",
        version: "2026.5.4",
        peerDependencies: { carapace: ">=2026.5.4" },
      });
      const developerInstallPath = createInstalledPackageDir({
        name: "@acme/developer",
        version: "2026.5.4",
        peerDependencies: { carapace: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", "developer"),
      });
      const marketplaceInstallPath = createInstalledPackageDir({
        name: "@acme/marketplace",
        version: "2026.5.4",
        peerDependencies: { carapace: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", "marketplace"),
      });
      const clawhubInstallPath = createInstalledPackageDir({
        name: "@acme/clawhub",
        version: "2026.5.4",
        peerDependencies: { carapace: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", "clawhub"),
      });
      const copiedHosts = [
        outsideInstallPath,
        developerInstallPath,
        marketplaceInstallPath,
        clawhubInstallPath,
      ].map((installPath) => {
        const copiedHostDir = path.join(installPath, "node_modules", "carapace");
        fs.mkdirSync(copiedHostDir, { recursive: true });
        fs.writeFileSync(
          path.join(copiedHostDir, "package.json"),
          JSON.stringify({ name: "carapace", version: "2026.4.1" }),
        );
        return copiedHostDir;
      });
      const outsideAliasPath = path.join(stateDir, "extensions", "outside-alias");
      const developerAliasPath = path.join(stateDir, "extensions", "developer-alias");
      fs.symlinkSync(outsideInstallPath, outsideAliasPath, "dir");
      fs.symlinkSync(developerInstallPath, developerAliasPath, "dir");

      mockNpmViewMetadata({
        name: "@acme/updated",
        version: "2026.5.5",
        integrity: "sha512-same",
        shasum: "same",
      });
      installPluginFromNpmSpecMock.mockImplementation(() => {
        fs.rmSync(peerLinkPath("sibling"), { recursive: true, force: true });
        fs.rmSync(peerLinkPath("updated"), { recursive: true, force: true });
        linkPeer("updated");
        return Promise.resolve(
          createSuccessfulNpmUpdateResult({
            pluginId: "updated",
            targetDir: installPaths.updated,
            version: "2026.5.5",
            npmResolution: {
              name: "@acme/updated",
              version: "2026.5.5",
              resolvedSpec: "@acme/updated@2026.5.5",
            },
          }),
        );
      });

      await withEnvAsync({ CARAPACE_STATE_DIR: stateDir }, async () =>
        updateNpmInstalledPlugins({
          config: createPeerLinkInstallConfig({
            plugins,
            installPaths,
            extraInstalls: {
              outside: { source: "npm", installPath: outsideInstallPath },
              "outside-alias": { source: "npm", installPath: outsideAliasPath },
              developer: { source: "path", installPath: developerInstallPath },
              "developer-alias": { source: "npm", installPath: developerAliasPath },
              marketplace: { source: "marketplace", installPath: marketplaceInstallPath },
              clawhub: { source: "clawhub", installPath: clawhubInstallPath },
            },
          }),
          pluginIds: ["updated"],
        }),
      );

      expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
      expect(fs.lstatSync(peerLinkPath("sibling")).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(peerLinkPath("updated")).isSymbolicLink()).toBe(true);
      for (const copiedHostDir of copiedHosts) {
        expect(fs.lstatSync(copiedHostDir).isDirectory()).toBe(true);
        expect(
          JSON.parse(fs.readFileSync(path.join(copiedHostDir, "package.json"), "utf8")),
        ).toEqual({ name: "carapace", version: "2026.4.1" });
      }
    },
  );

  it("continues repairing sibling carapace peer links after one recorded npm install cannot be relinked", async () => {
    const plugins = [
      { pluginId: "brave", packageName: "@carapace/brave-plugin" },
      { pluginId: "codex", packageName: "@carapace/codex" },
    ];
    const { stateDir, installPaths, peerLinkPath, linkPeer } =
      createCarapacePeerLinkFixtures(plugins);
    const malformedInstallPath = path.join(stateDir, "extensions", "aardvark");
    fs.mkdirSync(malformedInstallPath, { recursive: true });
    fs.writeFileSync(path.join(malformedInstallPath, "package.json"), "{ malformed");
    const brokenInstallPath = createInstalledPackageDir({
      name: "@carapace/broken-plugin",
      version: "2026.5.4",
      peerDependencies: { carapace: ">=2026.5.4" },
      installPath: path.join(stateDir, "extensions", "broken"),
    });
    fs.writeFileSync(path.join(brokenInstallPath, "node_modules"), "not a directory");
    linkPeer("brave");
    mockNpmViewMetadata({
      name: "@carapace/codex",
      version: "2026.5.5",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockImplementation(() => {
      for (const { pluginId } of plugins) {
        fs.rmSync(peerLinkPath(pluginId), { recursive: true, force: true });
      }
      linkPeer("codex");
      return Promise.resolve(
        createSuccessfulNpmUpdateResult({
          pluginId: "codex",
          targetDir: installPaths.codex,
          version: "2026.5.5",
          npmResolution: {
            name: "@carapace/codex",
            version: "2026.5.5",
            resolvedSpec: "@carapace/codex@2026.5.5",
          },
        }),
      );
    });
    const warnMessages: string[] = [];

    await withEnvAsync({ CARAPACE_STATE_DIR: stateDir }, async () =>
      updateNpmInstalledPlugins({
        config: createPeerLinkInstallConfig({
          plugins,
          installPaths,
          extraInstalls: {
            aardvark: { source: "npm", installPath: malformedInstallPath },
            broken: {
              source: "npm",
              spec: "@carapace/broken-plugin",
              installPath: brokenInstallPath,
              resolvedName: "@carapace/broken-plugin",
              resolvedVersion: "2026.5.4",
              resolvedSpec: "@carapace/broken-plugin@2026.5.4",
            },
          },
        }),
        pluginIds: ["codex"],
        logger: { warn: (message) => warnMessages.push(message) },
      }),
    );

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(peerLinkPath("brave"))).toBe(true);
    expect(fs.existsSync(peerLinkPath("codex"))).toBe(true);
    expect(warnMessages).toEqual([
      expect.stringContaining(
        `Could not repair carapace peer link at ${malformedInstallPath}: SyntaxError:`,
      ),
      `Skipping carapace peerDependency link because ${path.join(brokenInstallPath, "node_modules")} is not a real directory.`,
    ]);
  });

  it("refreshes legacy npm install records before skipping unchanged artifacts", async () => {
    const installPath = createInstalledPackageDir({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
    });
    mockNpmViewMetadata({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "lossless-claw",
        targetDir: installPath,
        version: "0.9.0",
        npmResolution: {
          name: "@martian-engineering/lossless-claw",
          version: "0.9.0",
          resolvedSpec: "@martian-engineering/lossless-claw@0.9.0",
        },
      }),
    );

    const result = await updateNpmInstalledPlugins({
      config: createNpmInstallConfig({
        pluginId: "lossless-claw",
        spec: "@martian-engineering/lossless-claw",
        installPath,
      }),
      pluginIds: ["lossless-claw"],
    });

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    expect(result.changed).toBe(true);
    expectRecordFields(result.outcomes[0], {
      pluginId: "lossless-claw",
      status: "unchanged",
      currentVersion: "0.9.0",
      nextVersion: "0.9.0",
    });
    expectRecordFields(result.config.plugins?.installs?.["lossless-claw"], {
      source: "npm",
      spec: "@martian-engineering/lossless-claw",
      resolvedName: "@martian-engineering/lossless-claw",
      resolvedVersion: "0.9.0",
      resolvedSpec: "@martian-engineering/lossless-claw@0.9.0",
    });
  });

  it("expands home-relative install paths before checking installed npm versions", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-plugin-update-home-"));
    tempDirs.push(home);
    const installPath = path.join(home, ".carapace", "extensions", "lossless-claw");
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(
      path.join(installPath, "package.json"),
      JSON.stringify({ name: "@martian-engineering/lossless-claw", version: "0.9.0" }),
    );
    mockNpmViewMetadata({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

    const result = await withEnvAsync({ HOME: home }, () =>
      updateNpmInstalledPlugins({
        config: createNpmInstallConfig({
          pluginId: "lossless-claw",
          spec: "@martian-engineering/lossless-claw",
          installPath: "~/.carapace/extensions/lossless-claw",
          resolvedName: "@martian-engineering/lossless-claw",
          resolvedVersion: "0.9.0",
          resolvedSpec: "@martian-engineering/lossless-claw@0.9.0",
          integrity: "sha512-same",
          shasum: "same",
        }),
        pluginIds: ["lossless-claw"],
      }),
    );

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expectRecordFields(result.outcomes[0], {
      pluginId: "lossless-claw",
      status: "unchanged",
      currentVersion: "0.9.0",
    });
  });

  it("falls through to npm reinstall when the recorded integrity differs", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "lossless-claw",
      packageName: "@martian-engineering/lossless-claw",
      installedVersion: "0.9.0",
      registryVersion: "0.9.0",
      registryIntegrity: "sha512-new",
      integrity: "sha512-old",
      installerVersion: "0.9.0",
      installerResolvedSpec: "@martian-engineering/lossless-claw@0.9.0",
    });
    const result = await updatePlugin(config, "lossless-claw");

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    expect(result.changed).toBe(true);
    expectRecordFields(result.outcomes[0], {
      pluginId: "lossless-claw",
      status: "unchanged",
      currentVersion: "0.9.0",
      nextVersion: "0.9.0",
    });
  });

  it.each([
    {
      name: "falls through to npm reinstall when metadata probing fails for valid specs",
      spec: "@martian-engineering/lossless-claw",
      fallsBack: true,
    },
    {
      name: "records range metadata probing failures without falling through to npm reinstall",
      spec: "@martian-engineering/lossless-claw@^0.9.0",
      fallsBack: false,
    },
  ] as const)("$name", async ({ spec, fallsBack }) => {
    const warn = vi.fn();
    const installPath = createInstalledPackageDir({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "registry timeout",
    });
    if (fallsBack) {
      installPluginFromNpmSpecMock.mockResolvedValue(
        createSuccessfulNpmUpdateResult({
          pluginId: "lossless-claw",
          targetDir: installPath,
          version: "0.9.0",
        }),
      );
    }
    const result = await updatePlugin(
      createNpmInstallConfig({
        pluginId: "lossless-claw",
        spec,
        installPath,
      }),
      "lossless-claw",
      { logger: { warn } },
    );

    if (fallsBack) {
      expect(warn).toHaveBeenCalledWith(
        "Could not check lossless-claw before update; falling back to installer path: npm view failed: registry timeout",
      );
      expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    } else {
      expect(warn).not.toHaveBeenCalled();
      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
      expect(result.outcomes).toEqual([
        {
          pluginId: "lossless-claw",
          status: "error",
          message: "Failed to check lossless-claw: npm view failed: registry timeout",
        },
      ]);
    }
  });

  it("defers installed payload validation until metadata probing fails", async () => {
    const installPath = createInstalledPackageDir({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
      runnable: true,
    });
    mockNpmViewMetadata({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
    });

    const result = await updateNpmInstalledPlugins({
      config: createNpmInstallConfig({
        pluginId: "lossless-claw",
        spec: "@martian-engineering/lossless-claw@^0.9.0",
        installPath,
        resolvedName: "@martian-engineering/lossless-claw",
        resolvedSpec: "@martian-engineering/lossless-claw@0.9.0",
        resolvedVersion: "0.9.0",
      }),
      pluginIds: ["lossless-claw"],
      disableOnFailure: true,
    });

    expect(result.outcomes[0]?.status).toBe("unchanged");
    expect(validatePackageExtensionEntriesForInstallMock).not.toHaveBeenCalled();
  });

  it("preserves healthy plugin state when metadata probing fails before replacement", async () => {
    const warn = vi.fn();
    const installPath = createInstalledPackageDir({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
      runnable: true,
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "registry timeout",
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          allow: ["lossless-claw", "keep"],
          deny: ["lossless-claw", "blocked"],
          slots: {
            memory: "lossless-claw",
            contextEngine: "lossless-claw",
          },
          entries: {
            "lossless-claw": {
              enabled: true,
              config: { preserved: true },
            },
          },
          installs: {
            "lossless-claw": {
              source: "npm",
              spec: "@martian-engineering/lossless-claw@^0.9.0",
              installPath,
              resolvedName: "@martian-engineering/lossless-claw",
              resolvedVersion: "0.9.0",
              resolvedSpec: "@martian-engineering/lossless-claw@0.9.0",
            },
          },
        },
      },
      pluginIds: ["lossless-claw"],
      disableOnFailure: true,
      logger: { warn },
    });

    expect(warn).not.toHaveBeenCalled();
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config.plugins?.entries?.["lossless-claw"]).toEqual({
      enabled: true,
      config: { preserved: true },
    });
    expect(result.config.plugins?.allow).toEqual(["lossless-claw", "keep"]);
    expect(result.config.plugins?.deny).toEqual(["lossless-claw", "blocked"]);
    expect(result.config.plugins?.slots).toEqual({
      memory: "lossless-claw",
      contextEngine: "lossless-claw",
    });
    expect(validatePackageExtensionEntriesForInstallMock).toHaveBeenCalledTimes(1);
    expect(result.outcomes).toEqual([
      {
        pluginId: "lossless-claw",
        status: "error",
        message: "Failed to check lossless-claw: npm view failed: registry timeout",
      },
    ]);
  });

  it("disables a corrupt installed payload when metadata probing also fails", async () => {
    const warn = vi.fn();
    const installPath = createInstalledPackageDir({
      name: "@martian-engineering/lossless-claw",
      version: "0.9.0",
      runnable: true,
    });
    fs.rmSync(path.join(installPath, "index.js"));
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "registry timeout",
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          allow: ["lossless-claw", "keep"],
          deny: ["lossless-claw", "blocked"],
          slots: {
            memory: "lossless-claw",
            contextEngine: "lossless-claw",
          },
          entries: {
            "lossless-claw": {
              enabled: true,
              config: { preserved: true },
            },
          },
          installs: {
            "lossless-claw": {
              source: "npm",
              spec: "@martian-engineering/lossless-claw@^0.9.0",
              installPath,
            },
          },
        },
      },
      pluginIds: ["lossless-claw"],
      disableOnFailure: true,
      logger: { warn },
    });

    const message =
      'Disabled "lossless-claw" after plugin update failure; Carapace will continue without it. Failed to check lossless-claw: npm view failed: registry timeout';
    expect(warn).toHaveBeenCalledWith(message);
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.["lossless-claw"]).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expect(result.config.plugins?.allow).toEqual(["lossless-claw", "keep"]);
    expect(result.config.plugins?.deny).toEqual(["lossless-claw", "blocked"]);
    expect(result.config.plugins?.slots).toBeUndefined();
    expect(result.outcomes).toEqual([
      {
        pluginId: "lossless-claw",
        status: "skipped",
        message,
      },
    ]);
  });

  it("continues the plugin sweep when deferred payload validation throws", async () => {
    const warn = vi.fn();
    const installPath = createInstalledPackageDir({
      name: "@acme/demo",
      version: "1.0.0",
      runnable: true,
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "registry timeout",
    });
    validatePackageExtensionEntriesForInstallMock.mockImplementationOnce(() => {
      throw new Error("permission denied");
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          entries: { demo: { enabled: true } },
          installs: {
            demo: {
              source: "npm",
              spec: "@acme/demo@^1.0.0",
              installPath,
            },
            local: {
              source: "path",
              installPath: "/tmp/local",
            },
          },
        },
      },
      pluginIds: ["demo", "local"],
      disableOnFailure: true,
      logger: { warn },
    });

    expect(result.config.plugins?.entries?.demo?.enabled).toBe(false);
    expect(result.outcomes.map(({ pluginId }) => pluginId)).toEqual(["demo", "local"]);
  });

  it("disables a missing plugin payload when metadata probing also fails", async () => {
    const warn = vi.fn();
    const installPath = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-plugin-update-missing-"));
    tempDirs.push(installPath);
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "npm view failed: registry timeout",
      code: "npm_metadata_failure",
    });
    const config = {
      plugins: {
        allow: ["demo", "other"],
        deny: ["demo", "blocked"],
        slots: { memory: "demo" },
        entries: {
          demo: {
            enabled: true,
            config: { preserved: true },
          },
        },
        installs: {
          demo: {
            source: "npm" as const,
            spec: "@acme/demo",
            installPath,
          },
        },
      },
    } satisfies CarapaceConfig;

    const result = await updatePlugin(config, "demo", {
      disableOnFailure: true,
      logger: { warn },
    });

    const message =
      'Disabled "demo" after plugin update failure; Carapace will continue without it. Failed to update demo: npm view failed: registry timeout';
    expect(warn).toHaveBeenCalledWith(message);
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.demo).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expect(result.config.plugins?.allow).toEqual(["demo", "other"]);
    expect(result.config.plugins?.deny).toEqual(["demo", "blocked"]);
    expect(result.config.plugins?.slots?.memory).toBeUndefined();
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        message,
      },
    ]);
  });

  it.each([
    {
      source: "npm",
      config: createDisabledPluginConfig({
        source: "npm",
        spec: "@acme/demo",
        installPath: "/tmp/demo",
        resolvedName: "@acme/demo",
      }),
    },
    {
      source: "ClawHub",
      config: createDisabledPluginConfig({
        source: "clawhub",
        spec: "clawhub:demo",
        installPath: "/tmp/demo",
        clawhubUrl: "https://clawhub.ai",
        clawhubPackage: "demo",
        clawhubFamily: "code-plugin",
        clawhubChannel: "official",
      }),
    },
    {
      source: "marketplace",
      config: createDisabledPluginConfig({
        source: "marketplace",
        installPath: "/tmp/demo",
        marketplaceSource: "acme/plugins",
        marketplacePlugin: "demo",
      }),
    },
  ])("skips disabled $source installs before update network calls", async ({ config }) => {
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("npm installer should not run"));
    installPluginFromClawHubMock.mockRejectedValue(new Error("ClawHub installer should not run"));
    installPluginFromMarketplaceMock.mockRejectedValue(
      new Error("marketplace installer should not run"),
    );

    const result = await updateNpmInstalledPlugins({
      config,
      skipDisabledPlugins: true,
    });

    expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    expect(installPluginFromMarketplaceMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.config.plugins?.installs?.demo).toEqual(config.plugins?.installs?.demo);
    expect(result.config.plugins?.entries?.demo).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        message: 'Skipping "demo" (disabled in config).',
      },
    ]);
  });

  it("skips globally disabled installs before network or capability consent", async () => {
    capabilityConsentMode.real = true;
    const onCapabilityConsent = vi.fn();
    const config = createNpmInstallConfig({
      pluginId: "demo",
      spec: "@acme/demo",
      installPath: "/tmp/demo",
    });
    config.plugins = { ...config.plugins, enabled: false };

    const result = await updateNpmInstalledPlugins({
      config,
      skipDisabledPlugins: true,
      onCapabilityConsent,
    });

    expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(onCapabilityConsent).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        message: 'Skipping "demo" (plugins disabled).',
      },
    ]);
  });

  it("updates disabled trusted official npm installs from the channel spec when requested", async () => {
    const installPath = createInstalledPackageDir({
      name: "@carapace/codex",
      version: "2026.5.3",
    });
    mockNpmViewMetadata({
      name: "@carapace/codex",
      version: "2026.5.4",
      integrity: "sha512-next",
      shasum: "next",
    });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "codex",
        targetDir: installPath,
        version: "2026.5.4",
        npmResolution: {
          name: "@carapace/codex",
          version: "2026.5.4",
          resolvedSpec: "@carapace/codex@2026.5.4",
        },
      }),
    );

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          entries: {
            codex: {
              enabled: false,
              config: { preserved: true },
            },
          },
          installs: {
            codex: {
              source: "npm",
              spec: "@carapace/codex@2026.5.3",
              installPath,
            },
          },
        },
      },
      skipDisabledPlugins: true,
      syncOfficialPluginInstalls: true,
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/codex@2026.5.3");
    expect(npmInstallCall()?.expectedPluginId).toBe("codex");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.codex).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expectRecordFields(result.config.plugins?.installs?.codex, {
      source: "npm",
      spec: "@carapace/codex@2026.5.3",
      version: "2026.5.4",
      resolvedName: "@carapace/codex",
      resolvedVersion: "2026.5.4",
      resolvedSpec: "@carapace/codex@2026.5.4",
    });
    expectRecordFields(result.outcomes[0], {
      pluginId: "codex",
      status: "updated",
      currentVersion: "2026.5.3",
      nextVersion: "2026.5.4",
    });
  });

  it("preserves exact official npm pins on an inferred beta channel", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "codex",
      packageName: "@carapace/codex",
      installedVersion: "2026.5.28",
      spec: "@carapace/codex@2026.5.28",
      installerVersion: "2026.5.28",
      installerResolvedSpec: "@carapace/codex@2026.5.28",
    });
    const result = await updatePlugin(config, "codex", {
      dryRun: true,
      officialPluginUpdateChannel: "beta",
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/codex@2026.5.28");
    expect(npmInstallCall()?.expectedPluginId).toBe("codex");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.changed).toBe(false);
    expectRecordFields(result.outcomes[0], {
      pluginId: "codex",
      status: "unchanged",
      currentVersion: "2026.5.28",
      nextVersion: "2026.5.28",
    });
  });

  it("reinstalls missing exact official npm pins without official install sync", async () => {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-missing-plugin-"));
    tempDirs.push(extensionsDir);
    const installPath = path.join(extensionsDir, "codex");
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "codex",
        targetDir: installPath,
        version: "2026.5.28",
        npmResolution: {
          name: "@carapace/codex",
          version: "2026.5.28",
          resolvedSpec: "@carapace/codex@2026.5.28",
        },
      }),
    );

    const result = await updateNpmInstalledPlugins({
      config: createNpmInstallConfig({
        pluginId: "codex",
        spec: "@carapace/codex@2026.5.28",
        installPath,
        resolvedName: "@carapace/codex",
        resolvedSpec: "@carapace/codex@2026.5.28",
        resolvedVersion: "2026.5.28",
      }),
      pluginIds: ["codex"],
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/codex@2026.5.28");
    expect(npmInstallCall()?.extensionsDir).toBe(extensionsDir);
    expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
    expectRecordFields(result.config.plugins?.installs?.codex, {
      source: "npm",
      spec: "@carapace/codex@2026.5.28",
      installPath,
      version: "2026.5.28",
      resolvedName: "@carapace/codex",
      resolvedSpec: "@carapace/codex@2026.5.28",
      resolvedVersion: "2026.5.28",
    });
    expectRecordFields(result.outcomes[0], {
      pluginId: "codex",
      status: "updated",
      nextVersion: "2026.5.28",
    });
  });

  it("keeps integrity checks when official sync repairs missing exact npm pins", async () => {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-missing-plugin-"));
    tempDirs.push(extensionsDir);
    const installPath = path.join(extensionsDir, "codex");
    mockNpmViewMetadata({
      name: "@carapace/codex",
      version: "2026.5.28",
      integrity: "sha512-old",
    });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "codex",
        targetDir: installPath,
        version: "2026.5.28",
        npmResolution: {
          name: "@carapace/codex",
          version: "2026.5.28",
          resolvedSpec: "@carapace/codex@2026.5.28",
        },
      }),
    );

    await updateNpmInstalledPlugins({
      config: createNpmInstallConfig({
        pluginId: "codex",
        spec: "@carapace/codex@2026.5.28",
        installPath,
        resolvedName: "@carapace/codex",
        resolvedSpec: "@carapace/codex@2026.5.28",
        resolvedVersion: "2026.5.28",
        integrity: "sha512-old",
      }),
      pluginIds: ["codex"],
      syncOfficialPluginInstalls: true,
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/codex@2026.5.28");
    expect(npmInstallCall()?.expectedIntegrity).toBe("sha512-old");
  });

  it("keeps third-party exact pinned npm specs pinned during official install sync", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "demo",
      packageName: "@acme/demo",
      installedVersion: "1.2.3",
      spec: "@acme/demo@1.2.3",
      installerVersion: "1.2.3",
    });
    await updatePlugin(config, "demo", {
      dryRun: true,
      syncOfficialPluginInstalls: true,
    });

    expect(npmInstallCall()?.spec).toBe("@acme/demo@1.2.3");
    expect(npmInstallCall()?.expectedPluginId).toBe("demo");
  });

  it.each([
    {
      name: "uses exact npm spec selectors as dry-run target versions when probes omit metadata",
      targetVersion: "1.2.4",
      status: "updated",
      message: "Would update demo: 1.2.3 -> 1.2.4.",
    },
    {
      name: "keeps exact npm dry-runs unchanged when probe metadata is absent but spec matches",
      targetVersion: "1.2.3",
      status: "unchanged",
      message: "demo is up to date (1.2.3).",
    },
    {
      name: "reports exact npm dry-runs that move backwards as downgrades",
      targetVersion: "1.2.2",
      status: "updated",
      message: "Would downgrade demo: 1.2.3 -> 1.2.2.",
    },
  ] as const)("$name", async ({ targetVersion, status, message }) => {
    const installPath = createInstalledPackageDir({
      name: "@acme/demo",
      version: "1.2.3",
    });
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: installPath,
      extensions: ["index.ts"],
    });

    const result = await updatePlugin(
      createNpmInstallConfig({
        pluginId: "demo",
        spec: `@acme/demo@${targetVersion}`,
        installPath,
      }),
      "demo",
      { dryRun: true },
    );

    expectRecordFields(result.outcomes[0], {
      pluginId: "demo",
      status,
      currentVersion: "1.2.3",
      nextVersion: targetVersion,
      message,
    });
  });

  it.each(
    ["1.2.3", "v1.2.3"].flatMap((version) => [
      { version, pluginId: "demo", packageName: "@acme/demo", syncOfficialPluginInstalls: false },
      {
        version,
        pluginId: "acpx",
        packageName: "@carapace/acpx",
        syncOfficialPluginInstalls: true,
      },
    ]),
  )(
    "reports newer registry default releases for exact pinned $pluginId@$version dry-runs (official sync=$syncOfficialPluginInstalls)",
    async ({ version, pluginId, packageName, syncOfficialPluginInstalls }) => {
      const spec = `${packageName}@${version}`;
      const { config } = createNpmUpdateFixture({
        pluginId,
        packageName,
        installedVersion: "1.2.3",
        registryVersion: "1.2.4",
        spec,
        installerVersion: "1.2.3",
        installerResolvedSpec: spec,
      });
      const result = await updatePlugin(config, pluginId, {
        dryRun: true,
        syncOfficialPluginInstalls,
      });

      expect(npmInstallCall()?.spec).toBe(spec);
      expect(npmViewCall()?.[0]).toEqual([
        "npm",
        "view",
        packageName,
        "name",
        "version",
        "dist.integrity",
        "dist.shasum",
        "carapace",
        "--json",
      ]);
      expectRecordFields(result.outcomes[0], {
        pluginId,
        status: "unchanged",
        currentVersion: "1.2.3",
        nextVersion: "1.2.4",
        message: `${pluginId} is pinned to ${spec} (installed 1.2.3); registry latest resolves to 1.2.4. Pass \`carapace plugins update ${packageName}@latest\` to replace this version pin.`,
      });
    },
  );

  it("updates disabled trusted official ClawHub installs through the catalog spec", async () => {
    installPluginFromClawHubMock.mockResolvedValue(
      createSuccessfulClawHubUpdateResult({
        pluginId: "diagnostics-otel",
        targetDir: "/tmp/diagnostics-otel",
        version: "2026.5.4",
        clawhubPackage: "@carapace/diagnostics-otel",
      }),
    );

    const config = createClawHubInstallConfig({
      pluginId: "diagnostics-otel",
      clawhubPackage: "@carapace/diagnostics-otel",
      spec: "clawhub:@carapace/diagnostics-otel@2026.5.3",
    });
    const result = await updateNpmInstalledPlugins({
      config: {
        ...config,
        plugins: {
          ...config.plugins,
          entries: {
            "diagnostics-otel": {
              enabled: false,
              config: { preserved: true },
            },
          },
        },
      },
      skipDisabledPlugins: true,
      syncOfficialPluginInstalls: true,
    });

    expect(clawHubInstallCall()?.spec).toBe("clawhub:@carapace/diagnostics-otel@2026.5.3");
    expect(clawHubInstallCall()?.expectedPluginId).toBe("diagnostics-otel");
    expectRecordFields(result.config.plugins?.installs?.["diagnostics-otel"], {
      source: "clawhub",
      spec: "clawhub:@carapace/diagnostics-otel@2026.5.3",
      version: "2026.5.4",
      clawhubPackage: "@carapace/diagnostics-otel",
      clawhubChannel: "official",
    });
    expect(result.config.plugins?.entries?.["diagnostics-otel"]).toEqual({
      enabled: false,
      config: { preserved: true },
    });
  });

  it("updates bare trusted official ClawHub installs through the catalog spec", async () => {
    installPluginFromClawHubMock.mockResolvedValue(
      createSuccessfulClawHubUpdateResult({
        pluginId: "diagnostics-prometheus",
        targetDir: "/tmp/diagnostics-prometheus",
        version: "2026.5.4",
        clawhubPackage: "@carapace/diagnostics-prometheus",
      }),
    );

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          installs: {
            "diagnostics-prometheus": {
              source: "clawhub",
              spec: "clawhub:@carapace/diagnostics-prometheus@2026.5.3",
              installPath: "/tmp/diagnostics-prometheus",
            },
          },
        },
      },
      syncOfficialPluginInstalls: true,
    });

    expect(clawHubInstallCall()?.spec).toBe("clawhub:@carapace/diagnostics-prometheus@2026.5.3");
    expect(clawHubInstallCall()?.expectedPluginId).toBe("diagnostics-prometheus");
    expectRecordFields(result.config.plugins?.installs?.["diagnostics-prometheus"], {
      source: "clawhub",
      spec: "clawhub:@carapace/diagnostics-prometheus@2026.5.3",
      version: "2026.5.4",
      clawhubPackage: "@carapace/diagnostics-prometheus",
      clawhubChannel: "official",
    });
  });

  it("keeps enabled tracked plugin update failures fatal when disabled skipping is enabled", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "registry timeout",
    });
    const config = {
      plugins: {
        entries: {
          demo: {
            enabled: true,
          },
        },
        installs: {
          demo: {
            source: "npm" as const,
            spec: "@acme/demo",
            installPath: "/tmp/demo",
          },
        },
      },
    } satisfies CarapaceConfig;

    const result = await updateNpmInstalledPlugins({
      config,
      skipDisabledPlugins: true,
      dryRun: true,
    });

    expect(npmInstallCall()?.spec).toBe("@acme/demo");
    expect(npmInstallCall()?.expectedPluginId).toBe("demo");
    expect(npmInstallCall()?.dryRun).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "error",
        message: "Failed to check demo: registry timeout",
      },
    ]);
  });

  it("disables failed plugin activation without revoking explicit policy", async () => {
    const warn = vi.fn();
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "registry timeout",
    });
    const config = {
      plugins: {
        entries: {
          demo: {
            enabled: true,
            config: { preserved: true },
          },
        },
        installs: {
          demo: {
            source: "npm" as const,
            spec: "@acme/demo",
            installPath: "/tmp/demo",
          },
        },
        allow: ["demo", "other"],
        deny: ["blocked"],
        slots: {
          memory: "demo",
          contextEngine: "demo",
        },
      },
    } satisfies CarapaceConfig;

    const result = await updateNpmInstalledPlugins({
      config,
      skipDisabledPlugins: true,
      disableOnFailure: true,
      logger: { warn },
    });

    expect(npmInstallCall()?.spec).toBe("@acme/demo");
    expect(npmInstallCall()?.expectedPluginId).toBe("demo");
    const message =
      'Disabled "demo" after plugin update failure; Carapace will continue without it. Failed to update demo: registry timeout';
    expect(warn).toHaveBeenCalledWith(message);
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.demo).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expect(result.config.plugins?.allow).toEqual(["demo", "other"]);
    expect(result.config.plugins?.deny).toEqual(["blocked"]);
    expect(result.config.plugins?.slots).toBeUndefined();
    expect(result.config.plugins?.installs?.demo).toEqual(config.plugins.installs.demo);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        message,
      },
    ]);
  });

  it("does not create trust policy when disabling a failed plugin", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "registry timeout",
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          entries: { demo: { enabled: true } },
          installs: {
            demo: {
              source: "npm",
              spec: "@acme/demo",
              installPath: "/tmp/demo",
            },
          },
        },
      },
      pluginIds: ["demo"],
      disableOnFailure: true,
    });

    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.demo?.enabled).toBe(false);
    expect(result.config.plugins?.allow).toBeUndefined();
    expect(result.config.plugins?.deny).toBeUndefined();
  });

  it.each([
    {
      name: "keeps an existing ClawHub plugin enabled when a newer target release is blocked",
      code: "clawhub_download_blocked",
      version: "1.2.4",
      error: "ClawHub blocked this release; update was not started.",
      warning:
        "╭─ BLOCKED - ClawHub flagged this release as malicious ─╮\n│ • Security scan: malicious │\n╰────────────────────────────────────────────────────────╯",
    },
    ...["1.2.4", "1.2.3"].map((version) => ({
      name: `keeps an existing ClawHub plugin enabled when ${version === "1.2.4" ? "newer" : "current"} target security data is unavailable`,
      code: "clawhub_security_unavailable",
      version,
      error: `ClawHub release "demo@${version}" could not be checked because ClawHub security data is unavailable. Try again later or choose a different version.`,
      warning: undefined,
    })),
  ])("$name", async ({ code, version, error, warning }) => {
    installPluginFromClawHubMock.mockResolvedValue({
      ok: false,
      code,
      ...(version ? { version } : {}),
      error,
      ...(warning ? { warning } : {}),
    });
    const config = createEnabledDemoClawHubInstallConfig();

    const result = await updatePlugin(config, "demo", { disableOnFailure: true });

    expect(clawHubInstallCall()?.spec).toBe("clawhub:demo");
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.config.plugins?.entries?.demo).toEqual({
      enabled: true,
      config: { preserved: true },
    });
    expect(result.config.plugins?.allow).toEqual(["demo"]);
    expect(result.config.plugins?.slots?.memory).toBe("demo");
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        code,
        currentVersion: "1.2.3",
        ...(warning ? { warning } : {}),
        message: `Skipped demo ClawHub update: ${error} Existing installed plugin left unchanged.`,
      },
    ]);
  });

  it("disables a blocked ClawHub plugin without changing trust policy", async () => {
    const warn = vi.fn();
    installPluginFromClawHubMock.mockResolvedValue({
      ok: false,
      code: "clawhub_download_blocked",
      version: "1.2.3",
      error: "ClawHub blocked this release; update was not started.",
      warning:
        "╭─ BLOCKED - ClawHub flagged this release as malicious ─╮\n│ • Security scan: malicious │\n╰────────────────────────────────────────────────────────╯",
    });
    const config = createEnabledDemoClawHubInstallConfig();

    const result = await updatePlugin(config, "demo", {
      disableOnFailure: true,
      logger: { warn },
    });

    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.demo).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expect(result.config.plugins?.allow).toEqual(["demo"]);
    expect(result.config.plugins?.slots).toBeUndefined();
    const message =
      'Disabled "demo" after plugin update failure; Carapace will continue without it. Failed to update demo: ClawHub blocked this release; update was not started. (ClawHub clawhub:demo).';
    expect(warn).toHaveBeenCalledWith(message);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        message,
      },
    ]);
  });

  it("aborts exact pinned npm plugin updates on integrity drift by default", async () => {
    const warn = vi.fn();
    installPluginFromNpmSpecMock.mockImplementation(
      async (params: {
        spec: string;
        onIntegrityDrift?: (drift: NpmInstallIntegrityDrift) => boolean | Promise<boolean>;
      }) => {
        const proceed = await params.onIntegrityDrift?.({
          spec: params.spec,
          expectedIntegrity: "sha512-old",
          actualIntegrity: "sha512-new",
          resolution: {
            integrity: "sha512-new",
            resolvedSpec: "@opik/opik-carapace@0.2.5",
            version: "0.2.5",
          },
        });
        if (proceed === false) {
          return {
            ok: false,
            error: "aborted: npm package integrity drift detected for @opik/opik-carapace@0.2.5",
          };
        }
        return createSuccessfulNpmUpdateResult();
      },
    );

    const config = createNpmInstallConfig({
      pluginId: "opik-carapace",
      spec: "@opik/opik-carapace@0.2.5",
      integrity: "sha512-old",
      installPath: "/tmp/opik-carapace",
    });
    const result = await updatePlugin(config, "opik-carapace", { logger: { warn } });

    expect(warn).toHaveBeenCalledWith(
      'Integrity drift for "opik-carapace" (@opik/opik-carapace@0.2.5): expected sha512-old, got sha512-new',
    );
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "opik-carapace",
        status: "error",
        message:
          "Failed to update opik-carapace: aborted: npm package integrity drift detected for @opik/opik-carapace@0.2.5",
      },
    ]);
  });

  it.each([
    {
      name: "formats package-not-found updates with a stable message",
      installerResult: {
        ok: false,
        code: "npm_package_not_found",
        error: "Package not found on npm: @carapace/missing.",
      },
      config: createNpmInstallConfig({
        pluginId: "missing",
        spec: "@carapace/missing",
        installPath: "/tmp/missing",
      }),
      pluginId: "missing",
      expectedMessage: "Failed to check missing: npm package not found for @carapace/missing.",
    },
    {
      name: "falls back to raw installer error for unknown error codes",
      installerResult: {
        ok: false,
        code: "invalid_npm_spec",
        error: "unsupported npm spec: github:evil/evil",
      },
      config: createNpmInstallConfig({
        pluginId: "bad",
        spec: "github:evil/evil",
        installPath: "/tmp/bad",
      }),
      pluginId: "bad",
      expectedMessage: "Failed to check bad: unsupported npm spec: github:evil/evil",
    },
  ] as const)("$name", async ({ installerResult, config, pluginId, expectedMessage }) => {
    installPluginFromNpmSpecMock.mockResolvedValue(installerResult);

    const result = await updateNpmInstalledPlugins({
      config,
      pluginIds: [pluginId],
      dryRun: true,
    });

    expect(result.outcomes).toEqual([
      {
        pluginId,
        status: "error",
        message: expectedMessage,
      },
    ]);
  });

  it.each([
    {
      name: "reuses a recorded npm dist-tag spec for id-based updates",
      installerResult: {
        ok: true,
        pluginId: "carapace-codex-app-server",
        targetDir: "/tmp/carapace-codex-app-server",
        version: "0.2.0-beta.4",
        extensions: ["index.ts"],
      },
      config: createCodexAppServerInstallConfig({
        spec: "carapace-codex-app-server@beta",
        resolvedName: "carapace-codex-app-server",
        resolvedSpec: "carapace-codex-app-server@0.2.0-beta.3",
      }),
      expectedSpec: "carapace-codex-app-server@beta",
      expectedVersion: "0.2.0-beta.4",
    },
    {
      name: "uses and persists an explicit npm spec override during updates",
      installerResult: {
        ok: true,
        pluginId: "carapace-codex-app-server",
        targetDir: "/tmp/carapace-codex-app-server",
        version: "0.2.0-beta.4",
        extensions: ["index.ts"],
        npmResolution: {
          name: "carapace-codex-app-server",
          version: "0.2.0-beta.4",
          resolvedSpec: "carapace-codex-app-server@0.2.0-beta.4",
        },
      },
      config: createCodexAppServerInstallConfig({
        spec: "carapace-codex-app-server",
      }),
      specOverrides: {
        "carapace-codex-app-server": "carapace-codex-app-server@beta",
      },
      expectedSpec: "carapace-codex-app-server@beta",
      expectedRecordSpec: "carapace-codex-app-server@beta",
      expectedVersion: "0.2.0-beta.4",
      expectedResolvedSpec: "carapace-codex-app-server@0.2.0-beta.4",
    },
  ] as const)(
    "$name",
    async ({
      installerResult,
      config,
      specOverrides,
      expectedSpec,
      expectedRecordSpec,
      expectedVersion,
      expectedResolvedSpec,
    }) => {
      installPluginFromNpmSpecMock.mockResolvedValue(installerResult);

      const result = await updatePlugin(
        config,
        "carapace-codex-app-server",
        specOverrides ? { specOverrides } : {},
      );

      expectNpmUpdateCall({
        spec: expectedSpec,
        expectedPluginId: "carapace-codex-app-server",
      });
      expectCodexAppServerInstallState({
        result,
        spec: expectedRecordSpec ?? expectedSpec,
        version: expectedVersion,
        ...(expectedResolvedSpec ? { resolvedSpec: expectedResolvedSpec } : {}),
      });
    },
  );

  it("preserves explicit official npm tag overrides during manual updates", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@carapace/acpx",
      installedVersion: "2026.5.2",
      registryVersion: "2026.5.3-beta.1",
      installerVersion: "2026.5.3-beta.1",
      installerResolvedSpec: "@carapace/acpx@2026.5.3-beta.1",
    });
    const result = await updatePlugin(config, "acpx", {
      specOverrides: { acpx: "@carapace/acpx@beta" },
    });

    expectNpmUpdateCall({
      spec: "@carapace/acpx@beta",
      expectedPluginId: "acpx",
    });
    expectRecordFields(result.config.plugins?.installs?.acpx, {
      spec: "@carapace/acpx@beta",
      version: "2026.5.3-beta.1",
      resolvedSpec: "@carapace/acpx@2026.5.3-beta.1",
    });
  });

  it.each(["carapace-codex-app-server", "carapace-codex-app-server@latest"])(
    "selects a newer npm beta release and preserves recorded intent %s",
    async (spec) => {
      mockNpmViewMetadata({ name: "carapace-codex-app-server", version: "0.2.0-beta.4" });
      mockNpmViewMetadata({ name: "carapace-codex-app-server", version: "0.1.9" });
      installPluginFromNpmSpecMock.mockResolvedValue(
        createSuccessfulNpmUpdateResult({
          pluginId: "carapace-codex-app-server",
          targetDir: "/tmp/carapace-codex-app-server",
          version: "0.2.0-beta.4",
          npmResolution: {
            name: "carapace-codex-app-server",
            version: "0.2.0-beta.4",
            resolvedSpec: "carapace-codex-app-server@0.2.0-beta.4",
          },
        }),
      );

      const result = await updateNpmInstalledPlugins({
        config: createCodexAppServerInstallConfig({
          spec,
        }),
        pluginIds: ["carapace-codex-app-server"],
        updateChannel: "beta",
      });

      expectNpmUpdateCall({
        spec: "carapace-codex-app-server@0.2.0-beta.4",
        expectedPluginId: "carapace-codex-app-server",
      });
      expectCodexAppServerInstallState({
        result,
        spec,
        version: "0.2.0-beta.4",
        resolvedSpec: "carapace-codex-app-server@0.2.0-beta.4",
      });
    },
  );

  it.each(
    [
      {
        channel: "extended-stable" as const,
        coreVersion: "2026.7.33",
        selectedVersion: "2026.7.33",
      },
      {
        channel: "beta" as const,
        coreVersion: "2026.8.1-beta.3",
        selectedVersion: "2026.8.1-beta.4",
      },
    ].flatMap(({ channel, coreVersion, selectedVersion }) =>
      ["@carapace/acpx", "@carapace/acpx@latest"].map((spec) => ({
        channel,
        coreVersion,
        selectedVersion,
        spec,
      })),
    ),
  )(
    "selects the official $channel release policy and preserves $spec",
    async ({ channel, coreVersion, selectedVersion, spec }) => {
      const { config } = createNpmUpdateFixture({
        pluginId: "acpx",
        packageName: "@carapace/acpx",
        spec,
        installedVersion: "2026.7.21",
        registryVersion: selectedVersion,
        installerVersion: selectedVersion,
        installerResolvedSpec: `@carapace/acpx@${selectedVersion}`,
      });
      if (channel === "beta") {
        mockNpmViewMetadata({ name: "@carapace/acpx", version: "2026.8.0" });
      }
      const result = await updatePlugin(config, "acpx", {
        syncOfficialPluginInstalls: true,
        officialPluginUpdateChannel: channel,
        coreVersion,
      });

      expectNpmUpdateCall({
        spec: `@carapace/acpx@${selectedVersion}`,
        expectedPluginId: "acpx",
      });
      expectRecordFields(result.config.plugins?.installs?.acpx, {
        spec,
        version: selectedVersion,
        resolvedSpec: `@carapace/acpx@${selectedVersion}`,
      });
    },
  );

  it("preserves an explicit official pin during extended-stable updates", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@carapace/acpx",
      installedVersion: "2026.6.33",
      spec: "@carapace/acpx@2026.6.33",
      installerVersion: "2026.6.33",
    });
    await updatePlugin(config, "acpx", {
      syncOfficialPluginInstalls: true,
      officialPluginUpdateChannel: "extended-stable",
      coreVersion: "2026.7.33",
      dryRun: true,
    });

    expectNpmUpdateCall({
      spec: "@carapace/acpx@2026.6.33",
      expectedPluginId: "acpx",
    });
  });

  it("lets an explicit bare official spec opt a legacy pin into exact-core tracking", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@carapace/acpx",
      installedVersion: "2026.6.21",
      registryVersion: "2026.7.33",
      spec: "@carapace/acpx@2026.6.21",
      installerVersion: "2026.7.33",
      installerResolvedSpec: "@carapace/acpx@2026.7.33",
    });
    const result = await updatePlugin(config, "acpx", {
      specOverrides: { acpx: "@carapace/acpx" },
      syncOfficialPluginInstalls: true,
      officialPluginUpdateChannel: "extended-stable",
      coreVersion: "2026.7.33",
    });

    expectNpmUpdateCall({
      spec: "@carapace/acpx@2026.7.33",
      expectedPluginId: "acpx",
    });
    expectRecordFields(result.config.plugins?.installs?.acpx, {
      spec: "@carapace/acpx",
      version: "2026.7.33",
      resolvedSpec: "@carapace/acpx@2026.7.33",
    });
  });

  it.each([false, true])(
    "selects latest before install when the beta tag is unavailable (dryRun=%s)",
    async (dryRun) => {
      runCommandWithTimeoutMock.mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "npm error code E404",
      });
      mockNpmViewMetadata({ name: "carapace-codex-app-server", version: "0.2.6" });
      installPluginFromNpmSpecMock.mockResolvedValue(
        createSuccessfulNpmUpdateResult({
          pluginId: "carapace-codex-app-server",
          targetDir: "/tmp/carapace-codex-app-server",
          version: "0.2.6",
          npmResolution: {
            name: "carapace-codex-app-server",
            version: "0.2.6",
            resolvedSpec: "carapace-codex-app-server@0.2.6",
          },
        }),
      );
      const config = createCodexAppServerInstallConfig({
        spec: "carapace-codex-app-server",
      });
      const result = await updatePlugin(config, "carapace-codex-app-server", {
        updateChannel: "beta",
        dryRun,
      });

      expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
      expect(npmInstallCall()?.spec).toBe("carapace-codex-app-server@0.2.6");
      expect(npmInstallCall()?.config).toBe(config);
      expect(result.outcomes[0]?.message).toBe(
        `${dryRun ? "Would update" : "Updated"} carapace-codex-app-server: unknown -> 0.2.6.`,
      );
      if (dryRun) {
        expect(result.config).toBe(config);
        expect(result.changed).toBe(false);
      } else {
        expectCodexAppServerInstallState({
          result,
          spec: "carapace-codex-app-server",
          version: "0.2.6",
          resolvedSpec: "carapace-codex-app-server@0.2.6",
        });
      }
    },
  );

  it.each([
    { code: "incompatible_plugin_api", error: "Incompatible artifact" },
    { code: "security_scan_blocked", error: "Denied package" },
    { code: "security_scan_failed", error: "Policy unavailable" },
    { error: "Integrity mismatch" },
    { code: "incompatible_host_version", error: "ETARGET in untrusted validation text" },
  ])("does not retry a refused beta artifact ($error)", async (failure) => {
    mockNpmViewMetadata({ name: "carapace-codex-app-server", version: "0.2.0-beta.4" });
    mockNpmViewMetadata({ name: "carapace-codex-app-server", version: "0.1.9" });
    installPluginFromNpmSpecMock.mockResolvedValue({ ok: false, ...failure });
    const result = await updatePlugin(
      createCodexAppServerInstallConfig({ spec: "carapace-codex-app-server" }),
      "carapace-codex-app-server",
      { updateChannel: "beta" },
    );
    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({
      status: "error",
      message: expect.stringContaining(failure.error),
    });
  });

  it("preserves explicit npm tags when updating on the beta channel", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "carapace-codex-app-server",
        targetDir: "/tmp/carapace-codex-app-server",
        version: "0.2.0-rc.1",
      }),
    );

    await updateNpmInstalledPlugins({
      config: createCodexAppServerInstallConfig({
        spec: "carapace-codex-app-server@rc",
      }),
      pluginIds: ["carapace-codex-app-server"],
      updateChannel: "beta",
      dryRun: true,
    });

    expectNpmUpdateCall({
      spec: "carapace-codex-app-server@rc",
      expectedPluginId: "carapace-codex-app-server",
    });
  });

  it("updates ClawHub-installed plugins via recorded package metadata", async () => {
    installPluginFromClawHubMock.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: "/tmp/demo",
      version: "1.2.4",
      clawhub: {
        source: "clawhub",
        clawhubUrl: "https://clawhub.ai",
        clawhubPackage: "demo",
        clawhubFamily: "code-plugin",
        clawhubChannel: "official",
        artifactKind: "npm-pack",
        artifactFormat: "tgz",
        npmIntegrity: "sha512-next",
        npmShasum: "1".repeat(40),
        npmTarballName: "demo-1.2.4.tgz",
        integrity: "sha256-next",
        resolvedAt: "2026-03-22T00:00:00.000Z",
        clawpackSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        clawpackSpecVersion: 1,
        clawpackManifestSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        clawpackSize: 4096,
      },
    });

    const config = createClawHubInstallConfig();
    delete config.plugins?.installs?.demo?.clawhubPackage;
    config.plugins!.installs!.demo!.resolvedSpec = "clawhub:demo@1.2.3";
    delete config.plugins?.installs?.demo?.spec;
    const result = await updatePlugin(config, "demo", { timeoutMs: 1_800_000 });

    expect(clawHubInstallCall()?.spec).toBe("clawhub:demo@1.2.3");
    expect(clawHubInstallCall()?.baseUrl).toBe("https://clawhub.ai");
    expect(clawHubInstallCall()?.expectedPluginId).toBe("demo");
    expect(clawHubInstallCall()?.mode).toBe("update");
    expect(clawHubInstallCall()?.timeoutMs).toBe(1_800_000);
    expect(withClawPackageLifecycleLeaseMock).toHaveBeenCalledWith(
      { kind: "plugin", source: "clawhub", ref: "demo" },
      expect.any(Function),
      { required: true },
    );
    expect(markClawPackageIndependentlyOwnedMock).toHaveBeenCalledWith({
      kind: "plugin",
      source: "clawhub",
      ref: "demo",
    });
    expectRecordFields(result.config.plugins?.installs?.demo, {
      source: "clawhub",
      spec: "clawhub:demo@1.2.3",
      installPath: "/tmp/demo",
      version: "1.2.4",
      clawhubPackage: "demo",
      clawhubFamily: "code-plugin",
      clawhubChannel: "official",
      artifactKind: "npm-pack",
      artifactFormat: "tgz",
      npmIntegrity: "sha512-next",
      npmShasum: "1".repeat(40),
      npmTarballName: "demo-1.2.4.tgz",
      integrity: "sha256-next",
      clawpackSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      clawpackSpecVersion: 1,
      clawpackManifestSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      clawpackSize: 4096,
    });
  });

  it("records a busy ClawHub lifecycle lease as one plugin update failure", async () => {
    withClawPackageLifecycleLeaseMock.mockRejectedValueOnce(new Error("package busy"));
    const result = await updatePlugin(createClawHubInstallConfig(), "demo");

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({
        pluginId: "demo",
        status: "error",
        message: expect.stringContaining("package busy"),
      }),
    );
    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
  });

  it.each(["clawhub:demo", "clawhub:demo@latest"])(
    "tries ClawHub beta and preserves recorded intent %s",
    async (spec) => {
      installPluginFromClawHubMock.mockResolvedValue(
        createSuccessfulClawHubUpdateResult({
          pluginId: "demo",
          targetDir: "/tmp/demo",
          version: "1.3.0-beta.1",
          clawhubPackage: "demo",
        }),
      );

      const result = await updatePlugin(createClawHubInstallConfig({ spec }), "demo", {
        updateChannel: "beta",
      });

      expect(clawHubInstallCall()?.spec).toBe("clawhub:demo@beta");
      expect(clawHubInstallCall()?.baseUrl).toBe("https://clawhub.ai");
      expect(clawHubInstallCall()?.expectedPluginId).toBe("demo");
      expectRecordFields(result.config.plugins?.installs?.demo, {
        source: "clawhub",
        spec,
        installPath: "/tmp/demo",
        version: "1.3.0-beta.1",
        clawhubPackage: "demo",
      });
    },
  );

  it.each([
    {
      channel: "beta",
      spec: "clawhub:@carapace/discord",
      expectedSpec: "clawhub:@carapace/discord@beta",
      version: "2026.5.4-beta.1",
    },
    {
      channel: "extended-stable",
      spec: "clawhub:@carapace/discord",
      expectedSpec: "clawhub:@carapace/discord@2026.7.33",
      version: "2026.7.33",
    },
    {
      channel: "extended-stable",
      spec: "clawhub:@carapace/discord@latest",
      expectedSpec: "clawhub:@carapace/discord@2026.7.33",
      version: "2026.7.33",
    },
    {
      channel: "extended-stable",
      spec: "clawhub:@carapace/discord@rc",
      expectedSpec: "clawhub:@carapace/discord@rc",
      version: "2026.7.34-rc.1",
    },
    {
      channel: "extended-stable",
      spec: "clawhub:@carapace/discord@2026.6.33",
      expectedSpec: "clawhub:@carapace/discord@2026.6.33",
      version: "2026.6.33",
    },
  ] as const)(
    "updates official $spec on $channel with npm-only catalog metadata and preserves its selector",
    async ({ channel, spec, expectedSpec, version }) => {
      installPluginFromClawHubMock.mockResolvedValue(
        createSuccessfulClawHubUpdateResult({
          pluginId: "discord",
          targetDir: "/tmp/discord",
          version,
          clawhubPackage: "@carapace/discord",
        }),
      );

      const result = await updatePlugin(
        createClawHubInstallConfig({
          pluginId: "discord",
          clawhubPackage: "@carapace/discord",
          spec,
        }),
        "discord",
        { officialPluginUpdateChannel: channel, coreVersion: "2026.7.33" },
      );

      expect(clawHubInstallCall()?.spec).toBe(expectedSpec);
      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expectRecordFields(result.config.plugins?.installs?.discord, {
        source: "clawhub",
        spec,
        version,
        clawhubPackage: "@carapace/discord",
      });
    },
  );

  it.each([
    { channel: "beta", explicit: false },
    { channel: "extended-stable", explicit: false },
    { channel: "extended-stable", explicit: true },
  ] as const)(
    "does not core-pin custom ClawHub provenance on $channel (explicit: $explicit)",
    async ({ channel, explicit }) => {
      installPluginFromClawHubMock.mockResolvedValue(
        createSuccessfulClawHubUpdateResult({
          pluginId: "discord",
          targetDir: "/tmp/discord",
          version: "2026.5.4",
          clawhubPackage: "@carapace/discord",
        }),
      );

      await updatePlugin(
        createClawHubInstallConfig({
          pluginId: "discord",
          clawhubPackage: "@carapace/discord",
          clawhubUrl: "https://custom-clawhub.example",
        }),
        "discord",
        {
          ...(explicit ? { updateChannel: channel } : { officialPluginUpdateChannel: channel }),
          coreVersion: "2026.7.33",
        },
      );

      expect(clawHubInstallCall()?.spec).toBe("clawhub:@carapace/discord");
    },
  );

  it("falls back to the default ClawHub spec when a beta release is unavailable", async () => {
    installPluginFromClawHubMock
      .mockResolvedValueOnce({
        ok: false,
        code: "version_not_found",
        error: "version not found: beta",
      })
      .mockResolvedValueOnce(
        createSuccessfulClawHubUpdateResult({
          pluginId: "demo",
          targetDir: "/tmp/demo",
          version: "1.2.4",
          clawhubPackage: "demo",
        }),
      );

    const warnMessages: string[] = [];
    const result = await updatePlugin(createClawHubInstallConfig(), "demo", {
      updateChannel: "beta",
      logger: { warn: (msg) => warnMessages.push(msg) },
    });

    expect(clawHubInstallCall(0)?.spec).toBe("clawhub:demo@beta");
    expect(clawHubInstallCall(1)?.spec).toBe("clawhub:demo");
    expect(warnMessages).toEqual([
      'Plugin "demo" has no beta ClawHub release for clawhub:demo@beta; using clawhub:demo instead. Core update can still complete.',
    ]);
    expectRecordFields(result.config.plugins?.installs?.demo, {
      source: "clawhub",
      spec: "clawhub:demo",
      installPath: "/tmp/demo",
      version: "1.2.4",
      clawhubPackage: "demo",
    });
    expect(result.outcomes[0]?.message).toBe(
      "Updated demo: unknown -> 1.2.4. (warning: beta channel fallback used clawhub:demo because clawhub:demo@beta could not be used).",
    );
  });

  it("does not fall back to npm for blocked official ClawHub artifact downloads", async () => {
    const warnMessages: string[] = [];
    const installPath = createInstalledPackageDir({
      name: "@carapace/discord",
      version: "2026.5.12",
    });
    installPluginFromClawHubMock.mockResolvedValueOnce({
      ok: false,
      code: "clawhub_download_blocked",
      error:
        'ClawHub blocked artifact download for "@carapace/discord@2026.5.16-beta.5"; install was not started. ClawHub /api/v1/packages/%40carapace%2Fdiscord/versions/2026.5.16-beta.5/artifact/download failed (403): Blocked: this package release has been flagged as malicious and cannot be downloaded.',
      version: "2026.5.16-beta.5",
    });

    const result = await updatePlugin(
      createClawHubInstallConfig({
        pluginId: "discord",
        installPath,
        clawhubPackage: "@carapace/discord",
      }),
      "discord",
      {
        updateChannel: "beta",
        disableOnFailure: true,
        logger: { warn: (msg) => warnMessages.push(msg) },
      },
    );

    expect(clawHubInstallCall()?.spec).toBe("clawhub:@carapace/discord@beta");
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.config.plugins?.entries?.discord?.enabled).toBeUndefined();
    expectRecordFields(result.config.plugins?.installs?.discord, {
      source: "clawhub",
      spec: "clawhub:@carapace/discord",
      installPath,
      clawhubPackage: "@carapace/discord",
    });
    expect(result.outcomes).toEqual([
      {
        pluginId: "discord",
        status: "skipped",
        code: "clawhub_download_blocked",
        currentVersion: "2026.5.12",
        message:
          'Skipped discord ClawHub update: ClawHub blocked artifact download for "@carapace/discord@2026.5.16-beta.5"; install was not started. ClawHub /api/v1/packages/%40carapace%2Fdiscord/versions/2026.5.16-beta.5/artifact/download failed (403): Blocked: this package release has been flagged as malicious and cannot be downloaded. Existing installed plugin left unchanged.',
      },
    ]);
    expect(warnMessages).toStrictEqual([]);
  });

  it.each(["stable", "beta", "extended-stable"] as const)(
    "keeps ambiguous historical ClawHub source intent on %s",
    async (channel) => {
      const config = createClawHubInstallConfig({
        pluginId: "discord",
        clawhubPackage: "@carapace/discord",
      });
      installPluginFromClawHubMock.mockResolvedValue({
        ok: false,
        code: "artifact_unavailable",
        error: "artifact unavailable",
      });
      const result = await updatePlugin(config, "discord", {
        syncOfficialPluginInstalls: true,
        officialPluginUpdateChannel: channel,
        coreVersion: "2026.7.33",
        dryRun: true,
      });
      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expect(result.config).toBe(config);
      expect(result.outcomes[0]).toMatchObject({
        status: "error",
        message: expect.stringContaining("artifact unavailable"),
      });
    },
  );

  it("does not fall back to trusted npm from custom ClawHub provenance", async () => {
    const installPath = createInstalledPackageDir({
      name: "@carapace/discord",
      version: "2026.5.12",
    });
    installPluginFromClawHubMock.mockResolvedValueOnce({
      ok: false,
      code: "artifact_unavailable",
      error: "artifact unavailable",
    });

    const result = await updatePlugin(
      createClawHubInstallConfig({
        pluginId: "discord",
        installPath,
        clawhubUrl: "https://custom-clawhub.example",
        clawhubPackage: "@carapace/discord",
      }),
      "discord",
      { updateChannel: "beta" },
    );

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      {
        pluginId: "discord",
        status: "error",
        message:
          "Failed to update discord: artifact unavailable (ClawHub clawhub:@carapace/discord@beta).",
      },
    ]);
  });

  it("preserves explicit ClawHub tags when updating on the beta channel", async () => {
    installPluginFromClawHubMock.mockResolvedValue(
      createSuccessfulClawHubUpdateResult({
        pluginId: "demo",
        targetDir: "/tmp/demo",
        version: "1.3.0-rc.1",
        clawhubPackage: "demo",
      }),
    );

    await updatePlugin(createClawHubInstallConfig({ spec: "clawhub:demo@rc" }), "demo", {
      updateChannel: "beta",
      dryRun: true,
    });

    expect(clawHubInstallCall()?.spec).toBe("clawhub:demo@rc");
  });

  it.each([
    {
      name: "skips ClawHub plugin update when bundled version is newer",
      pluginId: "whatsapp",
      bundledVersion: "2026.4.20",
      installedVersion: "2026.2.9",
      clawhubFamily: "bundle-plugin",
      clawhubChannel: "community",
      nextVersion: undefined,
    },
    {
      name: "proceeds with ClawHub plugin update when bundled version is older",
      pluginId: "demo",
      bundledVersion: "1.0.0",
      installedVersion: "1.5.0",
      clawhubFamily: "code-plugin",
      clawhubChannel: "official",
      nextVersion: "2.0.0",
    },
    {
      name: "does not treat an older bundled stable release as newer than an installed correction release",
      pluginId: "demo",
      bundledVersion: "2026.5.3",
      installedVersion: "2026.5.3-1",
      clawhubFamily: "code-plugin",
      clawhubChannel: "official",
      nextVersion: "2026.5.3-2",
    },
  ] as const)(
    "$name",
    async ({
      pluginId,
      bundledVersion,
      installedVersion,
      clawhubFamily,
      clawhubChannel,
      nextVersion,
    }) => {
      resolveBundledPluginSourcesMock.mockReturnValue(
        new Map([
          [
            pluginId,
            { pluginId, localPath: appBundledPluginRoot(pluginId), version: bundledVersion },
          ],
        ]),
      );
      if (nextVersion) {
        installPluginFromClawHubMock.mockResolvedValue(
          createSuccessfulClawHubUpdateResult({
            pluginId,
            targetDir: `/tmp/${pluginId}`,
            version: nextVersion,
            clawhubPackage: pluginId,
          }),
        );
      }
      const config = createClawHubInstallConfig({ pluginId, clawhubFamily, clawhubChannel });
      const install = config.plugins?.installs?.[pluginId];
      if (!install) {
        throw new Error(`Missing ClawHub install fixture for ${pluginId}`);
      }
      install.version = installedVersion;
      const warnings: string[] = [];
      const result = await updatePlugin(config, pluginId, {
        logger: { warn: (message) => warnings.push(message) },
      });

      if (!nextVersion) {
        expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
        expect(result.changed).toBe(false);
        expect(result.outcomes).toHaveLength(1);
        expectRecordFields(result.outcomes[0], { pluginId, status: "skipped" });
        expect(result.outcomes[0]?.message).toContain(`bundled version ${bundledVersion} is newer`);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`bundled version ${bundledVersion} is newer`);
        return;
      }

      expect(installPluginFromClawHubMock).toHaveBeenCalled();
      expect(result.changed).toBe(true);
      if (installedVersion.includes("-")) {
        expectRecordFields(result.outcomes[0], {
          pluginId,
          status: "updated",
          currentVersion: undefined,
          nextVersion,
        });
      }
    },
  );

  it("migrates legacy unscoped install keys when a scoped npm package updates", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: true,
      pluginId: "@carapace/voice-call",
      targetDir: "/tmp/carapace-voice-call",
      version: "0.0.2",
      extensions: ["index.ts"],
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          allow: ["voice-call"],
          deny: ["voice-call"],
          slots: { memory: "voice-call" },
          entries: {
            "voice-call": {
              enabled: false,
              hooks: { allowPromptInjection: false },
            },
          },
          installs: {
            "voice-call": {
              source: "npm",
              spec: "@carapace/voice-call",
              installPath: "/tmp/voice-call",
            },
          },
        },
      },
      pluginIds: ["voice-call"],
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/voice-call");
    expect(npmInstallCall()?.expectedPluginId).toBe("voice-call");
    expect(result.config.plugins?.allow).toEqual(["@carapace/voice-call"]);
    expect(result.config.plugins?.deny).toEqual(["@carapace/voice-call"]);
    expect(result.config.plugins?.slots?.memory).toBe("@carapace/voice-call");
    expect(result.config.plugins?.entries?.["@carapace/voice-call"]).toEqual({
      enabled: false,
      hooks: { allowPromptInjection: false },
    });
    expect(result.config.plugins?.entries?.["voice-call"]).toBeUndefined();
    expectRecordFields(result.config.plugins?.installs?.["@carapace/voice-call"], {
      source: "npm",
      spec: "@carapace/voice-call",
      installPath: "/tmp/carapace-voice-call",
      version: "0.0.2",
    });
    expect(result.config.plugins?.installs?.["voice-call"]).toBeUndefined();
  });

  it.each([
    {
      name: "beta",
      params: { officialPluginUpdateChannel: "beta" as const },
      expectedInstallSpec: "@carapace/fish-audio-speech@2026.8.1",
      expectedRecordSpec: "@carapace/fish-audio-speech",
    },
    {
      name: "stable",
      params: { officialPluginUpdateChannel: "stable" as const },
      expectedInstallSpec: "@carapace/fish-audio-speech",
      expectedRecordSpec: "@carapace/fish-audio-speech",
    },
    {
      name: "extended-stable",
      params: {
        officialPluginUpdateChannel: "extended-stable" as const,
        coreVersion: "2026.8.1",
      },
      expectedInstallSpec: "@carapace/fish-audio-speech@2026.8.1",
      expectedRecordSpec: "@carapace/fish-audio-speech",
    },
    {
      name: "explicit override",
      params: {
        officialPluginUpdateChannel: "beta" as const,
        specOverrides: { "fish-audio": "@carapace/fish-audio-speech@next" },
      },
      expectedInstallSpec: "@carapace/fish-audio-speech@next",
      expectedRecordSpec: "@carapace/fish-audio-speech@next",
    },
  ])(
    "selects the $name package line when migrating a manifest-declared legacy id",
    async ({ params, expectedInstallSpec, expectedRecordSpec }) => {
      if (params.officialPluginUpdateChannel === "beta" && !params.specOverrides) {
        mockNpmViewMetadata({ name: "@carapace/fish-audio-speech", version: "2026.8.1-beta.1" });
        mockNpmViewMetadata({ name: "@carapace/fish-audio-speech", version: "2026.8.1" });
      }
      installPluginFromNpmSpecMock.mockResolvedValue({
        ok: true,
        pluginId: "fish-audio-speech",
        targetDir: "/tmp/fish-audio-speech",
        version: "2026.8.1",
        extensions: ["index.js"],
      });

      const result = await updateNpmInstalledPlugins({
        config: {
          plugins: {
            allow: ["fish-audio"],
            entries: { "fish-audio": { enabled: true } },
            installs: {
              "fish-audio": {
                source: "npm",
                spec: "@carapace/fish-audio-speech@2026.7.2-beta.7",
                resolvedName: "@carapace/fish-audio-speech",
                resolvedSpec: "@carapace/fish-audio-speech@2026.7.2-beta.7",
                installPath: "/tmp/fish-audio",
              },
            },
          },
        },
        pluginIds: ["fish-audio"],
        ...params,
      });

      expectNpmUpdateCall({
        spec: expectedInstallSpec,
        expectedPluginId: "fish-audio",
      });
      expect(npmInstallCall()?.expectedReplacementPluginId).toBe("fish-audio-speech");
      expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
      expect(result.config.plugins?.allow).toEqual(["fish-audio-speech"]);
      expect(result.config.plugins?.entries?.["fish-audio-speech"]).toEqual({ enabled: true });
      expect(result.config.plugins?.entries?.["fish-audio"]).toBeUndefined();
      expectRecordFields(result.config.plugins?.installs?.["fish-audio-speech"], {
        source: "npm",
        spec: expectedRecordSpec,
        installPath: "/tmp/fish-audio-speech",
        version: "2026.8.1",
      });
      expect(result.config.plugins?.installs?.["fish-audio"]).toBeUndefined();
    },
  );

  it("rewrites @carapace/qqbot under the canonical plugin id", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "carapace-qqbot",
        targetDir: "/tmp/carapace-qqbot",
        version: "2.0.3",
        npmResolution: {
          name: "@tencent-connect/carapace-qqbot",
          version: "2.0.3",
          resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.3",
        },
      }),
    );

    const result = await updatePlugin(
      createNpmInstallConfig({
        pluginId: "carapace-qqbot",
        spec: "@carapace/qqbot@1.9.0",
        installPath: "/tmp/carapace-qqbot",
        resolvedName: "@carapace/qqbot",
        resolvedSpec: "@carapace/qqbot@1.9.0",
        resolvedVersion: "1.9.0",
      }),
      "carapace-qqbot",
    );

    expectNpmUpdateCall({
      spec: "@tencent-connect/carapace-qqbot@2.0.3",
      expectedIntegrity: QQBOT_EXPECTED_INTEGRITY,
      expectedPluginId: "carapace-qqbot",
    });
    expect(npmInstallCall()?.expectedReplacementPluginId).toBeUndefined();
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expectRecordFields(result.config.plugins?.installs?.["carapace-qqbot"], {
      source: "npm",
      spec: "@tencent-connect/carapace-qqbot@2.0.3",
      installPath: "/tmp/carapace-qqbot",
      version: "2.0.3",
    });
  });

  it("aborts a renamed official package update when its artifact differs from the catalog pin", async () => {
    const installPath = createInstalledPackageDir({
      name: "@carapace/qqbot",
      version: "1.9.0",
    });
    mockNpmViewMetadata({
      name: "@tencent-connect/carapace-qqbot",
      version: "2.0.3",
      integrity: "sha512-republished",
    });
    installPluginFromNpmSpecMock.mockImplementation(
      async (params: {
        expectedIntegrity?: string;
        onIntegrityDrift?: (drift: NpmInstallIntegrityDrift) => boolean | Promise<boolean>;
        spec: string;
      }) => {
        const proceed = await params.onIntegrityDrift?.({
          spec: params.spec,
          expectedIntegrity: params.expectedIntegrity!,
          actualIntegrity: "sha512-republished",
          resolution: {
            integrity: "sha512-republished",
            resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.3",
            version: "2.0.3",
          },
        });
        return proceed === false
          ? {
              ok: false as const,
              error:
                "aborted: npm package integrity drift detected for @tencent-connect/carapace-qqbot@2.0.3",
            }
          : createSuccessfulNpmUpdateResult();
      },
    );
    const config = createNpmInstallConfig({
      pluginId: "qqbot",
      spec: "@carapace/qqbot@1.9.0",
      installPath,
      resolvedName: "@carapace/qqbot",
      resolvedSpec: "@carapace/qqbot@1.9.0",
      resolvedVersion: "1.9.0",
    });
    const warn = vi.fn();

    const result = await updatePlugin(config, "qqbot", { logger: { warn } });

    expectNpmUpdateCall({
      spec: "@tencent-connect/carapace-qqbot@2.0.3",
      expectedIntegrity: QQBOT_EXPECTED_INTEGRITY,
      expectedPluginId: "qqbot",
    });
    expect(npmInstallCall()?.expectedReplacementPluginId).toBe("carapace-qqbot");
    expect(warn).toHaveBeenCalledWith(
      `Integrity drift for "qqbot" (@tencent-connect/carapace-qqbot@2.0.3): expected ${QQBOT_EXPECTED_INTEGRITY}, got sha512-republished`,
    );
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "qqbot",
        status: "error",
        message:
          "Failed to update qqbot: aborted: npm package integrity drift detected for @tencent-connect/carapace-qqbot@2.0.3",
      },
    ]);
  });

  it("does not apply the catalog pin to an explicit renamed-package override", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "carapace-qqbot",
        targetDir: "/tmp/carapace-qqbot",
        version: "2.0.4",
      }),
    );
    const config = createNpmInstallConfig({
      pluginId: "carapace-qqbot",
      spec: "@carapace/qqbot@1.9.0",
      installPath: "/tmp/carapace-qqbot",
      resolvedName: "@carapace/qqbot",
      resolvedSpec: "@carapace/qqbot@1.9.0",
      resolvedVersion: "1.9.0",
    });

    await updatePlugin(config, "carapace-qqbot", {
      specOverrides: {
        "carapace-qqbot": "@tencent-connect/carapace-qqbot@2.0.4",
      },
    });

    expectNpmUpdateCall({
      spec: "@tencent-connect/carapace-qqbot@2.0.4",
      expectedPluginId: "carapace-qqbot",
    });
  });

  it("migrates the qqbot install id and preserves root plus multi-account channel config", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "carapace-qqbot",
        targetDir: "/tmp/carapace-qqbot",
        version: "2.0.3",
        npmResolution: {
          name: "@tencent-connect/carapace-qqbot",
          version: "2.0.3",
          resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.3",
        },
      }),
    );
    const qqbotConfig = {
      enabled: true,
      appId: "root-app",
      clientSecret: "root-secret",
      accounts: {
        primary: { appId: "primary-app", clientSecret: "primary-secret" },
        secondary: { appId: "secondary-app", clientSecret: "secondary-secret" },
      },
    };
    const config = createNpmInstallConfig({
      pluginId: "qqbot",
      spec: "@carapace/qqbot@1.9.0",
      installPath: "/tmp/carapace-qqbot",
      resolvedName: "@carapace/qqbot",
      resolvedSpec: "@carapace/qqbot@1.9.0",
      resolvedVersion: "1.9.0",
    });
    config.channels = { qqbot: qqbotConfig };

    const result = await updatePlugin(config, "qqbot");

    expectNpmUpdateCall({
      spec: "@tencent-connect/carapace-qqbot@2.0.3",
      expectedIntegrity: QQBOT_EXPECTED_INTEGRITY,
      expectedPluginId: "qqbot",
    });
    expect(npmInstallCall()?.expectedReplacementPluginId).toBe("carapace-qqbot");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.config.channels?.qqbot).toEqual(qqbotConfig);
    expect(result.config.plugins?.installs?.qqbot).toBeUndefined();
    expectRecordFields(result.config.plugins?.installs?.["carapace-qqbot"], {
      source: "npm",
      spec: "@tencent-connect/carapace-qqbot@2.0.3",
      installPath: "/tmp/carapace-qqbot",
      version: "2.0.3",
    });
  });

  it.each([
    { name: "npm-pack archive", provenance: { artifactKind: "npm-pack" as const } },
    { name: "local source path", provenance: { sourcePath: "/tmp/local-carapace-qqbot" } },
  ])("does not migrate a legacy $name install into official ownership", async ({ provenance }) => {
    const installPath = createInstalledPackageDir({
      name: "@carapace/qqbot",
      version: "1.9.0",
    });
    mockNpmViewMetadata({ name: "@carapace/qqbot", version: "1.9.1" });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "qqbot",
        targetDir: installPath,
        version: "1.9.1",
        npmResolution: {
          name: "@carapace/qqbot",
          version: "1.9.1",
          resolvedSpec: "@carapace/qqbot@1.9.1",
        },
      }),
    );
    const config = {
      plugins: {
        entries: { qqbot: { enabled: true } },
        installs: {
          qqbot: {
            source: "npm",
            spec: "@carapace/qqbot@1.9.0",
            installPath,
            resolvedName: "@carapace/qqbot",
            resolvedSpec: "@carapace/qqbot@1.9.0",
            ...provenance,
          },
          "carapace-qqbot": {
            source: "npm",
            spec: "@tencent-connect/carapace-qqbot@2.0.3",
            resolvedName: "@tencent-connect/carapace-qqbot",
            resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.3",
          },
        },
      },
    } satisfies CarapaceConfig;

    const result = await updatePlugin(config, "qqbot");

    expectNpmUpdateCall({
      spec: "@carapace/qqbot@1.9.0",
      expectedPluginId: "qqbot",
    });
    expect(npmInstallCall()?.expectedIntegrity).toBeUndefined();
    expect(npmInstallCall()?.expectedReplacementPluginId).toBeUndefined();
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).not.toBe(true);
    expect(result.config.plugins?.entries?.qqbot).toEqual({ enabled: true });
    expect(result.config.plugins?.installs?.qqbot).toBeDefined();
    expect(result.config.plugins?.installs?.["carapace-qqbot"]).toEqual(
      config.plugins.installs["carapace-qqbot"],
    );
    expect(resolvePluginInstallOwnerMigrations(result)).toBeUndefined();
    expect(result.outcomes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Removed duplicate") }),
      ]),
    );
  });

  it.each([false, true])(
    "drops a duplicate qqbot record after canonical success (canonicalFirst=%s)",
    async (canonicalFirst) => {
      const canonicalInstallPath = createInstalledPackageDir({
        name: "@tencent-connect/carapace-qqbot",
        version: "2.0.0",
        runnable: true,
      });
      mockNpmViewMetadata({ name: "@tencent-connect/carapace-qqbot", version: "2.0.1" });
      validatePackageExtensionEntriesForInstallMock.mockResolvedValueOnce({ ok: true });
      installPluginFromNpmSpecMock.mockResolvedValue(
        createSuccessfulNpmUpdateResult({
          pluginId: "carapace-qqbot",
          targetDir: canonicalInstallPath,
          version: "2.0.1",
          npmResolution: {
            name: "@tencent-connect/carapace-qqbot",
            version: "2.0.1",
            resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.1",
          },
        }),
      );

      const result = await updateNpmInstalledPlugins({
        config: createDuplicateQqbotConfig({ canonicalFirst, canonicalInstallPath }),
      });

      expectNpmUpdateCall({
        spec: "@tencent-connect/carapace-qqbot@2.0.1",
        expectedPluginId: "carapace-qqbot",
      });
      expect(result.outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pluginId: "qqbot",
            status: "skipped",
            message:
              'Removed duplicate "qqbot" install record; "carapace-qqbot" is the canonical plugin id.',
          }),
        ]),
      );
      expect(result.config.plugins?.installs?.qqbot).toBeUndefined();
      expectRecordFields(result.config.plugins?.installs?.["carapace-qqbot"], {
        source: "npm",
        spec: "@tencent-connect/carapace-qqbot@2.0.1",
        installPath: canonicalInstallPath,
        version: "2.0.1",
      });
      expect(resolvePluginInstallOwnerMigrations(result)).toEqual({
        qqbot: "carapace-qqbot",
      });
    },
  );

  it.each([false, true])(
    "keeps the working qqbot alias after canonical failure (canonicalFirst=%s)",
    async (canonicalFirst) => {
      installPluginFromNpmSpecMock.mockResolvedValue({
        ok: false,
        error: "canonical package install failed",
      });
      const config = createDuplicateQqbotConfig({ canonicalFirst });

      const result = await updateNpmInstalledPlugins({ config });

      expect(result.changed).toBe(false);
      expect(result.config).toBe(config);
      expect(result.config.plugins?.entries?.qqbot).toEqual({ enabled: true });
      expect(result.config.plugins?.installs).toEqual(config.plugins?.installs);
      expect(resolvePluginInstallOwnerMigrations(result)).toBeUndefined();
      expect(result.outcomes).toEqual([
        {
          pluginId: "carapace-qqbot",
          status: "error",
          message: "Failed to update carapace-qqbot: canonical package install failed",
        },
        {
          pluginId: "qqbot",
          status: "skipped",
          message:
            'Kept duplicate "qqbot" install record because "carapace-qqbot" did not complete a runnable canonical update.',
        },
      ]);
    },
  );

  it.each([
    { payload: "runnable", removesAlias: true },
    { payload: "corrupt", removesAlias: false },
    { payload: "missing", removesAlias: false },
  ])("handles a skipped canonical $payload payload", async ({ payload, removesAlias }) => {
    const canonicalInstallPath =
      payload === "missing"
        ? path.join(makeTrackedTempDir("carapace-plugin-update-missing", tempDirs), "missing")
        : createInstalledPackageDir({
            name: "@tencent-connect/carapace-qqbot",
            version: "2.0.1",
            runnable: payload === "runnable",
          });
    if (payload === "runnable") {
      validatePackageExtensionEntriesForInstallMock.mockResolvedValueOnce({ ok: true });
    }
    const result = await updateNpmInstalledPlugins({
      config: createDuplicateQqbotConfig({ canonicalInstallPath }),
      pluginIds: ["qqbot"],
      skipIds: new Set(["carapace-qqbot"]),
    });

    expect(result.changed).toBe(removesAlias);
    expect(result.config.plugins?.installs?.qqbot === undefined).toBe(removesAlias);
    expect(resolvePluginInstallOwnerMigrations(result)).toEqual(
      removesAlias ? { qqbot: "carapace-qqbot" } : undefined,
    );
  });

  it("does not remove the alias when canonical failure disables the canonical plugin", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "canonical package install failed",
    });
    const result = await updateNpmInstalledPlugins({
      config: createDuplicateQqbotConfig(),
      disableOnFailure: true,
    });

    expect(result.config.plugins?.installs?.qqbot).toBeDefined();
    expect(resolvePluginInstallOwnerMigrations(result)).toBeUndefined();
    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: "qqbot",
          message:
            'Kept duplicate "qqbot" install record because "carapace-qqbot" did not complete a runnable canonical update.',
        }),
      ]),
    );
  });

  it("reports duplicate removal without mutating on dry-run", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "carapace-qqbot",
        version: "2.0.3",
        npmResolution: {
          name: "@tencent-connect/carapace-qqbot",
          version: "2.0.3",
          resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.3",
        },
      }),
    );
    const config = {
      plugins: {
        installs: {
          qqbot: {
            source: "npm",
            spec: "@carapace/qqbot@1.9.0",
            resolvedName: "@carapace/qqbot",
            resolvedSpec: "@carapace/qqbot@1.9.0",
          },
          "carapace-qqbot": {
            source: "npm",
            spec: "@tencent-connect/carapace-qqbot@2.0.1",
            resolvedName: "@tencent-connect/carapace-qqbot",
            resolvedSpec: "@tencent-connect/carapace-qqbot@2.0.1",
          },
        },
      },
    } satisfies CarapaceConfig;

    const result = await updatePlugin(config, "qqbot", { dryRun: true });

    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: "qqbot",
          status: "skipped",
          message:
            'Would remove duplicate "qqbot" install record; "carapace-qqbot" is the canonical plugin id.',
        }),
      ]),
    );
    expect(result.changed).toBe(false);
    expect(result.config.plugins?.installs).toEqual(config.plugins.installs);
    expect(resolvePluginInstallOwnerMigrations(result)).toBeUndefined();
  });

  it("rejects duplicate migration when canonical npm identities disagree", async () => {
    const config = {
      plugins: {
        entries: { qqbot: { enabled: true } },
        installs: {
          qqbot: {
            source: "npm",
            spec: "@carapace/qqbot@1.9.0",
            resolvedName: "@carapace/qqbot",
            resolvedSpec: "@carapace/qqbot@1.9.0",
          },
          "carapace-qqbot": {
            source: "npm",
            spec: "@vendor/carapace-qqbot@1.0.0",
            resolvedName: "@tencent-connect/carapace-qqbot",
            resolvedSpec: "@vendor/carapace-qqbot@1.0.0",
          },
        },
      },
    } satisfies CarapaceConfig;

    const result = await updatePlugin(config, "qqbot");

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.config.plugins?.entries).toEqual(config.plugins.entries);
    expect(result.config.plugins?.installs).toEqual(config.plugins.installs);
    expect(resolvePluginInstallOwnerMigrations(result)).toBeUndefined();
    expect(result.outcomes).toEqual([
      {
        pluginId: "qqbot",
        status: "error",
        message:
          'Cannot replace "qqbot" with "carapace-qqbot" because both plugin install records exist. Remove one of the conflicting installs, then retry the update.',
      },
    ]);
  });

  it("rejects legacy id replacement when the canonical install already exists", async () => {
    const config = {
      plugins: {
        installs: {
          "fish-audio": {
            source: "npm",
            spec: "@carapace/fish-audio-speech@2026.7.2-beta.7",
            resolvedName: "@carapace/fish-audio-speech",
            resolvedSpec: "@carapace/fish-audio-speech@2026.7.2-beta.7",
            installPath: "/tmp/fish-audio-legacy",
          },
          "fish-audio-speech": {
            source: "npm",
            spec: "@carapace/fish-audio-speech@2026.8.1-beta.1",
            resolvedName: "@carapace/fish-audio-speech",
            resolvedSpec: "@carapace/fish-audio-speech@2026.8.1-beta.1",
            installPath: "/tmp/fish-audio-canonical",
          },
        },
      },
    } satisfies CarapaceConfig;

    const result = await updatePlugin(config, "fish-audio");

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.config.plugins?.installs).toEqual(config.plugins?.installs);
    expect(result.outcomes).toEqual([
      {
        pluginId: "fish-audio",
        status: "error",
        message:
          'Cannot replace "fish-audio" with "fish-audio-speech" because both plugin install records exist. Remove one of the conflicting installs, then retry the update.',
      },
    ]);
  });

  it("preserves a canonical official exact pin during a targeted beta update", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "acpx",
        targetDir: "/tmp/acpx",
        version: "2026.7.2",
      }),
    );

    await updatePlugin(
      createNpmInstallConfig({
        pluginId: "acpx",
        spec: "@carapace/acpx@2026.7.2",
        resolvedName: "@carapace/acpx",
        installPath: "/tmp/acpx",
      }),
      "acpx",
      { dryRun: true, officialPluginUpdateChannel: "beta" },
    );

    expectNpmUpdateCall({
      spec: "@carapace/acpx@2026.7.2",
      expectedPluginId: "acpx",
    });
  });

  it("keeps authored plugin config shape when only the install key migrates", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: true,
      pluginId: "@carapace/voice-call",
      targetDir: "/tmp/carapace-voice-call",
      version: "0.0.2",
      extensions: ["index.ts"],
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          installs: {
            "voice-call": {
              source: "npm",
              spec: "@carapace/voice-call",
              installPath: "/tmp/voice-call",
            },
          },
        },
      },
      pluginIds: ["voice-call"],
    });

    expect(result.config.plugins).toEqual({
      installs: {
        "@carapace/voice-call": expect.objectContaining({
          source: "npm",
          spec: "@carapace/voice-call",
          installPath: "/tmp/carapace-voice-call",
        }),
      },
    });
  });

  it("migrates context engine slot when a plugin id changes during update", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: true,
      pluginId: "@carapace/context-engine",
      targetDir: "/tmp/carapace-context-engine",
      version: "0.0.2",
      extensions: ["index.ts"],
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          slots: { contextEngine: "context-engine" },
          installs: {
            "context-engine": {
              source: "npm",
              spec: "@carapace/context-engine",
              installPath: "/tmp/context-engine",
            },
          },
        },
      } as CarapaceConfig,
      pluginIds: ["context-engine"],
    });

    expect(result.config.plugins?.slots?.contextEngine).toBe("@carapace/context-engine");
    expectRecordFields(result.config.plugins?.installs?.["@carapace/context-engine"], {
      source: "npm",
      spec: "@carapace/context-engine",
      installPath: "/tmp/carapace-context-engine",
      version: "0.0.2",
    });
    expect(result.config.plugins?.installs?.["context-engine"]).toBeUndefined();
  });

  it("checks marketplace installs during dry-run updates", async () => {
    installPluginFromMarketplaceMock.mockResolvedValue({
      ok: true,
      pluginId: "claude-bundle",
      targetDir: "/tmp/claude-bundle",
      version: "1.2.0",
      extensions: ["index.ts"],
      marketplaceSource: "vincentkoc/claude-marketplace",
      marketplacePlugin: "claude-bundle",
    });

    const result = await updateNpmInstalledPlugins({
      config: createMarketplaceInstallConfig({
        pluginId: "claude-bundle",
        installPath: "/tmp/claude-bundle",
        marketplaceSource: "vincentkoc/claude-marketplace",
        marketplacePlugin: "claude-bundle",
      }),
      pluginIds: ["claude-bundle"],
      timeoutMs: 1_800_000,
      dryRun: true,
    });

    expect(marketplaceInstallCall()?.marketplace).toBe("vincentkoc/claude-marketplace");
    expect(marketplaceInstallCall()?.plugin).toBe("claude-bundle");
    expect(marketplaceInstallCall()?.expectedPluginId).toBe("claude-bundle");
    expect(marketplaceInstallCall()?.dryRun).toBe(true);
    expect(marketplaceInstallCall()?.timeoutMs).toBe(1_800_000);
    expect(result.outcomes).toEqual([
      {
        pluginId: "claude-bundle",
        status: "updated",
        currentVersion: undefined,
        nextVersion: "1.2.0",
        message: "Would update claude-bundle: unknown -> 1.2.0.",
      },
    ]);
  });

  it("updates marketplace installs and preserves source metadata", async () => {
    installPluginFromMarketplaceMock.mockResolvedValue({
      ok: true,
      pluginId: "claude-bundle",
      targetDir: "/tmp/claude-bundle",
      version: "1.3.0",
      extensions: ["index.ts"],
      marketplaceName: "Vincent's Claude Plugins",
      marketplaceSource: "vincentkoc/claude-marketplace",
      marketplacePlugin: "claude-bundle",
    });

    const result = await updateNpmInstalledPlugins({
      config: createMarketplaceInstallConfig({
        pluginId: "claude-bundle",
        installPath: "/tmp/claude-bundle",
        marketplaceName: "Vincent's Claude Plugins",
        marketplaceSource: "vincentkoc/claude-marketplace",
        marketplacePlugin: "claude-bundle",
      }),
      pluginIds: ["claude-bundle"],
    });

    expect(result.changed).toBe(true);
    expectRecordFields(result.config.plugins?.installs?.["claude-bundle"], {
      source: "marketplace",
      installPath: "/tmp/claude-bundle",
      version: "1.3.0",
      marketplaceName: "Vincent's Claude Plugins",
      marketplaceSource: "vincentkoc/claude-marketplace",
      marketplacePlugin: "claude-bundle",
    });
  });

  it("updates git installs and records resolved commit metadata", async () => {
    const installPath = createInstalledPackageDir({ name: "demo", version: "1.3.0" });
    installPluginFromGitSpecMock.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: installPath,
      version: "1.3.0",
      extensions: ["index.ts"],
      git: {
        url: "https://github.com/acme/demo.git",
        ref: "main",
        commit: "def456",
        resolvedAt: "2026-04-30T00:00:00.000Z",
      },
    });

    const result = await updatePlugin(
      createGitInstallConfig({
        pluginId: "demo",
        installPath,
        spec: "git:github.com/acme/demo@main",
        commit: "abc123",
      }),
      "demo",
    );

    expect(gitInstallCall()?.spec).toBe("git:github.com/acme/demo@main");
    expect(gitInstallCall()?.expectedPluginId).toBe("demo");
    expect(gitInstallCall()?.mode).toBe("update");
    expect(result.changed).toBe(true);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "updated",
        currentVersion: "1.3.0",
        nextVersion: "1.3.0",
        message: "Updated demo: 1.3.0 -> 1.3.0.",
      },
    ]);
    expectRecordFields(result.config.plugins?.installs?.demo, {
      source: "git",
      spec: "git:github.com/acme/demo@main",
      installPath,
      version: "1.3.0",
      gitUrl: "https://github.com/acme/demo.git",
      gitRef: "main",
      gitCommit: "def456",
    });
  });

  it("forwards dangerous force unsafe install to plugin update installers", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "carapace-codex-app-server",
        targetDir: "/tmp/carapace-codex-app-server",
        version: "0.2.0-beta.4",
      }),
    );

    await updatePlugin(
      createCodexAppServerInstallConfig({
        spec: "carapace-codex-app-server@beta",
      }),
      "carapace-codex-app-server",
      { dangerouslyForceUnsafeInstall: true },
    );

    expect(npmInstallCall()?.spec).toBe("carapace-codex-app-server@beta");
    expect(npmInstallCall()?.dangerouslyForceUnsafeInstall).toBe(true);
    expect(npmInstallCall()?.expectedPluginId).toBe("carapace-codex-app-server");
  });

  it("reuses the recorded managed extensions root when updating external plugins", async () => {
    const installPath = "/var/carapace/extensions/demo";
    const extensionsDir = "/var/carapace/extensions";
    const expectedExtensionsDir = path.resolve(extensionsDir);
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "demo",
        targetDir: installPath,
        version: "1.2.0",
      }),
    );
    installPluginFromClawHubMock.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: installPath,
      version: "1.2.0",
      extensions: ["index.ts"],
      clawhub: {
        source: "clawhub",
        clawhubUrl: "https://clawhub.ai",
        clawhubPackage: "demo",
        clawhubFamily: "code-plugin",
        clawhubChannel: "official",
        integrity: "sha256-next",
        resolvedAt: "2026-03-22T00:00:00.000Z",
      },
    });
    installPluginFromMarketplaceMock.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: installPath,
      version: "1.2.0",
      extensions: ["index.ts"],
      marketplaceSource: "acme/plugins",
      marketplacePlugin: "demo",
    });
    installPluginFromGitSpecMock.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: installPath,
      version: "1.2.0",
      extensions: ["index.ts"],
      git: {
        url: "https://github.com/acme/demo.git",
        ref: "main",
        commit: "abc123",
        resolvedAt: "2026-04-30T00:00:00.000Z",
      },
    });

    await updatePlugin(
      createNpmInstallConfig({
        pluginId: "demo",
        spec: "@acme/demo",
        installPath,
      }),
      "demo",
    );
    await updatePlugin(createClawHubInstallConfig({ installPath }), "demo");
    await updatePlugin(
      createMarketplaceInstallConfig({
        pluginId: "demo",
        installPath,
        marketplaceSource: "acme/plugins",
        marketplacePlugin: "demo",
      }),
      "demo",
    );
    await updatePlugin(
      createGitInstallConfig({
        pluginId: "demo",
        installPath,
        spec: "git:github.com/acme/demo@main",
      }),
      "demo",
    );

    expect(npmInstallCall()?.extensionsDir).toBe(expectedExtensionsDir);
    expect(clawHubInstallCall()?.extensionsDir).toBe(expectedExtensionsDir);
    expect(marketplaceInstallCall()?.extensionsDir).toBe(expectedExtensionsDir);
    expect(gitInstallCall()?.extensionsDir).toBe(expectedExtensionsDir);
  });
});

describe("syncPluginsForUpdateChannel", () => {
  beforeEach(() => {
    installPluginFromNpmSpecMock.mockReset();
    installPluginFromClawHubMock.mockReset();
    installPluginFromGitSpecMock.mockReset();
    resolveBundledPluginSourcesMock.mockReset();
    runCommandWithTimeoutMock.mockReset();
  });

  it.each([
    {
      name: "keeps bundled path installs on beta without reinstalling from npm",
      config: createBundledPathInstallConfig({
        loadPaths: [appBundledPluginRoot("feishu")],
        installPath: appBundledPluginRoot("feishu"),
        spec: "@carapace/feishu",
      }),
      expectedChanged: false,
      expectedLoadPaths: [appBundledPluginRoot("feishu")],
      expectedInstallPath: appBundledPluginRoot("feishu"),
    },
    {
      name: "repairs bundled install metadata when the load path is re-added",
      config: createBundledPathInstallConfig({
        loadPaths: [],
        installPath: "/tmp/old-feishu",
        spec: "@carapace/feishu",
      }),
      expectedChanged: true,
      expectedLoadPaths: [appBundledPluginRoot("feishu")],
      expectedInstallPath: appBundledPluginRoot("feishu"),
    },
  ] as const)(
    "$name",
    async ({ config, expectedChanged, expectedLoadPaths, expectedInstallPath }) => {
      mockBundledSources(createBundledSource());

      const result = await syncPluginsForUpdateChannel({
        channel: "beta",
        config,
      });

      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expect(result.changed).toBe(expectedChanged);
      expect(result.summary.switchedToNpm).toStrictEqual([]);
      expect(result.config.plugins?.load?.paths).toEqual(expectedLoadPaths);
      expectBundledPathInstall({
        install: result.config.plugins?.installs?.feishu,
        sourcePath: appBundledPluginRoot("feishu"),
        installPath: expectedInstallPath,
        spec: "@carapace/feishu",
      });
    },
  );

  it("forwards an explicit env to bundled plugin source resolution", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    const env = { CARAPACE_HOME: "/srv/carapace-home" } as NodeJS.ProcessEnv;

    await syncPluginsForUpdateChannel({
      channel: "beta",
      config: {},
      workspaceDir: "/workspace",
      env,
    });

    expect(resolveBundledPluginSourcesMock).toHaveBeenCalledWith({
      workspaceDir: "/workspace",
      env,
    });
  });

  it("uses the provided env when matching bundled load and install paths", async () => {
    const bundledHome = "/tmp/carapace-home";
    mockBundledSources(
      createBundledSource({
        localPath: `${bundledHome}/plugins/feishu`,
      }),
    );

    await withEnvAsync({ HOME: "/tmp/process-home" }, async () => {
      const result = await syncPluginsForUpdateChannel({
        channel: "beta",
        env: {
          ...process.env,
          CARAPACE_HOME: bundledHome,
          HOME: "/tmp/ignored-home",
        },
        config: {
          plugins: {
            load: { paths: ["~/plugins/feishu"] },
            installs: {
              feishu: {
                source: "path",
                sourcePath: "~/plugins/feishu",
                installPath: "~/plugins/feishu",
                spec: "@carapace/feishu",
              },
            },
          },
        },
      });

      expect(result.changed).toBe(false);
      expect(result.config.plugins?.load?.paths).toEqual(["~/plugins/feishu"]);
      expectBundledPathInstall({
        install: result.config.plugins?.installs?.feishu,
        sourcePath: "~/plugins/feishu",
        installPath: "~/plugins/feishu",
      });
    });
  });

  it("installs an externalized bundled plugin and rewrites its old bundled path plugin index", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "legacy-chat",
        targetDir: "/tmp/carapace-plugins/legacy-chat",
        version: "2.0.0",
        npmResolution: {
          name: "@carapace/legacy-chat",
          version: "2.0.0",
          resolvedSpec: "@carapace/legacy-chat@2.0.0",
        },
      }),
    );

    const result = await syncExternalizedPlugin({});

    expect(npmInstallCall()?.spec).toBe("@carapace/legacy-chat");
    expect(npmInstallCall()?.mode).toBe("update");
    expect(npmInstallCall()?.expectedPluginId).toBe("legacy-chat");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).not.toBe(true);
    expect(result.changed).toBe(true);
    expect(result.summary.switchedToNpm).toEqual(["legacy-chat"]);
    expect(result.summary.errors).toStrictEqual([]);
    expect(result.config.plugins?.load?.paths).toStrictEqual([]);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
      source: "npm",
      spec: "@carapace/legacy-chat",
      installPath: "/tmp/carapace-plugins/legacy-chat",
      version: "2.0.0",
      resolvedName: "@carapace/legacy-chat",
      resolvedVersion: "2.0.0",
      resolvedSpec: "@carapace/legacy-chat@2.0.0",
    });
  });

  it("installs an externalized bundled plugin under its renamed package id", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "carapace-qqbot",
        targetDir: "/tmp/carapace-plugins/carapace-qqbot",
        version: "2.0.1",
      }),
    );

    const result = await syncPluginsForUpdateChannel({
      channel: "stable",
      externalizedBundledPluginBridges: [
        {
          bundledPluginId: "qqbot",
          pluginId: "carapace-qqbot",
          npmSpec: "@tencent-connect/carapace-qqbot@2.0.1",
          expectedIntegrity: "sha512-qqbot-catalog-pin",
          channelIds: ["qqbot"],
        },
      ],
      config: {
        channels: { qqbot: { enabled: true } },
        plugins: {
          entries: { qqbot: { enabled: true } },
          load: { paths: [appBundledPluginRoot("qqbot")] },
          installs: {
            qqbot: {
              source: "path",
              sourcePath: appBundledPluginRoot("qqbot"),
              installPath: appBundledPluginRoot("qqbot"),
            },
          },
        },
      },
    });

    expect(npmInstallCall()?.expectedPluginId).toBe("carapace-qqbot");
    expect(npmInstallCall()?.expectedIntegrity).toBe("sha512-qqbot-catalog-pin");
    expect(result.summary.switchedToNpm).toEqual(["carapace-qqbot"]);
    expect(result.config.plugins?.entries?.qqbot).toBeUndefined();
    expect(result.config.plugins?.entries?.["carapace-qqbot"]).toEqual({ enabled: true });
    expect(result.config.plugins?.installs?.qqbot).toBeUndefined();
    expectRecordFields(result.config.plugins?.installs?.["carapace-qqbot"], {
      source: "npm",
      spec: "@tencent-connect/carapace-qqbot@2.0.1",
      installPath: "/tmp/carapace-plugins/carapace-qqbot",
      version: "2.0.1",
    });
  });

  it("marks official externalized bundled npm installs as trusted", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "voice-call",
        targetDir: "/tmp/carapace-plugins/voice-call",
        version: "0.0.2-beta.1",
      }),
    );

    await syncExternalizedPlugin({
      bridge: {
        bundledPluginId: "voice-call",
        npmSpec: "@carapace/voice-call",
        channelIds: ["voice-call"],
      },
      config: createExternalizedPluginConfig({ pluginId: "voice-call" }),
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/voice-call");
    expect(npmInstallCall()?.expectedPluginId).toBe("voice-call");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
  });

  it("installs a ClawHub-only externalized bundled plugin", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromClawHubMock.mockResolvedValue(
      createSuccessfulClawHubUpdateResult({
        pluginId: "legacy-chat",
        targetDir: "/tmp/carapace-plugins/legacy-chat",
        version: "2026.5.1-beta.2",
        clawhubPackage: "legacy-chat",
      }),
    );
    const result = await syncExternalizedPlugin({
      bridge: {
        npmSpec: undefined,
        clawhubSpec: "clawhub:legacy-chat@2026.5.1-beta.2",
        clawhubUrl: "https://clawhub.ai",
      },
    });

    expect(clawHubInstallCall()?.spec).toBe("clawhub:legacy-chat@2026.5.1-beta.2");
    expect(clawHubInstallCall()?.baseUrl).toBe("https://clawhub.ai");
    expect(clawHubInstallCall()?.mode).toBe("update");
    expect(clawHubInstallCall()?.expectedPluginId).toBe("legacy-chat");
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(true);
    expect(result.summary.switchedToClawHub).toEqual(["legacy-chat"]);
    expect(result.summary.switchedToNpm).toStrictEqual([]);
    expect(result.summary.errors).toStrictEqual([]);
    expect(result.config.plugins?.load?.paths).toStrictEqual([]);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
      source: "clawhub",
      spec: "clawhub:legacy-chat@2026.5.1-beta.2",
      installPath: "/tmp/carapace-plugins/legacy-chat",
      version: "2026.5.1-beta.2",
      integrity: "sha256-clawpack",
      clawhubUrl: "https://clawhub.ai",
      clawhubPackage: "legacy-chat",
      clawhubFamily: "code-plugin",
      clawhubChannel: "official",
      artifactKind: "npm-pack",
      artifactFormat: "tgz",
      npmIntegrity: "sha512-clawpack",
      npmShasum: "2".repeat(40),
      npmTarballName: "legacy-chat-2026.5.1-beta.2.tgz",
      clawpackSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      clawpackSpecVersion: 1,
      clawpackManifestSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      clawpackSize: 4096,
    });
  });

  it.each(["npm", "clawhub", "source-fallback"] as const)(
    "selects npm releases before install and retains ClawHub fallback during %s externalization",
    async (source) => {
      resolveBundledPluginSourcesMock.mockReturnValue(new Map());
      const pluginId = "diagnostics-otel";
      const npmSpec = "@carapace/diagnostics-otel";
      const clawhubSpec = `clawhub:${npmSpec}`;
      const coreVersion = "2026.8.1-beta.3";
      const clawhubBetaSpec = `${clawhubSpec}@beta`;
      if (source !== "clawhub") {
        mockNpmViewMetadata({ name: npmSpec, version: "2026.7.1-beta.1" });
        mockNpmViewMetadata({ name: npmSpec, version: "2026.8.0" });
      }
      const attempts: Array<{ spec: string; expectedIntegrity?: string }> = [];
      installPluginFromNpmSpecMock.mockImplementation(
        async ({ spec, expectedIntegrity }: { spec: string; expectedIntegrity?: string }) => {
          attempts.push({ spec, expectedIntegrity });
          return source === "source-fallback"
            ? { ok: false, code: "npm_package_not_found", error: "target unavailable" }
            : createSuccessfulNpmUpdateResult({
                pluginId,
                targetDir: `/tmp/carapace-plugins/${pluginId}`,
                version: "2026.8.0",
              });
        },
      );
      installPluginFromClawHubMock.mockImplementation(async ({ spec }: { spec: string }) => {
        attempts.push({ spec });
        return spec !== clawhubSpec
          ? { ok: false, code: "version_not_found", error: "beta unavailable" }
          : createSuccessfulClawHubUpdateResult({
              pluginId,
              targetDir: `/tmp/carapace-plugins/${pluginId}`,
              version: "2026.8.0",
              clawhubPackage: npmSpec,
            });
      });

      const result = await syncExternalizedPlugin({
        channel: "beta",
        coreVersion,
        bridge: {
          bundledPluginId: pluginId,
          npmSpec: source === "clawhub" ? undefined : npmSpec,
          clawhubSpec: source === "npm" ? undefined : clawhubSpec,
          expectedIntegrity: "sha512-catalog-default",
          channelIds: [pluginId],
        },
        config: createExternalizedPluginConfig({ pluginId }),
      });

      expect(result.summary.errors).toEqual([]);
      expect(attempts).toEqual([
        ...(source === "clawhub"
          ? []
          : [{ spec: `${npmSpec}@2026.8.0`, expectedIntegrity: undefined }]),
        ...(source === "npm" ? [] : [{ spec: clawhubBetaSpec }, { spec: clawhubSpec }]),
      ]);
      expect(result.config.plugins?.installs?.[pluginId]).toMatchObject({
        source: source === "npm" ? "npm" : "clawhub",
        spec: source === "npm" ? npmSpec : clawhubSpec,
        version: "2026.8.0",
      });
      expect(result.config.plugins?.load?.paths).toEqual([]);
      if (source === "npm") {
        expect(result.summary.warnings).toEqual([]);
      } else {
        expect(result.summary.warnings.join("\n")).toContain(clawhubBetaSpec);
      }
    },
  );

  it("selects npm before the declared ClawHub source", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromClawHubMock.mockResolvedValue({
      ok: false,
      code: "package_not_found",
      error: "Package not found on ClawHub.",
    });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "legacy-chat",
        targetDir: "/tmp/carapace-plugins/legacy-chat",
        version: "2.0.0",
      }),
    );

    const result = await syncExternalizedPlugin({
      bridge: {
        clawhubSpec: "clawhub:legacy-chat@2026.5.1-beta.2",
      },
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/legacy-chat");
    expect(npmInstallCall()?.mode).toBe("update");
    expect(npmInstallCall()?.expectedPluginId).toBe("legacy-chat");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).not.toBe(true);
    expect(result.changed).toBe(true);
    expect(result.summary.switchedToClawHub).toStrictEqual([]);
    expect(result.summary.switchedToNpm).toEqual(["legacy-chat"]);
    expect(result.summary.warnings).toEqual([]);
    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    expect(result.summary.errors).toStrictEqual([]);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
      source: "npm",
      spec: "@carapace/legacy-chat",
      installPath: "/tmp/carapace-plugins/legacy-chat",
      version: "2.0.0",
    });
  });

  it("uses exact-core npm when an official ClawHub bridge falls back on extended-stable", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromClawHubMock.mockResolvedValue({
      ok: false,
      code: "package_not_found",
      error: "Package not found on ClawHub.",
    });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "voice-call",
        targetDir: "/tmp/carapace-plugins/voice-call",
        version: "2026.7.33",
        npmResolution: {
          name: "@carapace/voice-call",
          version: "2026.7.33",
          resolvedSpec: "@carapace/voice-call@2026.7.33",
        },
      }),
    );

    const result = await syncExternalizedPlugin({
      channel: "extended-stable",
      coreVersion: "2026.7.33",
      bridge: {
        bundledPluginId: "voice-call",
        clawhubSpec: "clawhub:@carapace/voice-call",
        npmSpec: "@carapace/voice-call",
        channelIds: ["voice-call"],
      },
      config: createExternalizedPluginConfig({ pluginId: "voice-call", includeLoad: false }),
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/voice-call@2026.7.33");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expectRecordFields(result.config.plugins?.installs?.["voice-call"], {
      source: "npm",
      spec: "@carapace/voice-call",
      version: "2026.7.33",
      resolvedSpec: "@carapace/voice-call@2026.7.33",
    });
  });

  it("does not invent npm metadata for a ClawHub-only bridge", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromClawHubMock.mockResolvedValue({
      ok: false,
      code: "package_not_found",
      error: "Package not found on ClawHub.",
    });
    const config = createExternalizedPluginConfig();

    const result = await syncExternalizedPlugin({
      bridge: {
        clawhubSpec: "clawhub:legacy-chat@2026.5.1-beta.2",
        npmSpec: undefined,
      },
      config,
    });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.summary.switchedToNpm).toStrictEqual([]);
    expect(result.summary.warnings).toStrictEqual([]);
    expect(result.summary.errors).toEqual([
      {
        pluginId: "legacy-chat",
        code: "package_not_found",
        message:
          'Failed to update legacy-chat: Package not found on ClawHub. (ClawHub clawhub:legacy-chat@2026.5.1-beta.2).\nBundled relocation did not install the replacement plugin payload; resolve the error above, then run "carapace update repair".',
      },
    ]);
  });

  it("falls back from official ClawHub artifact misses to trusted npm packages", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromClawHubMock.mockResolvedValue({
      ok: false,
      code: "artifact_download_unavailable",
      error: "ClawHub ClawPack artifact is unavailable.",
    });
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "voice-call",
        targetDir: "/tmp/carapace-plugins/voice-call",
        version: "0.0.2-beta.1",
      }),
    );

    await syncExternalizedPlugin({
      bridge: {
        bundledPluginId: "voice-call",
        clawhubSpec: "clawhub:@carapace/voice-call",
        npmSpec: "@carapace/voice-call",
        channelIds: ["voice-call"],
      },
      config: createExternalizedPluginConfig({ pluginId: "voice-call" }),
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/voice-call");
    expect(npmInstallCall()?.expectedPluginId).toBe("voice-call");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
  });

  it("moves ClawHub-preferred externalized plugin fallbacks back to ClawHub", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromClawHubMock.mockResolvedValue(
      createSuccessfulClawHubUpdateResult({
        pluginId: "legacy-chat",
        targetDir: "/tmp/carapace-plugins/legacy-chat",
        version: "2026.5.1-beta.2",
        clawhubPackage: "legacy-chat",
      }),
    );

    const result = await syncExternalizedPlugin({
      bridge: {
        clawhubSpec: "clawhub:legacy-chat@2026.5.1-beta.2",
      },
      config: createExternalizedPluginConfig({
        includeLoad: false,
        install: {
          source: "npm",
          spec: "@carapace/legacy-chat",
          installPath: "/tmp/carapace-plugins/legacy-chat",
        },
      }),
    });

    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
      source: "npm",
      spec: "@carapace/legacy-chat",
    });
  });

  it("fails closed without npm fallback when ClawHub returns integrity drift", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromClawHubMock.mockResolvedValue({
      ok: false,
      code: "archive_integrity_mismatch",
      error: "ClawHub ClawPack integrity mismatch.",
      warning: "WARNING\nSecurity scan: suspicious",
    });
    const config = createExternalizedPluginConfig();

    const result = await syncExternalizedPlugin({
      bridge: {
        npmSpec: undefined,
        clawhubSpec: "clawhub:legacy-chat@2026.5.1-beta.2",
      },
      config,
    });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.summary.warnings).toEqual(["WARNING\nSecurity scan: suspicious"]);
    expect(result.summary.errors).toEqual([
      {
        pluginId: "legacy-chat",
        code: "archive_integrity_mismatch",
        message:
          'Failed to update legacy-chat: ClawHub ClawPack integrity mismatch. (ClawHub clawhub:legacy-chat@2026.5.1-beta.2).\nBundled relocation did not install the replacement plugin payload; resolve the error above, then run "carapace update repair".',
      },
    ]);
  });

  it("externalizes bundled plugins that were enabled by default", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromNpmSpecMock.mockResolvedValue(
      createSuccessfulNpmUpdateResult({
        pluginId: "default-chat",
        targetDir: "/tmp/carapace-plugins/default-chat",
        version: "2.0.0",
      }),
    );

    const result = await syncPluginsForUpdateChannel({
      channel: "stable",
      externalizedBundledPluginBridges: [
        {
          bundledPluginId: "default-chat",
          enabledByDefault: true,
          npmSpec: "@carapace/default-chat",
          channelIds: ["default-chat"],
        },
      ],
      config: {},
    });

    expect(npmInstallCall()?.spec).toBe("@carapace/default-chat");
    expect(npmInstallCall()?.mode).toBe("update");
    expect(npmInstallCall()?.expectedPluginId).toBe("default-chat");
    expect(result.changed).toBe(true);
    expect(result.summary.switchedToNpm).toEqual(["default-chat"]);
    expectRecordFields(result.config.plugins?.installs?.["default-chat"], {
      source: "npm",
      spec: "@carapace/default-chat",
      installPath: "/tmp/carapace-plugins/default-chat",
      version: "2.0.0",
    });
  });

  it("does not externalize disabled bundled plugins", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());

    const result = await syncExternalizedPlugin({
      config: createExternalizedPluginConfig({
        channelEnabled: false,
        entryEnabled: false,
      }),
    });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
      source: "path",
    });
  });

  it("leaves config unchanged when externalized plugin installation fails", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "package unavailable",
    });
    const config = createExternalizedPluginConfig();

    const result = await syncExternalizedPlugin({ config });

    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.summary.errors).toEqual([
      {
        pluginId: "legacy-chat",
        message:
          'Failed to update legacy-chat: package unavailable\nBundled relocation did not install the replacement plugin payload; resolve the error above, then run "carapace update repair".',
      },
    ]);
  });

  it("does not externalize custom local path installs that only share the old plugin id", async () => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());

    const result = await syncExternalizedPlugin({
      config: createExternalizedPluginConfig({
        loadPaths: ["/workspace/plugins/legacy-chat"],
        install: {
          source: "path",
          sourcePath: "/workspace/plugins/legacy-chat",
          installPath: "/workspace/plugins/legacy-chat",
        },
      }),
    });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
      source: "path",
      sourcePath: "/workspace/plugins/legacy-chat",
    });
  });

  it("does not externalize while the bundled source is still present in the current build", async () => {
    mockBundledSources(
      createBundledSource({
        pluginId: "legacy-chat",
        localPath: appBundledPluginRoot("legacy-chat"),
      }),
    );

    const result = await syncExternalizedPlugin({});

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
      source: "path",
    });
  });

  it.each(["constructor", "__proto__"])(
    "migrates already-externalized records to prototype-named plugin id %s",
    async (targetPluginId) => {
      const legacyPluginId = `legacy-${targetPluginId}`;
      const npmPackageName = `carapace-plugin-${targetPluginId}`;
      resolveBundledPluginSourcesMock.mockReturnValue(new Map());

      const result = await syncPluginsForUpdateChannel({
        channel: "stable",
        externalizedBundledPluginBridges: [
          {
            bundledPluginId: legacyPluginId,
            pluginId: targetPluginId,
            npmSpec: npmPackageName,
            channelIds: [],
          },
        ],
        config: {
          plugins: {
            entries: {
              [legacyPluginId]: { enabled: true },
            },
            installs: {
              [legacyPluginId]: {
                source: "npm",
                spec: npmPackageName,
                installPath: `/tmp/${targetPluginId}`,
              },
            },
          },
        },
      });

      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expect(result.changed).toBe(true);
      expect(Object.hasOwn(result.config.plugins?.entries ?? {}, targetPluginId)).toBe(true);
      expect(Object.getPrototypeOf(result.config.plugins?.entries ?? {})).toBe(Object.prototype);
      expect(result.config.plugins?.entries?.[targetPluginId]).toEqual({ enabled: true });
      expect(Object.hasOwn(result.config.plugins?.installs ?? {}, targetPluginId)).toBe(true);
      expect(Object.getPrototypeOf(result.config.plugins?.installs ?? {})).toBe(Object.prototype);
      expectRecordFields(result.config.plugins?.installs?.[targetPluginId], {
        source: "npm",
        spec: npmPackageName,
        installPath: `/tmp/${targetPluginId}`,
      });
      expect(result.config.plugins?.entries?.[legacyPluginId]).toBeUndefined();
      expect(result.config.plugins?.installs?.[legacyPluginId]).toBeUndefined();
    },
  );

  it.each([
    {
      name: "removes stale bundled load paths for already-externalized npm installs",
      install: {
        source: "npm",
        spec: "@carapace/legacy-chat",
        installPath: "/tmp/carapace-plugins/legacy-chat",
      },
      expectedInstall: { source: "npm", spec: "@carapace/legacy-chat" },
      bridge: {},
      expectClawHubNotCalled: false,
    },
    {
      name: "removes stale bundled load paths for already-externalized resolved-name-only npm installs",
      install: {
        source: "npm",
        resolvedName: "@carapace/legacy-chat",
        installPath: "/tmp/carapace-plugins/legacy-chat",
      },
      expectedInstall: { source: "npm", resolvedName: "@carapace/legacy-chat" },
      bridge: {},
      expectClawHubNotCalled: false,
    },
    {
      name: "removes stale bundled load paths for already-externalized pinned npm installs",
      install: {
        source: "npm",
        spec: "@carapace/legacy-chat@1.2.3",
        resolvedSpec: "@carapace/legacy-chat@1.2.3",
        installPath: "/tmp/carapace-plugins/legacy-chat",
      },
      expectedInstall: { source: "npm", spec: "@carapace/legacy-chat@1.2.3" },
      bridge: {},
      expectClawHubNotCalled: false,
    },
    {
      name: "removes stale bundled load paths for already-externalized pinned ClawHub installs",
      install: {
        source: "clawhub",
        spec: "clawhub:legacy-chat@2026.5.1",
        clawhubPackage: "legacy-chat",
        installPath: "/tmp/carapace-plugins/legacy-chat",
      },
      expectedInstall: { source: "clawhub", spec: "clawhub:legacy-chat@2026.5.1" },
      bridge: { clawhubSpec: "clawhub:legacy-chat" },
      expectClawHubNotCalled: true,
    },
  ] as const)("$name", async ({ install, expectedInstall, bridge, expectClawHubNotCalled }) => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());

    const result = await syncExternalizedPlugin({
      bridge,
      config: createExternalizedPluginConfig({
        loadPaths: [appBundledPluginRoot("legacy-chat"), "/workspace/plugins/other"],
        install,
      }),
    });

    if (expectClawHubNotCalled) {
      expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    }
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.load?.paths).toEqual(["/workspace/plugins/other"]);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], expectedInstall);
  });
});
/* oxlint-disable max-lines -- TODO: split this grandfathered oversized file. */
