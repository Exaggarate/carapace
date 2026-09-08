// Resolves development source roots for local plugin installs.
import fs from "node:fs";
import path from "node:path";
import { resolveUserPath } from "../utils.js";
import { isPluginInPackageBundledRoots } from "./bundled-dir.js";
import { pluginCacheExistsSync, pluginCacheRealpathSync } from "./plugin-cache-files.js";
import { getPluginCache } from "./plugin-cache.js";

/** Env var that points bundled-plugin lookup at an Carapace source checkout. */
const CARAPACE_DEV_SOURCE_ROOT_ENV = "CARAPACE_DEV_SOURCE_ROOT";

function readPackageName(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

/** Resolves and validates the configured Carapace development source root. */
export function resolveCarapaceDevSourceRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const rawRoot = env[CARAPACE_DEV_SOURCE_ROOT_ENV]?.trim();
  if (!rawRoot) {
    return null;
  }
  const resolvedRoot = resolveUserPath(rawRoot, env);
  const roots = getPluginCache().sdk.devSourceRoots;
  if (roots.has(resolvedRoot)) {
    return roots.get(resolvedRoot) ?? null;
  }
  const realRoot = pluginCacheRealpathSync(resolvedRoot);
  const valid =
    realRoot &&
    readPackageName(path.join(realRoot, "package.json")) === "carapace" &&
    pluginCacheExistsSync(path.join(realRoot, "src")) &&
    pluginCacheExistsSync(path.join(realRoot, "extensions"));
  const result = valid ? realRoot : null;
  roots.set(resolvedRoot, result);
  return result;
}

/** Prioritizes already-bundled candidates; the selector itself never grants provenance. */
export function isBundledPluginInsideDevSourceRoot(params: {
  rootDir: string;
  env: NodeJS.ProcessEnv;
}): boolean {
  const devSourceRoot = resolveCarapaceDevSourceRoot(params.env);
  if (!devSourceRoot) {
    return false;
  }
  return isPluginInPackageBundledRoots({
    packageRoot: devSourceRoot,
    rootDir: resolveUserPath(params.rootDir, params.env),
  });
}
