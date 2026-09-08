import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyCliProfileEnv } from "../cli/profile.js";
import { withCarapaceTestState } from "../test-utils/carapace-test-state.js";
import {
  getInstallationTarget,
  installationTargetEnv,
  resolveInstallationTarget,
  withInstallationTarget,
} from "./installation-target-context.js";

describe("installation target ownership", () => {
  it.each(["default", "custom", "relative", "profile", "legacy"])(
    "captures the canonical %s installation before selectors change",
    async (selector) => {
      await withCarapaceTestState({ layout: "home" }, async (state) => {
        const env: NodeJS.ProcessEnv = { HOME: state.home };
        let stateDir = state.stateDir;
        let configPath = state.configPath;
        let defaultWorkspaceDir = path.join(stateDir, "workspace");
        if (selector === "custom" || selector === "relative") {
          stateDir = state.path("custom state");
          configPath = state.path("separate config", "custom.json");
          defaultWorkspaceDir = state.path("custom workspace");
          env.CARAPACE_STATE_DIR =
            selector === "relative" ? path.relative(process.cwd(), stateDir) : stateDir;
          env.CARAPACE_CONFIG_PATH =
            selector === "relative" ? path.relative(process.cwd(), configPath) : configPath;
          env.CARAPACE_WORKSPACE_DIR =
            selector === "relative"
              ? path.relative(process.cwd(), defaultWorkspaceDir)
              : defaultWorkspaceDir;
        } else if (selector === "profile") {
          applyCliProfileEnv({ profile: "diagnostic", env });
          stateDir = path.join(state.home, ".carapace-diagnostic");
          configPath = path.join(stateDir, "carapace.json");
          defaultWorkspaceDir = path.join(stateDir, "workspace");
        } else if (selector === "legacy") {
          await fs.rm(stateDir, { recursive: true });
          stateDir = path.join(state.home, ".clawdbot");
          configPath = path.join(stateDir, "clawdbot.json");
          await fs.mkdir(stateDir);
          await fs.writeFile(configPath, "{}");
        }
        const target = resolveInstallationTarget(env);
        env.CARAPACE_STATE_DIR = state.path("scratch");
        delete env.CARAPACE_CONFIG_PATH;
        env.CARAPACE_WORKSPACE_DIR = state.path("execution cwd");
        expect(target).toEqual({ stateDir, configPath, defaultWorkspaceDir });
        expect(Object.isFrozen(target)).toBe(true);
        expect(installationTargetEnv(target)).toEqual({
          CARAPACE_STATE_DIR: stateDir,
          CARAPACE_CONFIG_PATH: configPath,
          CARAPACE_WORKSPACE_DIR: defaultWorkspaceDir,
        });
      });
    },
  );

  it("isolates concurrent targets and restores nested and failed scopes", async () => {
    const targets = [
      {
        stateDir: "/fixture/one",
        configPath: "/fixture/one.json",
        defaultWorkspaceDir: "/work/one",
      },
      {
        stateDir: "/fixture/two",
        configPath: "/fixture/two.json",
        defaultWorkspaceDir: "/work/two",
      },
    ];
    await Promise.all(
      targets.map(async (target) => {
        await expect(
          withInstallationTarget(target, async () => {
            await Promise.resolve();
            expect(getInstallationTarget()).toEqual(target);
            expect(Object.isFrozen(getInstallationTarget())).toBe(true);
            withInstallationTarget(undefined, () =>
              expect(getInstallationTarget()).toBeUndefined(),
            );
            expect(getInstallationTarget()).toEqual(target);
            throw new Error("fixture failure");
          }),
        ).rejects.toThrow("fixture failure");
        expect(getInstallationTarget()).toBeUndefined();
      }),
    );
    expect(getInstallationTarget()).toBeUndefined();
  });
});
