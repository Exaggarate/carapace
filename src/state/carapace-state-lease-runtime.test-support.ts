// Compile once per test invocation so process-exit proof uses packaged worker startup.
export const stateLeaseProcessExitRuntimeEntrypoint = {
  currentModuleUrl: import.meta.url,
  sourceWorkerName: "carapace-state-lease-process-exit-child.test-support",
  distWorkerPath: "state/carapace-state-lease-process-exit-child.test-support.js",
} as const;

export const agentDatabaseHeldRuntimeEntrypoint = {
  currentModuleUrl: import.meta.url,
  sourceWorkerName: "carapace-agent-db-held-child.test-support",
  distWorkerPath: "state/carapace-agent-db-held-child.test-support.js",
} as const;
