// Memory tools (M9): let the agent read and append its own memory files.
// memory_read — today's daily note (default), a dated daily note, or MEMORY.md
// memory_write — append text to the daily note (default) or the long-term file
// Both are pure context consumers: they act only when the runtime injected a
// memory workspace into ToolContext, and they never resolve paths outside it.

import { existsSync, readFileSync } from "node:fs";
import { MemoryStore, MEMORY_MD, todayIsoDate } from "../../memory.js";
import type { ToolDefinition } from "../registry.js";

const DATED_DAILY = /^\d{4}-\d{2}-\d{2}\.md$/;
const DATED_PLAIN = /^\d{4}-\d{2}-\d{2}$/;

/** Reject anything that is not a bare memory file name — no traversal. */
function safeMemoryFile(file: string): string | null {
  if (file === MEMORY_MD || DATED_DAILY.test(file)) return file;
  return null;
}

export function createMemoryReadTool(): ToolDefinition {
  return {
    name: "memory_read",
    description:
      "Read a memory file: today's daily note (default), a dated daily note (YYYY-MM-DD.md), or the long-term MEMORY.md.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: `"today" (default) | "YYYY-MM-DD.md" | "${MEMORY_MD}"`,
        },
      },
      required: [],
    },
    execute: async (input, context) => {
      const workspace = context.memoryWorkspace;
      if (workspace === undefined || workspace === "") {
        return { ok: false, output: "memory system is not enabled in this runtime" };
      }
      const memory = new MemoryStore(workspace);
      const raw = typeof input.file === "string" ? input.file.trim() : "";
      let path: string;
      let label: string;
      if (raw === "" || raw === "today") {
        const today = todayIsoDate();
        path = memory.dailyPath(today);
        label = `memory/${today}.md`;
      } else {
        const safe = safeMemoryFile(raw);
        if (safe === null) {
          return {
            ok: false,
            output: `unknown memory file "${raw}" — use "today" (default), "YYYY-MM-DD.md", or "${MEMORY_MD}"`,
          };
        }
        path = safe === MEMORY_MD ? memory.longTermPath() : memory.dailyPath(safe.replace(/\.md$/, ""));
        label = safe === MEMORY_MD ? MEMORY_MD : `memory/${safe}`;
      }
      if (!existsSync(path)) return { ok: true, output: `(no memory file yet: ${label})` };
      const content = readFileSync(path, "utf8");
      return { ok: true, output: content.trim() === "" ? `(empty: ${label})` : content };
    },
  };
}

export function createMemoryWriteTool(): ToolDefinition {
  return {
    name: "memory_write",
    description:
      "Append text to memory: the daily note (default) or the long-term MEMORY.md. Creates the file when new.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "the memory line/section to append" },
        target: { type: "string", description: '"daily" (default) or "longterm"' },
        date: { type: "string", description: "YYYY-MM-DD for daily notes (default: today)" },
      },
      required: ["text"],
    },
    execute: async (input, context) => {
      const workspace = context.memoryWorkspace;
      if (workspace === undefined || workspace === "") {
        return { ok: false, output: "memory system is not enabled in this runtime" };
      }
      const text = typeof input.text === "string" ? input.text : "";
      if (text.trim() === "") {
        return { ok: false, output: 'memory_write needs non-empty "text"' };
      }
      const targetRaw = typeof input.target === "string" ? input.target.trim().toLowerCase() : "daily";
      if (targetRaw !== "daily" && targetRaw !== "" && targetRaw !== "longterm" && targetRaw !== "long-term") {
        return { ok: false, output: `unknown target "${String(input.target)}" — use "daily" (default) or "longterm"` };
      }
      const memory = new MemoryStore(workspace);
      if (targetRaw === "longterm" || targetRaw === "long-term") {
        const path = memory.appendLongTerm(text);
        return { ok: true, output: `appended to ${MEMORY_MD} (${path})` };
      }
      const dateRaw = typeof input.date === "string" ? input.date.trim() : "";
      if (dateRaw !== "" && !DATED_PLAIN.test(dateRaw)) {
        return { ok: false, output: `invalid date "${dateRaw}" — use YYYY-MM-DD` };
      }
      const date = dateRaw === "" ? todayIsoDate() : dateRaw;
      const path = memory.appendDaily(text, date);
      return { ok: true, output: `appended to memory/${date}.md (${path})` };
    },
  };
}