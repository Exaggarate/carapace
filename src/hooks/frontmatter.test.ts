// Hook frontmatter tests cover hook metadata parsing from hook files.
import { expectDefined } from "@carapace/normalization-core";
import { describe, expect, it } from "vitest";
import {
  parseHookFrontmatter,
  resolveHookManifestMetadata,
  resolveHookInvocationPolicy,
} from "./frontmatter.js";
import type { CarapaceHookMetadata } from "./types.js";

function requireString(value: string | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`expected ${label}`);
  }
  return value;
}

function requireCarapaceMetadata(metadata: CarapaceHookMetadata | undefined): CarapaceHookMetadata {
  if (!metadata) {
    throw new Error("expected carapace metadata");
  }
  return metadata;
}

describe("parseHookFrontmatter", () => {
  it("parses single-line key-value pairs", () => {
    const content = `---
name: test-hook
description: "A test hook"
homepage: https://example.com
---

# Test Hook
`;
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("test-hook");
    expect(result.description).toBe("A test hook");
    expect(result.homepage).toBe("https://example.com");
  });

  it("handles missing frontmatter", () => {
    const content = "# Just a markdown file";
    const result = parseHookFrontmatter(content);
    expect(result).toStrictEqual({});
  });

  it("handles unclosed frontmatter", () => {
    const content = `---
name: broken
    `;
    const result = parseHookFrontmatter(content);
    expect(result).toStrictEqual({});
  });

  it("parses multi-line metadata block with indented JSON", () => {
    const content = `---
name: session-memory
description: "Save session context"
metadata:
  {
    "carapace": {
      "emoji": "💾",
      "events": ["command:new"]
    }
  }
---

# Session Memory Hook
`;
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("session-memory");
    expect(result.description).toBe("Save session context");
    const metadata = requireString(result.metadata, "session-memory metadata");

    // Verify the metadata is valid JSON
    const parsed = JSON.parse(metadata);
    expect(parsed.carapace.emoji).toBe("💾");
    expect(parsed.carapace.events).toEqual(["command:new"]);
  });

  it("parses multi-line metadata with complex nested structure", () => {
    const content = `---
name: command-logger
description: "Log all command events"
metadata:
  {
    "carapace":
      {
        "emoji": "📝",
        "events": ["command"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled" }]
      }
  }
---
`;
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("command-logger");

    const parsed = JSON.parse(requireString(result.metadata, "command-logger metadata"));
    expect(parsed.carapace.emoji).toBe("📝");
    expect(parsed.carapace.events).toEqual(["command"]);
    expect(parsed.carapace.requires.config).toEqual(["workspace.dir"]);
    expect(parsed.carapace.install[0].kind).toBe("bundled");
  });

  it("handles single-line metadata (inline JSON)", () => {
    const content = `---
name: simple-hook
metadata: {"carapace": {"events": ["test"]}}
---
`;
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("simple-hook");
    expect(result.metadata).toBe('{"carapace": {"events": ["test"]}}');
  });

  it("handles mixed single-line and multi-line values", () => {
    const content = `---
name: mixed-hook
description: "A hook with mixed values"
homepage: https://example.com
metadata:
  {
    "carapace": {
      "events": ["command:new"]
    }
  }
enabled: true
---
`;
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("mixed-hook");
    expect(result.description).toBe("A hook with mixed values");
    expect(result.homepage).toBe("https://example.com");
    expect(requireString(result.metadata, "mixed-hook metadata")).toContain('"command:new"');
    expect(result.enabled).toBe("true");
  });

  it("strips surrounding quotes from values", () => {
    const content = `---
name: "quoted-name"
description: 'single-quoted'
---
`;
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("quoted-name");
    expect(result.description).toBe("single-quoted");
  });

  it("handles CRLF line endings", () => {
    const content = "---\r\nname: test\r\ndescription: crlf\r\n---\r\n";
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("crlf");
  });

  it("handles CR line endings", () => {
    const content = "---\rname: test\rdescription: cr\r---\r";
    const result = parseHookFrontmatter(content);
    expect(result.name).toBe("test");
    expect(result.description).toBe("cr");
  });
});

