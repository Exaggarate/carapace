import path from "node:path";
import { normalizeModuleId } from "vite/module-runner";

// Exact source publications, not a naming convention. Keep symbol and string keys
// distinct; override stores and production singletons have separate lifecycle owners.
const publications: Record<string, string | symbol> = {
  "extensions/google/vertex-adc.ts": Symbol.for("carapace.google.vertexAdcTestApi"),
  "extensions/memory-lancedb/lancedb-runtime.ts": Symbol.for(
    "carapace.memoryLanceDbRuntimeTestApi",
  ),
  "packages/ai/src/transports/openai-responses-transport.ts":
    "carapaceOpenAIResponsesTransportTestApi",
  "src/agents/agent-hooks/compaction-safeguard.ts": Symbol.for(
    "carapace.compactionSafeguardTestApi",
  ),
  "src/agents/agent-tools.before-tool-call.wrapper.ts": Symbol.for(
    "carapace.beforeToolCallBlockedErrorTestApi",
  ),
  "src/agents/apply-patch.ts": Symbol.for("carapace.applyPatchTestApi"),
  "src/agents/auth-profiles/external-auth.ts": Symbol.for("carapace.externalAuthTestApi"),
  "src/agents/auth-profiles/oauth.ts": Symbol.for("carapace.oauthTestApi"),
  "src/agents/auth-profiles/runtime-snapshots.ts": Symbol.for(
    "carapace.runtimeAuthSnapshotsTestApi",
  ),
  "src/agents/auth-profiles/store.ts": Symbol.for("carapace.authProfileStoreTestApi"),
  "src/agents/auth-profiles/usage.ts": Symbol.for("carapace.authProfileUsageTestApi"),
  "src/agents/bash-process-registry.ts": Symbol.for("carapace.bashProcessRegistryTestApi"),
  "src/agents/cli-auth-epoch.ts": Symbol.for("carapace.cliAuthEpochTestApi"),
  "src/agents/cli-backends.ts": Symbol.for("carapace.cliBackendsTestApi"),
  "src/agents/cli-credentials.ts": Symbol.for("carapace.cliCredentialsTestApi"),
  "src/agents/cli-runner/prepare.ts": Symbol.for("carapace.cliRunnerPrepareTestApi"),
  "src/agents/command/attempt-execution.helpers.ts": Symbol.for(
    "carapace.attemptExecutionHelpersTestApi",
  ),
  "src/agents/compaction.ts": Symbol.for("carapace.compactionTestApi"),
  "src/agents/embedded-agent-runner/context-engine-maintenance.ts": Symbol.for(
    "carapace.contextEngineMaintenanceTestApi",
  ),
  "src/agents/embedded-agent-runner/extra-params.ts": Symbol.for("carapace.extraParamsTestApi"),
  "src/agents/embedded-agent-runner/runs.ts": Symbol.for("carapace.embeddedRunsTestApi"),
  "src/agents/embedded-agent-tool-media.ts": Symbol.for("carapace.embeddedSubscribeToolsTestApi"),
  "src/agents/mcp-ui-resource.ts": Symbol.for("carapace.mcpUiResourceTestApi"),
  "src/agents/media-generation-task-status-shared.ts": Symbol.for(
    "carapace.mediaGenerationDuplicateGuardTestApi",
  ),
  "src/agents/models-config.plan.ts": Symbol.for("carapace.modelsConfigPlanTestApi"),
  "src/agents/models-config.ts": Symbol.for("carapace.modelsConfigTestApi"),
  "src/agents/prepared-model-runtime.ts": Symbol.for("carapace.preparedModelRuntimeTestApi"),
  "src/agents/session-suspension.ts": Symbol.for("carapace.sessionSuspensionTestApi"),
  "src/agents/sessions/tools/bash.ts": Symbol.for("carapace.bashToolTestApi"),
  "src/agents/subagents/announce/subagent-announce-delivery.ts": Symbol.for(
    "carapace.subagentAnnounceDeliveryTestApi",
  ),
  "src/agents/subagents/announce/subagent-announce-output.ts": Symbol.for(
    "carapace.subagentAnnounceOutputTestApi",
  ),
  "src/agents/subagents/registry/subagent-registry.ts": Symbol.for(
    "carapace.subagentRegistryTestApi",
  ),
  "src/agents/subagents/spawn/subagent-spawn.ts": Symbol.for("carapace.subagentSpawnTestApi"),
  "src/agents/subagents/swarm/swarm-scheduler.ts": Symbol.for("carapace.swarmSchedulerTestApi"),
  "src/agents/tool-search.ts": Symbol.for("carapace.toolSearchTestApi"),
  "src/agents/tools/agent-step.ts": Symbol.for("carapace.agentStepTestApi"),
  "src/agents/tools/ask-user-tool.ts": Symbol.for("carapace.askUserToolTestApi"),
  "src/agents/tools/image-tool.ts": Symbol.for("carapace.imageToolTestApi"),
  "src/agents/tools/model-config.helpers.ts": Symbol.for("carapace.modelConfigHelpersTestApi"),
  "src/agents/tools/web-fetch.ts": Symbol.for("carapace.webFetchTestApi"),
  "src/agents/utils/tools-manager.ts": Symbol.for("carapace.toolsManagerTestApi"),
  "src/agents/workspace-legacy-state.ts": Symbol.for("carapace.workspaceLegacyStateTestApi"),
  "src/agents/worktrees/run-lease.ts": Symbol.for("carapace.worktreeRunLeaseTestApi"),
  "src/auto-reply/reply/agent-runner-session-reset.ts": Symbol.for(
    "carapace.agentRunnerSessionResetTestApi",
  ),
  "src/auto-reply/reply/commands-login.ts": Symbol.for("carapace.commandsLoginTestApi"),
  "src/auto-reply/reply/queue/enqueue.ts": Symbol.for("carapace.queueEnqueueTestApi"),
  "src/auto-reply/reply/reply-run-registry.registry.ts": Symbol.for(
    "carapace.replyRunRegistryTestApi",
  ),
  "src/auto-reply/usage-bar/template.ts": Symbol.for("carapace.usageBarTemplateTestApi"),
  "src/cli/command-secret-gateway.ts": Symbol.for("carapace.commandSecretGatewayTestApi"),
  "src/cli/gateway-cli/run.ts": Symbol.for("carapace.gatewayRunTestApi"),
  "src/commands/doctor-auth-migration-receipts.ts": Symbol.for(
    "carapace.authProfileMigrationReceiptsTestApi",
  ),
  "src/commands/doctor-heartbeat-main-session-repair.ts": Symbol.for(
    "carapace.doctorHeartbeatMainSessionRepairTestApi",
  ),
  "src/commands/doctor-sandbox.ts": Symbol.for("carapace.doctorSandboxTestApi"),
  "src/commands/doctor-session-snapshots.ts": Symbol.for("carapace.doctorSessionSnapshotsTestApi"),
  "src/commands/doctor-whatsapp-responsiveness.ts": Symbol.for(
    "carapace.doctorWhatsappResponsivenessTestApi",
  ),
  "src/commands/doctor/shared/codex-native-assets.ts": Symbol.for(
    "carapace.codexNativeAssetsTestApi",
  ),
  "src/commands/doctor/shared/codex-route-session-repair.ts": Symbol.for(
    "carapace.codexRouteSessionRepairTestApi",
  ),
  "src/commands/doctor/shared/stale-auth-order.ts": Symbol.for("carapace.staleAuthOrderTestApi"),
  "src/commands/doctor/shared/stale-oauth-profile-shadows.ts": Symbol.for(
    "carapace.staleOAuthProfileShadowsTestApi",
  ),
  "src/commands/onboard-non-interactive/local.ts": Symbol.for(
    "carapace.onboardNonInteractiveLocalTestApi",
  ),
  "src/commands/status.command.ts": Symbol.for("carapace.statusCommandTestApi"),
  "src/cron/service/active-run-cancellation.ts": Symbol.for("carapace.activeCronTaskRunTestApi"),
  "src/cron/service/timer.ts": Symbol.for("carapace.cronTimerTestApi"),
  "src/cron/session-reaper.ts": Symbol.for("carapace.cronSessionReaperTestApi"),
  "src/flows/doctor-health-contributions.ts": Symbol.for(
    "carapace.doctorHealthContributionsTestApi",
  ),
  "src/infra/exec-approvals-store.ts": Symbol.for("carapace.execApprovalsStoreTestApi"),
  "src/logging/diagnostic-run-activity.ts": Symbol.for("carapace.diagnosticRunActivityTestApi"),
  "src/logging/diagnostic.ts": Symbol.for("carapace.diagnosticTestApi"),
  "src/logging/secret-redaction-registry.ts": Symbol.for("carapace.secretRedactionRegistryTestApi"),
  "src/media-understanding/runner.ts": Symbol.for("carapace.mediaUnderstandingRunnerTestApi"),
  "src/media/playback-transcode.ts": Symbol.for("carapace.playbackTranscodeTestApi"),
  "src/media/store.ts": Symbol.for("carapace.mediaStoreTestApi"),
  "src/model-catalog/remote-overlay.ts": Symbol.for("carapace.remoteModelCatalogOverlayTestApi"),
  "src/node-host/invoke.ts": Symbol.for("carapace.nodeHostInvokeTestApi"),
  "src/node-host/plugin-node-host.ts": Symbol.for("carapace.nodeHostPluginTestApi"),
  "src/plugin-state/plugin-state-store.sqlite.ts": Symbol.for("carapace.pluginStateSqliteTestApi"),
  "src/plugin-state/plugin-state-store.ts": Symbol.for("carapace.pluginStateStoreTestApi"),
  "src/plugins/memory-runtime.ts": Symbol.for("carapace.memoryRuntimeTestApi"),
  "src/sessions/session-lifecycle-admission.ts": Symbol.for(
    "carapace.sessionLifecycleAdmissionTestApi",
  ),
  "src/sessions/session-upstream-monitor.ts": Symbol.for("carapace.sessionUpstreamMonitorTestApi"),
  "src/sessions/user-turn-transcript.ts": Symbol.for("carapace.userTurnTranscriptTestApi"),
  "src/skills/lifecycle/install.ts": Symbol.for("carapace.skillsInstallTestApi"),
  "src/skills/lifecycle/upload-store.ts": Symbol.for("carapace.skillUploadStoreTestApi"),
  "src/skills/runtime/refresh.ts": Symbol.for("carapace.skillsRefreshTestApi"),
  "src/skills/runtime/remote-skills.ts": Symbol.for("carapace.remoteNodeSkillsTestApi"),
  "src/system-agent/agent-turn.ts": Symbol.for("carapace.systemAgentTurnTestApi"),
  "src/system-agent/assistant-timeout.ts": Symbol.for("carapace.systemAgentTimeoutTestApi"),
  "src/talk/client-voice-confirmation.ts": Symbol.for("carapace.clientVoiceConfirmationTestApi"),
  "src/talk/client-voice-session.ts": Symbol.for("carapace.clientVoiceSessionTestApi"),
  "src/tasks/generated-media-task-activity.ts": Symbol.for(
    "carapace.generatedMediaTaskActivityTestApi",
  ),
  "src/tasks/task-flow-registry.store.ts": Symbol.for("carapace.taskFlowRegistryStoreTestApi"),
  "src/tasks/task-flow-registry.ts": Symbol.for("carapace.taskFlowRegistryTestApi"),
  "src/tasks/task-registry.ts": Symbol.for("carapace.taskRegistryTestApi"),
};

// Vite's EvaluatedModuleNode.file is a normalized, query-free filesystem path.
// Store only paths and keys: this table must never retain published API values.
export const repositoryTestApiPublications: ReadonlyMap<string, string | symbol> = new Map(
  Object.entries(publications).map(([source, key]) => [
    normalizeModuleId(path.resolve(import.meta.dirname, "..", source)),
    key,
  ]),
);
