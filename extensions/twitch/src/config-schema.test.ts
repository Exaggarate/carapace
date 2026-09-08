// Twitch tests cover config schema plugin behavior.
import { buildChannelConfigSchema } from "carapace/plugin-sdk/channel-config-schema";
import { validateJsonSchemaValue } from "carapace/plugin-sdk/json-schema-runtime";
import { describe, expect, it } from "vitest";
import { TwitchConfigSchema } from "./config-schema.js";

function validateTwitchConfig(value: unknown): boolean {
  const schema = buildChannelConfigSchema(TwitchConfigSchema).schema;
  const result = validateJsonSchemaValue({
    cacheKey: "twitch.config-schema.test",
    schema,
    value,
  });
  if (!result.ok) {
    throw new Error(`expected valid Twitch config: ${JSON.stringify(result.errors)}`);
  }
  return true;
}

describe("TwitchConfigSchema JSON schema", () => {
  it("accepts single-account channel config with base fields", () => {
    expect(
      validateTwitchConfig({
        enabled: false,
        username: "carapace",
        accessToken: "oauth:test",
        clientId: "test-client-id",
        channel: "carapace-test",
      }),
    ).toBe(true);
  });

  it("accepts multi-account channel config with defaultAccount", () => {
    expect(
      validateTwitchConfig({
        enabled: true,
        defaultAccount: "stream",
        accounts: {
          stream: {
            username: "carapace",
            accessToken: "oauth:test",
            clientId: "test-client-id",
            channel: "carapace-test",
          },
        },
      }),
    ).toBe(true);
  });
});
