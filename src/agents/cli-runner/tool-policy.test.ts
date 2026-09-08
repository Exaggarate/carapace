import { describe, expect, it } from "vitest";
import { resolveCliRuntimeToolsAllow, stripCarapaceMcpToolPrefix } from "./tool-policy.js";

describe("stripCarapaceMcpToolPrefix", () => {
  it("strips only the loopback transport prefix", () => {
    expect(stripCarapaceMcpToolPrefix("mcp__carapace__memory_search")).toBe("memory_search");
    expect(stripCarapaceMcpToolPrefix("memory_search")).toBe("memory_search");
    expect(stripCarapaceMcpToolPrefix("mcp__other__tool")).toBe("mcp__other__tool");
  });
});

describe("resolveCliRuntimeToolsAllow", () => {
  it("keeps every concrete restriction, including server-managed defaults", () => {
    expect(resolveCliRuntimeToolsAllow(undefined)).toBeUndefined();
    expect(resolveCliRuntimeToolsAllow(["memory_search"], true)).toEqual(["memory_search"]);
    expect(resolveCliRuntimeToolsAllow(["*"])).toBeUndefined();
    expect(resolveCliRuntimeToolsAllow(["memory_search"])).toEqual(["memory_search"]);
  });
});
