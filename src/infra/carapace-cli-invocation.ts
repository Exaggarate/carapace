import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isBunRuntime } from "../daemon/runtime-binary.js";
import { resolveCarapacePackageRootSync } from "./carapace-root.js";
import { resolveRuntimeWorkerArgv } from "./runtime-worker-url.js";
import { tryProcessCwd } from "./safe-cwd.js";

const requireFromHere = createRequire(import.meta.url);
const CARAPACE_CLI_ENTRY_BASENAMES = new Set(["carapace", "carapace.mjs"]);
const CARAPACE_PACKAGE_ENTRY_PATHS = new Set([
  path.join("dist", "entry.js"),
  path.join("dist", "entry.mjs"),
  path.join("dist", "index.js"),
  path.join("dist", "index.mjs"),
  path.join("src", "entry.ts"),
]);

export type CarapaceCliInvocation = Readonly<{
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}>;

function resolveTsxImport(packageRoot: string): string {
  return pathToFileURL(requireFromHere.resolve("tsx", { paths: [packageRoot] })).href;
}

/** Keep parent runtime flags, pin its known TSX preload, and leave debugger ownership behind. */
export function filterCarapaceChildExecArgv(
  execArgv: readonly string[],
  sourceRoot?: string,
): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const arg = execArgv[index] ?? "";
    if (/^--inspect(?:-brk|-wait|-port)?(?:=|$)/.test(arg)) {
      const next = execArgv[index + 1];
      if (!arg.includes("=") && typeof next === "string" && !next.startsWith("-")) {
        index += 1;
      }
      continue;
    }
    // Node resolves bare preloads from the child cwd. Pin only our known TSX
    // spelling; unrelated parent import hooks retain their own semantics.
    const bareTsx = arg === "tsx" && execArgv[index - 1] === "--import";
    filtered.push(
      sourceRoot && (bareTsx || arg === "--import=tsx")
        ? `${bareTsx ? "" : "--import="}${resolveTsxImport(sourceRoot)}`
        : arg,
    );
  }
  return filtered;
}

function buildPackageRootCliArgs(packageRoot: string, execPath: string): string[] {
  const sourceEntry = path.join(packageRoot, "src", "entry.ts");
  if (fs.existsSync(sourceEntry)) {
    try {
      return filterCarapaceChildExecArgv(
        resolveRuntimeWorkerArgv(pathToFileURL(sourceEntry), execPath),
        packageRoot,
      );
    } catch {
      // A checkout without TSX can still use its built package launcher.
    }
  }
  return [path.join(packageRoot, "carapace.mjs")];
}

export function resolveCurrentCarapaceCliInvocation(
  args: readonly string[],
  options: {
    argv1?: string;
    cwd?: string;
    execArgv?: readonly string[];
    execPath?: string;
    moduleUrl?: string;
  } = {},
): CarapaceCliInvocation {
  const execPath = options.execPath ?? process.execPath;
  const entry = (options.argv1 ?? process.argv[1])?.trim();
  const cwd = options.cwd ?? tryProcessCwd();
  const entryPackageRoot = entry ? resolveCarapacePackageRootSync({ argv1: entry }) : null;
  const packageRoot =
    entryPackageRoot ??
    resolveCarapacePackageRootSync({
      argv1: entry,
      cwd,
      moduleUrl: options.moduleUrl ?? import.meta.url,
    });
  const invocationCwd =
    packageRoot ?? cwd ?? (entry ? path.dirname(path.resolve(entry)) : path.dirname(execPath));
  const sourceEntry = packageRoot ? path.join(packageRoot, "src", "entry.ts") : undefined;

  const currentEntry =
    entry &&
    entry !== execPath &&
    entryPackageRoot &&
    (CARAPACE_CLI_ENTRY_BASENAMES.has(path.basename(entry)) ||
      CARAPACE_PACKAGE_ENTRY_PATHS.has(
        path.relative(path.resolve(entryPackageRoot), path.resolve(entry)),
      ))
      ? entry
      : undefined;
  const cliArgs = currentEntry
    ? [
        ...filterCarapaceChildExecArgv(
          options.execArgv ?? process.execArgv,
          currentEntry === sourceEntry && !isBunRuntime(execPath)
            ? (packageRoot ?? undefined)
            : undefined,
        ),
        currentEntry,
      ]
    : packageRoot
      ? buildPackageRootCliArgs(packageRoot, execPath)
      : entry && entry !== execPath
        ? [entry]
        : [];
  // TSX resolves workspace aliases from cwd unless the source invocation carries
  // its own config. Callers may preserve their workspace cwd without rediscovery.
  const env =
    packageRoot && !isBunRuntime(execPath) && cliArgs.at(-1) === sourceEntry
      ? { TSX_TSCONFIG_PATH: path.join(packageRoot, "tsconfig.json") }
      : undefined;
  return {
    command: execPath,
    args: [...cliArgs, ...args],
    cwd: invocationCwd,
    ...(env ? { env } : {}),
  };
}
