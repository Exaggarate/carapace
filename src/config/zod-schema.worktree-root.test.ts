import path from "node:path";
import { describe, expect, it } from "vitest";
import { CarapaceSchema } from "./zod-schema.js";

describe("CarapaceSchema worktreeRoot", () => {
  it("keeps the default implicit and accepts an absolute or home-relative root", () => {
    expect(CarapaceSchema.parse({}).worktreeRoot).toBeUndefined();
    const roots = [path.resolve("worktrees"), "~/worktrees", "~"];
    if (path.sep === "\\") {
      roots.push("~\\worktrees");
    }
    for (const worktreeRoot of roots) {
      expect(CarapaceSchema.parse({ worktreeRoot }).worktreeRoot).toBe(worktreeRoot);
    }
  });

  it.each([
    "",
    "  ",
    "worktrees",
    "./worktrees",
    "../worktrees",
    "~someone/worktrees",
    ...(path.sep === "/" ? ["~\\worktrees"] : []),
    42,
    null,
  ])("rejects an empty, relative, or non-string root: %j", (worktreeRoot) => {
    expect(CarapaceSchema.safeParse({ worktreeRoot }).success).toBe(false);
  });

  it("keeps the retired worktrees namespace invalid", () => {
    expect(CarapaceSchema.safeParse({ worktrees: { root: "~/worktrees" } }).success).toBe(false);
  });
});
