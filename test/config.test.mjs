// M1 config smoke tests. Run with: npm test (builds first, then node --test test/).
// These import the built dist/ — they verify the shipped surface, not the sources.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSecretRef, loadConfig, resolveSecret, validateConfig } from "../dist/config.js";
import { ToolRegistry } from "../dist/core/tools/registry.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

test("validateConfig accepts a well-formed config with llm and tools sections", () => {
  const result = validateConfig({
    gateway: { host: "0.0.0.0", port: 9000 },
    llm: { baseURL: "http://127.0.0.1:11434/v1", apiKey: { env: "MY_KEY" }, model: "llama3", timeoutMs: 30_000 },
    channels: { telegram: { enabled: true, botToken: { env: "MY_TOKEN" } } },
    tools: { allowedRoots: ["~/data"], exec: { timeoutMs: 5_000, denylist: ["mkfs"] } },
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.config.gateway.host, "0.0.0.0");
  assert.equal(result.config.gateway.port, 9000);
  assert.equal(result.config.llm.baseURL, "http://127.0.0.1:11434/v1");
  assert.equal(result.config.llm.model, "llama3");
  assert.equal(result.config.agent.maxToolIterations, 12);
  assert.equal(result.config.tools.allowedRoots.length, 1);
  // tilde expansion applied
  assert.ok(result.config.tools.allowedRoots[0].startsWith("/"));
  assert.equal(result.config.tools.exec.denylist.length, 1);
  assert.equal(result.config.storage.path.length > 0, true);
});

test("validateConfig defaults: gateway port 8899, llm + telegram botToken present", () => {
  const result = validateConfig({});
  assert.equal(result.errors.length, 0);
  assert.equal(result.config.gateway.port, 8899);
  assert.ok(isSecretRef(result.config.gateway.apiToken));
  assert.ok(result.config.llm.baseURL.includes("http"));
  assert.ok(isSecretRef(result.config.llm.apiKey));
  assert.ok(result.config.llm.model.length > 0);
  assert.equal(result.config.channels.telegram.enabled, false);
  assert.ok(isSecretRef(result.config.channels.telegram.botToken));
  assert.ok(result.config.tools.allowedRoots.length > 0);
  assert.ok(result.config.tools.exec.denylist.length > 0);
});

test("validateConfig keeps accepting the M0-era telegram `token` key as an alias", () => {
  const result = validateConfig({
    channels: { telegram: { enabled: true, token: { file: "/run/secrets/tg" } } },
  });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.config.channels.telegram.botToken, { file: "/run/secrets/tg" });
});

test("validateConfig rejects unknown sections and bad ports", () => {
  const result = validateConfig({ gateway: { port: 99999 }, mystery: {} });
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some((e) => e.includes("mystery")));
  assert.ok(result.errors.some((e) => e.includes("gateway.port")));
});

test("SecretRef helpers: shape checks and resolution", () => {
  assert.equal(isSecretRef({ env: "FOO" }), true);
  assert.equal(isSecretRef({ file: "/tmp/x" }), true);
  assert.equal(isSecretRef({ env: "FOO", extra: 1 }), false);
  assert.equal(isSecretRef("plain"), false);
  assert.equal(isSecretRef({ env: 42 }), false);

  assert.equal(resolveSecret("inline"), "inline");
  assert.equal(resolveSecret(""), null);

  process.env.CARAPACE_TEST_TOKEN = "abc123";
  assert.equal(resolveSecret({ env: "CARAPACE_TEST_TOKEN" }), "abc123");
  delete process.env.CARAPACE_TEST_TOKEN;
  assert.equal(resolveSecret({ env: "CARAPACE_DEFINITELY_MISSING_VAR" }), null);
});

test("loadConfig bootstraps defaults into an isolated home (port 8899)", () => {
  const home = mkdtempSync(join(tmpdir(), "carapace-home-"));
  process.env.CARAPACE_HOME = home;
  try {
    const first = loadConfig();
    assert.equal(first.createdDefaults, true);
    assert.equal(existsSync(join(home, "config.json")), true);
    assert.equal(first.config.gateway.port, 8899);
    assert.equal(first.config.storage.path, join(home, "carapace.db"));
    const second = loadConfig();
    assert.equal(second.createdDefaults, false);
    assert.equal(second.config.gateway.port, first.config.gateway.port);
  } finally {
    delete process.env.CARAPACE_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("tool registry registers, lists, renders specs, and rejects duplicates", () => {
  const registry = new ToolRegistry();
  const noop = {
    name: "noop",
    description: "does nothing",
    inputSchema: { type: "object", properties: {}, required: [] },
    execute: async () => ({ ok: true, output: "done" }),
  };
  registry.register(noop);
  assert.deepEqual(registry.names(), ["noop"]);
  assert.equal(registry.size, 1);
  assert.equal(registry.has("noop"), true);
  assert.equal(registry.get("noop")?.description, "does nothing");
  assert.deepEqual(registry.toSpecs(), [
    { type: "function", function: { name: "noop", description: "does nothing", parameters: noop.inputSchema } },
  ]);
  assert.throws(() => registry.register(noop));
});

test("sqlite store round-trips sessions and messages", () => {
  const store = new CarapaceStore(":memory:");
  store.createSession("s1", "test", { origin: "unit-test" });
  store.appendMessage("s1", "user", "hello");
  store.appendMessage("s1", "assistant", "hi back");
  assert.equal(store.listMessages("s1").length, 2);
  assert.equal(store.getSession("s1")?.channel, "test");
  assert.equal(store.getSession("s1")?.metadata, '{"origin":"unit-test"}');
  // auto-creates a shell session for unknown ids
  store.appendMessage("ghost", "user", "who am i");
  assert.equal(store.getSession("ghost")?.channel, "unknown");
  store.close();
});