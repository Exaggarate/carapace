// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCarapaceToolFallbackText } from "./prompt-surface.js";

describe("buildCarapaceToolFallbackText", () => {
  it("does not invent tool names when the structured list is unavailable", () => {
    const text = buildCarapaceToolFallbackText({
      surface: "carapace_main",
    });

    expect(text).toContain("Use only exposed tools");
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });
});
