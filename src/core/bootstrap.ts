// Bootstrap files (#29387): ~/.carapace/agents/<id>/bootstrap/*.md are loaded into
// the system context of every agent turn — operator-maintained, always-on context
// (persona rules, environment notes) that lives outside the model configuration.
// Files load fresh on every turn, sorted by agent directory then file name, so
// edits land immediately without a restart.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Cap on the total bootstrap text injected into one system prompt. */
export const BOOTSTRAP_MAX_CHARS = 20_000;

export interface BootstrapLoad {
  /** "## Bootstrap files" block for the system prompt; null when nothing exists. */
  block: string | null;
  /** Loaded files as "<agentId>/bootstrap/<name>" relative paths. */
  files: string[];
  /** Read problems — surfaced by doctor, never fatal to agent turns. */
  issues: string[];
}

/** The agents root under a Carapace home: <home>/agents. */
export function agentsRoot(home: string): string {
  return join(home, "agents");
}

/**
 * Collect every agents/<id>/bootstrap markdown file into one system-prompt
 * block. Missing directories yield a null block — a fresh install must not
 * grow a bootstrap section until the operator creates the convention's files.
 */
export function loadBootstrapFiles(home: string): BootstrapLoad {
  const root = agentsRoot(home);
  if (!existsSync(root)) return { block: null, files: [], issues: [] };
  let agentIds: string[];
  try {
    agentIds = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return { block: null, files: [], issues: [`agents directory unreadable: ${(error as Error).message}`] };
  }
  const sections: string[] = [];
  const files: string[] = [];
  const issues: string[] = [];
  for (const agentId of agentIds) {
    const bootstrapDir = join(root, agentId, "bootstrap");
    if (!existsSync(bootstrapDir)) continue;
    let names: string[];
    try {
      names = readdirSync(bootstrapDir)
        .filter((name) => name.toLowerCase().endsWith(".md"))
        .sort();
    } catch (error) {
      issues.push(`${agentId}/bootstrap unreadable: ${(error as Error).message}`);
      continue;
    }
    for (const name of names) {
      const path = join(bootstrapDir, name);
      try {
        const content = readFileSync(path, "utf8").trim();
        if (content === "") continue;
        files.push(`${agentId}/bootstrap/${name}`);
        sections.push(`### ${agentId}/bootstrap/${name}\n${content}`);
      } catch (error) {
        issues.push(`${agentId}/bootstrap/${name} unreadable: ${(error as Error).message}`);
      }
    }
  }
  if (sections.length === 0) return { block: null, files, issues };
  let body = sections.join("\n\n");
  let suffix = "";
  if (body.length > BOOTSTRAP_MAX_CHARS) {
    body = body.slice(0, BOOTSTRAP_MAX_CHARS);
    suffix = `\n\n[bootstrap truncated at ${BOOTSTRAP_MAX_CHARS} chars]`;
  }
  return { block: `## Bootstrap files\n\n${body}${suffix}`, files, issues };
}