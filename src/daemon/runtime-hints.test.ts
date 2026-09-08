// Daemon runtime hint tests cover platform-specific daemon guidance.
import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          HOME: "/Users/test",
          CARAPACE_STATE_DIR: "/tmp/carapace-state",
          CARAPACE_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "carapace-gateway",
        windowsTaskName: "Carapace Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /Users/test/Library/Logs/carapace/gateway.log",
      "Launchd stderr (if installed): suppressed",
      "Restart attempts: /tmp/carapace-state/logs/gateway-restart.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        env: {
          CARAPACE_STATE_DIR: "/tmp/carapace-state",
        },
        systemdServiceName: "carapace-gateway",
        windowsTaskName: "Carapace Gateway",
      }),
    ).toEqual([
      "Logs: journalctl --user -u carapace-gateway.service -n 200 --no-pager",
      "Restart attempts: /tmp/carapace-state/logs/gateway-restart.log",
    ]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        env: {
          CARAPACE_STATE_DIR: "/tmp/carapace-state",
        },
        systemdServiceName: "carapace-gateway",
        windowsTaskName: "Carapace Gateway",
      }),
    ).toEqual([
      'Logs: schtasks /Query /TN "Carapace Gateway" /V /FO LIST',
      "Restart attempts: /tmp/carapace-state/logs/gateway-restart.log",
    ]);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installHint: "carapace gateway install",
        startCommand: "carapace gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.carapace.gateway.plist",
        systemdServiceName: "carapace-gateway",
        windowsTaskName: "Carapace Gateway",
      }),
    ).toEqual([
      "carapace gateway install",
      "carapace gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.carapace.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installHint: "carapace gateway install",
        startCommand: "carapace gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.carapace.gateway.plist",
        systemdServiceName: "carapace-gateway",
        windowsTaskName: "Carapace Gateway",
      }),
    ).toEqual([
      "carapace gateway install",
      "carapace gateway",
      "systemctl --user start carapace-gateway.service",
    ]);
  });
});
