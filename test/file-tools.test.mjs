// File-defined tools + once-only setup hooks (#80213).
// Verifies: definition files register as tools, setup scripts run exactly once on
// first load (marker-tracked, output logged), broken files degrade to warnings, and
// {{key}} arguments substitute into the spawn argv.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "node:test";
import assert from "node:assert/strict";

const home = mkdtempSync(join(tmpdir(), "carapace-filetools-"));
process.env.CARAPACE_HOME = home;
const toolsDir = join(home, "tools");
mkdirSync(toolsDir, { recursive: true });

const counterPath = join(home, "setup-count");
writeFileSync(
  join(toolsDir, "greet.json"),
  JSON.stringify({
    name: "greet",
    description: "Greets a name through node",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "who to greet" } },
      required: ["name"],
    },
    exec: { argv: ["node", "-e", "console.log('hello ' + process.argv[1])", "{{name}}"] },
    setup: { argv: ["node", "-e", `require('fs').appendFileSync(${JSON.stringify(counterPath)}, 'x')`] },
  }),
);
writeFileSync(join(toolsDir, "broken.json"), "{ not json");
writeFileSync(
  join(toolsDir, "badargs.json"),
  JSON.stringify({ name: "badargs", description: "missing argv", exec: {} }),
);

const { createBuiltinTools, createBuiltinToolRegistry } = await import(
  "../dist/core/tools/builtins/index.js"
);
const { loadFileToolDefs } = await import("../dist/core/tools/custom.js");

function makeConfig() {
  return {
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 5_000, denylist: [] } },
  };
}

test("file tools register, run their setup once, and substitute arguments", async () => {
  const logs = [];
  const warnings = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (line) => logs.push(String(line));
  console.warn = (line) => warnings.push(String(line));
  let registry;
  try {
    registry = createBuiltinTools(makeConfig());
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  assert.equal(registry.has("greet"), true);
  // The setup script appended exactly once on first load.
  assert.equal(readFileSync(counterPath, "utf8"), "x");
  assert.ok(logs.some((line) => line.includes('setup "greet" ok')), logs.join("\n"));
  // Broken and invalid definition files are reported as warnings, not crashes.
  assert.equal(warnings.filter((w) => w.includes("broken.json")).length, 1);
  assert.equal(warnings.filter((w) => w.includes("badargs.json")).length, 1);

  const result = await registry.get("greet").execute({ name: "carapace" }, { sessionId: "t", workdir: tmpdir() });
  assert.equal(result.ok, true, result.output);
  assert.ok(result.output.includes("hello carapace"), result.output);

  // Second load: the setup must NOT run again (marker-tracked); the tool still registers.
  const logs2 = [];
  console.log = (line) => logs2.push(String(line));
  let registry2;
  try {
    registry2 = createBuiltinTools(makeConfig());
  } finally {
    console.log = originalLog;
  }
  assert.equal(registry2.has("greet"), true);
  assert.equal(readFileSync(counterPath, "utf8"), "x");
  assert.ok(!logs2.some((line) => line.includes('setup "greet"')), logs2.join("\n"));
});

test("loadFileToolDefs is pure and doctor-safe; the builtins-only registry skips file tools", () => {
  const snapshot = loadFileToolDefs(toolsDir);
  assert.deepEqual(
    snapshot.defs.map((d) => d.name),
    ["greet"],
  );
  assert.equal(snapshot.issues.length, 2);

  const builtinOnly = createBuiltinToolRegistry(makeConfig());
  assert.equal(builtinOnly.has("greet"), false);
  assert.deepEqual(builtinOnly.names(), ["exec", "files", "memory_read", "memory_write", "web_fetch"]);
});