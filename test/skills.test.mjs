// Skills system (M7): SKILL.md parsing, directory loading, system-context injection,
// the CLI surface (skills list / skills path), and the doctor skills check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { loadSkillsFromDir, parseSkillMd, runSkillSetup, skillSetupState, SkillRegistry } from "../dist/core/skills.js";
import { runAgentTurn } from "../dist/core/agent.js";
import { createBuiltinTools } from "../dist/core/tools/builtins/index.js";
import { SessionStore } from "../dist/core/session.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { buildRuntime } from "../dist/gateway/runtime.js";

const run = promisify(execFile);

const VALID_SKILL = [
  "---",
  "name: demo-skill",
  "description: A demo skill used by the unit tests.",
  "---",
  "",
  "Follow the demo procedure.",
  "",
].join("\n");

function writeSkill(root, dirName, contents) {
  mkdirSync(join(root, dirName), { recursive: true });
  writeFileSync(join(root, dirName, "SKILL.md"), contents, "utf8");
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "carapace-skills-"));
}

function testConfig() {
  return {
    gateway: { host: "127.0.0.1", port: 0 },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "unit-test-token", allowedSenders: [] },
      api: { enabled: true },
      discord: { enabled: false, botToken: "unit-test-token" },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
}

function fakeProvider() {
  return { name: "fake", complete: async () => ({ text: "done", toolCalls: [], stopReason: "final_answer" }) };
}

test("parseSkillMd extracts frontmatter name, description, and body", () => {
  const parsed = parseSkillMd(VALID_SKILL, "inline");
  assert.equal(parsed.name, "demo-skill");
  assert.equal(parsed.description, "A demo skill used by the unit tests.");
  assert.match(parsed.body, /Follow the demo procedure\./);
});

test("parseSkillMd rejects malformed SKILL.md files with readable reasons", () => {
  assert.throws(() => parseSkillMd("no frontmatter here", "a.md"), /frontmatter/);
  assert.throws(() => parseSkillMd("---\nname: x\ndescription: y\n", "b.md"), /never closed/);
  assert.throws(() => parseSkillMd("---\ndescription: y\n---\nbody", "c.md"), /"name:"/);
  assert.throws(() => parseSkillMd("---\nname: x\n---\nbody", "d.md"), /"description:"/);
});

test("loadSkillsFromDir collects skills and issues without throwing", () => {
  const root = tempRoot();
  writeSkill(root, "broken", "junk without frontmatter");
  writeSkill(root, "dup", VALID_SKILL);
  mkdirSync(join(root, "empty-dir"));
  writeSkill(root, "good", VALID_SKILL);
  const result = loadSkillsFromDir(root);
  assert.deepEqual(result.skills.map((skill) => skill.name), ["demo-skill"]);
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.some((issue) => issue.includes("no SKILL.md found")));
  assert.ok(result.issues.some((issue) => issue.includes("duplicate skill name")));
  assert.ok(result.issues.some((issue) => issue.includes("frontmatter")));
});

test("loadSkillsFromDir tolerates a missing root", () => {
  const result = loadSkillsFromDir(join(tmpdir(), "carapace-no-such-root-xyz"));
  assert.deepEqual(result, { skills: [], issues: [] });
});

test("SkillRegistry builds the available-skills block (null when empty)", () => {
  const root = tempRoot();
  const registry = new SkillRegistry(root);
  assert.equal(registry.systemContextBlock(), null);
  writeSkill(root, "demo", VALID_SKILL);
  registry.reload();
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get("demo-skill")?.dir, join(root, "demo"));
  const block = registry.systemContextBlock() ?? "";
  assert.match(block, /## Available skills/);
  assert.match(block, /demo-skill — A demo skill used by the unit tests\./);
  assert.match(block, /SKILL\.md: /);
});

