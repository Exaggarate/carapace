// Git utility tests cover plugin git source parsing, ref normalization, and path
// traversal rejection before managed checkouts are created.
import { describe, expect, it } from "vitest";
import { parseGitUrl } from "./git.js";

describe("parseGitUrl", () => {
  it("parses ordinary hosted git sources", () => {
    expect(parseGitUrl("git:github.com/Exaggarate/carapace/example-plugin")).toMatchObject({
      type: "git",
      host: "github.com",
      path: "carapace/example-plugin",
    });
    expect(parseGitUrl("git:https://example.com/@team/example-plugin")).toMatchObject({
      host: "example.com",
      path: "@team/example-plugin",
    });
  });

  it.each([
    ["git:https://github.com/Exaggarate/carapace/example-plugin.git@v1.2.3", "github.com"],
    ["git:git@github.com:carapace/example-plugin.git@feature/foo", "github.com"],
    ["git:example.com/carapace/example-plugin@main", "example.com"],
    ["git:gitlab.com/carapace/example-plugin@feature/foo", "gitlab.com"],
    ["git:https://example.com/@team/example-plugin@main", "example.com", "@team/example-plugin"],
  ])("ignores refs in the identity for %s", (source, host, path = "carapace/example-plugin") => {
    expect(parseGitUrl(source)).toMatchObject({ host, path });
  });

  it("rejects repository paths that could escape managed checkout roots", () => {
    // Managed plugin checkouts derive local paths from repo path segments, so
    // dot-segments are rejected instead of normalized.
    expect(parseGitUrl("git:https://example.com/carapace/../outside")).toBeNull();
    expect(parseGitUrl("git:git@example.com:carapace/../outside")).toBeNull();
    expect(parseGitUrl("git:example.com/carapace/./outside")).toBeNull();
    expect(parseGitUrl("git:https://github.com/Exaggarate/carapace/../outside@feature/foo")).toBeNull();
    expect(parseGitUrl("git:https://github.com/carapace/%2e%2e/outside")).toBeNull();
    expect(parseGitUrl("git:https://github.com/Exaggarate/carapace/repo\\..\\outside")).toBeNull();
  });
});
