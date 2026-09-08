import { afterEach, describe, expect, it, vi } from "vitest";
import type { LaneState } from "../../scripts/lib/cross-os-release-checks/config.ts";

const mocks = vi.hoisted(() => ({
  runInstalledCli: vi.fn(),
  runCarapace: vi.fn(),
}));

vi.mock("../../scripts/lib/cross-os-release-checks/installed.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../scripts/lib/cross-os-release-checks/installed.ts")
  >()),
  runInstalledCli: mocks.runInstalledCli,
}));

vi.mock("../../scripts/lib/cross-os-release-checks/runtime.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../scripts/lib/cross-os-release-checks/runtime.ts")
  >()),
  runCarapace: mocks.runCarapace,
}));

import { installLaneCompanions } from "../../scripts/lib/cross-os-release-checks/lane-companions.ts";

function createLane(): LaneState {
  return {
    name: "fresh",
    rootDir: "/tmp/carapace-release",
    prefixDir: "/tmp/carapace-release/prefix",
    homeDir: "/tmp/carapace-release/home",
    stateDir: "/tmp/carapace-release/state",
    appDataDir: "/tmp/carapace-release/app-data",
    gatewayPort: 18789,
    phaseTimings: [],
  };
}

describe("cross-OS release companion installation", () => {
  afterEach(() => {
    mocks.runInstalledCli.mockReset();
    mocks.runCarapace.mockReset();
  });

  it.each([
    { cliPath: undefined, runner: "packaged", supported: true },
    { cliPath: undefined, runner: "packaged", supported: false },
    { cliPath: "/tmp/carapace", runner: "installed", supported: true },
    { cliPath: "/tmp/carapace", runner: "installed", supported: false },
  ] as const)(
    "probes capability consent once through the $runner runner (supported=$supported)",
    async ({ cliPath, supported }) => {
      const lane = createLane();
      const env = { HOME: lane.homeDir };
      const runner = cliPath ? mocks.runInstalledCli : mocks.runCarapace;
      const unusedRunner = cliPath ? mocks.runCarapace : mocks.runInstalledCli;
      runner
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: supported ? "  --accept-capabilities  Accept declared capabilities\n" : "Usage\n",
          stderr: "",
        })
        .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      await installLaneCompanions({
        companions: [
          { name: "@carapace/codex", tarballPath: "/tmp/carapace-codex.tgz" },
          { name: "@carapace/discord", tarballPath: "/tmp/carapace-discord.tgz" },
        ],
        logsDir: "/tmp/carapace-release/logs",
        lane,
        env,
        ...(cliPath ? { cliPath } : {}),
      });

      expect(runner).toHaveBeenCalledTimes(3);
      expect(runner).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ args: ["plugins", "install", "--help"], env }),
      );
      for (const [callIndex, tarball] of [
        [2, "/tmp/carapace-codex.tgz"],
        [3, "/tmp/carapace-discord.tgz"],
      ] as const) {
        expect(runner).toHaveBeenNthCalledWith(
          callIndex,
          expect.objectContaining({
            args: [
              "plugins",
              "install",
              `npm-pack:${tarball}`,
              "--force",
              ...(supported ? ["--accept-capabilities"] : []),
            ],
            env,
          }),
        );
      }
      expect(unusedRunner).not.toHaveBeenCalled();
    },
  );

  it.each([
    { cliPath: undefined, runner: "packaged" },
    { cliPath: "/tmp/carapace", runner: "installed" },
  ] as const)("fails the lane when the $runner help probe fails", async ({ cliPath }) => {
    const lane = createLane();
    const runner = cliPath ? mocks.runInstalledCli : mocks.runCarapace;
    runner.mockRejectedValueOnce(new Error("help probe failed"));

    await expect(
      installLaneCompanions({
        companions: [{ name: "@carapace/codex", tarballPath: "/tmp/carapace-codex.tgz" }],
        logsDir: "/tmp/carapace-release/logs",
        lane,
        env: { HOME: lane.homeDir },
        ...(cliPath ? { cliPath } : {}),
      }),
    ).rejects.toThrow("help probe failed");
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
