// File-defined tools (#80213): ~/.carapace/tools/*.json become registry entries, and
// an optional `setup` argv runs ONCE on first load — inside the allowed roots, with
// its output logged — so a tool can prepare its own state (dirs, caches, tokens).
// Definition files are operator-authored and executed on the operator's machine; they
// carry the same trust level as config.json itself. Broken files and failed setups
// only log warnings — they never block the toolbox or gateway boot.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { carapaceHome } from "../../config.js";
import type { ToolDefinition, ToolInputSchema, ToolParameterSchema, ToolResult } from "./registry.js";

const STDOUT_CAP_CHARS = 60_000;
const STDERR_CAP_CHARS = 20_000;
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
/** Directory under the tools dir holding setup-run markers. */
const SETUP_MARKER_DIR = ".setup";
const SETUP_OUTPUT_TAIL_CHARS = 400;

export interface FileToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** argv spawned directly (no shell) when the model calls this tool. */
  execArgv: string[];
  /** Optional one-time setup argv; runs on first load, marker-tracked (#80213). */
  setupArgv?: string[];
}

export interface FileToolsSnapshot {
  /** Valid definitions; invalid files are reported via issues and skipped. */
  defs: FileToolDefinition[];
  /** Human-readable problems; never fatal for gateway boot. */
  issues: string[];
}

/** Directory holding operator-defined tool files (default ~/.carapace/tools). */
export function fileToolsDir(): string {
  return join(carapaceHome(), "tools");
}

/**
 * Read + validate the tool definition directory. Pure: no execution, no marker
 * writes, no side effects — safe for `carapace doctor`.
 */
export function loadFileToolDefs(dir: string): FileToolsSnapshot {
  const defs: FileToolDefinition[] = [];
  const issues: string[] = [];
  if (!existsSync(dir)) return { defs, issues };
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    return { defs, issues: [`tools dir "${dir}" is unreadable: ${(error as Error).message}`] };
  }
  const seen = new Set<string>();
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const path = join(dir, entry);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      issues.push(`${entry}: not valid JSON (${(error as Error).message})`);
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push(`${entry}: root must be a JSON object`);
      continue;
    }
    const record = raw as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
      issues.push(`${entry}: "name" must be 1-64 characters of [a-zA-Z0-9_-]`);
      continue;
    }
    if (seen.has(name)) {
      issues.push(`${entry}: duplicate tool name "${name}"`);
      continue;
    }
    const description = record.description;
    if (typeof description !== "string" || description.trim() === "") {
      issues.push(`${entry}: "description" must be a non-empty string`);
      continue;
    }
    const execArgv = readArgv(record.exec, `${entry}: exec`, issues);
    if (execArgv === null) continue;
    let setupArgv: string[] | undefined;
    if (record.setup !== undefined) {
      const setup = readArgv(record.setup, `${entry}: setup`, issues);
      if (setup === null) continue;
      setupArgv = setup;
    }
    seen.add(name);
    defs.push({
      name,
      description,
      inputSchema: readInputSchema(record.inputSchema, entry, issues),
      execArgv,
      ...(setupArgv !== undefined ? { setupArgv } : {}),
    });
  }
  return { defs, issues };
}

function readArgv(value: unknown, label: string, issues: string[]): string[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(`${label} must be an object with a non-empty "argv" string array`);
    return null;
  }
  const raw = (value as Record<string, unknown>).argv;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    issues.push(`${label}.argv must be a non-empty array of non-empty strings`);
    return null;
  }
  return raw as string[];
}

function readInputSchema(value: unknown, label: string, issues: string[]): ToolInputSchema {
  if (value === undefined) return { type: "object", properties: {}, required: [] };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(`${label}: inputSchema must be an object; using the empty schema`);
    return { type: "object", properties: {}, required: [] };
  }
  const record = value as Record<string, unknown>;
  const properties: Record<string, ToolParameterSchema> = {};
  const rawProps = record.properties;
  if (typeof rawProps === "object" && rawProps !== null && !Array.isArray(rawProps)) {
    for (const [key, prop] of Object.entries(rawProps)) {
      const spec = (typeof prop === "object" && prop !== null ? prop : {}) as Record<string, unknown>;
      const param: ToolParameterSchema = {
        type: spec.type === "number" || spec.type === "boolean" ? spec.type : "string",
      };
      if (typeof spec.description === "string") param.description = spec.description;
      properties[key] = param;
    }
  }
  const required = Array.isArray(record.required)
    ? (record.required as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  return { type: "object", properties, required };
}

/** Replace {{key}} tokens in an argv template with model-supplied arguments. */
export function materializeArgv(argv: string[], input: Record<string, unknown>): string[] {
  return argv.map((entry) =>
    entry.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
      const value = input[key];
      if (value === undefined || value === null) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    }),
  );
}

interface SpawnCapture {
  code: number | null;
  signal: string | null;
  spawnError: string | null;
  stdout: string;
  stderr: string;
}

