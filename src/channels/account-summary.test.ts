import { describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { buildChannelAccountSummary } from "./account-summary.js";
import type { ChannelPlugin } from "./plugins/types.plugin.js";

describe("buildChannelAccountSummary", () => {
  it("redacts a raw baseUrl returned by describeAccount without mutating the account", () => {
    const rawBaseUrl = [
      "https://",
      "user",
      ":",
      "pass",
      "@",
      "chat.example.test/?token=",
      "secret",
    ].join("");
    const account = Object.freeze({
      baseUrl: "https://safe.example.test/",
    });
    const plugin = {
      config: {
        describeAccount: () => ({
          baseUrl: rawBaseUrl,
        }),
      },
    } as unknown as ChannelPlugin;

    const snapshot = buildChannelAccountSummary({
      plugin,
      account,
      cfg: {} as CarapaceConfig,
      accountId: "default",
      enabled: true,
      configured: true,
    });

    expect(snapshot.baseUrl).toBe("https://chat.example.test/?token=***");
    expect(account.baseUrl).toBe("https://safe.example.test/");
  });
});
