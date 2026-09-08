import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../../config/types.carapace.js";

const writeWizardConfigFile = vi.hoisted(() => vi.fn());

vi.mock("../../wizard/setup.shared.js", () => ({ writeWizardConfigFile }));

import { commitNonInteractiveOnboardConfig } from "./config-write.js";

describe("commitNonInteractiveOnboardConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeWizardConfigFile.mockImplementation(async (config: CarapaceConfig) => config);
  });

  it("keeps the verified config hash on the canonical writer", async () => {
    const nextConfig: CarapaceConfig = {
      gateway: { port: 19_001 },
    };

    await expect(
      commitNonInteractiveOnboardConfig({
        nextConfig,
        baseConfig: {},
        baseHash: "verified-config-hash",
      }),
    ).resolves.toBe(nextConfig);

    expect(writeWizardConfigFile).toHaveBeenCalledWith(nextConfig, {
      allowConfigSizeDrop: false,
      mergeBase: {},
      baseHash: "verified-config-hash",
    });
  });

  it("permits config size reduction only for an explicitly requested reset", async () => {
    const nextConfig: CarapaceConfig = {};

    await commitNonInteractiveOnboardConfig({
      nextConfig,
      baseConfig: {},
      reset: true,
    });

    expect(writeWizardConfigFile).toHaveBeenCalledWith(nextConfig, {
      allowConfigSizeDrop: true,
      mergeBase: {},
    });
  });
});