/** Spawn argv directly (no shell) inside cwd, bounded by a wall-clock timeout. */
async function runArgv(argv: string[], cwd: string, timeoutMs: number): Promise<SpawnCapture> {
  return await new Promise<SpawnCapture>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: SpawnCapture): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child: ChildProcess;
    try {
      child = spawn(argv[0] ?? "", argv.slice(1), { cwd, timeout: timeoutMs, killSignal: "SIGKILL" });
    } catch (error) {
      resolve({ code: null, signal: null, spawnError: (error as Error).message, stdout: "", stderr: "" });
      return;
    }
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Uint8Array) => {
      if (typeof chunk === "string" && stdout.length < STDOUT_CAP_CHARS) stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string | Uint8Array) => {
      if (typeof chunk === "string" && stderr.length < STDERR_CAP_CHARS) stderr += chunk;
    });
    child.on("error", (error: Error) =>
      finish({ code: null, signal: null, spawnError: error.message, stdout, stderr }),
    );
    child.on("close", (code, signal) => finish({ code, signal, spawnError: null, stdout, stderr }));
  });
}

function captureToResult(name: string, capture: SpawnCapture, timeoutMs: number): ToolResult {
  const parts: string[] = [];
  if (capture.spawnError !== null) {
    parts.push(`${name}: failed to start (${capture.spawnError})`);
  } else if (capture.code === null && capture.signal !== null) {
    parts.push(`terminated by signal ${capture.signal} (timeout ${timeoutMs}ms)`);
  } else {
    parts.push(`exit=${capture.code ?? "null"}`);
  }
  parts.push(capture.stdout.trim() === "" ? "stdout: (empty)" : `stdout:\n${capture.stdout.trimEnd()}`);
  parts.push(capture.stderr.trim() === "" ? "stderr: (empty)" : `stderr:\n${capture.stderr.trimEnd()}`);
  return { ok: capture.spawnError === null && capture.code === 0, output: parts.join("\n") };
}

/** Build the registry entry for one file-defined tool. */
export function fileToolDefinition(
  def: FileToolDefinition,
  opts: { cwd: string; timeoutMs: number },
): ToolDefinition {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async execute(input): Promise<ToolResult> {
      // {{key}} tokens substitute single spawn arguments — no shell, no injection surface.
      const capture = await runArgv(materializeArgv(def.execArgv, input), opts.cwd, opts.timeoutMs);
      return captureToResult(def.name, capture, opts.timeoutMs);
    },
  };
}

function setupMarkerPath(dir: string, def: FileToolDefinition): string {
  // Hash the setup argv into the marker name so an edited setup re-runs once.
  const hash = createHash("sha256").update(JSON.stringify(def.setupArgv ?? [])).digest("hex").slice(0, 12);
  return join(dir, SETUP_MARKER_DIR, `${def.name}-${hash}`);
}

/**
 * Run a tool's setup script once (#80213): marker-tracked under <toolsDir>/.setup so
 * it fires on first load only — and again if the setup argv changes. A failed setup
 * is logged and retried on the next boot; it never blocks tool registration.
 * Synchronous on purpose: one-time boot work, bounded by tools.exec.timeoutMs.
 */
export function runSetupOnce(
  dir: string,
  def: FileToolDefinition,
  opts: { cwd: string; timeoutMs: number; log: (line: string) => void },
): void {
  if (def.setupArgv === undefined) return;
  const marker = setupMarkerPath(dir, def);
  if (existsSync(marker)) return;

  let capture: SpawnCapture;
  try {
    const result = spawnSync(def.setupArgv[0] ?? "", def.setupArgv.slice(1), {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      killSignal: "SIGKILL",
      encoding: "utf8",
    });
    capture = {
      code: result.status,
      signal: result.signal,
      spawnError: result.error?.message ?? null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    capture = { code: null, signal: null, spawnError: (error as Error).message, stdout: "", stderr: "" };
  }

  const tail = (text: string): string => {
    const trimmed = text.trim();
    if (trimmed === "") return "(no output)";
    return trimmed.length > SETUP_OUTPUT_TAIL_CHARS
      ? `${trimmed.slice(0, SETUP_OUTPUT_TAIL_CHARS)}…`
      : trimmed;
  };
  const failed = capture.spawnError !== null || capture.code !== 0;
  opts.log(
    `setup "${def.name}" ${failed ? "FAILED" : "ok"} (exit=${capture.code ?? "null"}${
      capture.signal !== null ? `, signal ${capture.signal}` : ""
    }): ${tail(capture.stdout)} ${tail(capture.stderr)}` + (failed ? " — will retry on next load" : ""),
  );
  if (failed) return;
  try {
    mkdirSync(join(dir, SETUP_MARKER_DIR), { recursive: true });
    writeFileSync(marker, new Date().toISOString(), "utf8");
  } catch {
    // A marker write failure only means the setup reruns on next boot — harmless.
  }
}