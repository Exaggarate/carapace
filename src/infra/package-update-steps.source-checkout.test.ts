import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { runGlobalPackageUpdateSteps } from "./package-update-steps.js";
import {
  createNpmTarget,
  createRootRunner,
  writePackageRoot,
} from "./package-update-steps.test-support.js";
import { resolveNpmGlobalPrefixLayoutFromPrefix } from "./update-global.js";

const SOURCE_VERSION = "2026.8.1";
const SOURCE_SHA = "a".repeat(40);

async function writeSourceCheckout(checkoutRoot: string): Promise<void> {
  await fs.mkdir(checkoutRoot, { recursive: true });
  for (const dir of [".git", "src", "extensions", "dist/control-ui/assets"]) {
    await fs.mkdir(path.join(checkoutRoot, dir), { recursive: true });
  }
  for (const [file, contents] of Object.entries({
    "package.json": JSON.stringify({ name: "carapace", version: SOURCE_VERSION }),
    "pnpm-workspace.yaml": "packages: []\n",
    "dist/entry.js": "export {};\n",
    "dist/build-info.json": JSON.stringify({ commit: SOURCE_SHA }),
    "dist/.buildstamp": JSON.stringify({ head: SOURCE_SHA }),
    "dist/.runtime-postbuildstamp": JSON.stringify({ head: SOURCE_SHA }),
    "dist/control-ui/index.html": '<script src="./assets/startup.js"></script>',
    "dist/control-ui/assets/startup.js": "export {};\n",
  })) {
    await fs.writeFile(path.join(checkoutRoot, file), contents);
  }
  await fs.writeFile(path.join(checkoutRoot, "carapace.mjs"), "#!/usr/bin/env node\n", {
    mode: 0o755,
  });
}

