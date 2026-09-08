// Daemon restart log tests cover restart log formatting and filtering.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendGatewayLifecycleAuditLog,
  renderCmdRestartLogSetup,
  renderPosixRestartLogSetup,
  resolveGatewayLogPaths,
  resolveGatewayRestartLogPath,
  resolveGatewaySupervisorLogPaths,
} from "./restart-logs.js";
import { buildPlatformRuntimeLogHints } from "./runtime-hints.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("restart log conventions", () => {
  it("resolves profile-aware gateway logs and restart attempts together", () => {
    const env = {
      HOME: "/Users/test",
      CARAPACE_PROFILE: "work",
    };

    expect(resolveGatewayLogPaths(env)).toEqual({
      logDir: "/Users/test/.carapace-work/logs",
      stdoutPath: "/Users/test/.carapace-work/logs/gateway.log",
      stderrPath: "/Users/test/.carapace-work/logs/gateway.err.log",
    });
    expect(resolveGatewayRestartLogPath(env)).toBe(
      "/Users/test/.carapace-work/logs/gateway-restart.log",
    );
  });

  it("honors CARAPACE_STATE_DIR for restart attempts", () => {
    const env = {
      HOME: "/Users/test",
      CARAPACE_STATE_DIR: "/tmp/carapace-state",
    };

    expect(resolveGatewayRestartLogPath(env)).toBe("/tmp/carapace-state/logs/gateway-restart.log");
  });

  it("keeps macOS LaunchAgent stdout outside the state directory", () => {
    const env = {
      HOME: "/Users/test",
      CARAPACE_STATE_DIR: "/Volumes/External/carapace",
    };

    expect(resolveGatewaySupervisorLogPaths(env, { platform: "darwin" })).toEqual({
      logDir: "/Users/test/Library/Logs/carapace",
      stdoutPath: "/Users/test/Library/Logs/carapace/gateway.log",
      stderrPath: "/Users/test/Library/Logs/carapace/gateway.err.log",
    });
    expect(resolveGatewayRestartLogPath(env)).toBe(
      "/Volumes/External/carapace/logs/gateway-restart.log",
    );
  });

  it("keeps macOS LaunchAgent logs profile-aware in the shared user log directory", () => {
    const env = {
      HOME: "/Users/test",
      CARAPACE_PROFILE: "work",
    };

    expect(resolveGatewaySupervisorLogPaths(env, { platform: "darwin" })).toEqual({
      logDir: "/Users/test/Library/Logs/carapace",
      stdoutPath: "/Users/test/Library/Logs/carapace/gateway-work.log",
      stderrPath: "/Users/test/Library/Logs/carapace/gateway-work.err.log",
    });
  });

  it("renders best-effort POSIX log setup with escaped paths", () => {
    const setup = renderPosixRestartLogSetup({
      HOME: "/Users/test's",
    });

    expect(setup).toContain(
      "if mkdir -p '/Users/test'\\''s/.carapace/logs' 2>/dev/null && : >>'/Users/test'\\''s/.carapace/logs/gateway-restart.log' 2>/dev/null; then",
    );
    expect(setup).toContain("exec >>'/Users/test'\\''s/.carapace/logs/gateway-restart.log' 2>&1");
  });

  it("renders CMD log setup with quoted paths", () => {
    const setup = renderCmdRestartLogSetup({
      USERPROFILE: "C:\\Users\\Test User",
    });

    expect(setup.quotedLogPath).toBe('"C:\\Users\\Test User/.carapace/logs/gateway-restart.log"');
    expect(setup.lines).toContain(
      'if not exist "C:\\Users\\Test User/.carapace/logs" mkdir "C:\\Users\\Test User/.carapace/logs" >nul 2>&1',
    );
  });

  it("appends a profile-aware lifecycle audit line with stable key-value fields", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-lifecycle-audit-"));
    tempDirs.push(stateDir);

    appendGatewayLifecycleAuditLog(
      { CARAPACE_STATE_DIR: stateDir },
      {
        action: "restart",
        source: "safe-rpc",
        mode: "deferred",
        pid: 4242,
        interactive: false,
      },
    );

    const line = fs.readFileSync(path.join(stateDir, "logs", "gateway-restart.log"), "utf8");
    expect(line).toMatch(/^\[[^\]]+\] carapace gateway lifecycle /);
    expect(line).toContain("source=safe-rpc");
    expect(line).toContain("action=restart");
    expect(line).toContain("mode=deferred");
    expect(line).toContain("pid=4242");
    expect(line).toContain("interactive=0");
  });

  it("advertises the actual restart log when a POSIX state path contains a backslash", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-restart-path-"));
    tempDirs.push(dir);
    const env = { HOME: dir, CARAPACE_STATE_DIR: path.join(dir, String.raw`state\literal`) };
    appendGatewayLifecycleAuditLog(env, {
      action: "restart",
      source: "cli",
      mode: "deferred",
      interactive: false,
    });

    const hints = buildPlatformRuntimeLogHints({
      platform: "darwin",
      env,
      systemdServiceName: "carapace-gateway",
      windowsTaskName: "Carapace Gateway",
    });
    const advertised = hints.find((hint) => hint.startsWith("Restart attempts: "));
    expect(advertised).toBe(`Restart attempts: ${resolveGatewayRestartLogPath(env)}`);
    expect(fs.readFileSync(resolveGatewayRestartLogPath(env), "utf8")).toContain(
      "carapace gateway lifecycle source=cli action=restart",
    );
  });

  it("does not throw when lifecycle audit logging fails", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-lifecycle-audit-fail-"));
    tempDirs.push(stateDir);
    const blocker = path.join(stateDir, "not-a-directory");
    fs.writeFileSync(blocker, "block");

    expect(() =>
      appendGatewayLifecycleAuditLog(
        { CARAPACE_STATE_DIR: path.join(blocker, "state") },
        {
          action: "stop",
          source: "cli",
          mode: "bootout",
          interactive: true,
        },
      ),
    ).not.toThrow();
  });
});
