import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { runCliProcessChild } from "./cli-process-child.test-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const pluginId = "authoring-proof";
const invalidConfig = '{"gateway":{"port":"invalid"}}\n';

async function createAuthoringFixture(root: string) {
  const project = path.join(root, "project");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(
    path.join(project, "package.json"),
    JSON.stringify({
      name: "carapace-plugin-authoring-proof",
      version: "1.0.0",
      type: "module",
      carapace: { extensions: ["./index.ts"] },
    }),
  );
  await fs.writeFile(
    path.join(project, "index.ts"),
    `import { defineToolPlugin } from "carapace/plugin-sdk/tool-plugin";
export default defineToolPlugin({
  id: "authoring-proof", name: "Authoring Proof", description: "Authoring fixture.",
  tools: (tool) => [tool({
    name: "echo", description: "Echo input.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ ok: true }),
  })],
});
`,
  );
  await fs.writeFile(
    path.join(project, "carapace.plugin.json"),
    JSON.stringify({
      id: pluginId,
      name: "Authoring Proof",
      description: "Authoring fixture.",
      version: "1.0.0",
      configSchema: { type: "object", additionalProperties: false, properties: {} },
      activation: { onStartup: true },
      contracts: { tools: ["echo"] },
    }),
  );
  return project;
}

async function runPlugins(root: string, args: string[]) {
  const configPath = path.join(root, "carapace.json");
  await fs.writeFile(configPath, invalidConfig);
  return runCliProcessChild({
    nodeArgs: ["--import", "tsx", path.resolve("src", "entry.ts"), "plugins", ...args],
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      NODE_DISABLE_COMPILE_CACHE: "1",
      NODE_ENV: undefined,
      NODE_OPTIONS: undefined,
      NO_COLOR: "1",
      CARAPACE_CONFIG_PATH: configPath,
      CARAPACE_HIDE_BANNER: "1",
      CARAPACE_HOME: root,
      CARAPACE_NO_RESPAWN: "1",
      CARAPACE_STATE_DIR: path.join(root, "state"),
      VITEST: undefined,
      VITEST_POOL_ID: undefined,
      VITEST_WORKER_ID: undefined,
    },
  });
}

describe("plugin authoring with invalid host config", () => {
  it.each(["init", "build", "validate"] as const)(
    "runs plugins %s against its target package",
    async (command) => {
      const root = tempDirs.make("carapace-plugin-authoring-process-");
      const project =
        command === "init" ? path.join(root, "project") : await createAuthoringFixture(root);
      if (command === "build") {
        await fs.unlink(path.join(project, "carapace.plugin.json"));
      }
      const args =
        command === "init"
          ? [command, pluginId, "--directory", project]
          : [command, "--root", project, ...(command === "validate" ? ["--json"] : [])];

      const result = await runPlugins(root, args);

      expect(result.code, result.stderr).toBe(0);
      expect(await fs.readFile(path.join(root, "carapace.json"), "utf8")).toBe(invalidConfig);
      const manifest = JSON.parse(
        await fs.readFile(path.join(project, "carapace.plugin.json"), "utf8"),
      );
      expect(manifest).toMatchObject({ id: pluginId, contracts: { tools: ["echo"] } });
      if (command === "validate") {
        expect(JSON.parse(result.stdout)).toEqual({ valid: true, pluginId, errors: [] });
      }
    },
  );

  it("still rejects invalid host config for plugin enable", async () => {
    const root = tempDirs.make("carapace-plugin-enable-process-");
    const result = await runPlugins(root, ["enable", pluginId]);
    expect(result.code, result.stderr).toBe(1);
    expect(result.stderr).toContain("Carapace config is invalid");
    expect(await fs.readFile(path.join(root, "carapace.json"), "utf8")).toBe(invalidConfig);
  });
});
