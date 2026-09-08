import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { readConfigFileSnapshotForWrite, writeConfigFile } from "../config/config.js";
import { closeCarapaceStateDatabaseForTest } from "../state/carapace-state-db.js";
import { withEnvAsync } from "../test-utils/env.js";
import {
  cleanupPluginLoaderFixturesForTest,
  makePluginLoaderTempDir,
  resetPluginLoaderTestStateForTest,
  writePlugin,
} from "./loader.test-fixtures.js";
import { clearPluginMetadataLifecycleCaches } from "./plugin-metadata-lifecycle.js";

vi.mock("./management-install.js", () => {
  throw new Error("Plugin policy changes must not load the installation implementation");
});
vi.mock("./management-uninstall.js", () => {
  throw new Error("Plugin policy changes must not load the removal implementation");
});

vi.mock("./install-persistence.js", () => {
  throw new Error("Plugin policy changes must not load install persistence");
});
vi.mock("./status.js", () => {
  throw new Error("Bundled plugin policy changes must not load runtime diagnostics");
});

afterEach(() => {
  clearPluginMetadataLifecycleCaches();
  resetPluginLoaderTestStateForTest();
  closeCarapaceStateDatabaseForTest();
});
afterAll(cleanupPluginLoaderFixturesForTest);

it("persists CLI plugin policy without loading installation, removal, or runtime diagnostics", async () => {
  const stateDir = makePluginLoaderTempDir();
  const bundledDir = makePluginLoaderTempDir();
  const pluginId = "policy-only";
  writePlugin({
    id: pluginId,
    dir: path.join(bundledDir, pluginId),
    filename: "index.cjs",
    body: `module.exports = { id: ${JSON.stringify(pluginId)}, register() {} };`,
  });
  await withEnvAsync(
    {
      CARAPACE_STATE_DIR: stateDir,
      CARAPACE_CONFIG_PATH: path.join(stateDir, "carapace.json"),
      CARAPACE_BUNDLED_PLUGINS_DIR: bundledDir,
      CARAPACE_DISABLE_BUNDLED_PLUGINS: undefined,
    },
    async () => {
      await writeConfigFile({ plugins: { entries: { [pluginId]: { enabled: false } } } });
      const { runPluginsEnableCommand, runPluginsDisableCommand } =
        await import("../cli/plugins-cli.runtime.js");
      await runPluginsEnableCommand(pluginId);
      expect(
        (await readConfigFileSnapshotForWrite()).snapshot.sourceConfig.plugins?.entries?.[pluginId]
          ?.enabled,
      ).toBe(true);
      await runPluginsDisableCommand(pluginId);
      expect(
        JSON.parse(fs.readFileSync(path.join(stateDir, "carapace.json"), "utf8")).plugins.entries[
          pluginId
        ].enabled,
      ).toBe(false);
    },
  );
});
