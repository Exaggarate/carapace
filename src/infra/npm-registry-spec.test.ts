// Tests npm registry spec parsing for packages, tags, and versions.
import { describe, expect, it } from "vitest";
import {
  compareCarapaceReleaseVersions,
  formatPrereleaseResolutionError,
  isExactSemverVersion,
  isPrereleaseSemverVersion,
  isPrereleaseResolutionAllowed,
  parseRegistryNpmSpec,
  resolveCarapaceReleaseCohortVersion,
  resolveNpmJsonEntries,
  validateRegistryNpmSpec,
} from "./npm-registry-spec.js";

function parseSpecOrThrow(spec: string) {
  const parsed = parseRegistryNpmSpec(spec);
  if (parsed === null) {
    throw new Error(`Expected ${spec} to parse`);
  }
  return parsed;
}

describe("npm registry spec validation", () => {
  it.each([
    "@carapace/voice-call",
    "@carapace/voice-call@1.2.3",
    "@carapace/voice-call@1.2.3-beta.4",
    "@carapace/voice-call@latest",
    "@carapace/voice-call@beta",
  ])("accepts %s", (spec) => {
    expect(validateRegistryNpmSpec(spec)).toBeNull();
  });

  it.each([
    {
      spec: "@carapace/voice-call@^1.2.3",
      expected: "exact version or dist-tag",
    },
    {
      spec: "@carapace/voice-call@~1.2.3",
      expected: "exact version or dist-tag",
    },
    {
      spec: "https://npmjs.org/pkg.tgz",
      expected: "URLs are not allowed",
    },
    {
      spec: "git+ssh://github.com/Exaggarate/carapace",
      expected: "URLs are not allowed",
    },
    {
      spec: "@carapace/voice-call@",
      expected: "missing version/tag after @",
    },
    {
      spec: "@carapace/voice-call@../beta",
      expected: "invalid version/tag",
    },
  ])("rejects %s", ({ spec, expected }) => {
    expect(validateRegistryNpmSpec(spec)).toContain(expected);
  });
});

describe("npm registry spec parsing helpers", () => {
  it.each([
    {
      spec: "@carapace/voice-call",
      expected: {
        name: "@carapace/voice-call",
        raw: "@carapace/voice-call",
        selectorKind: "none",
        selectorIsPrerelease: false,
      },
    },
    {
      spec: "@carapace/voice-call@beta",
      expected: {
        name: "@carapace/voice-call",
        raw: "@carapace/voice-call@beta",
        selector: "beta",
        selectorKind: "tag",
        selectorIsPrerelease: false,
      },
    },
    {
      spec: "@carapace/voice-call@2026.5.3-1",
      expected: {
        name: "@carapace/voice-call",
        raw: "@carapace/voice-call@2026.5.3-1",
        selector: "2026.5.3-1",
        selectorKind: "exact-version",
        selectorIsPrerelease: false,
      },
    },
    {
      spec: "@carapace/voice-call@1.2.3-beta.1",
      expected: {
        name: "@carapace/voice-call",
        raw: "@carapace/voice-call@1.2.3-beta.1",
        selector: "1.2.3-beta.1",
        selectorKind: "exact-version",
        selectorIsPrerelease: true,
      },
    },
  ])("parses %s", ({ spec, expected }) => {
    expect(parseRegistryNpmSpec(spec)).toEqual(expected);
  });

  it.each([
    { value: "v1.2.3", expected: true },
    { value: "1.2", expected: false },
  ])("detects exact semver versions for %s", ({ value, expected }) => {
    expect(isExactSemverVersion(value)).toBe(expected);
  });

  it.each([
    { value: "1.2.3-beta.1", expected: true },
    { value: "1.2.3-1", expected: true },
    { value: "2026.5.3-beta.1", expected: true },
    { value: "2026.5.3-1", expected: false },
    { value: "2026.2.30-1", expected: false },
    { value: "1.2.3", expected: false },
  ])("detects prerelease semver versions for %s", ({ value, expected }) => {
    expect(isPrereleaseSemverVersion(value)).toBe(expected);
  });

  it.each([
    { left: "2026.5.3-1", right: "2026.5.3", expected: 1 },
    { left: "2026.5.3-2", right: "2026.5.3-1", expected: 1 },
    { left: "2026.5.3", right: "2026.5.3-beta.3", expected: 1 },
    { left: "2026.5.3-beta.3", right: "2026.5.3-alpha.9", expected: 1 },
    { left: "2026.5.3-alpha.10", right: "2026.5.3-alpha.2", expected: 1 },
    { left: "2026.5.3-0", right: "2026.5.3", expected: null },
    { left: "2026.5.3+build", right: "2026.5.3", expected: null },
    { left: "1.2.3-1", right: "1.2.3", expected: null },
  ])("compares Carapace release versions for %s and %s", ({ left, right, expected }) => {
    expect(compareCarapaceReleaseVersions(left, right)).toBe(expected);
  });

  it.each([
    { version: "2026.7.1-2", expected: "2026.7.1" },
    { version: " 2026.7.1-1 ", expected: "2026.7.1" },
    { version: "2026.7.1", expected: "2026.7.1" },
    { version: "2026.7.1-beta.3", expected: "2026.7.1-beta.3" },
    { version: "1.2.3-1", expected: "1.2.3-1" },
  ])("resolves the Carapace release cohort for $version", ({ version, expected }) => {
    expect(resolveCarapaceReleaseCohortVersion(version)).toBe(expected);
  });
});

