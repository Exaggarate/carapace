// Gateway end-to-end test: HTTP server + api channel + real agent loop with a MOCK
// provider (no network). Proves the full request → loop → reply path over HTTP.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

function testConfig() {
  return {
    gateway: { host: "127.0.0.1", port: 0 },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "unit-test-token", allowedSenders: [] },
      api: { enabled: true },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
}

test("gateway serves /health and answers api messages through the agent loop", async () => {
  const provider = {
    name: "fake",
    complete: async () => ({ text: "gateway says hi", toolCalls: [], stopReason: "final_answer" }),
  };
  const runtime = buildRuntime({
    config: testConfig(),
    provider,
    store: new CarapaceStore(":memory:"),
  });
  const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${handle.port}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.equal(health.service, "carapace");

    const replyResponse = await fetch(`http://127.0.0.1:${handle.port}/api/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senderId: "tester", text: "hello" }),
    });
    assert.equal(replyResponse.status, 200);
    const body = await replyResponse.json();
    assert.equal(body.reply, "gateway says hi");
    assert.equal(body.channel, "api");

    const badResponse = await fetch(`http://127.0.0.1:${handle.port}/api/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senderId: "tester" }),
    });
    assert.equal(badResponse.status, 400);
  } finally {
    await handle.stop();
    runtime.close();
  }
});