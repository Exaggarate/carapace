import { describe, expect, it } from "vitest";
import { buildPostCoreHandoffEnv } from "./update-post-core-context.js";

describe("buildPostCoreHandoffEnv", () => {
  it("replaces only current-run handoff values without mutating the base env", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      CARAPACE_COMPATIBILITY_HOST_VERSION: "stale-version",
      CARAPACE_UPDATE_POST_CORE_REQUESTED_CHANNEL: "beta",
      CARAPACE_UPDATE_POST_CORE_SOURCE_CONFIG_PATH: "/tmp/stale-config.json",
      CARAPACE_UNRELATED: "preserved",
    };

    const absent = buildPostCoreHandoffEnv({ baseEnv });
    expect(absent).toEqual({
      PATH: "/usr/bin",
      CARAPACE_UNRELATED: "preserved",
    });

    const fresh = buildPostCoreHandoffEnv({
      baseEnv,
      compatHostVersion: "2026.8.11",
      requestedChannel: "dev",
      sourceConfigPath: "/tmp/current-config.json",
    });
    expect(fresh).toMatchObject({
      CARAPACE_COMPATIBILITY_HOST_VERSION: "2026.8.11",
      CARAPACE_UPDATE_POST_CORE_REQUESTED_CHANNEL: "dev",
      CARAPACE_UPDATE_POST_CORE_SOURCE_CONFIG_PATH: "/tmp/current-config.json",
      CARAPACE_UNRELATED: "preserved",
    });
    expect(baseEnv).toMatchObject({
      CARAPACE_COMPATIBILITY_HOST_VERSION: "stale-version",
      CARAPACE_UPDATE_POST_CORE_REQUESTED_CHANNEL: "beta",
      CARAPACE_UPDATE_POST_CORE_SOURCE_CONFIG_PATH: "/tmp/stale-config.json",
      CARAPACE_UNRELATED: "preserved",
    });
  });

  it("clears mixed-case inherited values with Windows environment semantics", () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(
        buildPostCoreHandoffEnv({
          baseEnv: {
            Carapace_Compatibility_Host_Version: "stale-version",
            Carapace_Update_Post_Core_Requested_Channel: "beta",
            Carapace_Update_Post_Core_Source_Config_Path: "C:\\stale-config.json",
            CARAPACE_UNRELATED: "preserved",
          },
        }),
      ).toEqual({ CARAPACE_UNRELATED: "preserved" });
    } finally {
      Object.defineProperty(process, "platform", platformDescriptor!);
    }
  });
});
