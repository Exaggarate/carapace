import { describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { digestRuntimeWebOwnerContract } from "./runtime-owner-contract.js";

function digestWebContract(sourceConfig: CarapaceConfig): string {
  return digestRuntimeWebOwnerContract({
    scopePath: "plugins.entries.web-search.config.webSearch.apiKey",
    configuredProvider: "brave",
    toolConfig: sourceConfig.tools?.web?.search,
    providers: [{ id: "brave", pluginId: "web-search" }],
    providerId: "brave",
    sourceConfig,
  });
}

describe("runtime owner contracts", () => {
  it("canonicalizes equivalent web-owner SecretRef input forms", () => {
    const shorthand = {
      plugins: {
        entries: {
          "web-search": { config: { webSearch: { apiKey: "$BRAVE_API_KEY" } } },
        },
      },
    } satisfies CarapaceConfig;
    const canonical = {
      plugins: {
        entries: {
          "web-search": {
            config: {
              webSearch: {
                apiKey: { source: "env", provider: "default", id: "BRAVE_API_KEY" },
              },
            },
          },
        },
      },
    } satisfies CarapaceConfig;

    expect(digestWebContract(shorthand)).toBe(digestWebContract(canonical));
  });
});
