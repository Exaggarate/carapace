import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resolveConfigWidePluginMetadataSnapshot } from "../config/io.plugin-metadata.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { closeCarapaceStateDatabaseByPath } from "../state/carapace-state-db.js";
import { listChannelCatalogEntries } from "./channel-catalog-registry.js";
import { setGatewayPluginMetadataSnapshot } from "./current-plugin-metadata-snapshot.js";
import { writePersistedInstalledPluginIndexInstallRecordsSync } from "./installed-plugin-index-records.js";
import { createPluginCache, withPluginCache } from "./plugin-cache.js";
import { clearPluginMetadataLifecycleCaches } from "./plugin-metadata-lifecycle.js";

const tempDirs = createTempDirTracker();
const databasePaths = new Set<string>();
afterEach(() => {
  vi.restoreAllMocks();
  clearPluginMetadataLifecycleCaches();
  for (const databasePath of databasePaths) {
    closeCarapaceStateDatabaseByPath(databasePath);
  }
  databasePaths.clear();
  tempDirs.cleanup();
});

it("keeps the published install generation across ledger writes until restart", () => {
  const root = tempDirs.make("carapace-channel-ledger-");
  const env = { HOME: root, CARAPACE_STATE_DIR: root, CARAPACE_DISABLE_BUNDLED_PLUGINS: "1" };
  const initialRoot = path.join(root, "initial");
  const replacementRoot = path.join(root, "replacement");
  const config: CarapaceConfig = {};
  for (const rootDir of [initialRoot, replacementRoot]) {
    writeChannelPlugin(rootDir, "managed-channel");
  }
  const install = (rootDir: string, installEnv = env) => {
    databasePaths.add(
      writePersistedInstalledPluginIndexInstallRecordsSync(
        { "managed-channel": { source: "path", sourcePath: rootDir, installPath: rootDir } },
        { config, env: installEnv },
      ),
    );
  };
  install(initialRoot);
  const snapshot = resolveConfigWidePluginMetadataSnapshot({ config, env });
  setGatewayPluginMetadataSnapshot(snapshot, { config, env });
  const read = () => listChannelCatalogEntries({ env }).map((entry) => entry.rootDir);
  expect(read()).toEqual([initialRoot]);

  install(replacementRoot);
  expect(read()).toEqual([initialRoot]);
  const foreign = tempDirs.make("carapace-channel-foreign-ledger-");
  const foreignEnv = { ...env, HOME: foreign, CARAPACE_STATE_DIR: foreign };
  install(replacementRoot, foreignEnv);
  expect(listChannelCatalogEntries({ env: foreignEnv }).map((entry) => entry.rootDir)).toEqual([
    replacementRoot,
  ]);
  clearPluginMetadataLifecycleCaches();
  expect(read()).toEqual([replacementRoot]);
});

function writeChannelPlugin(rootDir: string, id: string): void {
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, "index.js"), "export default { register() {} };\n");
  fs.writeFileSync(
    path.join(rootDir, "carapace.plugin.json"),
    JSON.stringify({ id, channels: [id], configSchema: { type: "object", properties: {} } }),
  );
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({
      name: id,
      type: "module",
      carapace: {
        extensions: ["./index.js"],
        channel: { id, name: id, description: `Synthetic ${id} channel` },
      },
    }),
  );
}

it("keeps channel catalog workspace and load-path scopes after Gateway publication", () => {
  const root = tempDirs.make("carapace-channel-catalog-");
  const env = { HOME: root, CARAPACE_STATE_DIR: root, CARAPACE_DISABLE_BUNDLED_PLUGINS: "1" };
  const alpha = path.join(root, "alpha");
  const beta = path.join(root, "beta");
  const extra = path.join(root, "extra");
  writeChannelPlugin(path.join(alpha, ".carapace/extensions/alpha-channel"), "alpha-channel");
  writeChannelPlugin(path.join(beta, ".carapace/extensions/beta-channel"), "beta-channel");
  writeChannelPlugin(extra, "extra-channel");
  const config: CarapaceConfig = {
    agents: { entries: { alpha: { workspace: alpha }, beta: { workspace: beta } } },
    plugins: { load: { paths: [extra] } },
  };
  const scopes = [
    { workspaceDir: alpha, expected: ["alpha-channel"] },
    { workspaceDir: beta, expected: ["beta-channel"] },
    { workspaceDir: alpha, extraPaths: [extra], expected: ["alpha-channel", "extra-channel"] },
  ];
  const read = () =>
    scopes.map(({ expected: _expected, ...scope }) =>
      listChannelCatalogEntries({ ...scope, env })
        .map((entry) => entry.pluginId)
        .toSorted(),
    );
  expect(withPluginCache(createPluginCache(), read)).toEqual(
    scopes.map(({ expected }) => expected),
  );
  const snapshot = resolveConfigWidePluginMetadataSnapshot({ config, env });
  expect(snapshot.plugins.map((plugin) => plugin.id).toSorted()).toEqual([
    "alpha-channel",
    "beta-channel",
    "extra-channel",
  ]);
  setGatewayPluginMetadataSnapshot(snapshot, { config, env });

  const fileReads = [
    "existsSync",
    "statSync",
    "lstatSync",
    "realpathSync",
    "readFileSync",
    "readdirSync",
    "openSync",
    "fstatSync",
  ] as const;
  const probes = fileReads.map((method) => vi.spyOn(fs, method));
  expect(read()).toEqual(scopes.map(({ expected }) => expected));
  expect(read()).toEqual(scopes.map(({ expected }) => expected));
  expect(probes.map((probe) => probe.mock.calls.length)).toEqual(fileReads.map(() => 0));
  vi.restoreAllMocks();
  writeChannelPlugin(path.join(alpha, ".carapace/extensions/late-channel"), "late-channel");
  expect(read()).toEqual(scopes.map(({ expected }) => expected));
  clearPluginMetadataLifecycleCaches();
  expect(read()[0]).toEqual(["alpha-channel", "late-channel"]);
});

it("retains raw workspace shadows for catalog trust filtering after publication", () => {
  const root = tempDirs.make("carapace-channel-shadow-");
  const env = { HOME: root, CARAPACE_STATE_DIR: root, CARAPACE_DISABLE_BUNDLED_PLUGINS: "1" };
  const workspaceDir = path.join(root, "workspace");
  writeChannelPlugin(path.join(root, "extensions/shadow-channel"), "shadow-channel");
  writeChannelPlugin(
    path.join(workspaceDir, ".carapace/extensions/shadow-channel"),
    "shadow-channel",
  );
  const config: CarapaceConfig = { agents: { entries: { alpha: { workspace: workspaceDir } } } };
  const read = () =>
    listChannelCatalogEntries({ workspaceDir, env }).map(({ pluginId, origin }) => ({
      pluginId,
      origin,
    }));
  const expected = [
    { pluginId: "shadow-channel", origin: "workspace" },
    { pluginId: "shadow-channel", origin: "global" },
  ];
  expect(read()).toEqual(expected);
  const snapshot = resolveConfigWidePluginMetadataSnapshot({ config, env });
  setGatewayPluginMetadataSnapshot(snapshot, { config, env });
  expect(read()).toEqual(expected);
});
