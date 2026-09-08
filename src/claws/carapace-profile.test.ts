import { link, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { readClawManifestFile } from "./reader.js";
import { parseClawCarapaceProfile } from "./schema.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("Carapace profile schema", () => {
  it("accepts typed settings", () => {
    const result = parseClawCarapaceProfile({
      schemaVersion: 1,
      agent: {
        tools: {
          profile: "coding",
          allow: ["read", "github__list_issues"],
          deny: ["exec"],
          fs: { workspaceOnly: true },
        },
        memory: {
          search: {
            enabled: true,
            rememberAcrossConversations: true,
            sources: ["memory", "sessions"],
          },
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("accepts a full profile only with a bounded allowlist", () => {
    expect(
      parseClawCarapaceProfile({
        schemaVersion: 1,
        agent: { tools: { profile: "full", allow: ["read", "write"] } },
      }).ok,
    ).toBe(true);
  });

  it("rejects disabled host filesystem confinement", () => {
    const result = parseClawCarapaceProfile({
      schemaVersion: 1,
      agent: { tools: { fs: { workspaceOnly: false } } },
    });

    expect(result.ok).toBe(false);
  });

  it("rejects retired heartbeat fields with a heartbeat-scoped diagnostic", () => {
    const result = parseClawCarapaceProfile({
      schemaVersion: 1,
      agent: { heartbeat: { every: "30m", skipWhenBusy: true } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        path: "$.agent.heartbeat",
        message: expect.stringContaining("skipWhenBusy"),
      }),
    );
  });

  it("rejects invalid profile policy", () => {
    for (const agent of [
      { tools: { profile: "future-profile" } },
      { tools: { profile: "full" } },
      { tools: { profile: "coding" } },
      { tools: { profile: "messaging" } },
      { tools: { profile: "coding", allow: ["bundle-mcp"] } },
      { tools: { allow: ["bundle-mcp"] } },
      { tools: { allow: ["*"] } },
      { tools: { profile: "coding", allow: ["tts"] } },
      { tools: { profile: "coding", allow: ["read", "tts"] } },
      { tools: { alsoAllow: ["read"] } },
      { tools: { alsoAllow: ["group:plugins"] } },
      { tools: { alsoAllow: ["GROUP:PLUGINS"] } },
      { tools: { allow: ["read"], alsoAllow: ["write"] } },
      { memory: { search: { provider: "openai" } } },
      { memory: { search: { sources: ["sessions"] } } },
    ]) {
      expect(parseClawCarapaceProfile({ schemaVersion: 1, agent }).ok).toBe(false);
    }
  });
});

describe("Carapace profile reader", () => {
  it.each([
    ["anchor", "agent: &agent {}", "anchors"],
    ["alias", "agent: *agent", "aliases"],
    ["tag", "agent: !!map {}", "explicit tags"],
    ["merge", "agent: { <<: {} }", "merge keys"],
  ])(
    "rejects profile YAML %s with its profile diagnostic",
    async (_label, declaration, feature) => {
      const root = tempDirs.make("carapace-claw-profile-yaml-");
      await mkdir(join(root, "profiles"));
      const manifestPath = join(root, "carapace.claw.json");
      await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, agent: { id: "triage" } }));
      await writeFile(join(root, "profiles", "carapace.yml"), `schemaVersion: 1\n${declaration}\n`);

      const result = await readClawManifestFile(manifestPath);

      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          {
            level: "error",
            phase: "parse",
            path: "$",
            code: "unsupported_carapace_profile_yaml_feature",
            message: `profiles/carapace.yml uses ${feature}; Carapace profile YAML must map directly to JSON data.`,
          },
        ],
      });
    },
  );

  it.each([
    ["duplicate key", "schemaVersion: 1\nschemaVersion: 1\nagent: {}\n"],
    ["invalid syntax", "schemaVersion: 1\nagent: [\n"],
  ])("reports a profile YAML %s as a parse failure", async (_label, profile) => {
    const root = tempDirs.make("carapace-claw-profile-yaml-invalid-");
    await mkdir(join(root, "profiles"));
    const manifestPath = join(root, "carapace.claw.json");
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, agent: { id: "triage" } }));
    await writeFile(join(root, "profiles", "carapace.yml"), profile);

    const result = await readClawManifestFile(manifestPath);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          level: "error",
          phase: "parse",
          path: "$",
          code: "invalid_carapace_profile",
          message: expect.stringContaining("Could not parse profiles/carapace.yml:"),
        },
      ],
    });
  });

  it("loads and integrity-binds the conventional profile", async () => {
    const root = tempDirs.make("carapace-claw-profile-");
    await mkdir(join(root, "profiles"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@acme/github-triage",
        version: "3.2.1",
        carapace: { claw: "CLAW.md" },
      }),
      "utf8",
    );
    await writeFile(
      join(root, "CLAW.md"),
      ["---", "schemaVersion: 1", "agent:", "  id: triage", "---", "", "# GitHub Triage"].join(
        "\n",
      ),
      "utf8",
    );
    const profilePath = join(root, "profiles", "carapace.yml");
    await writeFile(
      profilePath,
      [
        "schemaVersion: 1",
        "agent:",
        "  tools:",
        "    profile: coding",
        "    allow: [read]",
        "    deny: [exec]",
        "    fs:",
        "      workspaceOnly: true",
      ].join("\n"),
      "utf8",
    );

    const first = await readClawManifestFile(root);
    expect(first).toMatchObject({
      ok: true,
      carapaceProfile: {
        schemaVersion: 1,
        agent: {
          tools: {
            profile: "coding",
            allow: ["read"],
            deny: ["exec"],
            fs: { workspaceOnly: true },
          },
        },
      },
    });
    if (!first.ok) {
      throw new Error("expected Carapace profile to parse");
    }

    await writeFile(
      profilePath,
      "schemaVersion: 1\nagent:\n  tools:\n    profile: messaging\n    allow: [message]\n",
      "utf8",
    );
    const second = await readClawManifestFile(root);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected changed Carapace profile to parse");
    }
    expect(second.source.integrity).not.toBe(first.source.integrity);
  });

  it.each([
    { toolProfile: "coding", strictOk: false },
    { toolProfile: "minimal", strictOk: true },
  ] as const)(
    "loads a legacy dynamic $toolProfile profile through the update migration path",
    async ({ toolProfile, strictOk }) => {
      const root = tempDirs.make("carapace-claw-legacy-profile-");
      await mkdir(join(root, "profiles"));
      await writeFile(
        join(root, "carapace.claw.json"),
        JSON.stringify({ schemaVersion: 1, agent: { id: "triage" } }),
        "utf8",
      );
      await writeFile(
        join(root, "profiles", "carapace.yml"),
        `schemaVersion: 1\nagent:\n  tools:\n    profile: ${toolProfile}\n`,
        "utf8",
      );

      const manifestPath = join(root, "carapace.claw.json");
      await expect(readClawManifestFile(manifestPath)).resolves.toMatchObject({ ok: strictOk });
      const migrated = await readClawManifestFile(manifestPath, {
        allowLegacyDynamicToolProfile: true,
      });

      expect(migrated).toMatchObject({
        ok: true,
        carapaceProfile: {
          agent: {
            tools: {
              profile: "full",
              allow: expect.not.arrayContaining(["bundle-mcp"]),
            },
          },
        },
        legacyCarapaceProfile: {
          agent: {
            tools: {
              profile: toolProfile,
            },
          },
        },
      });
    },
  );

  it("requires package authors to bound a legacy full profile before update", async () => {
    const root = tempDirs.make("carapace-claw-legacy-full-profile-");
    await mkdir(join(root, "profiles"));
    await writeFile(
      join(root, "carapace.claw.json"),
      JSON.stringify({ schemaVersion: 1, agent: { id: "triage" } }),
      "utf8",
    );
    await writeFile(
      join(root, "profiles", "carapace.yml"),
      "schemaVersion: 1\nagent:\n  tools:\n    profile: full\n",
      "utf8",
    );

    const result = await readClawManifestFile(join(root, "carapace.claw.json"), {
      allowLegacyDynamicToolProfile: true,
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          message: expect.stringContaining("bounded explicit allowlist"),
        }),
      ],
    });
  });

  it("rejects a hardlinked profile", async () => {
    const root = tempDirs.make("carapace-claw-profile-hardlink-");
    await mkdir(join(root, "profiles"));
    await writeFile(
      join(root, "carapace.claw.json"),
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "triage" },
      }),
      "utf8",
    );
    const source = join(root, "source.yml");
    await writeFile(source, "schemaVersion: 1\nagent: {}\n", "utf8");
    await link(source, join(root, "profiles", "carapace.yml"));

    const result = await readClawManifestFile(join(root, "carapace.claw.json"));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "carapace_profile_unsafe" })],
    });
  });
  it("rejects a symlinked profile at the read boundary", async () => {
    const root = tempDirs.make("carapace-claw-profile-symlink-");
    await mkdir(join(root, "profiles"));
    const path = join(root, "carapace.claw.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "triage" },
      }),
      "utf8",
    );
    await writeFile(join(root, "source.yml"), "schemaVersion: 1\nagent: {}\n", "utf8");
    await symlink("../source.yml", join(root, "profiles", "carapace.yml"));

    const result = await readClawManifestFile(path);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "carapace_profile_unsafe" })],
    });
  });

  it("fails closed for an escaping metadata profile pointer", async () => {
    const root = tempDirs.make("carapace-claw-profile-pointer-");
    const path = join(root, "carapace.claw.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "triage" },
        metadata: { "carapace.config": "../carapace.yml" },
      }),
      "utf8",
    );
    await writeFile(join(root, "carapace.yml"), "schemaVersion: 1\nagent: {}\n", "utf8");

    const result = await readClawManifestFile(path);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "invalid_carapace_profile_path",
          path: "$.metadata.carapace.config",
        }),
      ],
    });
  });

  it("still reads the deprecated metadata profile pointer with a warning", async () => {
    const root = tempDirs.make("carapace-claw-profile-legacy-pointer-");
    await mkdir(join(root, "profiles"));
    const path = join(root, "carapace.claw.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "triage" },
        metadata: { "carapace.config": "profiles/triage.carapace.yml" },
      }),
      "utf8",
    );
    await writeFile(
      join(root, "profiles", "triage.carapace.yml"),
      "schemaVersion: 1\nagent:\n  tools:\n    profile: coding\n    allow: [read]\n",
      "utf8",
    );

    const result = await readClawManifestFile(path);

    expect(result).toMatchObject({
      ok: true,
      carapaceProfile: {
        schemaVersion: 1,
        agent: { tools: { profile: "coding", allow: ["read"] } },
      },
    });
    if (!result.ok) {
      throw new Error("expected the deprecated pointer to keep resolving");
    }
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: "warning",
        code: "deprecated_carapace_profile_pointer",
        path: "$.metadata.carapace.config",
      }),
    );
    expect(result.diagnostics.some((entry) => entry.level === "error")).toBe(false);
  });

  it("accepts a deprecated pointer that already targets the conventional profile", async () => {
    const root = tempDirs.make("carapace-claw-profile-legacy-conventional-");
    await mkdir(join(root, "profiles"));
    const path = join(root, "carapace.claw.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "triage" },
        metadata: { "carapace.config": "profiles/carapace.yml" },
      }),
      "utf8",
    );
    await writeFile(
      join(root, "profiles", "carapace.yml"),
      "schemaVersion: 1\nagent:\n  tools:\n    profile: coding\n    allow: [read]\n",
      "utf8",
    );

    const result = await readClawManifestFile(path);

    expect(result).toMatchObject({ ok: true, carapaceProfile: { schemaVersion: 1 } });
  });

  it("fails closed when a deprecated pointer diverges from the conventional profile", async () => {
    const root = tempDirs.make("carapace-claw-profile-conflict-");
    await mkdir(join(root, "profiles"));
    const path = join(root, "carapace.claw.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        agent: { id: "triage" },
        metadata: { "carapace.config": "profiles/other.carapace.yml" },
      }),
      "utf8",
    );
    await writeFile(join(root, "profiles", "carapace.yml"), "schemaVersion: 1\n", "utf8");
    await writeFile(join(root, "profiles", "other.carapace.yml"), "schemaVersion: 1\n", "utf8");

    const result = await readClawManifestFile(path);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: "conflicting_carapace_profile_pointer",
          path: "$.metadata.carapace.config",
        }),
      ],
    });
  });

  it("keeps the shipped pointer-based fixtures resolvable", async () => {
    const result = await readClawManifestFile("src/claws/fixtures/incident-response.claw.json");

    expect(result).toMatchObject({
      ok: true,
      carapaceProfile: { schemaVersion: 1, agent: { tools: { deny: ["exec", "browser"] } } },
    });
    if (!result.ok) {
      throw new Error("expected the shipped fixture to remain valid");
    }
    expect(result.diagnostics.some((entry) => entry.level === "error")).toBe(false);
  });

  it("does not inspect profiles owned by other harnesses", async () => {
    const root = tempDirs.make("carapace-claw-foreign-profile-");
    await mkdir(join(root, "profiles"));
    const path = join(root, "carapace.claw.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, agent: { id: "triage" } }), "utf8");
    await writeFile(join(root, "profiles", "codex.yml"), Buffer.alloc(300 * 1024, "x"));

    const result = await readClawManifestFile(path);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error("expected foreign profile to remain opaque");
    }
    expect(result.carapaceProfile).toBeUndefined();
  });
});
