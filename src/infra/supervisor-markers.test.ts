// Covers supervisor marker files used to identify managed Carapace processes.
import { describe, expect, it } from "vitest";
import {
  detectGatewayRespawnSupervisor,
  detectRespawnSupervisor,
  SUPERVISOR_HINT_ENV_VARS,
} from "./supervisor-markers.js";

describe("SUPERVISOR_HINT_ENV_VARS", () => {
  it("includes the cross-platform supervisor hint env vars", () => {
    const envVars = new Set(SUPERVISOR_HINT_ENV_VARS);
    expect(envVars.has("CARAPACE_SUPERVISOR_MODE")).toBe(true);
    expect(envVars.has("LAUNCH_JOB_LABEL")).toBe(true);
    expect(envVars.has("INVOCATION_ID")).toBe(true);
    expect(envVars.has("CARAPACE_WINDOWS_TASK_NAME")).toBe(true);
    expect(envVars.has("CARAPACE_SERVICE_MARKER")).toBe(true);
    expect(envVars.has("CARAPACE_SERVICE_KIND")).toBe(true);
  });
});

describe("detectRespawnSupervisor", () => {
  it("detects launchd from Carapace's explicit marker or current gateway launchd job", () => {
    expect(
      detectRespawnSupervisor({ CARAPACE_LAUNCHD_LABEL: " ai.carapace.gateway " }, "darwin"),
    ).toBe("launchd");
    expect(detectRespawnSupervisor({ CARAPACE_LAUNCHD_LABEL: "   " }, "darwin")).toBeNull();
    expect(detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "ai.carapace.gateway" }, "darwin")).toBe(
      "launchd",
    );
    expect(
      detectRespawnSupervisor(
        { LAUNCH_JOB_NAME: "ai.carapace.work", CARAPACE_PROFILE: "work" },
        "darwin",
      ),
    ).toBe("launchd");
    expect(detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "ai.carapace.mac" }, "darwin")).toBeNull();
    expect(detectRespawnSupervisor({ XPC_SERVICE_NAME: "ai.carapace.mac" }, "darwin")).toBeNull();
    expect(
      detectRespawnSupervisor(
        { XPC_SERVICE_NAME: "ai.carapace.mac", CARAPACE_PROFILE: "mac" },
        "darwin",
      ),
    ).toBeNull();
    expect(detectRespawnSupervisor({ XPC_SERVICE_NAME: "ai.carapace.gateway" }, "darwin")).toBe(
      "launchd",
    );
  });

  it("detects systemd only from non-blank platform-specific hints", () => {
    expect(detectRespawnSupervisor({ INVOCATION_ID: "abc123" }, "linux")).toBe("systemd");
    expect(detectRespawnSupervisor({ JOURNAL_STREAM: "" }, "linux")).toBeNull();
  });

  it("detects Linux Carapace gateway service markers only for opt-in callers", () => {
    const gatewayServiceEnv = {
      CARAPACE_SERVICE_MARKER: " carapace ",
      CARAPACE_SERVICE_KIND: " gateway ",
    };
    expect(detectRespawnSupervisor(gatewayServiceEnv, "linux")).toBeNull();
    expect(
      detectRespawnSupervisor(gatewayServiceEnv, "linux", {
        includeLinuxCarapaceGatewayServiceMarker: true,
      }),
    ).toBe("systemd");
    expect(
      detectRespawnSupervisor(
        {
          CARAPACE_SERVICE_MARKER: "carapace",
          CARAPACE_SERVICE_KIND: "worker",
        },
        "linux",
        { includeLinuxCarapaceGatewayServiceMarker: true },
      ),
    ).toBeNull();
    expect(
      detectRespawnSupervisor(
        {
          CARAPACE_SERVICE_MARKER: "other",
          CARAPACE_SERVICE_KIND: "gateway",
        },
        "linux",
        { includeLinuxCarapaceGatewayServiceMarker: true },
      ),
    ).toBeNull();
  });

  it("detects scheduled-task supervision on Windows from either hint family", () => {
    expect(
      detectRespawnSupervisor({ CARAPACE_WINDOWS_TASK_NAME: "Carapace Gateway" }, "win32"),
    ).toBe("schtasks");
    expect(
      detectRespawnSupervisor(
        {
          CARAPACE_SERVICE_MARKER: "carapace",
          CARAPACE_SERVICE_KIND: "gateway",
        },
        "win32",
      ),
    ).toBe("schtasks");
    expect(
      detectRespawnSupervisor(
        {
          CARAPACE_SERVICE_MARKER: "carapace",
          CARAPACE_SERVICE_KIND: "worker",
        },
        "win32",
      ),
    ).toBeNull();
    expect(
      detectRespawnSupervisor(
        {
          CARAPACE_SERVICE_MARKER: "other",
          CARAPACE_SERVICE_KIND: "gateway",
        },
        "win32",
      ),
    ).toBeNull();
  });

  it("ignores service markers on non-Windows platforms and unknown platforms", () => {
    expect(
      detectRespawnSupervisor(
        {
          CARAPACE_SERVICE_MARKER: "carapace",
          CARAPACE_SERVICE_KIND: "gateway",
        },
        "linux",
      ),
    ).toBeNull();
    expect(
      detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "ai.carapace.gateway" }, "freebsd"),
    ).toBeNull();
  });
});

describe("detectGatewayRespawnSupervisor", () => {
  it("keeps external ownership separate from native supervisor detection", () => {
    const env = {
      CARAPACE_SUPERVISOR_MODE: "external",
      CARAPACE_LAUNCHD_LABEL: "ai.carapace.gateway",
    };

    expect(detectGatewayRespawnSupervisor(env, "darwin")).toBe("external");
    expect(detectRespawnSupervisor(env, "darwin")).toBe("launchd");
  });
});
