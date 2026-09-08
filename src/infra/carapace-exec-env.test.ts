// Tests Carapace execution environment construction.
import { describe, expect, it } from "vitest";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import {
  ensureCarapaceExecMarkerOnProcess,
  markCarapaceExecEnv,
  CARAPACE_CLI_ENV_VAR,
} from "./carapace-exec-env.js";

const CARAPACE_CLI_ENV_VALUE = "1";

describe("markCarapaceExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", CARAPACE_CLI: "0" };
    const marked = markCarapaceExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      CARAPACE_CLI: CARAPACE_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.CARAPACE_CLI).toBe("0");
  });
});

describe("ensureCarapaceExecMarkerOnProcess", () => {
  it.each([
    {
      name: "mutates and returns the provided process env",
      env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    },
    {
      name: "overwrites an existing marker on the provided process env",
      env: { PATH: "/usr/bin", [CARAPACE_CLI_ENV_VAR]: "0" } as NodeJS.ProcessEnv,
    },
  ])("$name", ({ env }) => {
    expect(ensureCarapaceExecMarkerOnProcess(env)).toBe(env);
    expect(env[CARAPACE_CLI_ENV_VAR]).toBe(CARAPACE_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[CARAPACE_CLI_ENV_VAR];
    deleteTestEnvValue(CARAPACE_CLI_ENV_VAR);

    try {
      expect(ensureCarapaceExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[CARAPACE_CLI_ENV_VAR]).toBe(CARAPACE_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        deleteTestEnvValue(CARAPACE_CLI_ENV_VAR);
      } else {
        setTestEnvValue(CARAPACE_CLI_ENV_VAR, previous);
      }
    }
  });
});
