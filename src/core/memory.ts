// Agent memory (M9): plain files, so memory survives restarts by construction.
//   ~/.carapace/workspace/memory/YYYY-MM-DD.md — daily notes (one per day)
//   ~/.carapace/workspace/MEMORY.md            — long-term facts
// At every agent turn the daily tail (last ~60 lines) and the long-term digest
// (first ~150 lines) are injected into the system prompt; the agent reads/writes
// them through the memory_read/memory_write tools. No database, no daemon.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Lines of TODAY's daily note injected into each agent turn. */
export const MEMORY_DAILY_TAIL_LINES = 60;
/** Lines of MEMORY.md (from the top) injected into each agent turn. */
export const MEMORY_DIGEST_LINES = 150;

export const MEMORY_MD = "MEMORY.md";

/** Server-local calendar date ("YYYY-MM-DD") for the given instant. */
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Last `max` non-trailing-empty lines. */
export function tailLines(text: string, max: number): string {
  const lines = text.replace(/\n+$/, "").split("\n");
  return lines.slice(Math.max(0, lines.length - max)).join("\n");
}

/** First `max` non-trailing-empty lines. */
export function headLines(text: string, max: number): string {
  return text.replace(/\n+$/, "").split("\n").slice(0, max).join("\n");
}

export class MemoryStore {
  constructor(readonly workspaceDir: string) {}

  get memoryDir(): string {
    return join(this.workspaceDir, "memory");
  }

  longTermPath(): string {
    return join(this.workspaceDir, MEMORY_MD);
  }

  dailyPath(date: string): string {
    return join(this.memoryDir, `${date}.md`);
  }

  ensureDirs(): void {
    mkdirSync(this.memoryDir, { recursive: true });
  }

  /** Daily note contents, or null when the day has no note yet. */
  readDaily(date: string): string | null {
    return this.readFile(this.dailyPath(date));
  }

  /** Long-term memory contents, or null when absent. */
  readLongTerm(): string | null {
    return this.readFile(this.longTermPath());
  }

  /** Append to a daily note, creating it with a `# <date>` header when new. */
  appendDaily(text: string, date: string = todayIsoDate()): string {
    this.ensureDirs();
    const path = this.dailyPath(date);
    if (!existsSync(path)) {
      // writeFileSync to avoid a header-less empty file race on first touch.
      writeFileSync(path, `# ${date}\n`, "utf8");
    }
    appendFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    return path;
  }

  /** Append to the long-term memory file, creating it when new. */
  appendLongTerm(text: string): string {
    this.ensureDirs();
    const path = this.longTermPath();
    if (!existsSync(path)) {
      writeFileSync(path, "# Long-term memory\n", "utf8");
    }
    appendFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    return path;
  }

  /** Dated daily notes present on disk, oldest first. */
  listDailyNotes(): string[] {
    if (!existsSync(this.memoryDir)) return [];
    return readdirSync(this.memoryDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort();
  }

  /**
   * The system-prompt block for one agent turn: today's daily note (tail) plus
   * the long-term digest (head). Null when both are missing/empty — fresh
   * installs must not get a memory section until there is something to recall.
   */
  contextBlock(now: Date = new Date()): string | null {
    const today = todayIsoDate(now);
    const sections: string[] = [];
    const daily = this.readDaily(today);
    if (daily !== null && daily.trim() !== "") {
      sections.push(
        `### Daily note — memory/${today}.md (last ${MEMORY_DAILY_TAIL_LINES} lines)\n${tailLines(daily, MEMORY_DAILY_TAIL_LINES)}`,
      );
    }
    const longTerm = this.readLongTerm();
    if (longTerm !== null && longTerm.trim() !== "") {
      sections.push(
        `### Long-term memory — ${MEMORY_MD} (first ${MEMORY_DIGEST_LINES} lines)\n${headLines(longTerm, MEMORY_DIGEST_LINES)}`,
      );
    }
    if (sections.length === 0) return null;
    return `## Persistent memory\nToday: ${today}.\n\n${sections.join("\n\n")}`;
  }

  private readFile(path: string): string | null {
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, "utf8");
    } catch {
      // Unreadable/corrupt file degrades to "no memory" instead of crashing turns.
      return null;
    }
  }
}