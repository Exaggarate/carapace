import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, onTestFinished } from "vitest";
import { getRegistryWorktree } from "../../agents/worktrees/registry.js";
import { managedWorktrees } from "../../agents/worktrees/service.js";
import { closeCarapaceStateDatabaseForTest } from "../../state/carapace-state-db.js";
import { createCarapaceTestState } from "../../test-utils/carapace-test-state.js";
import { testState } from "../test-helpers.js";
import {
  directSessionReq,
  seedLinearSessionTranscript,
  setupGatewaySessionsHandlerTestHarness,
} from "./server-sessions.test-helpers.js";

const execFileAsync = promisify(execFile);

export async function initializeRemoteBackedGitWorkspace(root: string): Promise<string> {
  const workspace = path.join(root, "workspace");
  const remote = path.join(root, "remote.git");
  await fs.mkdir(workspace, { recursive: true });
  await execFileAsync("git", ["-C", workspace, "init", "-b", "main"]);
  await execFileAsync("git", ["-C", workspace, "config", "user.name", "Carapace Test"]);
  await execFileAsync("git", [
    "-C",
    workspace,
    "config",
    "user.email",
    "carapace-test@example.invalid",
  ]);
  await fs.writeFile(path.join(workspace, "README.md"), "base\n");
  await execFileAsync("git", ["-C", workspace, "add", "README.md"]);
  await execFileAsync("git", ["-C", workspace, "commit", "-m", "initial"]);
  await execFileAsync("git", ["clone", "--bare", workspace, remote]);
  await execFileAsync("git", ["-C", workspace, "remote", "add", "origin", remote]);
  await execFileAsync("git", ["-C", workspace, "push", "-u", "origin", "main"]);
  return await fs.realpath(workspace);
}

export function setupGatewaySessionsWorktreeTestHarness() {
  const { createSessionStoreDir } = setupGatewaySessionsHandlerTestHarness();

  async function createArchiveWorktreeFixture() {
    const state = await createCarapaceTestState({
      layout: "state-only",
      prefix: "carapace-archive-worktree-",
    });
    const workspace = await initializeRemoteBackedGitWorkspace(state.root);
    closeCarapaceStateDatabaseForTest();
    testState.agentConfig = { workspace };
    const { storePath } = await createSessionStoreDir();
    const created = await directSessionReq<{
      key: string;
      sessionId: string;
      worktree: { id: string; path: string; branch: string };
    }>(
      "sessions.create",
      { agentId: "main", worktree: true },
      { client: { connect: { scopes: ["operator.admin"] } } as never },
    );
    const worktreeId = created.payload?.worktree.id;
    onTestFinished(async () => {
      const record = worktreeId ? getRegistryWorktree(process.env, worktreeId) : undefined;
      if (record && record.removedAt === undefined) {
        await managedWorktrees.remove({
          id: record.id,
          reason: "test-cleanup",
          allowSnapshotLoss: true,
        });
      }
      closeCarapaceStateDatabaseForTest();
      testState.agentConfig = undefined;
      await state.cleanup();
    });
    expect(created.ok).toBe(true);
    const { key, sessionId, worktree } = created.payload!;
    const transcriptScope = { storePath, sessionKey: key, sessionId };
    await seedLinearSessionTranscript({
      ...transcriptScope,
      contents: ["Preserve this conversation."],
    });
    return { key, sessionId, storePath, transcriptScope, worktree, workspace };
  }

  return { createSessionStoreDir, createArchiveWorktreeFixture };
}
