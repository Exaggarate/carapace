// Launchd current service tests cover resolving active macOS service labels.
import { describe, expect, it } from "vitest";
import { isCurrentProcessLaunchdServiceLabel } from "./launchd-current-service.js";

describe("isCurrentProcessLaunchdServiceLabel", () => {
  it("matches launchd-provided service labels", () => {
    expect(
      isCurrentProcessLaunchdServiceLabel("ai.carapace.gateway", {
        LAUNCH_JOB_LABEL: "ai.carapace.gateway",
      }),
    ).toBe(true);
  });

  it("falls back to Carapace service markers when XPC_SERVICE_NAME is inherited", () => {
    expect(
      isCurrentProcessLaunchdServiceLabel("ai.carapace.gateway", {
        XPC_SERVICE_NAME: "0",
        CARAPACE_SERVICE_MARKER: "carapace",
        CARAPACE_SERVICE_KIND: "gateway",
        CARAPACE_LAUNCHD_LABEL: "ai.carapace.gateway",
      }),
    ).toBe(true);
  });

  it("does not treat the configured label alone as current service identity", () => {
    // Detached update helper children inherit CARAPACE_LAUNCHD_LABEL.
    expect(
      isCurrentProcessLaunchdServiceLabel("ai.carapace.gateway", {
        CARAPACE_LAUNCHD_LABEL: "ai.carapace.gateway",
      }),
    ).toBe(false);
  });

  it("does not treat unrelated inherited launchd labels as current services", () => {
    expect(
      isCurrentProcessLaunchdServiceLabel("ai.carapace.gateway", {
        XPC_SERVICE_NAME: "0",
        CARAPACE_LAUNCHD_LABEL: "ai.carapace.gateway",
      }),
    ).toBe(false);
  });
});
