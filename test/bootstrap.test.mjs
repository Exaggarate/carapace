// Bootstrap files (#29387): ~/.carapace/agents/<id>/bootstrap/*.md are loaded into
// the system context of every agent turn, sorted by agent dir then file name.
// Non-markdown files are skipped; missing dirs are a no-op; problems never break
// turns. Unit tests for the loader + an integration test through runAgentTurn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentsRoot, loadBootstrapFiles } from "../dist/core/bootstrap.js";
import { runAgentTurn } from "../dist/core/agent.js";
import { ToolRegistry } from "../dist/core/tools/registry.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";

function makeBootstrapHome() {
  const home = mkdtempSync(join(tmpdir(), "carapace-bootstrap-"));
  mkdirSync(join(home, "agents", "alpha", "bootstrap"), { recursive: true });
  mkdirSync(join(home, "agents", "beta", "bootstrap"), { recursive: true });
  mkdirSync(join(home, "agents", "gamma"), { recursive: true }); // agent without a bootstrap dir
  writeFileSync(join(home, "agents", "alpha", "bootstrap", "01-rules.md"), "ALPHA RULE: answer in rhyme.\n", "utf8");
  writeFileSync(join(home, "agents", "alpha", "bootstrap", "skip.txt"), "not markdown\n", "utf8");
  writeFileSync(join(home, "agents", "beta", "bootstrap", "00-beta.md"), "BETA NOTE: mind the beta.\n", "utf8");
  return home;
}

test("loadBootstrapFiles collects markdown across agent dirs, sorted, skipping non-md", () => {
  const home = makeBootstrapHome();
  const load = loadBootstrapFiles(home);
  assert.deepEqual(load.files, ["alpha/bootstrap/01-rules.md", "beta/bootstrap/00-beta.md"]);
  assert.deepEqual(load.issues, []);
  assert.match(load.block, /^## Bootstrap files\n/);
  // alpha sorts before beta; each file is headed by its relative path
  assert.ok(load.block.indexOf("### alpha/bootstrap/01-rules.md") < load.block.indexOf("### beta/bootstrap/00-beta.md"));
  assert.match(load.block, /ALPHA RULE: answer in rhyme\./);
  assert.match(load.block, /BETA NOTE: mind the beta\./);
  assert.ok(!load.block.includes("not markdown"), "non-markdown files are skipped");
});

test("loadBootstrapFiles is a no-op without the agents directory", () => {
  const home = mkdtempSync(join(tmpdir(), "carapace-empty-"));
  const load = loadBootstrapFiles(home);
  assert.equal(load.block, null);
  assert.deepEqual(load.files, []);
  assert.equal(agentsRoot(home), join(home, "agents"));
});

test("bootstrap files enter the system context of every agent turn", async () => {
  const home = makeBootstrapHome();
  const previousHome = process.env.CARAPACE_HOME;
  process.env.CARAPACE_HOME = home;
  try {
    const store = new CarapaceStore(":memory:");
    const sessions = new SessionStore(store);
    const seen = [];
    const provider = {
      name: "fake",
      complete: async (request) => {
        seen.push(request.messages);
        return { text: "ok", toolCalls: [], stopReason: "final_answer" };
      },
    };
    const result = await runAgentTurn(
      { sessionId: "bootstrap-test", text: "hello", channel: "api" },
      {
        config: {
          agent: { systemPrompt: "You are a test agent.", maxToolIterations: 4 },
          tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
        },
        provider,
        tools: new ToolRegistry(),
        sessions,
      },
    );
    assert.equal(result.stopReason, "final_answer");
    assert.equal(seen.length, 1);
    const system = seen[0][0];
    assert.equal(system.role, "system");
    assert.match(system.content, /## Bootstrap files/);
    assert.match(system.content, /### alpha\/bootstrap\/01-rules\.md/);
    assert.match(system.content, /ALPHA RULE/);
    assert.match(system.content, /### beta\/bootstrap\/00-beta\.md/);
    assert.match(system.content, /BETA NOTE/);
  } finally {
    if (previousHome === undefined) delete process.env.CARAPACE_HOME;
    else process.env.CARAPACE_HOME = previousHome;
  }
});

test("turns work unchanged when no bootstrap files exist", async () => {
  const previousHome = process.env.CARAPACE_HOME;
  process.env.CARAPACE_HOME = mkdtempSync(join(tmpdir(), "carapace-noboot-"));
  try {
    const store = new CarapaceStore(":memory:");
    const sessions = new SessionStore(store);
    const seen = [];
    const provider = {
      name: "fake",
      complete: async (request) => {
        seen.push(request.messages);
        return { text: "plain", toolCalls: [], stopReason: "final_answer" };
      },
    };
    const result = await runAgentTurn(
      { sessionId: "noboot", text: "hi", channel: "api" },
      {
        config: {
          agent: { systemPrompt: "You are a test agent.", maxToolIterations: 4 },
          tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
        },
        provider,
        tools: new ToolRegistry(),
        sessions,
      },
    );
    assert.equal(result.reply, "plain");
    assert.ok(!seen[0][0].content.includes("Bootstrap files"), "no bootstrap section appears");
  } finally {
    if (previousHome === undefined) delete process.env.CARAPACE_HOME;
    else process.env.CARAPACE_HOME = previousHome;
  }
});