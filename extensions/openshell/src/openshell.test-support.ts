import type { CreateSandboxBackendParams } from "carapace/plugin-sdk/sandbox";
import {
  createSandboxBrowserConfig,
  createSandboxPruneConfig,
  createSandboxSshConfig,
} from "carapace/plugin-sdk/test-fixtures";

export function createOpenShellBackendSandboxConfig(): CreateSandboxBackendParams["cfg"] {
  return {
    mode: "all",
    backend: "openshell",
    scope: "session",
    workspaceAccess: "rw",
    workspaceRoot: "/tmp/carapace-sandboxes",
    dockerTmpfsSource: "configured",
    docker: {
      image: "carapace-sandbox:bookworm-slim",
      containerPrefix: "carapace-sbx-",
      workdir: "/workspace",
      readOnlyRoot: false,
      tmpfs: [],
      network: "none",
      capDrop: [],
      binds: [],
      env: {},
    },
    ssh: createSandboxSshConfig("/tmp/carapace-sandboxes"),
    browser: createSandboxBrowserConfig(),
    tools: { allow: ["*"], deny: [] },
    prune: createSandboxPruneConfig(),
  };
}

export function createOpenShellRuntimeEntryFixture(runtimeId: string, configLabel = "carapace") {
  return {
    containerName: runtimeId,
    backendId: "openshell",
    runtimeLabel: runtimeId,
    sessionKey: "agent:main",
    createdAtMs: 1,
    lastUsedAtMs: 1,
    image: configLabel,
    configLabelKind: "Source",
  } as const;
}
