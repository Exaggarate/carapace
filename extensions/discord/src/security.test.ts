// Discord tests cover the security adapter's entry-authentication classification.
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { resolveDiscordAccount } from "./accounts.js";
import { discordSecurityAdapter } from "./security.js";

describe("discordSecurityAdapter.resolveDmPolicy", () => {
  it("classifies snowflake entries verified and tag entries mutable", () => {
    const cfg = { channels: { discord: { token: "test-token" } } } as CarapaceConfig;
    const account = resolveDiscordAccount({ cfg, accountId: "default" });
    const policy = discordSecurityAdapter.resolveDmPolicy?.({
      cfg,
      accountId: "default",
      account,
    });

    expect(policy?.classifyEntryAuthentication?.("123456789012345678")).toBe("verified");
    expect(policy?.classifyEntryAuthentication?.("alice#0001")).toBe("mutable");
    expect(policy?.classifyEntryAuthentication?.("alice")).toBe("mutable");
  });
});
