// Doctor launchctl environment tests cover macOS gateway platform warnings for env overrides.
import fs from "node:fs";
import { expectDefined } from "@carapace/normalization-core/expect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/config.js";

const mocks = vi.hoisted(() => ({
  runExec: vi.fn(),
  note: vi.fn(),
  readCommand: vi.fn(),
  findJobs: vi.fn(),
}));

vi.mock("../process/exec.js", () => ({
  runExec: mocks.runExec,
}));
vi.mock("../../packages/terminal-core/src/note.js", () => ({ note: mocks.note }));
vi.mock("../daemon/service.js", () => ({
  resolveGatewayService: () => ({ readCommand: mocks.readCommand }),
}));
vi.mock("../daemon/launchd.js", () => ({ findStaleCarapaceUpdateLaunchdJobs: mocks.findJobs }));

import {
  collectMacGatewayPlatformWarnings,
  noteMacLaunchctlGatewayEnvOverrides,
  noteMacStaleCarapaceUpdateLaunchdJobs,
} from "./doctor-platform-notes.js";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(process, "platform", { ...platformDescriptor, value: "darwin" });
  vi.stubEnv("HOME", "/tmp/carapace-doctor-host");
  vi.stubEnv("CARAPACE_STATE_DIR", "/tmp/carapace-doctor-host-state");
  vi.spyOn(fs, "existsSync").mockReturnValue(false);
  mocks.runExec.mockResolvedValue({ stdout: "", stderr: "" });
  mocks.readCommand.mockResolvedValue(null);
  mocks.findJobs.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (platformDescriptor) {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
});

