// Dashboard + theme system (#28300): /ui page, redacted status/config endpoints,
// session messages + reset, bearer-auth parity with the API channel. Mock provider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { VERSION } from "../dist/version.js";

const PROVIDER = {
  name: "fake",
  complete: async () => ({ text: "pong", toolCalls: [], stopReason: "final_answer" }),
};

function testConfig(overrides = {}) {
  const config = {
    gateway: { host: "127.0.0.1", port: 0 },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "sk-dashboard-secret-1", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "tg-dashboard-secret-2", allowedSenders: [] },
      api: { enabled: true },
    },
    agent: { systemPrompt: "test", maxToolIterations: 4 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
  return { ...config, ...overrides };
}

async function boot(config, provider = PROVIDER) {
  const runtime = buildRuntime({ config, provider, store: new CarapaceStore(":memory:") });
  const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
  return { runtime, handle, base: `http://127.0.0.1:${handle.port}` };
}

test("GET /ui serves the dashboard with theme presets and ?theme= override", async () => {
  const { runtime, handle, base } = await boot(testConfig());
  try {
    const response = await fetch(`${base}/ui`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /data-theme="dark"/);
    assert.match(html, /--bg:#0d1117/, "dark preset variables are inlined");
    assert.match(html, /data-tab="config"/);

    const light = await (await fetch(`${base}/ui?theme=light`)).text();
    assert.match(light, /data-theme="light"/);

    const amber = await (await fetch(`${base}/ui?theme=carapace-amber`)).text();
    assert.match(amber, /data-theme="carapace-amber"/);

    const lobster = await (await fetch(`${base}/ui?theme=lobster-red`)).text();
    assert.match(lobster, /data-theme="lobster-red"/);

    // Unknown values fall back to the configured theme instead of erroring.
    const bogus = await (await fetch(`${base}/ui?theme=bogus`)).text();
    assert.match(bogus, /data-theme="dark"/);
  } finally {
    await handle.stop();
    runtime.close();
  }
});

test("ui.theme is honored and custom theme files are inlined with safe fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carapace-theme-"));
  const good = join(dir, "good.css");
  writeFileSync(good, ":root{--bg:#123456}\n.badge{color:#fff}\n");
  const empty = join(dir, "empty.css");
  writeFileSync(empty, "  \n");
  const markup = join(dir, "markup.css");
  writeFileSync(markup, "<html><body>oops</body></html>");

  const custom = await boot(testConfig({ ui: { theme: "custom", themeFile: good } }));
  try {
    const html = await (await fetch(`${custom.base}/ui`)).text();
    assert.match(html, /data-theme="custom"/);
    assert.match(html, /--bg:#123456/, "custom stylesheet is inlined");
    assert.match(html, /--bg:#0d1117/, "preset variables precede the custom file");
  } finally {
    await custom.handle.stop();
    custom.runtime.close();
  }

  for (const [label, file] of [
    ["empty", empty],
    ["markup", markup],
  ]) {
    const bad = await boot(testConfig({ ui: { theme: "custom", themeFile: file } }));
    try {
      const html = await (await fetch(`${bad.base}/ui`)).text();
      assert.match(html, /data-theme="dark"/, `${label} custom theme falls back to dark`);
      assert.match(html, /custom theme/, `${label} custom theme surfaces a note`);
    } finally {
      await bad.handle.stop();
      bad.runtime.close();
    }
  }

  const light = await boot(testConfig({ ui: { theme: "light", themeFile: good } }));
  try {
    const html = await (await fetch(`${light.base}/ui`)).text();
    assert.match(html, /data-theme="light"/, "ui.theme drives the served theme");
  } finally {
    await light.handle.stop();
    light.runtime.close();
  }
});

