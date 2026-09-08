import { ROOT_CONTEXT, SpanStatusCode } from "@opentelemetry/api";
import {
  isInternalDiagnosticEventMetadata,
  normalizeDiagnosticValue,
} from "carapace/plugin-sdk/diagnostic-runtime";
import { redactSensitiveText } from "../api.js";
import type { DiagnosticEventMetadata, DiagnosticEventPayload } from "../api.js";
import { positiveFiniteNumber } from "./service-genai-attributes.js";
import {
  assignOtelToolContentAttributes,
  assignOtelToolIdentityAttributes,
} from "./service-genai-content.js";
import type { OtelToolCallContent } from "./service-genai-content.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { TelemetryExporterDiagnosticEvent } from "./service-types.js";

export function createToolAndSystemRecorders(runtime: DiagnosticsRecorderRuntime) {
  const {
    gcDurationHistogram,
    gatewayEventLoopDelayMaxHistogram,
    gatewayEventLoopObservedCounter,
    queueDepthHistogram,
    skillUsedCounter,
    toolExecutionDurationHistogram,
    toolExecutionBlockedCounter,
    execProcessDurationHistogram,
    payloadLargeCounter,
    payloadLargeBytesHistogram,
    livenessWarningCounter,
    livenessEventLoopDelayP99Histogram,
    livenessEventLoopDelayMaxHistogram,
    livenessEventLoopUtilizationHistogram,
    livenessCpuCoreRatioHistogram,
    telemetryExporterCounter,
    spanWithDuration,
    activeTrustedParentContext,
    exportedInternalOrTrustedContext,
    trackTrustedSpan,
    getTrackedInternalOrTrustedSpan,
    takeTrackedTrustedSpan,
    setSpanAttrs,
    addRunAttrs,
    paramsSummaryAttrs,
    contentCapturePolicy,
    tracesEnabled,
  } = runtime;

  const toolExecutionBaseAttrs = (
    evt: Extract<
      DiagnosticEventPayload,
      {
        type:
          | "tool.execution.started"
          | "tool.execution.completed"
          | "tool.execution.error"
          | "tool.execution.blocked";
      }
    >,
  ): Record<string, string | number | boolean> => ({
    "carapace.toolName": evt.toolName,
    "carapace.tool.source": normalizeDiagnosticValue(evt.toolSource, "core"),
    "gen_ai.tool.name": evt.toolName,
    ...(evt.toolOwner ? { "carapace.tool.owner": normalizeDiagnosticValue(evt.toolOwner) } : {}),
    ...paramsSummaryAttrs(evt.paramsSummary),
  });
  const toolTimestampMs = (evt: { sourceTimestampMs?: number; ts: number }) =>
    evt.sourceTimestampMs ?? evt.ts;

  const skillUsedAttrs = (
    evt: Extract<DiagnosticEventPayload, { type: "skill.used" }>,
  ): Record<string, string | number | boolean> => ({
    "carapace.skill.name": normalizeDiagnosticValue(evt.skillName, "skill"),
    "carapace.skill.source": normalizeDiagnosticValue(evt.skillSource),
    "carapace.skill.activation": normalizeDiagnosticValue(evt.activation),
    ...(evt.agentId ? { "carapace.agent": normalizeDiagnosticValue(evt.agentId) } : {}),
    ...(evt.toolName
      ? { "carapace.toolName": normalizeDiagnosticValue(evt.toolName, "tool") }
      : {}),
  });

  const recordSkillUsed = (
    evt: Extract<DiagnosticEventPayload, { type: "skill.used" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!metadata.trusted) {
      return;
    }
    const attrs = skillUsedAttrs(evt);
    skillUsedCounter.add(1, attrs);
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = { ...attrs };
    addRunAttrs(spanAttrs, evt);
    const span = spanWithDuration("carapace.skill.used", spanAttrs, 0, {
      parentContext: activeTrustedParentContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    setSpanAttrs(span, spanAttrs);
    span.end(evt.ts);
  };

  const recordToolExecutionStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "tool.execution.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled || !metadata.trusted) {
      return undefined;
    }
    const trackedSpan = getTrackedInternalOrTrustedSpan(evt, metadata);
    if (trackedSpan) {
      return trackedSpan.spanContext();
    }
    const spanAttrs = toolExecutionBaseAttrs(evt);
    assignOtelToolIdentityAttributes(spanAttrs, evt);
    return trackTrustedSpan(
      evt,
      metadata,
      spanWithDuration("carapace.tool.execution", spanAttrs, undefined, {
        parentContext: activeTrustedParentContext(evt, metadata),
        startTimeMs: toolTimestampMs(evt),
      }),
    ).spanContext();
  };

  const recordToolExecutionFinished = (
    evt: Extract<
      DiagnosticEventPayload,
      { type: "tool.execution.completed" | "tool.execution.error" }
    >,
    metadata: DiagnosticEventMetadata,
    toolContent?: OtelToolCallContent,
  ) => {
    const attrs = toolExecutionBaseAttrs(evt);
    if (evt.type === "tool.execution.error") {
      attrs["carapace.errorCategory"] = normalizeDiagnosticValue(evt.errorCategory, "other");
    }
    toolExecutionDurationHistogram.record(evt.durationMs, attrs);
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = { ...attrs };
    addRunAttrs(spanAttrs, evt);
    assignOtelToolIdentityAttributes(spanAttrs, evt);
    if (evt.type === "tool.execution.error" && evt.errorCode) {
      spanAttrs["carapace.errorCode"] = normalizeDiagnosticValue(evt.errorCode, "other");
    }
    assignOtelToolContentAttributes(spanAttrs, toolContent, contentCapturePolicy);
    const span =
      takeTrackedTrustedSpan(evt, metadata) ??
      spanWithDuration("carapace.tool.execution", spanAttrs, evt.durationMs, {
        parentContext: activeTrustedParentContext(evt, metadata),
        endTimeMs: toolTimestampMs(evt),
      });
    setSpanAttrs(span, spanAttrs);
    if (evt.type === "tool.execution.error") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: redactSensitiveText(evt.errorCategory),
      });
    }
    span.end(toolTimestampMs(evt));
  };

  const recordToolExecutionBlocked = (
    evt: Extract<DiagnosticEventPayload, { type: "tool.execution.blocked" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    toolExecutionBlockedCounter.add(1, {
      ...toolExecutionBaseAttrs(evt),
      "carapace.deniedReason": normalizeDiagnosticValue(evt.deniedReason, "other"),
    });
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      ...toolExecutionBaseAttrs(evt),
      "carapace.outcome": "blocked",
      "carapace.deniedReason": normalizeDiagnosticValue(evt.deniedReason, "other"),
    };
    addRunAttrs(spanAttrs, evt);
    assignOtelToolIdentityAttributes(spanAttrs, evt);
    const span =
      takeTrackedTrustedSpan(evt, metadata) ??
      spanWithDuration("carapace.tool.execution", spanAttrs, 0, {
        parentContext: activeTrustedParentContext(evt, metadata),
        endTimeMs: toolTimestampMs(evt),
      });
    setSpanAttrs(span, spanAttrs);
    span.end(toolTimestampMs(evt));
  };

  const recordPayloadLarge = (evt: Extract<DiagnosticEventPayload, { type: "payload.large" }>) => {
    const attrs = {
      "carapace.payload.action": evt.action,
      "carapace.payload.surface": normalizeDiagnosticValue(evt.surface, "unknown"),
      "carapace.channel": normalizeDiagnosticValue(evt.channel, "none"),
      "carapace.plugin": normalizeDiagnosticValue(evt.pluginId, "none"),
      "carapace.reason": normalizeDiagnosticValue(evt.reason, "none"),
    };
    payloadLargeCounter.add(1, attrs);
    const bytes = positiveFiniteNumber(evt.bytes);
    if (bytes !== undefined) {
      payloadLargeBytesHistogram.record(bytes, attrs);
    }
  };

  const recordExecProcessCompleted = (
    evt: Extract<DiagnosticEventPayload, { type: "exec.process.completed" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs: Record<string, string | number> = {
      "carapace.exec.target": evt.target,
      "carapace.exec.mode": evt.mode,
      "carapace.outcome": evt.outcome,
    };
    if (evt.failureKind) {
      attrs["carapace.failureKind"] = evt.failureKind;
    }
    execProcessDurationHistogram.record(evt.durationMs, attrs);
    if (!tracesEnabled) {
      return;
    }

    const spanAttrs: Record<string, string | number | boolean> = {
      ...attrs,
      "carapace.exec.command_length": evt.commandLength,
    };
    if (typeof evt.exitCode === "number") {
      spanAttrs["carapace.exec.exit_code"] = evt.exitCode;
    }
    if (evt.exitSignal) {
      spanAttrs["carapace.exec.exit_signal"] = normalizeDiagnosticValue(evt.exitSignal, "other");
    }
    if (evt.timedOut !== undefined) {
      spanAttrs["carapace.exec.timed_out"] = evt.timedOut;
    }

    // Exec events carry the innermost ambient scope rather than a child context, so
    // the parent is looked up by the event's own span id first. For the carapace
    // harness that scope is the harness run (no run scope is opened -
    // shouldEmitAgentRunDiagnostics is false there), so the parent is
    // carapace.harness.run; other harnesses open a run scope and parent to carapace.run.
    const span = spanWithDuration("carapace.exec", spanAttrs, evt.durationMs, {
      parentContext: exportedInternalOrTrustedContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    if (evt.outcome === "failed") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        ...(evt.failureKind ? { message: evt.failureKind } : {}),
      });
    }
    span.end(evt.ts);
  };

  const recordGcDuration = (
    evt: Extract<DiagnosticEventPayload, { type: "diagnostic.gc" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!metadata.trusted && !isInternalDiagnosticEventMetadata(metadata)) {
      return;
    }
    gcDurationHistogram.record(evt.durationMs, undefined, ROOT_CONTEXT);
  };

  const recordGatewayEventLoopSample = (
    evt: Extract<DiagnosticEventPayload, { type: "gateway.event_loop.sample" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!metadata.trusted && !isInternalDiagnosticEventMetadata(metadata)) {
      return;
    }
    // Process-wide windows must not inherit the reader's trace through an external SDK.
    gatewayEventLoopDelayMaxHistogram.record(evt.delayMaxMs, undefined, ROOT_CONTEXT);
    gatewayEventLoopObservedCounter.add(evt.intervalMs, undefined, ROOT_CONTEXT);
  };

  const recordHeartbeat = (
    evt: Extract<DiagnosticEventPayload, { type: "diagnostic.heartbeat" }>,
  ) => {
    queueDepthHistogram.record(evt.queued, { "carapace.channel": "heartbeat" });
  };

  const recordLivenessWarning = (
    evt: Extract<DiagnosticEventPayload, { type: "diagnostic.liveness.warning" }>,
  ) => {
    const reason = evt.reasons.join(":");
    const attrs = {
      "carapace.liveness.reason": normalizeDiagnosticValue(reason, "unknown"),
    };
    livenessWarningCounter.add(1, attrs);
    queueDepthHistogram.record(evt.queued, { "carapace.channel": "liveness" });
    if (evt.eventLoopDelayP99Ms !== undefined) {
      livenessEventLoopDelayP99Histogram.record(evt.eventLoopDelayP99Ms, attrs);
    }
    if (evt.eventLoopDelayMaxMs !== undefined) {
      livenessEventLoopDelayMaxHistogram.record(evt.eventLoopDelayMaxMs, attrs);
    }
    if (evt.eventLoopUtilization !== undefined) {
      livenessEventLoopUtilizationHistogram.record(evt.eventLoopUtilization, attrs);
    }
    if (evt.cpuCoreRatio !== undefined) {
      livenessCpuCoreRatioHistogram.record(evt.cpuCoreRatio, attrs);
    }
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number> = {
      ...attrs,
      "carapace.liveness.active": evt.active,
      "carapace.liveness.waiting": evt.waiting,
      "carapace.liveness.queued": evt.queued,
      "carapace.liveness.interval_ms": evt.intervalMs,
      ...(evt.eventLoopDelayP99Ms !== undefined
        ? { "carapace.liveness.event_loop_delay_p99_ms": evt.eventLoopDelayP99Ms }
        : {}),
      ...(evt.eventLoopDelayMaxMs !== undefined
        ? { "carapace.liveness.event_loop_delay_max_ms": evt.eventLoopDelayMaxMs }
        : {}),
      ...(evt.eventLoopUtilization !== undefined
        ? { "carapace.liveness.event_loop_utilization": evt.eventLoopUtilization }
        : {}),
      ...(evt.cpuUserMs !== undefined ? { "carapace.liveness.cpu_user_ms": evt.cpuUserMs } : {}),
      ...(evt.cpuSystemMs !== undefined
        ? { "carapace.liveness.cpu_system_ms": evt.cpuSystemMs }
        : {}),
      ...(evt.cpuTotalMs !== undefined ? { "carapace.liveness.cpu_total_ms": evt.cpuTotalMs } : {}),
      ...(evt.cpuCoreRatio !== undefined
        ? { "carapace.liveness.cpu_core_ratio": evt.cpuCoreRatio }
        : {}),
    };
    const span = spanWithDuration("carapace.liveness.warning", spanAttrs, 0, {
      endTimeMs: evt.ts,
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: reason,
    });
    span.end(evt.ts);
  };

  const recordDiagnosticPhaseCompleted = (
    evt: Extract<DiagnosticEventPayload, { type: "diagnostic.phase.completed" }>,
  ) => {
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number> = {
      "carapace.phase": normalizeDiagnosticValue(evt.name, "unknown"),
      ...(evt.cpuUserMs !== undefined ? { "carapace.phase.cpu_user_ms": evt.cpuUserMs } : {}),
      ...(evt.cpuSystemMs !== undefined ? { "carapace.phase.cpu_system_ms": evt.cpuSystemMs } : {}),
      ...(evt.cpuTotalMs !== undefined ? { "carapace.phase.cpu_total_ms": evt.cpuTotalMs } : {}),
      ...(evt.cpuCoreRatio !== undefined
        ? { "carapace.phase.cpu_core_ratio": evt.cpuCoreRatio }
        : {}),
    };
    for (const [key, value] of Object.entries(evt.details ?? {})) {
      spanAttrs[`carapace.phase.detail.${key}`] =
        typeof value === "boolean" ? String(value) : value;
    }
    const span = spanWithDuration("carapace.diagnostic.phase", spanAttrs, evt.durationMs, {
      endTimeMs: evt.ts,
    });
    span.end(evt.ts);
  };

  const recordTelemetryExporter = (
    evt: TelemetryExporterDiagnosticEvent,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!metadata.trusted) {
      return;
    }
    telemetryExporterCounter.add(1, {
      "carapace.exporter": normalizeDiagnosticValue(evt.exporter, "unknown"),
      "carapace.signal": evt.signal,
      "carapace.status": evt.status,
      ...(evt.reason ? { "carapace.reason": evt.reason } : {}),
      ...(evt.errorCategory
        ? { "carapace.errorCategory": normalizeDiagnosticValue(evt.errorCategory, "other") }
        : {}),
    });
  };

  return {
    recordGcDuration,
    recordGatewayEventLoopSample,
    recordSkillUsed,
    recordToolExecutionStarted,
    recordToolExecutionFinished,
    recordToolExecutionBlocked,
    recordPayloadLarge,
    recordExecProcessCompleted,
    recordHeartbeat,
    recordLivenessWarning,
    recordDiagnosticPhaseCompleted,
    recordTelemetryExporter,
  };
}
