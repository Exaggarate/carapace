import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";

const mocks = vi.hoisted(() => ({
  listManagedPluginNpmRoots: vi.fn(),
  maybeRepairStaleManagedNpmBundledPlugins: vi.fn(),
  repairMissingConfiguredPluginInstalls: vi.fn(),
  relinkCarapacePeerDependenciesInManagedNpmRoot: vi.fn(),
  runPluginPayloadSmokeCheck: vi.fn(),
}));

vi.mock("./missing-configured-plugin-install.js", () => ({
  repairMissingConfiguredPluginInstalls: mocks.repairMissingConfiguredPluginInstalls,
}));
vi.mock("../../doctor-plugin-registry.js", () => ({
  maybeRepairStaleManagedNpmBundledPlugins: mocks.maybeRepairStaleManagedNpmBundledPlugins,
}));
vi.mock("../../../plugins/plugin-peer-link.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../plugins/plugin-peer-link.js")>();
  return {
    ...actual,
    relinkCarapacePeerDependenciesInManagedNpmRoot:
      mocks.relinkCarapacePeerDependenciesInManagedNpmRoot,
  };
});
vi.mock("../../../plugins/npm-project-roots.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../plugins/npm-project-roots.js")>();
  return {
    ...actual,
    listManagedPluginNpmRoots: mocks.listManagedPluginNpmRoots,
  };
});
vi.mock("../../../plugins/payload-verification.js", () => ({
  runPluginPayloadSmokeCheck: mocks.runPluginPayloadSmokeCheck,
}));

import { resolvePluginNpmGenerationProjectDir } from "../../../plugins/install-paths.js";
import {
  loadInstalledPluginIndexInstallRecords,
  readPersistedInstalledPluginIndexInstallRecords,
  writePersistedInstalledPluginIndexInstallRecords,
} from "../../../plugins/installed-plugin-index-records.js";
import { VERSION } from "../../../version.js";
import { runPostCorePluginConvergence } from "./post-core-plugin-convergence.js";

describe("post-core bundled plugin retirement", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listManagedPluginNpmRoots.mockImplementation((npmRoot: string) =>
      Promise.resolve([npmRoot]),
    );
    mocks.relinkCarapacePeerDependenciesInManagedNpmRoot.mockResolvedValue({
      checked: 0,
      attempted: 0,
      repaired: 0,
      skipped: 0,
    });
    mocks.runPluginPayloadSmokeCheck.mockResolvedValue({ checked: [], failures: [] });
  });

  it("retires payload and record state before repair across two starts", async () => {
    const stateDir = tempDirs.make("carapace-post-core-convergence-");
    const bundledRoot = tempDirs.make("carapace-post-core-bundled-");
    const cfg = {
      update: { channel: "beta" as const },
      plugins: { allow: ["bundleddemo"], entries: { bundleddemo: { enabled: true } } },
    };
    const env = {
      CARAPACE_STATE_DIR: stateDir,
      CARAPACE_BUNDLED_PLUGINS_DIR: bundledRoot,
      CARAPACE_TEST_TRUST_BUNDLED_PLUGINS_DIR: "1",
      VITEST: "true",
    };
    const bundledDir = path.join(bundledRoot, "bundleddemo");
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.writeFileSync(path.join(bundledDir, "index.js"), "export default {};\n", "utf8");
    fs.writeFileSync(
      path.join(bundledDir, "carapace.plugin.json"),
      JSON.stringify({
        id: "bundleddemo",
        name: "bundleddemo",
        version: VERSION,
        configSchema: { type: "object" },
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(bundledDir, "package.json"),
      JSON.stringify({ name: "@carapace/bundleddemo", version: VERSION }),
      "utf8",
    );
    const npmRoot = resolvePluginNpmGenerationProjectDir({
      npmDir: path.join(stateDir, "npm"),
      packageName: "@carapace/bundleddemo",
      generationKey: "@carapace/bundleddemo@2026.7.2-beta.7",
    });
    const packageDir = path.join(npmRoot, "node_modules", "@carapace", "bundleddemo");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(npmRoot, "package.json"),
      JSON.stringify({ dependencies: { "@carapace/bundleddemo": "2026.7.2-beta.7" } }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "@carapace/bundleddemo", version: "2026.7.2-beta.7" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(packageDir, "carapace.plugin.json"),
      JSON.stringify({ id: "bundleddemo", name: "bundleddemo", configSchema: { type: "object" } }),
      "utf8",
    );
    await writePersistedInstalledPluginIndexInstallRecords(
      {
        bundleddemo: {
          source: "npm",
          spec: "@carapace/bundleddemo@beta",
          installPath: packageDir,
          version: "2026.7.2-beta.7",
          resolvedName: "@carapace/bundleddemo",
          resolvedSpec: "@carapace/bundleddemo@2026.7.2-beta.7",
          resolvedVersion: "2026.7.2-beta.7",
        },
      },
      { config: cfg, env },
    );
    const actualDoctorRegistry = await vi.importActual<
      typeof import("../../doctor-plugin-registry.js")
    >("../../doctor-plugin-registry.js");
    mocks.maybeRepairStaleManagedNpmBundledPlugins.mockImplementation(
      actualDoctorRegistry.maybeRepairStaleManagedNpmBundledPlugins,
    );
    let installAttempts = 0;
    mocks.repairMissingConfiguredPluginInstalls.mockImplementation(async (params) => {
      const records =
        params.baselineRecords ??
        (await loadInstalledPluginIndexInstallRecords({ env: params.env }));
      const bundleddemoRecord = records.bundleddemo;
      if (bundleddemoRecord) {
        installAttempts += 1;
        const retryRoot = resolvePluginNpmGenerationProjectDir({
          npmDir: path.join(stateDir, "npm"),
          packageName: "@carapace/bundleddemo",
          generationKey: `@carapace/bundleddemo@retry-${installAttempts}`,
        });
        const retryPackageDir = path.join(retryRoot, "node_modules", "@carapace", "bundleddemo");
        fs.mkdirSync(retryPackageDir, { recursive: true });
        const nextRecords = {
          ...records,
          bundleddemo: { ...bundleddemoRecord, installPath: retryPackageDir },
        };
        await writePersistedInstalledPluginIndexInstallRecords(nextRecords, {
          config: cfg,
          env: params.env,
        });
        return {
          changes: [
            'Refreshed stale configured plugin "bundleddemo" from @carapace/bundleddemo@beta.',
          ],
          warnings: [],
          records: nextRecords,
        };
      }
      if (params.baselineRecords) {
        await writePersistedInstalledPluginIndexInstallRecords(records, {
          config: cfg,
          env: params.env,
        });
      }
      return { changes: [], warnings: [], records };
    });

    const first = await runPostCorePluginConvergence({ cfg, env });
    const projectsAfterFirst = fs.readdirSync(path.join(stateDir, "npm", "projects"));
    const second = await runPostCorePluginConvergence({ cfg, env });

    expect(fs.existsSync(packageDir)).toBe(false);
    expect(installAttempts).toBe(0);
    expect(projectsAfterFirst).toHaveLength(1);
    expect(fs.readdirSync(path.join(stateDir, "npm", "projects"))).toEqual(projectsAfterFirst);
    expect(await readPersistedInstalledPluginIndexInstallRecords({ env })).not.toHaveProperty(
      "bundleddemo",
    );
    expect(first.installRecords).not.toHaveProperty("bundleddemo");
    expect(second.installRecords).not.toHaveProperty("bundleddemo");
    expect(first.changes).toContain(
      'Removed stale managed install record for bundled plugin "bundleddemo".',
    );
    expect(second.changes).toEqual([]);
  });
});
