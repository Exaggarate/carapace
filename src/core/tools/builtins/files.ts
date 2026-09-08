// Built-in tool: files — read/write/list files, confined to configured allowed roots.
// Path safety: lexical resolve + root-prefix check, plus a realpath check so symlink
// escapes are refused. (A file-level symlink pointing outside a root is still followed
// on write in M1; tighten with per-file realpath before write in M2.)

import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import type { ToolDefinition, ToolResult } from "../registry.js";

const READ_CAP_CHARS = 100_000;
const LIST_MAX_ENTRIES = 500;

export interface FilesToolOptions {
  allowedRoots: string[];
}

type PathGuard = { ok: true; path: string } | { ok: false; error: string };

function isInsideRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => candidate === root || candidate.startsWith(root + sep));
}

function guardPath(candidate: unknown, roots: string[]): PathGuard {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    return { ok: false, error: "files: 'path' is required and must be a non-empty string" };
  }
  const resolved = resolve(candidate);
  if (!isInsideRoot(resolved, roots)) {
    return { ok: false, error: `files: path is outside the allowed roots: ${resolved}` };
  }
  return { ok: true, path: resolved };
}

/** Realpath when the target exists, so symlinked escapes cannot pass the root check. */
function realpathIfPossible(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

export function createFilesTool(options: FilesToolOptions): ToolDefinition {
  const roots = options.allowedRoots.map((root) => resolve(root));
  return {
    name: "files",
    description:
      "Read, write, or list files on the host. All paths must stay inside the configured allowed roots. " +
      "action=read needs path; action=write needs path+content (parents are created, existing files are " +
      "overwritten); action=list needs a directory path.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "One of: read, write, list." },
        path: { type: "string", description: "Absolute or ~-relative path inside an allowed root." },
        content: { type: "string", description: "File contents (action=write only)." },
      },
      required: ["action", "path"],
    },
    async execute(input): Promise<ToolResult> {
      const action = typeof input.action === "string" ? input.action : "";
      const guarded = guardPath(input.path, roots);
      if (!guarded.ok) return { ok: false, output: guarded.error };

      if (action === "read") {
        const real = realpathIfPossible(guarded.path);
        if (!isInsideRoot(real, roots)) {
          return { ok: false, output: `files: path escapes the allowed roots through a symlink: ${guarded.path}` };
        }
        let content: string;
        try {
          content = readFileSync(real, "utf8");
        } catch (error) {
          return { ok: false, output: `files: cannot read ${real} (${(error as Error).message})` };
        }
        if (content === "") return { ok: true, output: "(empty file)" };
        const output =
          content.length > READ_CAP_CHARS
            ? `${content.slice(0, READ_CAP_CHARS)}\n[truncated — file holds ${content.length} chars]`
            : content;
        return { ok: true, output };
      }

      if (action === "write") {
        if (input.content !== undefined && typeof input.content !== "string") {
          return { ok: false, output: "files: 'content' must be a string" };
        }
        const content = typeof input.content === "string" ? input.content : "";
        const parentReal = realpathIfPossible(dirname(guarded.path));
        if (!isInsideRoot(parentReal, roots)) {
          return { ok: false, output: `files: path escapes the allowed roots through a symlink: ${guarded.path}` };
        }
        try {
          mkdirSync(dirname(guarded.path), { recursive: true });
          writeFileSync(guarded.path, content, "utf8");
          const size = statSync(guarded.path).size;
          return { ok: true, output: `wrote ${size} bytes to ${guarded.path}` };
        } catch (error) {
          return { ok: false, output: `files: cannot write ${guarded.path} (${(error as Error).message})` };
        }
      }

      if (action === "list") {
        const real = realpathIfPossible(guarded.path);
        if (!isInsideRoot(real, roots)) {
          return { ok: false, output: `files: path escapes the allowed roots through a symlink: ${guarded.path}` };
        }
        let entries: string[];
        try {
          if (!statSync(real).isDirectory()) {
            return { ok: false, output: `files: not a directory: ${real}` };
          }
          entries = readdirSync(real);
        } catch (error) {
          return { ok: false, output: `files: cannot list ${real} (${(error as Error).message})` };
        }
        entries.sort();
        const lines: string[] = [];
        for (const entry of entries.slice(0, LIST_MAX_ENTRIES)) {
          let suffix = "";
          let detail = "";
          try {
            const stats = statSync(`${real}${sep}${entry}`);
            if (stats.isDirectory()) suffix = "/";
            else detail = `  ${stats.size} bytes`;
          } catch {
            detail = "  (stat failed)";
          }
          lines.push(`${entry}${suffix}${detail}`);
        }
        if (entries.length > LIST_MAX_ENTRIES) {
          lines.push(`[truncated — directory holds ${entries.length} entries, showing ${LIST_MAX_ENTRIES}]`);
        }
        return { ok: true, output: lines.length === 0 ? "(empty directory)" : lines.join("\n") };
      }

      return { ok: false, output: `files: unknown action "${action}" — use read, write, or list` };
    },
  };
}