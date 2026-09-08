// Skills system (M7): filesystem-loaded playbooks that shape agent behavior.
// Convention: ~/.carapace/skills/<name>/SKILL.md — a frontmatter block (name,
// description) followed by markdown instructions, plus optional scripts/ and
// assets/ subdirectories next to it. The gateway loads every skill at boot and
// re-loads on directory changes; only name + description + path are injected into
// the agent's system context — the agent reads a skill's full SKILL.md through its
// file tools when the task at hand matches.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join, resolve, sep } from "node:path";
import { carapaceHome } from "../config.js";

/** One loaded skill: metadata from frontmatter plus where to find the full text. */
export interface SkillDefinition {
  name: string;
  description: string;
  /** Absolute path to SKILL.md — the agent reads this for the full procedure. */
  path: string;
  /** Directory holding SKILL.md plus optional scripts/ and assets/. */
  dir: string;
  /** Root the skill was loaded from (reported by `carapace skills list`). */
  source: string;
  /** Instruction body below the frontmatter. */
  body: string;
  /**
   * Author-declared setup script (#80213), relative to the skill directory.
   * Run explicitly via `carapace skills setup` — never auto-executed.
   */
  setup?: string;
}

export interface SkillLoadResult {
  skills: SkillDefinition[];
  /** Human-readable problems (missing/broken SKILL.md, duplicate names) — never fatal. */
  issues: string[];
}

/** Raised for a SKILL.md that does not satisfy the frontmatter convention. */
export class SkillParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillParseError";
  }
}

/** Default skills root: ~/.carapace/skills (honors CARAPACE_HOME). */
export function carapaceSkillsDir(): string {
  return join(carapaceHome(), "skills");
}

/**
 * Parse one SKILL.md: a `---`-delimited frontmatter block with non-empty `name:`
 * and `description:` keys, followed by the instruction body. Minimal line-based
 * parsing — skill frontmatter is authored by humans, not generated.
 */
export function parseSkillMd(
  raw: string,
  label: string,
): { name: string; description: string; setup?: string; body: string } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if ((lines[0] ?? "").trim() !== "---") {
    throw new SkillParseError(`${label}: missing frontmatter block (must start with ---)`);
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index++) {
    if ((lines[index] ?? "").trim() === "---") {
      closing = index;
      break;
    }
  }
  if (closing === -1) {
    throw new SkillParseError(`${label}: frontmatter block is never closed (expected a second ---)`);
  }
  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, closing)) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) continue;
    meta[key.toLowerCase()] = value.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  const name = meta.name ?? "";
  const description = meta.description ?? "";
  if (name === "") {
    throw new SkillParseError(`${label}: frontmatter needs a non-empty "name:"`);
  }
  if (description === "") {
    throw new SkillParseError(`${label}: frontmatter needs a non-empty "description:"`);
  }
  const body = lines.slice(closing + 1).join("\n").trim();
  const declaredSetup = meta.setup?.trim();
  const setup = declaredSetup !== undefined && declaredSetup !== "" ? declaredSetup : undefined;
  return { name, description, setup, body };
}

/**
 * Load every skill under one root: one directory per skill, each containing a
 * SKILL.md. Problems are collected, never thrown — a broken skill must not take
 * the gateway down.
 */
export function loadSkillsFromDir(root: string): SkillLoadResult {
  const skills: SkillDefinition[] = [];
  const issues: string[] = [];
  if (!existsSync(root)) return { skills, issues };
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    issues.push(`${root}: unreadable (${(error as Error).message})`);
    return { skills, issues };
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const skillPath = join(dir, "SKILL.md");
    if (!existsSync(skillPath)) {
      issues.push(`${dir}: no SKILL.md found`);
      continue;
    }
    try {
      const parsed = parseSkillMd(readFileSync(skillPath, "utf8"), skillPath);
      if (skills.some((existing) => existing.name === parsed.name)) {
        issues.push(`${skillPath}: duplicate skill name "${parsed.name}" — the first one wins`);
        continue;
      }
      skills.push({
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        path: skillPath,
        dir,
        source: root,
        setup: parsed.setup,
      });
    } catch (error) {
      issues.push(error instanceof SkillParseError ? error.message : `${skillPath}: ${(error as Error).message}`);
    }
  }
  return { skills, issues };
}

/** Marker file dropped into a skill directory after its setup hook exits cleanly (#80213). */
export const SKILL_SETUP_MARKER = ".setup-complete";

/** Default wall-clock budget for one skill setup hook. */
const SETUP_HOOK_TIMEOUT_MS = 120_000;

export type SkillSetupState = "none" | "pending" | "complete";

/**
 * Setup-hook state of one skill: "none" (no setup: declared), "pending"
 * (declared but never completed — never run, or the last run failed), and
 * "complete" (marker present from a clean exit).
 */
export function skillSetupState(skill: SkillDefinition): SkillSetupState {
  if (skill.setup === undefined || skill.setup.trim() === "") return "none";
  return existsSync(join(skill.dir, SKILL_SETUP_MARKER)) ? "complete" : "pending";
}

export interface SkillSetupOutcome {
  skill: string;
  ok: boolean;
  /** Human-readable result: refusal reasons, exit status, output tail. */
  detail: string;
}

