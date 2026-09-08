// Built-in tool: exec — run a shell command inside a bounded envelope.
// Envelope: cwd restricted to allowed roots, wall-clock timeout, output caps, and a
// case-insensitive substring denylist for dangerous commands.

import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";

import type { ToolDefinition, ToolResult } from "../registry.js";

const STDOUT_CAP_CHARS = 60_000;
const STDERR_CAP_CHARS = 20_000;
const MAX_TIMEOUT_MS = 300_000;

export interface ExecToolOptions {
  timeoutMs: number;
  denylist: string[];
  /** Default working directory (must be an allowed root). */
  cwd: string;
  allowedRoots: string[];
}

interface ExecOutcome {
  code: number | null;
  signal: string | null;
  spawnError: string | null;
}

function isInsideRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => candidate === root || candidate.startsWith(root + sep));
}

export function createExecTool(options: ExecToolOptions): ToolDefinition {
  const roots = options.allowedRoots.map((root) => resolve(root));
  const defaultCwd = resolve(options.cwd);
  return {
    name: "exec",
    description:
      "Run a shell command on the host and capture stdout/stderr. The working directory must stay " +
      "inside the configured allowed roots; a denylist blocks dangerous commands.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        cwd: {
          type: "string",
          description: `Optional working directory inside an allowed root (default: ${defaultCwd}).`,
        },
        timeoutMs: {
          type: "number",
          description: `Optional wall-clock timeout in ms, 1000–${MAX_TIMEOUT_MS} (default ${options.timeoutMs}).`,
        },
      },
      required: ["command"],
    },
    async execute(input): Promise<ToolResult> {
      const command = typeof input.command === "string" ? input.command : "";
      if (command.trim() === "") {
        return { ok: false, output: "exec: 'command' is required and must be a non-empty string" };
      }

      const lowered = command.toLowerCase();
      for (const entry of options.denylist) {
        const needle = entry.trim().toLowerCase();
        if (needle !== "" && lowered.includes(needle)) {
          return { ok: false, output: `exec: command blocked by the exec denylist (matched "${entry}")` };
        }
      }

      const cwd = typeof input.cwd === "string" && input.cwd.trim() !== "" ? resolve(input.cwd) : defaultCwd;
      if (!isInsideRoot(cwd, roots)) {
        return { ok: false, output: `exec: cwd is outside the allowed roots: ${cwd}` };
      }

      const rawTimeout = input.timeoutMs;
      const timeoutMs =
        typeof rawTimeout === "number" && Number.isFinite(rawTimeout) && rawTimeout >= 1_000
          ? Math.min(Math.floor(rawTimeout), MAX_TIMEOUT_MS)
          : options.timeoutMs;

      let stdout = "";
      let stderr = "";
      const outcome = await new Promise<ExecOutcome>((resolvePromise) => {
        const child = spawn(command, { shell: true, cwd, timeout: timeoutMs, killSignal: "SIGKILL" });
        let settled = false;
        const finish = (result: ExecOutcome): void => {
          if (settled) return;
          settled = true;
          resolvePromise(result);
        };
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string | Uint8Array) => {
          if (stdout.length < STDOUT_CAP_CHARS) stdout += typeof chunk === "string" ? chunk : "";
        });
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string | Uint8Array) => {
          if (stderr.length < STDERR_CAP_CHARS) stderr += typeof chunk === "string" ? chunk : "";
        });
        child.on("error", (error: Error) => finish({ code: null, signal: null, spawnError: error.message }));
        child.on("close", (code, signal) => finish({ code, signal, spawnError: null }));
      });

      const parts: string[] = [];
      if (outcome.spawnError !== null) {
        parts.push(`exec: failed to start (${outcome.spawnError})`);
      } else if (outcome.code === null && outcome.signal !== null) {
        parts.push(`terminated by signal ${outcome.signal} (timeout ${timeoutMs}ms)`);
      } else {
        parts.push(`exit=${outcome.code ?? "null"}`);
      }
      parts.push(stdout.trim() === "" ? "stdout: (empty)" : `stdout:\n${stdout.trimEnd()}`);
      parts.push(stderr.trim() === "" ? "stderr: (empty)" : `stderr:\n${stderr.trimEnd()}`);
      return {
        ok: outcome.spawnError === null && outcome.code === 0,
        output: parts.join("\n"),
      };
    },
  };
}