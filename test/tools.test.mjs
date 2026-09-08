// Built-in tool tests: files sandboxing, exec envelope + denylist, web_fetch with a
// stubbed global fetch (no real network).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBuiltinTools } from "../dist/core/tools/builtins/index.js";

function makeRegistry(root) {
  return createBuiltinTools({
    tools: { allowedRoots: [root], exec: { timeoutMs: 5_000, denylist: ["mkfs"] } },
  });
}

test("files tool writes, reads, and lists within allowed roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "carapace-files-"));
  try {
    const files = makeRegistry(root).get("files");
    const write = await files.execute(
      { action: "write", path: join(root, "notes/hello.txt"), content: "carapace files test" },
      { sessionId: "t", workdir: root },
    );
    assert.equal(write.ok, true);
    assert.ok(write.output.includes("wrote"));
    assert.equal(existsSync(join(root, "notes/hello.txt")), true);

    const read = await files.execute({ action: "read", path: join(root, "notes/hello.txt") }, { sessionId: "t", workdir: root });
    assert.equal(read.ok, true);
    assert.equal(read.output, "carapace files test");

    const list = await files.execute({ action: "list", path: root }, { sessionId: "t", workdir: root });
    assert.equal(list.ok, true);
    assert.ok(list.output.includes("notes/"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("files tool refuses paths outside allowed roots (incl. traversal)", async () => {
  const root = mkdtempSync(join(tmpdir(), "carapace-files-"));
  try {
    const files = makeRegistry(root).get("files");
    const outside = await files.execute({ action: "read", path: "/etc/hostname" }, { sessionId: "t", workdir: root });
    assert.equal(outside.ok, false);
    assert.ok(outside.output.includes("outside the allowed roots"));

    const traversal = await files.execute(
      { action: "write", path: join(root, "../escape.txt"), content: "x" },
      { sessionId: "t", workdir: root },
    );
    assert.equal(traversal.ok, false);
    assert.ok(traversal.output.includes("outside the allowed roots"));
    assert.equal(existsSync(join(root, "..", "escape.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exec tool runs a command and captures output", async () => {
  const root = mkdtempSync(join(tmpdir(), "carapace-exec-"));
  try {
    const exec = makeRegistry(root).get("exec");
    const result = await exec.execute({ command: "echo carapace-exec-ok" }, { sessionId: "t", workdir: root });
    assert.equal(result.ok, true);
    assert.ok(result.output.includes("exit=0"));
    assert.ok(result.output.includes("carapace-exec-ok"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exec denylist blocks dangerous commands", async () => {
  const root = mkdtempSync(join(tmpdir(), "carapace-exec-"));
  try {
    const exec = makeRegistry(root).get("exec");
    const result = await exec.execute({ command: "echo mkfs" }, { sessionId: "t", workdir: root });
    assert.equal(result.ok, false);
    assert.ok(result.output.includes("denylist"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exec rejects cwd outside allowed roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "carapace-exec-"));
  try {
    const exec = makeRegistry(root).get("exec");
    const result = await exec.execute({ command: "pwd", cwd: "/etc" }, { sessionId: "t", workdir: root });
    assert.equal(result.ok, false);
    assert.ok(result.output.includes("outside the allowed roots"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exec timeout kills a runaway command", async () => {
  const root = mkdtempSync(join(tmpdir(), "carapace-exec-"));
  try {
    const exec = makeRegistry(root).get("exec");
    const result = await exec.execute({ command: "sleep 5", timeoutMs: 1_000 }, { sessionId: "t", workdir: root });
    assert.equal(result.ok, false);
    assert.ok(result.output.includes("SIGKILL"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const HTML_SAMPLE = "<html><head><script>evil()</script></head><body><h1>Hello</h1><p>Carapace&nbsp;world</p></body></html>";

function stubFetch(response) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  return () => {
    globalThis.fetch = original;
  };
}

test("web_fetch extracts readable text from html (stubbed fetch)", async () => {
  const restore = stubFetch({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "text/html; charset=utf-8" },
    text: async () => HTML_SAMPLE,
  });
  try {
    const registry = makeRegistry(mkdtempSync(join(tmpdir(), "carapace-web-")));
    const webFetch = registry.get("web_fetch");
    const result = await webFetch.execute({ url: "https://example.com/" }, { sessionId: "t", workdir: tmpdir() });
    assert.equal(result.ok, true);
    assert.ok(result.output.includes("Hello"));
    assert.ok(result.output.includes("Carapace world"));
    assert.ok(!result.output.includes("<"));
  } finally {
    restore();
  }
});

test("web_fetch refuses non-http urls", async () => {
  const registry = makeRegistry(tmpdir());
  const webFetch = registry.get("web_fetch");
  const result = await webFetch.execute({ url: "ftp://example.com/file" }, { sessionId: "t", workdir: tmpdir() });
  assert.equal(result.ok, false);
  assert.ok(result.output.includes("only http and https"));
});

test("web_fetch reports http errors (stubbed fetch)", async () => {
  const restore = stubFetch({
    ok: false,
    status: 404,
    statusText: "Not Found",
    headers: { get: () => "text/plain" },
    text: async () => "nope",
  });
  try {
    const registry = makeRegistry(tmpdir());
    const webFetch = registry.get("web_fetch");
    const result = await webFetch.execute({ url: "https://example.com/missing" }, { sessionId: "t", workdir: tmpdir() });
    assert.equal(result.ok, false);
    assert.ok(result.output.includes("404"));
  } finally {
    restore();
  }
});