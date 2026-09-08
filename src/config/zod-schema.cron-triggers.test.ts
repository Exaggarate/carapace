import { describe, expect, it } from "vitest";
import { CarapaceSchema } from "./zod-schema.js";

describe("CarapaceSchema cron gates", () => {
  it.each([undefined, false, true])(
    "accepts skipMissedJobs=%s without changing its default",
    (skipMissedJobs) => {
      expect(CarapaceSchema.parse({ cron: { skipMissedJobs } }).cron?.skipMissedJobs).toBe(
        skipMissedJobs,
      );
    },
  );

  it("rejects a non-boolean skipMissedJobs", () => {
    expect(CarapaceSchema.safeParse({ cron: { skipMissedJobs: "true" } }).success).toBe(false);
  });

  it("accepts the strict trigger gate", () => {
    expect(CarapaceSchema.parse({ cron: { triggers: { enabled: true } } }).cron?.triggers).toEqual({
      enabled: true,
    });
  });

  it("rejects invalid and unknown trigger settings", () => {
    expect(
      CarapaceSchema.safeParse({ cron: { triggers: { enabled: true, extra: true } } }).success,
    ).toBe(false);
  });
});