/**
 * Run one skill's author-declared setup hook (#80213): execute the setup:
 * script inside the skill directory under a wall-clock timeout, then drop the
 * completion marker on a clean exit. Explicit operator action only — the
 * gateway never auto-runs skill scripts. Paths must stay inside the skill
 * directory; absolute paths or traversal escapes are refused.
 */
export async function runSkillSetup(
  skill: SkillDefinition,
  options: { timeoutMs?: number } = {},
): Promise<SkillSetupOutcome> {
  const declared = skill.setup?.trim();
  if (declared === undefined || declared === "") {
    return {
      skill: skill.name,
      ok: false,
      detail: `skill "${skill.name}" declares no setup hook (add "setup: <script>" to SKILL.md frontmatter)`,
    };
  }
  if (declared.startsWith("/") || declared.startsWith("~")) {
    return {
      skill: skill.name,
      ok: false,
      detail: `setup script must be relative to the skill directory (got "${declared}")`,
    };
  }
  const root = resolve(skill.dir);
  const script = resolve(root, declared);
  if (!script.startsWith(root + sep)) {
    return { skill: skill.name, ok: false, detail: `setup script "${declared}" escapes the skill directory — refused` };
  }
  if (!existsSync(script)) {
    return { skill: skill.name, ok: false, detail: `setup script not found: ${declared}` };
  }

  const timeoutMs = options.timeoutMs ?? SETUP_HOOK_TIMEOUT_MS;
  const run = await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>(
    (settle) => {
      const child = spawn(script, { cwd: skill.dir, timeout: timeoutMs });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: unknown) => {
        if (stdout.length < 10_000) stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk: unknown) => {
        if (stderr.length < 10_000) stderr += String(chunk);
      });
      child.on("error", (error: Error) => {
        settle({ code: null, signal: null, stdout, stderr: stderr === "" ? error.message : `${stderr}\n${error.message}` });
      });
      child.on("close", (code, signal) => {
        settle({ code, signal, stdout, stderr });
      });
    },
  );

  const tail = (text: string): string => {
    const trimmed = text.trim();
    return trimmed.length > 400 ? `…${trimmed.slice(-400)}` : trimmed;
  };
  if (run.code !== 0) {
    const why =
      run.signal !== null
        ? `killed by signal ${run.signal} (timeout budget ${Math.round(timeoutMs / 1000)}s)`
        : `exit code ${run.code ?? "unknown"}`;
    const output = [tail(run.stdout), tail(run.stderr)].filter((part) => part !== "").join("\n");
    return {
      skill: skill.name,
      ok: false,
      detail: `setup script "${declared}" failed: ${why}${output === "" ? "" : `\n${output}`}`,
    };
  }

  // Marker written only after a clean exit: a failed or interrupted run leaves
  // the hook "pending" so the same command retries it.
  writeFileSync(
    join(skill.dir, SKILL_SETUP_MARKER),
    `${JSON.stringify({ script: declared, at: new Date().toISOString() })}\n`,
    "utf8",
  );
  return {
    skill: skill.name,
    ok: true,
    detail: `setup script "${declared}" completed${run.stdout.trim() === "" ? "" : `: ${tail(run.stdout)}`}`,
  };
}

/**
 * Loaded-skill state for a running gateway. Built once at boot; `watch()` keeps it
 * fresh when the operator adds, edits, or removes skills while the gateway runs.
 */
export class SkillRegistry {
  private skills: SkillDefinition[] = [];
  private issues: string[] = [];
  private watcher: FSWatcher | null = null;

  constructor(readonly root: string) {
    this.reload();
  }

  /** Re-scan the root now; returns what was found. */
  reload(): SkillLoadResult {
    const result = loadSkillsFromDir(this.root);
    this.skills = result.skills;
    this.issues = result.issues;
    return result;
  }

  list(): SkillDefinition[] {
    return [...this.skills];
  }

  get(name: string): SkillDefinition | null {
    return this.skills.find((skill) => skill.name === name) ?? null;
  }

  get loadIssues(): string[] {
    return [...this.issues];
  }

  /**
   * The "available skills" block injected into the agent's system context, or null
   * when no skills are installed (nothing to inject). The agent reads the full
   * SKILL.md at the given path with its file tools when a task matches.
   */
  systemContextBlock(): string | null {
    if (this.skills.length === 0) return null;
    const lines = [
      "## Available skills",
      "",
      "Skill playbooks installed by the operator. When the current task matches one,",
      "read its SKILL.md with your file tools FIRST and follow the procedure it describes:",
      "",
    ];
    for (const skill of this.skills) {
      lines.push(`- ${skill.name} — ${skill.description} (SKILL.md: ${skill.path})`);
    }
    return lines.join("\n");
  }

  /**
   * Watch the skills root and reload on any change (debounced 250ms — editors fire
   * several events per save). Best-effort: an unwatchable root never breaks the
   * gateway, and the next gateway start picks up whatever changed.
   */
  watch(onChange?: (result: SkillLoadResult) => void): void {
    if (this.watcher !== null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      this.watcher = watch(this.root, { persistent: false }, () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          const result = this.reload();
          onChange?.(result);
        }, 250);
      });
    } catch {
      this.watcher = null;
    }
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}