describe("runGlobalPackageUpdateSteps", () => {
  it("validates a temporary source checkout then exposes its published root", async () => {
    await withTestDir({ prefix: "carapace-source-publication-" }, async (base) => {
      const globalRoot = path.join(base, "prefix", "lib", "node_modules");
      const packageRoot = path.join(globalRoot, "carapace");
      const candidateRoot = path.join(base, "candidate");
      const publishedRoot = path.join(base, "checkout");
      await writePackageRoot(packageRoot, "1.0.0");
      await writeSourceCheckout(candidateRoot);
      await writeSourceCheckout(publishedRoot);
      const phases: string[] = [];
      const result = await runGlobalPackageUpdateSteps({
        installTarget: createNpmTarget(globalRoot),
        installSpec: candidateRoot,
        packageName: "carapace",
        expectedGitCheckout: { root: candidateRoot, sha: SOURCE_SHA },
        activateGitRoot: publishedRoot,
        runCommand: createRootRunner(globalRoot),
        runStep: async ({ name, argv }) => {
          const stagePrefix = argv[argv.indexOf("--prefix") + 1];
          if (!stagePrefix) {
            throw new Error("missing stage prefix");
          }
          const layout = resolveNpmGlobalPrefixLayoutFromPrefix(stagePrefix);
          await fs.mkdir(layout.globalRoot, { recursive: true });
          await fs.mkdir(layout.binDir, { recursive: true });
          await fs.symlink(
            candidateRoot,
            path.join(layout.globalRoot, "carapace"),
            process.platform === "win32" ? "junction" : undefined,
          );
          await fs.symlink(
            "../lib/node_modules/carapace/carapace.mjs",
            path.join(layout.binDir, "carapace"),
          );
          return { name, command: argv.join(" "), cwd: stagePrefix, durationMs: 0, exitCode: 0 };
        },
        validateCandidate: async (root) => {
          phases.push("validate");
          expect(await fs.realpath(root)).toBe(candidateRoot);
          return [];
        },
        beforeActivate: async () => {
          phases.push("publish");
          await fs.rename(publishedRoot, `${publishedRoot}.previous`);
          await fs.rename(candidateRoot, publishedRoot);
        },
        postVerifyStep: async (root) => {
          phases.push("doctor");
          expect(await fs.realpath(root)).toBe(publishedRoot);
          return { name: "doctor", command: "doctor --fix", cwd: root, durationMs: 0, exitCode: 0 };
        },
        timeoutMs: 1000,
      });
      expect(result.failedStep).toBeNull();
      expect(phases).toEqual(["validate", "publish", "doctor"]);
      expect(await fs.realpath(packageRoot)).toBe(publishedRoot);
      expect(result.afterVersion).toBe(SOURCE_VERSION);
    });
  });

  it("refuses a prepared checkout when the manager cannot identify its installed root", async () => {
    const postVerifyStep = vi.fn();
    const result = await runGlobalPackageUpdateSteps({
      installTarget: { manager: "pnpm", command: "pnpm", globalRoot: null, packageRoot: null },
      installSpec: "/prepared-checkout",
      packageName: "carapace",
      expectedGitCheckout: { root: "/prepared-checkout", sha: SOURCE_SHA },
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      runStep: async ({ name, argv }) => ({
        name,
        command: argv.join(" "),
        cwd: "/",
        durationMs: 0,
        exitCode: 0,
      }),
      timeoutMs: 1000,
      postVerifyStep,
    });
    expect(result.failedStep).toMatchObject({
      name: "global install verify",
      stderrTail: "could not identify the installed package root",
    });
    expect(postVerifyStep).not.toHaveBeenCalled();
  });

  it("preserves the old global package when source exposure refuses before activation", async () => {
    await withTestDir({ prefix: "carapace-git-exposure-recovery-" }, async (base) => {
      const globalRoot = path.join(base, "node_modules");
      const packageRoot = path.join(globalRoot, "carapace");
      await writePackageRoot(packageRoot, "1.0.0");
      await writeSourceCheckout(path.join(base, "prepared-checkout"));
      const runStep = vi.fn();
      const result = await runGlobalPackageUpdateSteps({
        installTarget: {
          ...createNpmTarget(globalRoot),
          npmOwner: { version: null, lifecyclePolicy: null },
        },
        installSpec: path.join(base, "prepared-checkout"),
        expectedGitCheckout: { root: path.join(base, "prepared-checkout"), sha: SOURCE_SHA },
        packageName: "carapace",
        packageRoot,
        runCommand: createRootRunner(globalRoot),
        runStep,
        timeoutMs: 1000,
      });
      expect(result.recovery).toEqual({
        serviceRestartSafe: true,
        version: "1.0.0",
      });
      expect(runStep).not.toHaveBeenCalled();
    });
  });

  describe.each(["npm", "pnpm", "bun"] as const)("%s source checkout activation", (manager) => {
    it.each([
      { name: "prepared checkout", error: null },
      { name: "wrong checkout", error: "expected checkout" },
      { name: "accidental source link", error: "source checkout" },
      { name: "missing build entry", remove: "dist/entry.js", error: "entry=false" },
      {
        name: "missing runtime stamp",
        remove: "dist/.runtime-postbuildstamp",
        error: "runtimeStamp=missing",
      },
      {
        name: "stale build identity",
        stale: "dist/build-info.json",
        error: "git runtime mismatch",
      },
      { name: "stale build stamp", stale: "dist/.buildstamp", error: "git runtime mismatch" },
      { name: "missing build identity", remove: "dist/build-info.json", error: "build=missing" },
      { name: "missing built SHA", error: "expected=missing" },
      { name: "missing UI index", remove: "dist/control-ui/index.html", error: "ui=missing-index" },
      {
        name: "incomplete UI",
        remove: "dist/control-ui/assets/startup.js",
        error: "ui=incomplete",
      },
      { name: "missing launcher", remove: "carapace.mjs", error: "missing" },
    ])("verifies $name before finalization", async ({ name: caseName, error, remove, stale }) => {
      await withTestDir({ prefix: "carapace-package-update-source-" }, async (base) => {
        const prefix = path.join(base, "prefix");
        const globalRoot =
          manager === "npm"
            ? path.join(prefix, "lib", "node_modules")
            : manager === "pnpm"
              ? path.join(prefix, "global", "5", "node_modules")
              : path.join(prefix, ".bun", "install", "global", "node_modules");
        const packageRoot = path.join(globalRoot, "carapace");
        const checkoutRoot = path.join(base, "checkout");
        const linkedRoot =
          caseName === "wrong checkout" ? path.join(base, "other-checkout") : checkoutRoot;
        await writePackageRoot(packageRoot, "1.0.0");
        await writeSourceCheckout(checkoutRoot);
        if (linkedRoot !== checkoutRoot) {
          await writeSourceCheckout(linkedRoot);
        }
        if (remove) {
          await fs.rm(path.join(checkoutRoot, remove));
        }
        if (stale) {
          await fs.writeFile(
            path.join(checkoutRoot, stale),
            JSON.stringify({ commit: "b".repeat(40), head: "b".repeat(40) }),
          );
        }
        const postVerifyStep = vi.fn(async () => ({
          name: "candidate doctor",
          command: "doctor",
          cwd: packageRoot,
          durationMs: 0,
          exitCode: 0,
        }));
        const result = await runGlobalPackageUpdateSteps({
          installTarget:
            manager === "npm"
              ? createNpmTarget(globalRoot)
              : { manager, command: manager, globalRoot, packageRoot },
          installSpec: checkoutRoot,
          expectedGitCheckout:
            caseName === "accidental source link"
              ? undefined
              : { root: checkoutRoot, sha: caseName === "missing built SHA" ? null : SOURCE_SHA },
          packageName: "carapace",
          packageRoot,
          installCwd: checkoutRoot,
          runCommand: createRootRunner(globalRoot),
          runStep: async ({ name, argv, cwd }) => {
            expect(name).toBe("global update");
            let targetRoot = packageRoot;
            if (manager === "npm") {
              const stagePrefix = argv[argv.indexOf("--prefix") + 1];
              if (!stagePrefix) {
                throw new Error("missing staged prefix");
              }
              expect(path.dirname(stagePrefix)).toBe(globalRoot);
              const stageLayout = resolveNpmGlobalPrefixLayoutFromPrefix(stagePrefix);
              targetRoot = path.join(stageLayout.globalRoot, "carapace");
              await fs.mkdir(stageLayout.binDir, { recursive: true });
              await fs.symlink(
                "../lib/node_modules/carapace/carapace.mjs",
                path.join(stageLayout.binDir, "carapace"),
              );
            } else {
              await fs.rm(packageRoot, { recursive: true });
            }
            await fs.mkdir(path.dirname(targetRoot), { recursive: true });
            await fs.symlink(
              process.platform === "win32"
                ? linkedRoot
                : path.relative(path.dirname(targetRoot), linkedRoot),
              targetRoot,
              process.platform === "win32" ? "junction" : undefined,
            );
            return {
              name,
              command: argv.join(" "),
              cwd: cwd ?? process.cwd(),
              durationMs: 1,
              exitCode: 0,
            };
          },
          timeoutMs: 1000,
          postVerifyStep,
        });
        if (error) {
          expect(result.failedStep).toMatchObject({
            name: "global install verify",
            stderrTail: expect.stringContaining(error),
          });
          expect(postVerifyStep).not.toHaveBeenCalled();
          if (manager === "npm") {
            expect(result.afterVersion).toBe("1.0.0");
            expect(result.steps.some((step) => step.name === "global install swap")).toBe(false);
            await expect(
              fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
            ).resolves.toContain('"version":"1.0.0"');
          }
        } else {
          expect(result.failedStep).toBeNull();
          expect(result.activePackageRoot).toBe(packageRoot);
          expect(result.afterVersion).toBe(SOURCE_VERSION);
          expect(postVerifyStep).toHaveBeenCalledWith(packageRoot);
          await expect(fs.realpath(packageRoot)).resolves.toBe(checkoutRoot);
          if (manager === "npm") {
            expect(result.steps.map((step) => step.name)).toEqual([
              "global update",
              "global install swap",
              "candidate doctor",
            ]);
            await expect(fs.readlink(path.join(prefix, "bin", "carapace"))).resolves.toBe(
              "../lib/node_modules/carapace/carapace.mjs",
            );
            expect(
              (await fs.readdir(globalRoot)).filter((entry) =>
                entry.startsWith(".carapace.update-stage-"),
              ),
            ).toEqual([]);
          }
        }
      });
    });
  });
});
