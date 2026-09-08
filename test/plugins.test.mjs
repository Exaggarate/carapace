// Plugin-UI foundation (#66944): manifest scanning, panel serving, traversal safety,
// and user/custom plugin directories with broken-manifest handling. Mock provider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { scanPlugins } from "../dist/gateway/plugins.js";

const PROVIDER = {
  name: "fake",
  complete: async () => ({ text: "pong", toolCalls: [], stopReason: "final_answer" }),
};

function testConfig(extra = {}) {
  return {
    gateway: { host: "127.0.0.1", port: 0 },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "sk-plugin-secret-1", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "tg-plugin-secret-2", allowedSenders: [] },
      api: { enabled: true },
    },
    agent: { systemPrompt: "test", maxToolIterations: 4 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
    ...extra,
  };
}

test("bundled system-info example plugin is discovered with its panel", () => {
  const scan = scanPlugins(testConfig());
  const info = scan.plugins.find((p) => p.manifest.name === "system-info");
  assert.ok(info, "bundled example plugin is discovered");
  assert.equal(info.source, "bundled");
  assert.ok(info.manifest.title.length > 0);
  assert.ok(scan.issues.length === 0, `no scan issues: ${scan.issues.join("; ")}`);
  assert.ok(scan.plugins.every((p) => /^[a-z0-9][a-z0-9-]*$/.test(p.manifest.name)));
});

test("plugin routes serve the manifest and allow-listed panel files only", async () => {
  const runtime = buildRuntime({
    config: testConfig(),
    provider: PROVIDER,
    store: new CarapaceStore(":memory:"),
  });
  const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
  const base = `http://127.0.0.1:${handle.port}`;
  try {
    const manifest = await (await fetch(`${base}/api/v1/plugins`)).json();
    const info = manifest.plugins.find((p) => p.name === "system-info");
    assert.ok(info, "manifest lists the example plugin");
    assert.equal(info.hasPanel, true);
    assert.equal(info.source, "bundled");

    const panel = await fetch(`${base}/ui/plugins/system-info/`);
    assert.equal(panel.status, 200);
    assert.match(panel.headers.get("content-type") ?? "", /text\/html/);
    const html = await panel.text();
    assert.match(html, /panel\.js/);

    const bare = await fetch(`${base}/ui/plugins/system-info`, { redirect: "manual" });
    assert.equal(bare.status, 302);
    assert.equal(bare.headers.get("location"), "/ui/plugins/system-info/");

    const script = await fetch(`${base}/ui/plugins/system-info/panel.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /javascript/);
    assert.match(await script.text(), /api\/v1\/status/);

    // Unknown plugins and non-allow-listed files 404; traversal paths never resolve.
    assert.equal((await fetch(`${base}/ui/plugins/nope/`)).status, 404);
    assert.equal((await fetch(`${base}/ui/plugins/system-info/panel.css`)).status, 404);
    assert.equal((await fetch(`${base}/ui/plugins/system-info/../../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/ui/plugins/system-info/%2e%2e/plugin.json`)).status, 404);
  } finally {
    await handle.stop();
    runtime.close();
  }
});

test("ui.pluginsDir plugins load, broken manifests are skipped with issues", () => {
  const dir = mkdtempSync(join(tmpdir(), "carapace-plugins-"));
  try {
    const good = join(dir, "weather");
    mkdirSync(good, { recursive: true });
    writeFileSync(join(good, "plugin.json"), JSON.stringify({ name: "weather", title: "Weather", version: "1.0" }));
    writeFileSync(join(good, "panel.html"), "<!doctype html><title>weather</title>");
    const broken = join(dir, "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "plugin.json"), "{ not json");
    const badName = join(dir, "badname");
    mkdirSync(badName, { recursive: true });
    writeFileSync(join(badName, "plugin.json"), JSON.stringify({ name: "Not_URL_Safe", title: "x" }));

    const scan = scanPlugins(
      testConfig({ ui: { theme: "dark", themeFile: join(dir, "theme.css"), pluginsDir: dir } }),
    );
    assert.ok(scan.plugins.some((p) => p.manifest.name === "weather" && p.source === "custom"));
    assert.ok(!scan.plugins.some((p) => p.manifest.name === "Not_URL_Safe"), "unsafe names are rejected");
    assert.ok(scan.issues.some((issue) => issue.includes("broken")), "broken manifest reported");
    assert.ok(scan.issues.some((issue) => issue.includes("badname")), "bad name reported");
    // Duplicates: the bundled system-info stays, re-declaring it elsewhere is ignored.
    const duplicate = join(dir, "dup");
    mkdirSync(duplicate, { recursive: true });
    writeFileSync(join(duplicate, "plugin.json"), JSON.stringify({ name: "system-info", title: "Fake" }));
    const dupScan = scanPlugins(
      testConfig({ ui: { theme: "dark", themeFile: join(dir, "t.css"), pluginsDir: dir } }),
    );
    assert.equal(dupScan.plugins.filter((p) => p.manifest.name === "system-info").length, 1);
    assert.ok(dupScan.issues.some((issue) => issue.includes("duplicate")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("custom plugin panels are served from ui.pluginsDir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carapace-plugins-serve-"));
  try {
    const weather = join(dir, "weather");
    mkdirSync(weather, { recursive: true });
    writeFileSync(join(weather, "plugin.json"), JSON.stringify({ name: "weather", title: "Weather" }));
    writeFileSync(join(weather, "panel.html"), "<!doctype html><title>weather panel</title>");

    const runtime = buildRuntime({
      config: testConfig({ ui: { theme: "dark", themeFile: join(dir, "t.css"), pluginsDir: dir } }),
      provider: PROVIDER,
      store: new CarapaceStore(":memory:"),
    });
    const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/ui/plugins/weather/`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /weather panel/);
      // panel.js missing → 500 with a readable error, never a stack trace
      const missing = await fetch(`http://127.0.0.1:${handle.port}/ui/plugins/weather/panel.js`);
      assert.equal(missing.status, 500);
      assert.match(await missing.json().then((b) => b.error), /plugin_file_unavailable/);
    } finally {
      await handle.stop();
      runtime.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});