test("status and config endpoints are correct and redact every secret", async () => {
  const { runtime, handle, base } = await boot(testConfig());
  try {
    const status = await (await fetch(`${base}/api/v1/status`)).json();
    assert.equal(status.version, VERSION);
    assert.equal(typeof status.uptimeSec, "number");
    assert.ok(status.uptimeSec >= 0);
    assert.equal(status.model, "fake");
    assert.equal(status.storage.path, ":memory:");
    assert.ok(status.channels.some((c) => c.name === "api" && c.configured === true));
    assert.ok(status.channels.some((c) => c.name === "telegram"));
    assert.equal(status.theme, "dark");

    const raw = await (await fetch(`${base}/api/v1/config`)).text();
    assert.ok(!raw.includes("sk-dashboard-secret-1"), "llm key value is redacted");
    assert.ok(!raw.includes("tg-dashboard-secret-2"), "telegram token value is redacted");
    const config = JSON.parse(raw);
    assert.equal(config.llm.model, "fake");
    assert.match(config.llm.apiKey, /hidden/);
    assert.match(config.channels.telegram.botToken, /hidden/);
    assert.equal(config.ui.theme, "dark");
  } finally {
    await handle.stop();
    runtime.close();
  }
});

test("dashboard data endpoints require the bearer token; /ui shell stays open", async () => {
  const config = testConfig();
  config.gateway.apiToken = "tok-dashboard-secret-3";
  const { runtime, handle, base } = await boot(config);
  try {
    assert.equal((await fetch(`${base}/ui`)).status, 200, "static shell carries no data");

    const gated = await Promise.all(
      [
        [`${base}/api/v1/status`, "GET"],
        [`${base}/api/v1/config`, "GET"],
        [`${base}/api/v1/sessions/messages`, "GET"],
        [`${base}/api/v1/sessions/reset`, "POST"],
      ].map(([url, method]) => fetch(url, { method })),
    );
    for (const response of gated) assert.equal(response.status, 401);

    const ok = await fetch(`${base}/api/v1/status`, {
      headers: { authorization: "Bearer tok-dashboard-secret-3" },
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).version, VERSION);
  } finally {
    await handle.stop();
    runtime.close();
  }
});

test("sessions: recent messages and reset through the dashboard API", async () => {
  const { runtime, handle, base } = await boot(testConfig());
  try {
    for (const text of ["one", "two", "three"]) {
      const response = await fetch(`${base}/api/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senderId: "dash", text }),
      });
      assert.equal(response.status, 200);
    }

    const sessions = (await (await fetch(`${base}/api/v1/sessions`)).json()).sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "api:dash");
    assert.ok(sessions[0].messages >= 3);

    const recent = await (
      await fetch(`${base}/api/v1/sessions/messages?sessionId=${encodeURIComponent("api:dash")}&limit=10`)
    ).json();
    assert.ok(recent.messages.length >= 3);
    assert.equal(recent.messages[0].role, "user");

    // The recent view returns the LAST N messages in chronological order
    // (each turn appends user + assistant rows, so the final two are "three"/"pong").
    const two = await (
      await fetch(`${base}/api/v1/sessions/messages?sessionId=${encodeURIComponent("api:dash")}&limit=2`)
    ).json();
    assert.equal(two.messages.length, 2);
    assert.equal(two.messages[0].content, "three");
    assert.equal(two.messages[1].content, "pong");

    assert.equal((await fetch(`${base}/api/v1/sessions/messages`)).status, 400);
    assert.equal((await fetch(`${base}/api/v1/sessions/messages?sessionId=nope`)).status, 404);

    const reset = await fetch(`${base}/api/v1/sessions/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "api:dash" }),
    });
    assert.equal(reset.status, 200);
    assert.deepEqual((await reset.json()), { ok: true, sessionId: "api:dash" });
    assert.equal((await (await fetch(`${base}/api/v1/sessions`)).json()).sessions.length, 0);

    const again = await fetch(`${base}/api/v1/sessions/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "api:dash" }),
    });
    assert.equal(again.status, 404);
  } finally {
    await handle.stop();
    runtime.close();
  }
});