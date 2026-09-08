import fs from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { closeCarapaceStateDatabaseForTest } from "../state/carapace-state-db.js";
import { captureEnv, setTestEnvValue } from "../test-utils/env.js";
import {
  detectLegacyWorkspaceState,
  migrateLegacyWorkspaceState,
} from "./state-migrations.workspace-setup.js";

export function useWorkspaceMigrationTestFixture() {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;
  const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
    afterEach(() => {
      closeCarapaceStateDatabaseForTest();
      envSnapshot?.restore();
      envSnapshot = undefined;
      cleanup();
    });
  });

  function setup() {
    const homeDir = tempDirs.make("carapace-workspace-migration-home-");
    const stateDir = path.join(homeDir, ".carapace");
    const workspaceDir = path.join(homeDir, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    envSnapshot ??= captureEnv(["HOME", "CARAPACE_HOME", "CARAPACE_STATE_DIR"]);
    setTestEnvValue("HOME", homeDir);
    setTestEnvValue("CARAPACE_STATE_DIR", stateDir);
    const cfg = {
      agents: { defaults: { workspace: workspaceDir } },
    } satisfies CarapaceConfig;
    return {
      cfg,
      env: { ...process.env, HOME: homeDir, CARAPACE_STATE_DIR: stateDir },
      homeDir,
      stateDir,
      workspaceDir,
    };
  }

  function detect(context: ReturnType<typeof setup>) {
    return detectLegacyWorkspaceState({
      cfg: context.cfg,
      stateDir: context.stateDir,
      env: context.env,
      homedir: () => context.homeDir,
      doctorOnlyStateMigrations: true,
    });
  }

  async function migrate(context: ReturnType<typeof setup>) {
    return await migrateLegacyWorkspaceState({
      detected: detect(context),
      env: context.env,
      stateDir: context.stateDir,
    });
  }

  return { detect, migrate, setup };
}
