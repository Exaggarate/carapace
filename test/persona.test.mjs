// M11 persona layer: the crafted default joins every channel turn's system
// prompt; channels.<name>.persona overrides it. Mock provider — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { runAgentTurn } from "../dist/core/agent.js";
import { DEFAULT_PERSONA, personaForChannel } from "../dist/core/persona.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";
import { ToolRegistry } from "../dist/core/tools/registry.js";

function baseConfig(channels = {}) {
  return {
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    channels,
  };
}

function runtimeWith(captured, channels = {}) {
  const store = new CarapaceStore(":memory:");
  const sessions = new SessionStore(store);
  const provider = {
    name: "fake",
    complete: async (request) => {
      captured.push(request.messages.map((m) => ({ role: m.role, content: m.content })));
      return { text: "ok", toolCalls: [], stopReason: "final_answer" };
    },
  };
  return { runtime: { config: baseConfig(channels), provider, tools: new ToolRegistry(), sessions }, sessions };
}

function systemPromptOf(captured) {
  const first = captured[0]?.[0];
  assert.equal(first?.role, "system", "the system message leads the context");
  return first?.content ?? "";
}

test("personaForChannel: crafted default for unset/unknown channels, override wins", () => {
  const config = baseConfig({
    telegram: { persona: "Telegraph custom voice" },
    discord: { persona: "Discord custom voice" },
    api: {},
  });
  assert.equal(personaForChannel(config, "telegram"), "Telegraph custom voice");
  assert.equal(personaForChannel(config, "discord"), "Discord custom voice");
  assert.equal(personaForChannel(config, "api"), DEFAULT_PERSONA);
  assert.equal(personaForChannel(config, "unknown-channel"), DEFAULT_PERSONA);
  assert.equal(personaForChannel(baseConfig({ telegram: { persona: "   " } }), "telegram"), DEFAULT_PERSONA);
});

test("runAgentTurn joins the persona block right after the base system prompt", async () => {
  const captured = [];
  const { runtime } = runtimeWith(captured);
  const result = await runAgentTurn(
    { sessionId: "telegram:1", text: "hi", channel: "telegram", persona: personaForChannel(baseConfig(), "telegram") },
    runtime,
  );
  assert.equal(result.stopReason, "final_answer");
  const system = systemPromptOf(captured);
  assert.ok(system.startsWith("You are a test agent."), "base prompt leads");
  assert.ok(system.includes(DEFAULT_PERSONA), "persona block joined");
  assert.ok(system.includes("🦞"), "persona carries the carapace voice");
});

test("runAgentTurn without a persona adds no block (hand-built configs, subagents)", async () => {
  const captured = [];
  const { runtime } = runtimeWith(captured);
  await runAgentTurn({ sessionId: "sub:1", text: "hi", channel: "internal" }, runtime);
  const system = systemPromptOf(captured);
  assert.ok(!system.includes("How you come across"), "no persona block when none supplied");
  assert.equal(system, "You are a test agent.");
});

test("a channel override reaches the system prompt", async () => {
  const captured = [];
  const config = baseConfig({ telegram: { persona: "Pirate mode: aye." } });
  const { runtime } = runtimeWith(captured, config.channels);
  await runAgentTurn(
    { sessionId: "telegram:2", text: "hi", channel: "telegram", persona: personaForChannel(config, "telegram") },
    runtime,
  );
  const system = systemPromptOf(captured);
  assert.ok(system.includes("Pirate mode: aye."));
  assert.ok(!system.includes("How you come across"), "override replaces the default");
});