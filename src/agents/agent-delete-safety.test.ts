import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { openCarapaceAgentDatabase } from "../state/carapace-agent-db.js";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { assertAgentSessionStoreDeletionSafe } from "./agent-delete-databases.js";
import { findOverlappingWorkspaceAgentIds, isSharedAuthStoreOwner } from "./agent-delete-safety.js";

describe("shared session store deletion safety", () => {
  it.each(["absent", "survivor-owned", "per-agent"])(
    "allows deletion with an %s session store",
    async (kind) => {
      await withStateDirEnv("carapace-agent-delete-session-owner-", async ({ stateDir }) => {
        const sharedPath = path.join(stateDir, "shared.sqlite");
        const cfg: CarapaceConfig = {
          agents: { ownership: "explicit", entries: { alpha: {}, ops: {} } },
          session: {
            store:
              kind === "per-agent"
                ? path.join(stateDir, "agents", "{agentId}", "agent", "carapace-agent.sqlite")
                : sharedPath,
          },
        };
        if (kind === "survivor-owned") {
          openCarapaceAgentDatabase({ agentId: "ops", path: sharedPath });
        } else if (kind === "per-agent") {
          openCarapaceAgentDatabase({ agentId: "alpha" });
        }

        expect(() => assertAgentSessionStoreDeletionSafe(cfg, "alpha")).not.toThrow();
      });
    },
  );
});

describe("shared auth store deletion safety", () => {
  const sharedAuthDbPath = path.join(os.tmpdir(), "shared-auth", "carapace-agent.sqlite");
  const otherAgentAuthDbPath = path.join(os.tmpdir(), "other-auth", "carapace-agent.sqlite");

  it.each([
    {
      name: "blocks the legacy-main database owner",
      ownership: { location: "legacy-main" } as const,
      agentAuthDbPath: sharedAuthDbPath,
      expected: true,
    },
    {
      name: "allows a non-owner agent database",
      ownership: { location: "legacy-main" } as const,
      agentAuthDbPath: otherAgentAuthDbPath,
      expected: false,
    },
    {
      name: "follows state-db ownership instead of a legacy-main path match",
      ownership: { location: "state-db" } as const,
      agentAuthDbPath: sharedAuthDbPath,
      expected: false,
    },
  ])("$name", ({ ownership, agentAuthDbPath, expected }) => {
    expect(isSharedAuthStoreOwner({ ownership, agentAuthDbPath, sharedAuthDbPath })).toBe(expected);
  });
});

describe("shared workspace deletion safety", () => {
  it("detects another agent behind a dangling workspace symlink", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "carapace-agent-delete-alias-"));
    const workspaceDir = path.join(rootDir, "vanished-workspace");
    const workspaceAliasDir = path.join(rootDir, "workspace-alias");
    try {
      fs.symlinkSync(
        workspaceDir,
        workspaceAliasDir,
        process.platform === "win32" ? "junction" : "dir",
      );
      const config: CarapaceConfig = {
        agents: {
          list: [
            { id: "alpha", workspace: workspaceAliasDir },
            { id: "beta", workspace: workspaceDir },
          ],
        },
      };

      expect(findOverlappingWorkspaceAgentIds(config, "alpha", workspaceAliasDir)).toEqual([
        "beta",
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
