// API-channel bearer auth: 401 on missing/wrong token, 200 with the right one,
// and open mode when no gateway.apiToken resolves. Mock provider — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

function testConfig(apiToken) {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken },
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

const provider = {
  name: "fake",
  complete: async () => ({ text: "auth ok", toolCalls: [], stopReason: "final_answer" }),
};

async function startWith(config) {
  const runtime = buildRuntime({ config, provider, store: new CarapaceStore(":memory:") });
  const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
  return { runtime, handle };
}

function post(handle, headers) {
  return fetch(`http://127.0.0.1:${handle.port}/api/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ senderId: "tester", text: "hello" }),
  });
}

test("api channel requires the bearer token when gateway.apiToken resolves", async () => {
  const { runtime, handle } = await startWith(testConfig("unit-test-token"));
  try {
    const missing = await post(handle, {});
    assert.equal(missing.status, 401);
    assert.ok((missing.headers.get("www-authenticate") ?? "").includes("Bearer"));

    const wrong = await post(handle, { authorization: "Bearer nope" });
    assert.equal(wrong.status, 401);

    const good = await post(handle, { authorization: "Bearer unit-test-token" });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).reply, "auth ok");
  } finally {
    await handle.stop();
    runtime.close();
  }
});

test("api channel runs open when no gateway.apiToken resolves", async () => {
  delete process.env.CARAPACE_API_TOKEN;
  const { runtime, handle } = await startWith(testConfig({ env: "CARAPACE_API_TOKEN" }));
  try {
    const open = await post(handle, {});
    assert.equal(open.status, 200);
    assert.equal((await open.json()).reply, "auth ok");
  } finally {
    await handle.stop();
    runtime.close();
  }
});