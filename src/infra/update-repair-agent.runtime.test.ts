import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { withCarapaceTestState } from "../test-utils/carapace-test-state.js";
import { withUpdateRepairEnvironment } from "./update-repair-agent.runtime.js";

describe("repair rehearsal environment", () => {
  it("keeps disposable selectors but rejects hostile overrides before child execution", async () => {
    await withCarapaceTestState({ layout: "home" }, async (state) => {
      const before = { ...process.env };
      const environment = {
        ...process.env,
        HOME: state.home,
        TMPDIR: state.root,
        CARAPACE_HOME: state.home,
        CARAPACE_UPDATE_RUN_HANDOFF: undefined,
        NODE_OPTIONS: "--no-warnings",
        PATH: "/synthetic-untrusted-bin",
        LD_PRELOAD: "/synthetic-preload.so",
        DYLD_INSERT_LIBRARIES: "/synthetic-preload.dylib",
        CARAPACE_SYNTHETIC_UNTRUSTED: "untrusted",
      };
      await expect(
        withUpdateRepairEnvironment(
          { ...state, installRoot: state.workspaceDir, environment },
          async () => {
            const keys = [
              "HOME",
              "TMPDIR",
              "CARAPACE_HOME",
              "CARAPACE_STATE_DIR",
              "CARAPACE_CONFIG_PATH",
              "CARAPACE_WORKSPACE_DIR",
              "PATH",
              "NODE_OPTIONS",
              "LD_PRELOAD",
              "DYLD_INSERT_LIBRARIES",
              "CARAPACE_SYNTHETIC_UNTRUSTED",
              "CARAPACE_UPDATE_RUN_HANDOFF",
            ];
            const child = JSON.parse(
              execFileSync(
                process.execPath,
                [
                  "-e",
                  `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key]]))))`,
                ],
                { encoding: "utf8" },
              ),
            );
            expect(child).toEqual({
              HOME: state.home,
              TMPDIR: state.root,
              CARAPACE_HOME: state.home,
              CARAPACE_STATE_DIR: state.stateDir,
              CARAPACE_CONFIG_PATH: state.configPath,
              CARAPACE_WORKSPACE_DIR: state.workspaceDir,
              PATH: before.PATH,
            });
            throw new Error("synthetic repair failure");
          },
        ),
      ).rejects.toThrow("synthetic repair failure");
      expect(process.env).toEqual(before);
    });
  });
});