test("runAgentTurn appends the skills block to the system prompt", async () => {
  const root = tempRoot();
  writeSkill(root, "demo", VALID_SKILL);
  const registry = new SkillRegistry(root);
  const captured = [];
  const provider = {
    name: "fake",
    complete: async (request) => {
      captured.push(request);
      return { text: "done", toolCalls: [], stopReason: "final_answer" };
    },
  };
  const config = testConfig();
  const runtime = {
    config,
    provider,
    tools: createBuiltinTools(config),
    sessions: new SessionStore(new CarapaceStore(":memory:")),
    skills: registry,
  };
  const result = await runAgentTurn({ sessionId: "s1", text: "hello", channel: "test" }, runtime);
  assert.equal(result.stopReason, "final_answer");
  const system = captured[0].messages.find((message) => message.role === "system");
  assert.match(system.content, /You are a test agent\./);
  assert.match(system.content, /## Available skills/);
  assert.match(system.content, /demo-skill/);
});

test("runAgentTurn without a skills registry leaves the system prompt untouched", async () => {
  const captured = [];
  const provider = {
    name: "fake",
    complete: async (request) => {
      captured.push(request);
      return { text: "done", toolCalls: [], stopReason: "final_answer" };
    },
  };
  const config = testConfig();
  const runtime = {
    config,
    provider,
    tools: createBuiltinTools(config),
    sessions: new SessionStore(new CarapaceStore(":memory:")),
  };
  await runAgentTurn({ sessionId: "s2", text: "hello", channel: "test" }, runtime);
  const system = captured[0].messages.find((message) => message.role === "system");
  assert.equal(system.content, "You are a test agent.");
});

test("buildRuntime forwards the skills registry into the agent runtime", () => {
  const registry = new SkillRegistry(tempRoot());
  const runtime = buildRuntime({
    config: testConfig(),
    provider: fakeProvider(),
    store: new CarapaceStore(":memory:"),
    skills: registry,
  });
  assert.equal(runtime.agent.skills, registry);
  runtime.close();
});

test("SkillRegistry watches the root and reloads on change", async () => {
  const root = tempRoot();
  const registry = new SkillRegistry(root);
  registry.watch();
  try {
    writeSkill(root, "late", VALID_SKILL.replace("demo-skill", "late-skill"));
    const deadline = Date.now() + 5_000;
    while (registry.list().length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(registry.list().length, 1);
    assert.equal(registry.list()[0].name, "late-skill");
  } finally {
    registry.close();
  }
});

test("carapace skills list / path work against CARAPACE_HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "carapace-skills-cli-"));
  writeSkill(join(home, "skills"), "research", VALID_SKILL.replace("demo-skill", "research-skill"));
  const env = { ...process.env, CARAPACE_HOME: home };

  const listed = await run("node", ["dist/cli/index.js", "skills", "list"], { env });
  assert.match(listed.stdout, /research-skill/);
  assert.match(listed.stdout, /A demo skill used by the unit tests\./);

  const shown = await run("node", ["dist/cli/index.js", "skills", "path", "research-skill"], { env });
  assert.equal(shown.stdout.trim(), join(home, "skills", "research", "SKILL.md"));

  await assert.rejects(
    run("node", ["dist/cli/index.js", "skills", "path", "nope"], { env }),
    (error) => error.code === 1,
  );
});

test("carapace skills list explains an empty installation", async () => {
  const home = mkdtempSync(join(tmpdir(), "carapace-skills-empty-"));
  const listed = await run("node", ["dist/cli/index.js", "skills", "list"], {
    env: { ...process.env, CARAPACE_HOME: home },
  });
  assert.match(listed.stdout, /no skills installed/);
});

test("doctor surfaces the skills check and stays healthy on a broken skill", async () => {
  const home = mkdtempSync(join(tmpdir(), "carapace-skills-doctor-"));
  writeSkill(join(home, "skills"), "broken", "junk without frontmatter");
  const checked = await run("node", ["dist/cli/index.js", "doctor"], {
    env: { ...process.env, CARAPACE_HOME: home },
  });
  assert.match(checked.stdout, /\[warn\] skills/);
  assert.match(checked.stdout, /frontmatter/);
  assert.match(checked.stdout, /verdict: healthy/);
});

// ── Setup hooks (#80213) ───────────────────────────────────────────────────

test("setup hook: parses the setup frontmatter key and runs the script once", async () => {
  const root = tempRoot();
  mkdirSync(join(root, "hooked", "scripts"), { recursive: true });
  writeFileSync(join(root, "hooked", "scripts", "init.sh"), "#!/bin/sh\nprintf done > out.txt\n", "utf8");
  chmodSync(join(root, "hooked", "scripts", "init.sh"), 0o755);
  writeSkill(root, "hooked", "---\nname: hooked\ndescription: skill with a setup hook\nsetup: scripts/init.sh\n---\n\nbody\n");
  const { skills } = loadSkillsFromDir(root);
  const skill = skills[0];
  assert.equal(skill?.setup, "scripts/init.sh");
  assert.equal(skillSetupState(skill), "pending");
  const outcome = await runSkillSetup(skill);
  assert.equal(outcome.ok, true, outcome.detail);
  assert.equal(skillSetupState(skill), "complete");
  assert.equal(readFileSync(join(root, "hooked", "out.txt"), "utf8"), "done");
  assert.ok(existsSync(join(root, "hooked", ".setup-complete")));
});

test("setup hook: a failing script stays pending and reports the output", async () => {
  const root = tempRoot();
  writeSkill(root, "failing", "---\nname: failing\ndescription: failing hook\nsetup: setup.sh\n---\n\nbody\n");
  writeFileSync(join(root, "failing", "setup.sh"), "#!/bin/sh\necho boom >&2\nexit 3\n", "utf8");
  chmodSync(join(root, "failing", "setup.sh"), 0o755);
  const { skills } = loadSkillsFromDir(root);
  const skill = skills[0];
  const outcome = await runSkillSetup(skill);
  assert.equal(outcome.ok, false);
  assert.match(outcome.detail, /exit code 3/);
  assert.match(outcome.detail, /boom/);
  assert.equal(skillSetupState(skill), "pending");
  assert.equal(existsSync(join(root, "failing", ".setup-complete")), false);
});

test("setup hook: refuses scripts that escape the skill directory", async () => {
  const root = tempRoot();
  writeSkill(root, "escapee", "---\nname: escapee\ndescription: traversal hook\nsetup: ../outside.sh\n---\n\nbody\n");
  const { skills } = loadSkillsFromDir(root);
  const skill = skills[0];
  const outcome = await runSkillSetup(skill);
  assert.equal(outcome.ok, false);
  assert.match(outcome.detail, /refused/);
});

test("setup hook: CLI shows pending state and runs the hook to completion", async () => {
  const home = mkdtempSync(join(tmpdir(), "carapace-skills-hook-"));
  mkdirSync(join(home, "skills", "cli-hooked"), { recursive: true });
  writeFileSync(join(home, "skills", "cli-hooked", "setup.sh"), "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(join(home, "skills", "cli-hooked", "setup.sh"), 0o755);
  writeFileSync(
    join(home, "skills", "cli-hooked", "SKILL.md"),
    "---\nname: cli-hooked\ndescription: cli hook test\nsetup: setup.sh\n---\n\nbody\n",
    "utf8",
  );
  const env = { ...process.env, CARAPACE_HOME: home };
  const listed = await run("node", ["dist/cli/index.js", "skills", "list"], { env });
  assert.match(listed.stdout, /\[setup: pending\]/);
  const setup = await run("node", ["dist/cli/index.js", "skills", "setup", "cli-hooked"], { env });
  assert.match(setup.stdout, /completed/);
  const relisted = await run("node", ["dist/cli/index.js", "skills", "list"], { env });
  assert.match(relisted.stdout, /\[setup: complete\]/);
});