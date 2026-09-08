import { describe, expect, it } from "vitest";
import { CarapaceSchema } from "./zod-schema.js";

describe("logging.audit.executionIdentity", () => {
  it("accepts only the explicit boolean config surface", () => {
    expect(
      CarapaceSchema.safeParse({
        logging: { audit: { executionIdentity: true } },
      }).success,
    ).toBe(true);
    expect(
      CarapaceSchema.safeParse({
        logging: { audit: { executionIdentity: false } },
      }).success,
    ).toBe(true);
    expect(
      CarapaceSchema.safeParse({
        logging: { audit: { executionIdentity: "true" } },
      }).success,
    ).toBe(false);
    expect(
      CarapaceSchema.safeParse({
        logging: { audit: { execution_identity: true } },
      }).success,
    ).toBe(false);
  });
});