describe("noteMacLaunchctlGatewayEnvOverrides", () => {
  it("prints clear unsetenv instructions for token override", async () => {
    mocks.runExec.mockImplementation(async (_command, [, name]) => ({
      stdout: name === "CARAPACE_GATEWAY_TOKEN" ? " \tlaunchctl-token\n" : " \n",
      stderr: "",
    }));
    const cfg: CarapaceConfig = {
      gateway: {
        auth: {
          token: "config-token",
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.note).toHaveBeenCalledTimes(1);
    expect(mocks.runExec).toHaveBeenCalledTimes(2);

    const [message, title] = expectDefined<unknown[]>(mocks.note.mock.calls[0], "note call 0");
    expect(title).toBe("Gateway (macOS)");
    expect(message).toContain("Host-wide launchctl gateway auth overrides detected");
    expect(message).toContain("Current managed Gateway installs do not need these values");
    expect(message).toContain("CARAPACE_GATEWAY_TOKEN");
    expect(message).toContain("launchctl unsetenv CARAPACE_GATEWAY_TOKEN");
    expect(message).not.toContain("CARAPACE_GATEWAY_PASSWORD");
    expect(message).not.toContain("launchctl-token");
    expect(message).not.toContain("config-token");
  });

  it("does nothing when config has no gateway credentials", async () => {
    mocks.runExec.mockResolvedValue({ stdout: "launchctl-token", stderr: "" });

    await noteMacLaunchctlGatewayEnvOverrides({});

    expect(mocks.runExec).not.toHaveBeenCalled();
    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("treats SecretRef-backed credentials as configured", async () => {
    mocks.runExec.mockImplementation(async (_command, [, name]) => ({
      stdout: name === "CARAPACE_GATEWAY_PASSWORD" ? " \tlaunchctl-password\n" : " \n",
      stderr: "",
    }));
    const cfg: CarapaceConfig = {
      gateway: {
        auth: {
          password: { source: "env", provider: "default", id: "CARAPACE_GATEWAY_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.note).toHaveBeenCalledTimes(1);
    const [message] = expectDefined<unknown[]>(mocks.note.mock.calls[0], "note call 0");
    expect(message).toContain("CARAPACE_GATEWAY_PASSWORD");
    expect(message).not.toContain("CARAPACE_GATEWAY_TOKEN");
    expect(message).not.toContain("launchctl-password");
  });

  it("does nothing on non-darwin platforms", async () => {
    Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
    mocks.runExec.mockResolvedValue({ stdout: "launchctl-token", stderr: "" });
    const cfg: CarapaceConfig = {
      gateway: {
        auth: {
          token: "config-token",
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.runExec).not.toHaveBeenCalled();
    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("bounds launchctl getenv calls and ignores timeout failures", async () => {
    mocks.runExec.mockRejectedValue(new Error("timed out"));
    const cfg: CarapaceConfig = {
      gateway: {
        auth: {
          token: "config-token",
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.runExec).toHaveBeenNthCalledWith(
      1,
      "/bin/launchctl",
      ["getenv", "CARAPACE_GATEWAY_TOKEN"],
      { logOutput: false, timeoutMs: 5_000 },
    );
    expect(mocks.runExec).toHaveBeenNthCalledWith(
      2,
      "/bin/launchctl",
      ["getenv", "CARAPACE_GATEWAY_PASSWORD"],
      { logOutput: false, timeoutMs: 5_000 },
    );
    expect(mocks.note).not.toHaveBeenCalled();
  });
});

describe("noteMacStaleCarapaceUpdateLaunchdJobs", () => {
  it("uses service env for gateway platform stale updater warnings", async () => {
    const serviceEnv = {
      CARAPACE_STATE_DIR: "/tmp/carapace-daemon",
      CARAPACE_LAUNCHD_LABEL: "ai.carapace.manual-update.gateway",
    };
    mocks.readCommand.mockResolvedValue({
      programArguments: ["/bin/node", "cli", "gateway"],
      environment: serviceEnv,
    });

    await collectMacGatewayPlatformWarnings({});

    expect(mocks.readCommand).toHaveBeenCalledTimes(1);
    expect(mocks.findJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        HOME: "/tmp/carapace-doctor-host",
        CARAPACE_STATE_DIR: "/tmp/carapace-daemon",
        CARAPACE_LAUNCHD_LABEL: "ai.carapace.manual-update.gateway",
      }),
    );
  });

  it("uses service env for doctor stale updater notes", async () => {
    const serviceEnv = {
      CARAPACE_STATE_DIR: "/tmp/carapace-daemon",
      CARAPACE_LAUNCHD_LABEL: "ai.carapace.manual-update.gateway",
    };
    mocks.readCommand.mockResolvedValue({
      programArguments: ["/bin/node", "cli", "doctor"],
      environment: serviceEnv,
    });

    await noteMacStaleCarapaceUpdateLaunchdJobs();

    expect(mocks.readCommand).toHaveBeenCalledTimes(1);
    expect(mocks.findJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        HOME: "/tmp/carapace-doctor-host",
        CARAPACE_STATE_DIR: "/tmp/carapace-daemon",
        CARAPACE_LAUNCHD_LABEL: "ai.carapace.manual-update.gateway",
      }),
    );
  });

  it("prints stale updater job cleanup guidance on macOS", async () => {
    mocks.findJobs.mockResolvedValue([
      {
        label: "ai.carapace.update.2026.5.12",
        lastExitStatus: 127,
      },
      {
        label: "ai.carapace.manual-update.1717168800",
        lastExitStatus: 0,
      },
    ]);

    await noteMacStaleCarapaceUpdateLaunchdJobs();

    expect(mocks.findJobs).toHaveBeenCalledTimes(1);
    const [message, title] = expectDefined<unknown[]>(mocks.note.mock.calls[0], "note call 0");
    expect(title).toBe("Gateway (macOS)");
    expect(message).toContain("Stale Carapace updater launchd job(s) detected");
    expect(message).toContain("ai.carapace.update.2026.5.12");
    expect(message).toContain("ai.carapace.manual-update.1717168800");
    expect(message).toContain("launchctl remove <label>");
    expect(message).toContain("carapace gateway restart");
  });

  it("does nothing when no stale updater jobs exist", async () => {
    await noteMacStaleCarapaceUpdateLaunchdJobs();

    expect(mocks.note).not.toHaveBeenCalled();
  });
});

describe("collectMacGatewayPlatformWarnings", () => {
  it("collects guidance when launch agent writes are disabled", async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (candidate) => candidate === "/tmp/carapace-doctor-host/.carapace/disable-launchagent",
    );
    mocks.readCommand.mockResolvedValue({ environment: { HOME: "/tmp/carapace-doctor-service" } });
    const warnings = await collectMacGatewayPlatformWarnings({});

    expect(warnings).toEqual([expect.stringContaining("LaunchAgent writes are disabled")]);
    expect(warnings[0]).toContain("disable-launchagent");
  });

  it("does nothing when launch agent writes are not disabled", async () => {
    await expect(collectMacGatewayPlatformWarnings({})).resolves.toEqual([]);
  });
});
