import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createExecTool } from "../agents/bash-tools.js";
import { resolveExecToolConfig } from "../agents/lazy-exec-tool.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { captureEnv } from "../test-utils/env.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import { resolveCurrentCarapaceCliInvocation } from "./carapace-cli-invocation.js";
import {
  createSourceCliFixture,
  runSourceCliProbe,
} from "./carapace-cli-invocation.test-support.js";
import { clearGatewayAgentCliShim, prepareGatewayAgentCliShim } from "./carapace-cli-shim.js";

const envSnapshot = captureEnv([
  "CARAPACE_EXEC_SHELL_SNAPSHOT",
  "CARAPACE_PROFILE",
  "PATH",
  "TSX_TSCONFIG_PATH",
  "TSX_DISABLE_CACHE",
]);

afterEach(() => {
  clearGatewayAgentCliShim();
  envSnapshot.restore();
});

function readExecText(result: Awaited<ReturnType<ReturnType<typeof createExecTool>["execute"]>>) {
  return result.content.find((entry) => entry.type === "text")?.text?.trim() ?? "";
}

describe.skipIf(process.platform === "win32")("Gateway agent CLI shim", () => {
  it.each(["file URL", "bare TSX", "inline bare TSX"])(
    "runs the checkout's source CLI version command outside the checkout (%s)",
    async (parentLoader) => {
      await withTempDir("carapace-agent-cli-version-", async (root) => {
        const checkout = fileURLToPath(new URL("../../", import.meta.url));
        const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
        const execArgv =
          parentLoader === "inline bare TSX"
            ? ["--import=tsx"]
            : ["--import", parentLoader === "bare TSX" ? "tsx" : loader];
        const entryPath = path.join(checkout, "src", "entry.ts");
        const callerCwd = path.join(root, "workspace");
        const stateDir = path.join(root, "state");
        await fs.mkdir(callerCwd);
        const env = {
          HOME: root,
          USERPROFILE: root,
          CARAPACE_PROFILE: "",
          CARAPACE_STATE_DIR: stateDir,
          CARAPACE_CONFIG_PATH: path.join(stateDir, "carapace.json"),
        };
        const invocation = resolveCurrentCarapaceCliInvocation([], {
          argv1: entryPath,
          cwd: checkout,
          execArgv,
          execPath: process.execPath,
        });
        const control = runSourceCliProbe(
          invocation.command,
          [...execArgv, entryPath, "--version"],
          checkout,
          { env },
        );
        expect(control.status, "checkout source CLI --version").toBe(0);
        expect(control.stdout).toMatch(/^Carapace \d+\./);

        await prepareGatewayAgentCliShim({ invocation, env, stateDir });
        const result = runSourceCliProbe(
          path.join(stateDir, "tmp", "agent-cli", "carapace"),
          ["--version"],
          callerCwd,
          { env },
        );
        expect(result.status, "external source CLI --version through agent launcher").toBe(0);
        expect(result.stdout).toBe(control.stdout);
      });
    },
  );

  it.each([
    { profile: "work", expectedArgs: ["--profile", "work", "probe"] },
    { profile: undefined, expectedArgs: ["probe"] },
  ])("pins the running CLI before configured PATH entries (profile=$profile)", async (testCase) => {
    await withTempDir("carapace-agent-cli-shim-", async (root) => {
      const fixture = await createSourceCliFixture(root);
      const staleBinDir = path.join(root, "stale-bin");
      const staleCliPath = path.join(staleBinDir, "carapace");
      const stateDir = path.join(root, "state");
      await fs.mkdir(staleBinDir, { recursive: true });
      await fs.writeFile(staleCliPath, "#!/bin/sh\nprintf '%s\\n' '{\"source\":\"stale\"}'\n", {
        mode: 0o700,
      });

      await prepareGatewayAgentCliShim({
        env: testCase.profile ? { CARAPACE_PROFILE: testCase.profile } : {},
        invocation: fixture.invocation,
        stateDir,
      });
      const shimBinDir = path.join(stateDir, "tmp", "agent-cli");
      const config = {
        tools: { exec: { pathPrepend: [staleBinDir] } },
      } satisfies CarapaceConfig;
      const execConfig = resolveExecToolConfig({ cfg: config });
      expect(execConfig.pathPrepend?.slice(0, 2)).toEqual([shimBinDir, staleBinDir]);

      process.env.CARAPACE_EXEC_SHELL_SNAPSHOT = "0";
      process.env.PATH = `${staleBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
      delete process.env.CARAPACE_PROFILE;
      delete process.env.TSX_TSCONFIG_PATH;
      process.env.TSX_DISABLE_CACHE = "1";
      const tool = createExecTool({
        ...execConfig,
        host: "gateway",
        security: "full",
        ask: "off",
        cwd: fixture.callerCwd,
        notifyOnExit: false,
      });
      const result = await tool.execute("gateway-cli-version-probe", {
        command: "carapace probe",
        yieldMs: 120_000,
      });
      expect(JSON.parse(readExecText(result))).toMatchObject({
        source: "gateway",
        args: testCase.expectedArgs,
        cwd: fixture.callerCwd,
        pathHead: shimBinDir,
      });
    });
  });
});

it("renders a Windows PATH launcher for the running CLI", async () => {
  await withTempDir("carapace-agent-cli-shim-win-", async (root) => {
    await prepareGatewayAgentCliShim({
      env: { CARAPACE_PROFILE: "work" },
      invocation: {
        command: "C:\\Program Files\\nodejs\\node.exe",
        args: ["C:\\Carapace\\dist\\index.js"],
        cwd: "C:\\Carapace %USERPROFILE%!",
      },
      platform: "win32",
      stateDir: root,
    });

    const executablePath = path.join(root, "tmp", "agent-cli", "carapace.cmd");
    expect(await fs.readFile(executablePath, "utf8")).toBe(
      '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"C:\\Program Files\\nodejs\\node.exe" C:\\Carapace\\dist\\index.js --profile work %*\r\n',
    );
  });
});
