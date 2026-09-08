// Workspace default tests cover environment-variable precedence for the
// built-in agent workspace location.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withEnv } from "../test-utils/env.js";
import { resolveDefaultAgentWorkspaceDir } from "./workspace.js";

describe("DEFAULT_AGENT_WORKSPACE_DIR", () => {
  it("uses CARAPACE_HOME when resolving the default workspace dir", () => {
    const home = path.join(path.sep, "srv", "carapace-home");

    const resolved = withEnv(
      {
        CARAPACE_WORKSPACE_DIR: undefined,
        CARAPACE_PROFILE: undefined,
        CARAPACE_HOME: home,
        HOME: path.join(path.sep, "home", "other"),
      },
      () => resolveDefaultAgentWorkspaceDir(),
    );

    expect(resolved).toBe(path.join(path.resolve(home), ".carapace", "workspace"));
  });

  it("uses CARAPACE_WORKSPACE_DIR before CARAPACE_HOME", () => {
    const workspaceDir = path.join(path.sep, "srv", "carapace-workspace");

    const resolved = withEnv(
      {
        CARAPACE_WORKSPACE_DIR: workspaceDir,
        CARAPACE_HOME: path.join(path.sep, "srv", "carapace-home"),
      },
      () => resolveDefaultAgentWorkspaceDir(),
    );

    expect(resolved).toBe(path.resolve(workspaceDir));
  });
});
