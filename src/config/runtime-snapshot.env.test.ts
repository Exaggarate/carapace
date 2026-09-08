import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyConfigEnvVars,
  collectConfigRuntimeEnvOwnership,
  getPublishedConfigRuntimeEnvState,
  initializePublishedConfigRuntimeEnv,
  prepareConfigRuntimeEnv,
} from "./config-env-vars.js";
import {
  clearRuntimeConfigSnapshot,
  resetConfigRuntimeState,
  setAppliedRuntimeConfigSnapshot,
} from "./runtime-snapshot.js";

describe("config environment across in-process restart", () => {
  afterEach(() => {
    resetConfigRuntimeState();
    vi.unstubAllEnvs();
  });

  it.each([
    { operation: "replacement", nextValue: "second" },
    { operation: "removal", nextValue: undefined },
  ])("applies config-owned value $operation after restart", ({ nextValue }) => {
    vi.stubEnv("CARAPACE_TEST_RESTART_VALUE", undefined);
    vi.stubEnv("CARAPACE_TEST_RESTART_AMBIENT", "ambient");
    const initial = {
      env: {
        vars: {
          CARAPACE_TEST_RESTART_VALUE: "first",
          CARAPACE_TEST_RESTART_AMBIENT: "config-default",
        },
      },
    };
    const beforeStartup = { ...process.env };
    applyConfigEnvVars(initial);
    initializePublishedConfigRuntimeEnv(initial, {
      ownedEnv: collectConfigRuntimeEnvOwnership(initial, beforeStartup, process.env),
    });
    setAppliedRuntimeConfigSnapshot(initial, initial);

    clearRuntimeConfigSnapshot();
    // Server shutdown and the run loop both clear snapshots before the next boot.
    clearRuntimeConfigSnapshot();
    const beforeRestartedStartup = { ...process.env };
    applyConfigEnvVars(initial);
    initializePublishedConfigRuntimeEnv(initial, {
      ownedEnv: collectConfigRuntimeEnvOwnership(initial, beforeRestartedStartup, process.env),
      preserveExistingOwnership: true,
    });
    const next = {
      env: {
        vars: {
          ...(nextValue ? { CARAPACE_TEST_RESTART_VALUE: nextValue } : {}),
          CARAPACE_TEST_RESTART_AMBIENT: "changed-config-default",
        },
      },
    };
    const publication = prepareConfigRuntimeEnv({
      previousConfig: initial,
      nextConfig: next,
    }).publish();
    publication.commit();

    expect(process.env.CARAPACE_TEST_RESTART_VALUE).toBe(nextValue);
    expect(process.env.CARAPACE_TEST_RESTART_AMBIENT).toBe("ambient");
  });

  it("preserves an ambient replacement of a formerly config-owned value", () => {
    vi.stubEnv("CARAPACE_TEST_RESTART_VALUE", "config-value");
    const initial = { env: { vars: { CARAPACE_TEST_RESTART_VALUE: "config-value" } } };
    initializePublishedConfigRuntimeEnv(initial, {
      ownedEnv: { CARAPACE_TEST_RESTART_VALUE: "config-value" },
    });
    process.env.CARAPACE_TEST_RESTART_VALUE = "new-ambient";

    clearRuntimeConfigSnapshot();
    const publication = prepareConfigRuntimeEnv({
      previousConfig: initial,
      nextConfig: {},
    }).publish();
    publication.commit();

    expect(process.env.CARAPACE_TEST_RESTART_VALUE).toBe("new-ambient");
  });

  it("keeps process-stable config selection in the environment during restart", () => {
    vi.stubEnv("CARAPACE_CONFIG_PATH", "/synthetic/restart/carapace.json");
    const initial = { env: { vars: { CARAPACE_CONFIG_PATH: "/synthetic/restart/carapace.json" } } };
    initializePublishedConfigRuntimeEnv(initial, {
      ownedEnv: { CARAPACE_CONFIG_PATH: "/synthetic/restart/carapace.json" },
    });

    clearRuntimeConfigSnapshot();

    expect(process.env.CARAPACE_CONFIG_PATH).toBe("/synthetic/restart/carapace.json");
  });

  it("fences a late rollback while retaining the published environment for restart", () => {
    vi.stubEnv("CARAPACE_TEST_RESTART_VALUE", "first");
    const initial = { env: { vars: { CARAPACE_TEST_RESTART_VALUE: "first" } } };
    const next = { env: { vars: { CARAPACE_TEST_RESTART_VALUE: "second" } } };
    initializePublishedConfigRuntimeEnv(initial, {
      ownedEnv: { CARAPACE_TEST_RESTART_VALUE: "first" },
    });
    const rollback = prepareConfigRuntimeEnv({
      previousConfig: initial,
      nextConfig: next,
    }).publish();

    clearRuntimeConfigSnapshot();
    rollback();

    expect(process.env.CARAPACE_TEST_RESTART_VALUE).toBe("second");
    const publication = prepareConfigRuntimeEnv({ previousConfig: next, nextConfig: {} }).publish();
    publication.commit();
    expect(process.env.CARAPACE_TEST_RESTART_VALUE).toBeUndefined();
  });

  it("still clears environment ownership on an explicit full runtime reset", () => {
    vi.stubEnv("CARAPACE_TEST_RESTART_VALUE", "owned");
    const initial = { env: { vars: { CARAPACE_TEST_RESTART_VALUE: "owned" } } };
    initializePublishedConfigRuntimeEnv(initial, {
      ownedEnv: { CARAPACE_TEST_RESTART_VALUE: "owned" },
    });

    resetConfigRuntimeState();

    expect(getPublishedConfigRuntimeEnvState().ownedEnv).toEqual({});
    expect(getPublishedConfigRuntimeEnvState().sourceConfig).toBeNull();
  });
});
