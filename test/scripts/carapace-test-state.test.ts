// Carapace Test State tests cover carapace test state script behavior.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = path.join(repoRoot, "scripts/lib/carapace-test-state.mts");

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function cleanupTestStateHomeTrap(): string {
  return [
    'cleanup_carapace_test_state_home() { [ -z "${CARAPACE_TEST_STATE_HOME:-}" ] || rm -rf "$CARAPACE_TEST_STATE_HOME"; }',
    "trap cleanup_carapace_test_state_home EXIT",
  ].join("; ");
}

const secretKeyPattern = /^[a-f0-9]{64}$/u;

describe("scripts/lib/carapace-test-state", () => {
  it("creates a sourceable env file and JSON description", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "carapace-test-state-script-"));
    const envFile = path.join(tempRoot, "env.sh");
    try {
      const { stdout } = await execFileAsync(process.execPath, [
        "--import",
        "tsx",
        scriptPath,
        "--",
        "create",
        "--label",
        "script-test",
        "--scenario",
        "update-stable",
        "--env-file",
        envFile,
        "--json",
      ]);
      const payload = JSON.parse(stdout);
      expect(payload.label).toBe("script-test");
      expect(payload.scenario).toBe("update-stable");
      for (const field of ["root", "home", "stateDir", "configPath", "workspaceDir"] as const) {
        expect(typeof payload[field]).toBe("string");
        expect(payload[field].length).toBeGreaterThan(0);
      }
      expect(payload.home).toBe(path.join(payload.root, "home"));
      expect(payload.stateDir).toBe(path.join(payload.home, ".carapace"));
      expect(payload.configPath).toBe(path.join(payload.stateDir, "carapace.json"));
      expect(payload.workspaceDir).toBe(path.join(payload.home, "workspace"));
      expect(payload.env.CARAPACE_AUTH_PROFILE_SECRET_KEY).toMatch(secretKeyPattern);
      expect(payload.env).toEqual({
        HOME: payload.home,
        USERPROFILE: payload.home,
        CARAPACE_HOME: payload.home,
        CARAPACE_STATE_DIR: payload.stateDir,
        CARAPACE_CONFIG_PATH: payload.configPath,
        CARAPACE_AUTH_PROFILE_SECRET_KEY: payload.env.CARAPACE_AUTH_PROFILE_SECRET_KEY,
      });
      expect(payload.config).toEqual({
        update: {
          channel: "stable",
        },
        plugins: {},
      });

      const envFileText = await fs.readFile(envFile, "utf8");
      expect(envFileText).toContain("export HOME=");
      expect(envFileText).toContain("export CARAPACE_HOME=");
      expect(envFileText).toContain("export CARAPACE_STATE_DIR=");
      expect(envFileText).toContain("export CARAPACE_CONFIG_PATH=");
      expect(envFileText).toContain("export CARAPACE_AUTH_PROFILE_SECRET_KEY=");

      const probe = await execFileAsync("bash", [
        "-lc",
        `source ${shellQuote(envFile)}; node -e 'const fs=require("node:fs"); const config=JSON.parse(fs.readFileSync(process.env.CARAPACE_CONFIG_PATH,"utf8")); process.stdout.write(JSON.stringify({home:process.env.HOME,stateDir:process.env.CARAPACE_STATE_DIR,secretKey:process.env.CARAPACE_AUTH_PROFILE_SECRET_KEY,channel:config.update.channel}));'`,
      ]);
      expect(JSON.parse(probe.stdout)).toEqual({
        home: payload.home,
        stateDir: payload.stateDir,
        secretKey: payload.env.CARAPACE_AUTH_PROFILE_SECRET_KEY,
        channel: "stable",
      });
      await fs.rm(payload.root, { recursive: true, force: true });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("renders a Docker-friendly shell snippet", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "carapace-test-state-shell-"));
    const snippetFile = path.join(tempRoot, "state.sh");
    try {
      const { stdout } = await execFileAsync(process.execPath, [
        scriptPath,
        "shell",
        "--label",
        "update-channel-switch",
        "--scenario",
        "update-stable",
      ]);
      expect(stdout).toContain(
        'CARAPACE_TEST_STATE_TMP_ROOT="${CARAPACE_TEST_STATE_TMPDIR:-${TMPDIR:-/tmp}}"',
      );
      expect(stdout).toContain(
        'mktemp -d "$CARAPACE_TEST_STATE_TMP_ROOT/carapace-update-channel-switch-update-stable-home.XXXXXX"',
      );
      expect(stdout).toContain("CARAPACE_TEST_STATE_JSON");
      expect(stdout).toContain('"channel": "stable"');
      await fs.writeFile(snippetFile, stdout, "utf8");

      const probe = await execFileAsync("bash", [
        "-lc",
        `${cleanupTestStateHomeTrap()}; source ${shellQuote(snippetFile)}; node -e 'const fs=require("node:fs"); const config=JSON.parse(fs.readFileSync(process.env.CARAPACE_CONFIG_PATH,"utf8")); process.stdout.write(JSON.stringify({home:process.env.HOME,carapaceHome:process.env.CARAPACE_HOME,workspace:process.env.CARAPACE_TEST_WORKSPACE_DIR,secretKey:process.env.CARAPACE_AUTH_PROFILE_SECRET_KEY,channel:config.update.channel}));'`,
      ]);

      const payload = JSON.parse(probe.stdout);
      expect(payload.home.startsWith(os.tmpdir())).toBe(true);
      expect(path.basename(payload.home)).toMatch(
        /^carapace-update-channel-switch-update-stable-home\./u,
      );
      expect(payload.carapaceHome).toBe(payload.home);
      expect(payload.workspace).toBe(`${payload.home}/workspace`);
      expect(payload.secretKey).toMatch(secretKeyPattern);
      expect(payload.channel).toBe("stable");

      const customTemp = path.join(tempRoot, "state-tmp");
      const customProbe = await execFileAsync("bash", [
        "-lc",
        `${cleanupTestStateHomeTrap()}; export CARAPACE_TEST_STATE_TMPDIR=${shellQuote(customTemp)}; source ${shellQuote(snippetFile)}; node -e 'process.stdout.write(JSON.stringify({home:process.env.HOME,tmpRoot:process.env.CARAPACE_TEST_STATE_TMP_ROOT}));'`,
      ]);
      const customPayload = JSON.parse(customProbe.stdout);
      expect(customPayload.tmpRoot).toBe(customTemp);
      expect(customPayload.home).toMatch(
        new RegExp(
          `^${escapeRegex(customTemp)}/carapace-update-channel-switch-update-stable-home\\.`,
        ),
      );

      const trailingSlashProbe = await execFileAsync("bash", [
        "-lc",
        `${cleanupTestStateHomeTrap()}; export CARAPACE_TEST_STATE_TMPDIR=${shellQuote(`${customTemp}/`)}; source ${shellQuote(snippetFile)}; node -e 'process.stdout.write(JSON.stringify({home:process.env.HOME,tmpRoot:process.env.CARAPACE_TEST_STATE_TMP_ROOT,stateDir:process.env.CARAPACE_STATE_DIR}));'`,
      ]);
      const trailingSlashPayload = JSON.parse(trailingSlashProbe.stdout);
      expect(trailingSlashPayload.tmpRoot).toBe(customTemp);
      expect(trailingSlashPayload.home).toMatch(
        new RegExp(
          `^${escapeRegex(customTemp)}/carapace-update-channel-switch-update-stable-home\\.`,
        ),
      );
      expect(trailingSlashPayload.stateDir).toBe(`${trailingSlashPayload.home}/.carapace`);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps shell key generation independent of node", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "carapace-test-state-path-node-"));
    const fakeBin = path.join(tempRoot, "bin");
    const snippetFile = path.join(tempRoot, "state.sh");
    const functionFile = path.join(tempRoot, "state-function.sh");
    try {
      await fs.mkdir(fakeBin, { recursive: true });
      await fs.writeFile(
        path.join(fakeBin, "node"),
        "#!/bin/sh\necho 'fake node should not be used for key generation' >&2\nexit 42\n",
        "utf8",
      );
      await fs.chmod(path.join(fakeBin, "node"), 0o755);

      const shell = await execFileAsync(process.execPath, [
        scriptPath,
        "shell",
        "--label",
        "path-node",
        "--scenario",
        "empty",
      ]);
      await fs.writeFile(snippetFile, shell.stdout, "utf8");

      const shellProbe = await execFileAsync("bash", [
        "-lc",
        `${cleanupTestStateHomeTrap()}; export PATH=${shellQuote(fakeBin)}:$PATH; source ${shellQuote(snippetFile)}; printf '%s' "$CARAPACE_AUTH_PROFILE_SECRET_KEY"`,
      ]);
      expect(shellProbe.stdout).toMatch(secretKeyPattern);

      const renderedFunction = await execFileAsync(process.execPath, [
        scriptPath,
        "shell-function",
      ]);
      await fs.writeFile(functionFile, renderedFunction.stdout, "utf8");

      const functionProbe = await execFileAsync("bash", [
        "-lc",
        `${cleanupTestStateHomeTrap()}; export PATH=${shellQuote(fakeBin)}:$PATH; export CARAPACE_TEST_STATE_TMPDIR=${shellQuote(path.join(tempRoot, "function-tmp"))}; source ${shellQuote(functionFile)}; carapace_test_state_create "path node" minimal; printf '%s' "$CARAPACE_AUTH_PROFILE_SECRET_KEY"`,
      ]);
      expect(functionProbe.stdout).toMatch(secretKeyPattern);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates the upgrade survivor scenario", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--",
      "create",
      "--label",
      "upgrade-survivor",
      "--scenario",
      "upgrade-survivor",
      "--json",
    ]);
    const payload = JSON.parse(stdout);
    try {
      expect(payload.scenario).toBe("upgrade-survivor");
      expect(payload.config.update).toStrictEqual({ channel: "stable" });
      expect(payload.config.gateway.reload).toStrictEqual({ mode: "off" });
      expect(payload.config.gateway.auth).toStrictEqual({
        mode: "token",
        token: {
          id: "GATEWAY_AUTH_TOKEN_REF",
          provider: "default",
          source: "env",
        },
      });
      expect(payload.config.channels.discord.enabled).toBe(true);
      expect(payload.config.channels.discord.dm).toStrictEqual({
        allowFrom: ["111111111111111111"],
        policy: "allowlist",
      });
      expect(payload.config.channels.telegram.enabled).toBe(true);
      expect(payload.config.channels.whatsapp.enabled).toBe(true);
      const renderedFunction = await execFileAsync(process.execPath, [
        scriptPath,
        "shell-function",
      ]);
      const snippetFile = path.join(payload.root, "state-function.sh");
      await fs.writeFile(snippetFile, renderedFunction.stdout, "utf8");
      const shellHome = path.join(payload.root, "shell-home");
      const shellProbe = await execFileAsync("bash", [
        "-c",
        `source ${shellQuote(snippetFile)}; carapace_test_state_create ${shellQuote(shellHome)} upgrade-survivor; cat "$CARAPACE_CONFIG_PATH"`,
      ]);
      expect(JSON.parse(shellProbe.stdout).gateway).toStrictEqual(payload.config.gateway);
    } finally {
      await fs.rm(payload.root, { recursive: true, force: true });
    }
  });

  it("renders a reusable Docker shell function", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "carapace-test-state-function-"));
    const snippetFile = path.join(tempRoot, "state-function.sh");
    try {
      const { stdout } = await execFileAsync(process.execPath, [
        "--import",
        "tsx",
        scriptPath,
        "shell-function",
      ]);
      expect(stdout).toContain("carapace_test_state_create()");
      expect(stdout).toContain("unset CARAPACE_AGENT_DIR");
      expect(stdout).toContain("update-stable");
      await fs.writeFile(snippetFile, stdout, "utf8");

      const probe = await execFileAsync("bash", [
        "-lc",
        `${cleanupTestStateHomeTrap()}; export CARAPACE_TEST_STATE_TMPDIR=${shellQuote(path.join(tempRoot, "function-tmp"))}; source ${shellQuote(snippetFile)}; export CARAPACE_AGENT_DIR=/tmp/outside-agent; carapace_test_state_create "onboard case" minimal; node -e 'const fs=require("node:fs"); const config=JSON.parse(fs.readFileSync(process.env.CARAPACE_CONFIG_PATH,"utf8")); process.stdout.write(JSON.stringify({home:process.env.HOME,tmpDir:process.env.CARAPACE_TEST_STATE_TMPDIR,agentDir:process.env.CARAPACE_AGENT_DIR || null,workspace:process.env.CARAPACE_TEST_WORKSPACE_DIR,secretKey:process.env.CARAPACE_AUTH_PROFILE_SECRET_KEY,config}));'`,
      ]);

      const payload = JSON.parse(probe.stdout);
      expect(payload.home).toBe(`${payload.tmpDir}/${path.basename(payload.home)}`);
      expect(payload.home).toContain("/carapace-onboard-case-minimal-home.");
      expect(payload.agentDir).toBeNull();
      expect(payload.workspace).toBe(`${payload.home}/workspace`);
      expect(payload.secretKey).toMatch(secretKeyPattern);
      expect(payload.config).toStrictEqual({});

      const trailingTmpDir = path.join(tempRoot, "function-trailing-tmp");
      const trailingProbe = await execFileAsync("bash", [
        "-lc",
        `${cleanupTestStateHomeTrap()}; export CARAPACE_TEST_STATE_TMPDIR=${shellQuote(`${trailingTmpDir}/`)}; source ${shellQuote(snippetFile)}; carapace_test_state_create "onboard case" minimal; node -e 'process.stdout.write(JSON.stringify({home:process.env.HOME,tmpDir:process.env.CARAPACE_TEST_STATE_TMPDIR,stateDir:process.env.CARAPACE_STATE_DIR,workspace:process.env.CARAPACE_TEST_WORKSPACE_DIR}));'`,
      ]);

      const trailingPayload = JSON.parse(trailingProbe.stdout);
      expect(trailingPayload.home).toBe(`${trailingTmpDir}/${path.basename(trailingPayload.home)}`);
      expect(trailingPayload.stateDir).toBe(`${trailingPayload.home}/.carapace`);
      expect(trailingPayload.workspace).toBe(`${trailingPayload.home}/workspace`);

      const existingHome = path.join(tempRoot, "existing-home");
      const existingProbe = await execFileAsync("bash", [
        "-lc",
        `source ${shellQuote(snippetFile)}; carapace_test_state_create ${shellQuote(existingHome)} minimal; firstKey="$CARAPACE_AUTH_PROFILE_SECRET_KEY"; export firstKey; printf '{"kept":true}\\n' > "$CARAPACE_CONFIG_PATH"; carapace_test_state_create ${shellQuote(existingHome)} empty; node -e 'const fs=require("node:fs"); const config=JSON.parse(fs.readFileSync(process.env.CARAPACE_CONFIG_PATH,"utf8")); process.stdout.write(JSON.stringify({home:process.env.HOME,secretKey:process.env.CARAPACE_AUTH_PROFILE_SECRET_KEY,firstKey:process.env.firstKey,config}));'`,
      ]);

      const existingPayload = JSON.parse(existingProbe.stdout);
      expect(existingPayload.home).toBe(existingHome);
      expect(existingPayload.secretKey).toBe(existingPayload.firstKey);
      expect(existingPayload.config).toEqual({ kept: true });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
