// Community wishlist panel (M10): GitHub fetch + 1h cache + docs/wishlist-status.json
// merge + the bearer-authed /api/v1/wishlist route. Mocked GitHub transport — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseGitHubIssues, WishlistService } from "../dist/gateway/wishlist.js";
import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

const GITHUB_PAYLOAD = [
  { number: 85030, title: "MCP tools not injected into subagent sessions", html_url: "https://github.com/openclaw/openclaw/issues/85030", state: "open", reactions: { "+1": 6 } },
  { number: 68596, title: "streaming watchdog timeout configurable", html_url: "https://github.com/openclaw/openclaw/issues/68596", state: "closed", reactions: { "+1": 8 } },
  { number: 999, title: "a pull request", html_url: "https://github.com/openclaw/openclaw/pull/999", state: "open", pull_request: { url: "x" }, reactions: { "+1": 100 } },
  { number: 1, title: "no reactions field", html_url: "https://github.com/openclaw/openclaw/issues/1" },
];

function okFetch(calls = []) {
  return async (input) => {
    calls.push(input);
    return new Response(JSON.stringify(GITHUB_PAYLOAD), { status: 200, headers: { "content-type": "application/json" } });
  };
}

function failingFetch() {
  return async () => {
    throw new Error("connection refused");
  };
}

function tmpStatusFile(entries) {
  const dir = mkdtempSync(join(tmpdir(), "wishlist-test-"));
  const path = join(dir, "wishlist-status.json");
  writeFileSync(path, JSON.stringify(entries), "utf8");
  return path;
}

test("parseGitHubIssues skips pull requests and defaults missing reactions", () => {
  const issues = parseGitHubIssues(GITHUB_PAYLOAD);
  assert.deepEqual(
    issues.map((issue) => issue.number),
    [85030, 68596, 1],
  );
  assert.equal(issues[0].likes, 6);
  assert.equal(issues[2].likes, 0);
  assert.equal(issues[0].title, "MCP tools not injected into subagent sessions");
});

test("WishlistService sorts by 👍 and merges tracker status", async () => {
  const statusPath = tmpStatusFile({
    issues: {
      "85030": { state: "building", feature: "spawn_subagent tool" },
      "12345": { state: "deferred", feature: "not on the GitHub top list" },
    },
  });
  const calls = [];
  const service = new WishlistService(statusPath, { fetchImpl: okFetch(calls), now: () => 1_000 });
  const snapshot = await service.list();
  assert.equal(snapshot.source, "github");
  assert.equal(snapshot.fetchedAt, 1_000);
  assert.equal(snapshot.issues[0].number, 68596, "sorted by 👍 desc");
  assert.equal(snapshot.issues[0].likes, 8);
  const tracked = snapshot.issues.find((issue) => issue.number === 85030);
  assert.equal(tracked.status.state, "building");
  assert.equal(tracked.status.feature, "spawn_subagent tool");
  const appended = snapshot.issues.find((issue) => issue.number === 12345);
  assert.ok(appended, "tracker-only entries are appended");
  assert.equal(appended.status.state, "deferred");
  assert.ok(!snapshot.issues.some((issue) => issue.number === 999), "pull requests are filtered");
});

test("list() serves the 1h cache without refetching, then refetches past the TTL", async () => {
  const statusPath = tmpStatusFile({ issues: {} });
  const calls = [];
  let clock = 1_000;
  const service = new WishlistService(statusPath, {
    fetchImpl: okFetch(calls),
    now: () => clock,
  });
  await service.list();
  assert.equal(calls.length, 1);
  const cached = await service.list();
  assert.equal(cached.source, "cache");
  assert.equal(calls.length, 1, "no refetch inside the TTL");
  clock += 60 * 60 * 1000 + 1;
  await service.list();
  assert.equal(calls.length, 2, "refetch after the TTL");
});

test("failed fetch with warm cache keeps the cached list with a note", async () => {
  const statusPath = tmpStatusFile({ issues: {} });
  const calls = [];
  let clock = 1_000;
  const flaky = async (input) => {
    calls.push(input);
    if (calls.length <= 1) {
      return new Response(JSON.stringify(GITHUB_PAYLOAD), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("rate limited");
  };
  const service = new WishlistService(statusPath, { fetchImpl: flaky, now: () => clock });
  await service.list();
  clock += 2 * 60 * 60 * 1000;
  const degraded = await service.list();
  assert.equal(degraded.source, "cache");
  assert.match(degraded.note ?? "", /rate limited/);
  assert.equal(degraded.fetchedAt, 1_000);
  assert.equal(degraded.issues[0].number, 68596);
});

test("never-fetched service degrades to tracker-only entries", async () => {
  const statusPath = tmpStatusFile({
    issues: { "8508": { state: "building", feature: "ack/done reaction emojis" } },
  });
  const service = new WishlistService(statusPath, { fetchImpl: failingFetch(), now: () => 1_000 });
  const snapshot = await service.list();
  assert.equal(snapshot.source, "unavailable");
  assert.equal(snapshot.fetchedAt, null);
  assert.match(snapshot.note ?? "", /GitHub unavailable/);
  assert.deepEqual(
    snapshot.issues.map((issue) => issue.number),
    [8508],
  );
  assert.equal(snapshot.issues[0].status.state, "building");
});

test("GET /api/v1/wishlist serves merged issues behind bearer auth", async () => {
  const statusPath = tmpStatusFile({
    issues: { "48003": { state: "building", feature: "steer mode" } },
  });
  const service = new WishlistService(statusPath, { fetchImpl: okFetch() });
  const config = {
    gateway: { host: "127.0.0.1", port: 0, apiToken: "unit-test-token" },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "unit-test-token", allowedSenders: [] },
      api: { enabled: true },
    },
    agent: { systemPrompt: "test", maxToolIterations: 4 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
  const runtime = buildRuntime({
    config,
    provider: { name: "fake", complete: async () => ({ text: "pong", toolCalls: [], stopReason: "final_answer" }) },
    store: new CarapaceStore(":memory:"),
    wishlist: service,
  });
  const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
  try {
    const base = `http://127.0.0.1:${handle.port}`;
    const denied = await fetch(`${base}/api/v1/wishlist`);
    assert.equal(denied.status, 401);

    const ok = await fetch(`${base}/api/v1/wishlist`, { headers: { authorization: "Bearer unit-test-token" } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.source, "github");
    assert.ok(Array.isArray(body.issues) && body.issues.length >= 4);
    const steered = body.issues.find((issue) => issue.number === 48003);
    assert.equal(steered.status.state, "building");
  } finally {
    handle.stop();
    runtime.close();
  }
});