describe("resolveHookManifestMetadata", () => {
  it("extracts carapace metadata from parsed frontmatter", () => {
    const frontmatter = {
      name: "test-hook",
      metadata: JSON.stringify({
        carapace: {
          emoji: "🔥",
          events: ["command:new", "command:reset"],
          requires: {
            config: ["workspace.dir"],
            bins: ["git"],
          },
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    const carapace = requireCarapaceMetadata(result);
    expect(carapace.emoji).toBe("🔥");
    expect(carapace.events).toEqual(["command:new", "command:reset"]);
    expect(carapace.requires?.config).toEqual(["workspace.dir"]);
    expect(carapace.requires?.bins).toEqual(["git"]);
  });

  it("returns undefined when metadata is missing", () => {
    const frontmatter = { name: "no-metadata" };
    const result = resolveHookManifestMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("returns undefined when carapace key is missing", () => {
    const frontmatter = {
      metadata: JSON.stringify({ other: "data" }),
    };
    const result = resolveHookManifestMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const frontmatter = {
      metadata: "not valid json {",
    };
    const result = resolveHookManifestMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("handles install specs", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        carapace: {
          events: ["command"],
          install: [
            { id: "bundled", kind: "bundled", label: "Bundled with Carapace" },
            { id: "npm", kind: "npm", package: "@carapace/hook" },
          ],
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    expect(result?.install).toHaveLength(2);
    expect(expectDefined(result?.install?.[0], "result?.install?.[0] test invariant").kind).toBe(
      "bundled",
    );
    expect(expectDefined(result?.install?.[1], "result?.install?.[1] test invariant").kind).toBe(
      "npm",
    );
    expect(expectDefined(result?.install?.[1], "result?.install?.[1] test invariant").package).toBe(
      "@carapace/hook",
    );
  });

  it("handles os restrictions", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        carapace: {
          events: ["command"],
          os: ["darwin", "linux"],
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    expect(result?.os).toEqual(["darwin", "linux"]);
  });

  it("parses real session-memory HOOK.md format", () => {
    // This is the actual format used in the bundled hooks
    const content = `---
name: session-memory
description: "Save session context to memory when a session is reset"
homepage: https://github.com/Exaggarate/carapace#session-memory
metadata:
  {
    "carapace":
      {
        "emoji": "💾",
        "events": ["command:new", "command:reset", "session:auto-reset"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with Carapace" }],
      },
  }
---

# Session Memory Hook
`;

    const frontmatter = parseHookFrontmatter(content);
    expect(frontmatter.name).toBe("session-memory");
    expect(requireString(frontmatter.metadata, "session-memory metadata")).toContain(
      '"command:reset"',
    );

    const carapace = requireCarapaceMetadata(resolveHookManifestMetadata(frontmatter));
    expect(carapace.emoji).toBe("💾");
    expect(carapace.events).toEqual(["command:new", "command:reset", "session:auto-reset"]);
    expect(carapace.requires?.config).toEqual(["workspace.dir"]);
    expect(expectDefined(carapace.install?.[0], "carapace.install?.[0] test invariant").kind).toBe(
      "bundled",
    );
  });

  it("parses YAML metadata map", () => {
    const content = `---
name: yaml-metadata
metadata:
  carapace:
    emoji: disk
    events:
      - command:new
---
`;
    const frontmatter = parseHookFrontmatter(content);
    const carapace = resolveHookManifestMetadata(frontmatter);
    expect(carapace?.emoji).toBe("disk");
    expect(carapace?.events).toEqual(["command:new"]);
  });
});

describe("resolveHookInvocationPolicy", () => {
  it("defaults to enabled when missing", () => {
    expect(resolveHookInvocationPolicy({}).enabled).toBe(true);
  });

  it("parses enabled flag", () => {
    expect(resolveHookInvocationPolicy({ enabled: "no" }).enabled).toBe(false);
    expect(resolveHookInvocationPolicy({ enabled: "on" }).enabled).toBe(true);
  });
});
