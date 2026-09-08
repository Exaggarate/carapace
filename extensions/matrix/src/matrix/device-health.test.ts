// Matrix tests cover device health plugin behavior.
import { describe, expect, it } from "vitest";
import { isCarapaceManagedMatrixDevice, summarizeMatrixDeviceHealth } from "./device-health.js";

describe("matrix device health", () => {
  it("detects Carapace-managed device names", () => {
    expect(isCarapaceManagedMatrixDevice("Carapace Gateway")).toBe(true);
    expect(isCarapaceManagedMatrixDevice("Carapace Debug")).toBe(true);
    expect(isCarapaceManagedMatrixDevice("Element iPhone")).toBe(false);
    expect(isCarapaceManagedMatrixDevice(null)).toBe(false);
  });

  it("summarizes stale Carapace-managed devices separately from the current device", () => {
    const summary = summarizeMatrixDeviceHealth([
      {
        deviceId: "du314Zpw3A",
        displayName: "Carapace Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "Carapace Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "Carapace Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element iPhone",
        current: false,
      },
    ]);

    expect(summary).toEqual({
      currentDeviceId: "du314Zpw3A",
      currentCarapaceDevices: [
        {
          deviceId: "du314Zpw3A",
          displayName: "Carapace Gateway",
          current: true,
        },
      ],
      staleCarapaceDevices: [
        {
          deviceId: "BritdXC6iL",
          displayName: "Carapace Gateway",
          current: false,
        },
        {
          deviceId: "G6NJU9cTgs",
          displayName: "Carapace Debug",
          current: false,
        },
      ],
    });
  });
});