describe("npm prerelease resolution policy", () => {
  it.each([
    {
      spec: "@carapace/voice-call",
      resolvedVersion: "1.2.3-beta.1",
      expected: false,
    },
    {
      spec: "@carapace/voice-call@latest",
      resolvedVersion: "1.2.3-rc.1",
      expected: false,
    },
    {
      spec: "@carapace/voice-call@latest",
      resolvedVersion: "2026.5.3-1",
      expected: true,
    },
    {
      spec: "@carapace/voice-call@beta",
      resolvedVersion: "1.2.3-beta.4",
      expected: true,
    },
    {
      spec: "@carapace/voice-call@1.2.3-beta.1",
      resolvedVersion: "1.2.3-beta.1",
      expected: true,
    },
    {
      spec: "@carapace/voice-call",
      resolvedVersion: "1.2.3",
      expected: true,
    },
    {
      spec: "@carapace/voice-call@latest",
      resolvedVersion: undefined,
      expected: true,
    },
  ])("decides prerelease resolution for %s -> %s", ({ spec, resolvedVersion, expected }) => {
    expect(
      isPrereleaseResolutionAllowed({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toBe(expected);
  });

  it.each([
    {
      spec: "@carapace/voice-call",
      resolvedVersion: "1.2.3-beta.1",
      expected: `Use "@carapace/voice-call@beta"`,
    },
    {
      spec: "@carapace/voice-call@beta",
      resolvedVersion: "1.2.3-rc.1",
      expected: "Use an explicit prerelease tag or exact prerelease version",
    },
  ])("formats prerelease guidance for %s", ({ spec, resolvedVersion, expected }) => {
    expect(
      formatPrereleaseResolutionError({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toContain(expected);
  });
});

describe("resolveNpmJsonEntries", () => {
  it("passes entry arrays through (npm <=11 pack shape)", () => {
    const entries = [{ name: "carapace", version: "2026.7.1", filename: "carapace-2026.7.1.tgz" }];
    expect(resolveNpmJsonEntries(entries)).toBe(entries);
  });

  it("keeps a bare entry object as a single entry (npm <=11 view shape)", () => {
    const entry = { name: "carapace", version: "2026.7.1", "dist.integrity": "sha512-x" };
    expect(resolveNpmJsonEntries(entry)).toEqual([entry]);
  });

  it("unwraps the npm 12 singleton view array", () => {
    const entry = { name: "carapace", version: "2026.7.1", "dist.integrity": "sha512-x" };
    expect(resolveNpmJsonEntries([entry])).toEqual([entry]);
  });

  it("unwraps the npm 12 name-keyed pack object", () => {
    const entry = {
      id: "carapace@2026.7.1",
      name: "carapace",
      version: "2026.7.1",
      filename: "carapace-2026.7.1.tgz",
    };
    expect(resolveNpmJsonEntries({ carapace: entry })).toEqual([entry]);
  });

  it("unwraps scoped name keys in the npm 12 pack object", () => {
    const entry = { id: "@carapace/voice-call@1.2.3", name: "@carapace/voice-call" };
    expect(resolveNpmJsonEntries({ "@carapace/voice-call": entry })).toEqual([entry]);
  });

  it("falls back to the raw value when no entries are recognizable", () => {
    expect(resolveNpmJsonEntries("not-json-shaped")).toEqual(["not-json-shaped"]);
    expect(resolveNpmJsonEntries(null)).toEqual([null]);
  });
});
