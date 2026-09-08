// Daemon shared tests cover shared daemon CLI helpers and validation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../../packages/terminal-core/src/theme.js";
import { mockSystemAccountHome } from "../../daemon/service.test-helpers.js";
import { applyCliProfileEnv } from "../profile.js";
import {
  filterContainerGenericHints,
  renderGatewayServiceStartHints,
  resolveRuntimeStatusColor,
} from "./shared.js";

describe("resolveRuntimeStatusColor", () => {
  it("maps known runtime states to expected theme colors", () => {
    expect(resolveRuntimeStatusColor("running")).toBe(theme.success);
    expect(resolveRuntimeStatusColor("stopped")).toBe(theme.error);
    expect(resolveRuntimeStatusColor("unknown")).toBe(theme.muted);
  });

  it("falls back to warning color for unexpected states", () => {
    expect(resolveRuntimeStatusColor("degraded")).toBe(theme.warn);
    expect(resolveRuntimeStatusColor(undefined)).toBe(theme.muted);
  });
});

describe("renderGatewayServiceStartHints", () => {
  beforeEach(() => {
    mockSystemAccountHome();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces only installation advice in Nix mode", () => {
    const env: NodeJS.ProcessEnv = {};
    applyCliProfileEnv({ profile: "work", env });
    const existingHints = renderGatewayServiceStartHints(env);
    const hints = renderGatewayServiceStartHints({ ...env, CARAPACE_NIX_MODE: "1" });

    expect(hints[0]).toContain("Nix mode detected; service install is disabled.");
    expect(hints.slice(1)).toEqual(existingHints.slice(1));
    expect(hints).toContain("carapace --profile work gateway start");
  });

  it.each([
    {
      name: "the default profile",
      profile: "default",
      installCommand: "carapace gateway install",
      startCommand: "carapace gateway start",
    },
    {
      name: "a named profile",
      profile: "work",
      installCommand: "carapace --profile work gateway install",
      startCommand: "carapace --profile work gateway start",
    },
  ])(
    "recommends managed service commands for $name",
    ({ profile, installCommand, startCommand }) => {
      const env: NodeJS.ProcessEnv = {};
      applyCliProfileEnv({ profile, env });
      expect(renderGatewayServiceStartHints(env).slice(0, 2)).toEqual([
        installCommand,
        startCommand,
      ]);
    },
  );

  it("prepends a single container restart hint when CARAPACE_CONTAINER is set", () => {
    expect(
      renderGatewayServiceStartHints({
        CARAPACE_CONTAINER: "carapace-demo-container",
      } as NodeJS.ProcessEnv),
    ).toContain(
      "Restart the container or the service that manages it for carapace-demo-container.",
    );
  });

  it("prepends a single container restart hint when CARAPACE_CONTAINER_HINT is set", () => {
    expect(
      renderGatewayServiceStartHints({
        CARAPACE_CONTAINER_HINT: "carapace-demo-container",
        CARAPACE_PROFILE: "work",
      } as NodeJS.ProcessEnv),
    ).toEqual([
      "Restart the container or the service that manages it for carapace-demo-container.",
    ]);
  });
});

describe("filterContainerGenericHints", () => {
  it("drops the generic container foreground hint when CARAPACE_CONTAINER is set", () => {
    expect(
      filterContainerGenericHints(
        [
          "systemd user services are unavailable; install/enable systemd or run the gateway under your supervisor.",
          "If you're in a container, run the gateway in the foreground instead of `carapace gateway`.",
        ],
        { CARAPACE_CONTAINER: "carapace-demo-container" } as NodeJS.ProcessEnv,
      ),
    ).toStrictEqual([]);
  });

  it("drops the generic container foreground hint when CARAPACE_CONTAINER_HINT is set", () => {
    expect(
      filterContainerGenericHints(
        [
          "systemd user services are unavailable; install/enable systemd or run the gateway under your supervisor.",
          "If you're in a container, run the gateway in the foreground instead of `carapace gateway`.",
        ],
        { CARAPACE_CONTAINER_HINT: "carapace-demo-container" } as NodeJS.ProcessEnv,
      ),
    ).toStrictEqual([]);
  });
});
