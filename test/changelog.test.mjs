// Changelog coverage guard (#48920): release docs must not run ahead of the
// shipped version — every VERSION needs a heading in docs/CHANGELOG.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { changelogCovers, VERSION } from "../dist/version.js";

test("changelog: detects the running version heading", () => {
  assert.equal(changelogCovers("# Changelog\n\n## v0.11.0 — 2026-09-09\n- thing\n", "0.11.0"), true);
  assert.equal(changelogCovers("## v0.11.0\n", "0.11.0"), true);
  assert.equal(changelogCovers("# Changelog\n\n### v0.11.0\n", "0.11.0"), true); // h3 tolerated
});

test("changelog: no false positives across prefixes or absent entries", () => {
  assert.equal(changelogCovers("## v0.11.0 — x\n", "0.1"), false);
  assert.equal(changelogCovers("## v0.11.0 — x\n", "0.12.0"), false);
  assert.equal(changelogCovers("", "0.11.0"), false);
});

test("changelog: the shipped CHANGELOG.md covers the running version", () => {
  const changelog = readFileSync(fileURLToPath(new URL("../docs/CHANGELOG.md", import.meta.url)), "utf8");
  assert.equal(changelogCovers(changelog, VERSION), true);
});