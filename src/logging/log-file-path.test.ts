// Log file path tests cover profile-aware rolling filename resolution.
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLegacyRollingLogFilePath,
  isSameRollingLogFileFamily,
  resolveConfiguredLogFilePath,
  resolveRollingLogFilePathForDate,
} from "./log-file-path.js";

const date = new Date(2026, 6, 22, 12, 0, 0);

describe("resolveConfiguredLogFilePath", () => {
  it.each([
    { name: "unset", env: {}, expected: "carapace-2026-07-22.log" },
    {
      name: "explicit default",
      env: { CARAPACE_PROFILE: "Default" },
      expected: "carapace-2026-07-22.log",
    },
    {
      name: "named",
      env: { CARAPACE_PROFILE: "dev" },
      expected: "carapace-dev-2026-07-22.log",
    },
    {
      name: "sanitized",
      env: { CARAPACE_PROFILE: "QA_Profile" },
      expected: "carapace--1q-1a-0-1profile-2026-07-22.log",
    },
  ])("uses the $name profile filename", ({ env, expected }) => {
    const resolved = resolveConfiguredLogFilePath(undefined, { date, env });

    expect(path.basename(resolved)).toBe(expected);
  });

  it("keeps profiles distinct when sanitization would otherwise collide", () => {
    const underscored = resolveConfiguredLogFilePath(undefined, {
      date,
      env: { CARAPACE_PROFILE: "QA_Profile" },
    });
    const dashed = resolveConfiguredLogFilePath(undefined, {
      date,
      env: { CARAPACE_PROFILE: "qa-profile" },
    });

    expect(underscored).not.toBe(dashed);
    expect(path.basename(dashed)).toBe("carapace-qa--profile-2026-07-22.log");
  });

  it("keeps escaped output distinct from a profile that resembles the encoding", () => {
    const transformed = resolveConfiguredLogFilePath(undefined, {
      date,
      env: { CARAPACE_PROFILE: "QA_Profile" },
    });
    const lookalike = resolveConfiguredLogFilePath(undefined, {
      date,
      env: { CARAPACE_PROFILE: "-1q-1a-0-1profile" },
    });

    expect(transformed).not.toBe(lookalike);
  });

  it("bounds direct environment profiles that exceed the CLI length contract", () => {
    const first = resolveConfiguredLogFilePath(undefined, {
      date,
      env: { CARAPACE_PROFILE: "A".repeat(80) },
    });
    const second = resolveConfiguredLogFilePath(undefined, {
      date,
      env: { CARAPACE_PROFILE: "B".repeat(80) },
    });

    expect(path.basename(first)).toMatch(/^carapace--3[a-f0-9]{64}-2026-07-22\.log$/u);
    expect(path.basename(first).length).toBeLessThanOrEqual(255);
    expect(first).not.toBe(second);
  });

  it("preserves an explicit logging.file override", () => {
    expect(
      resolveConfiguredLogFilePath(
        { logging: { file: "/var/log/carapace/custom.log" } },
        { date, env: { CARAPACE_PROFILE: "dev" } },
      ),
    ).toBe("/var/log/carapace/custom.log");
  });
});

describe("profile rolling log families", () => {
  it("preserves the profile segment across date rollover", () => {
    expect(
      resolveRollingLogFilePathForDate(
        "/tmp/carapace/carapace-dev-2026-07-22.log",
        new Date(2026, 6, 23, 12, 0, 0),
      ),
    ).toBe("/tmp/carapace/carapace-dev-2026-07-23.log");
  });

  it("expands the legacy YYYY-MM-DD placeholder", () => {
    expect(
      resolveRollingLogFilePathForDate(
        "/tmp/carapace/carapace-YYYY-MM-DD.log",
        new Date(2026, 6, 23, 12, 0, 0),
      ),
    ).toBe("/tmp/carapace/carapace-2026-07-23.log");
  });

  it("keeps default and named profile fallback families separate", () => {
    expect(
      isSameRollingLogFileFamily("carapace-dev-2026-07-22.log", "carapace-dev-2026-07-21.log"),
    ).toBe(true);
    expect(
      isSameRollingLogFileFamily("carapace-dev-2026-07-22.log", "carapace-2026-07-22.log"),
    ).toBe(false);
  });

  it("keeps legacy explicit dated paths rolling without broadening the override contract", () => {
    expect(isLegacyRollingLogFilePath("carapace-2026-07-22.log")).toBe(true);
    expect(isLegacyRollingLogFilePath("carapace-YYYY-MM-DD.log")).toBe(true);
    expect(isLegacyRollingLogFilePath("carapace-dev-2026-07-22.log")).toBe(false);
    expect(isLegacyRollingLogFilePath("carapace-configured.log")).toBe(false);
  });
});
