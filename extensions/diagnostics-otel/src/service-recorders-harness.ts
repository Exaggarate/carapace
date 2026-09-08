import { SpanStatusCode } from "@opentelemetry/api";
import {
  normalizeDiagnosticValue,
  normalizeDiagnosticLane,
} from "carapace/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
  DiagnosticEventPrivateData,
} from "../api.js";
import { normalizeOtelErrorMessage } from "./service-content-normalization.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { HarnessRunDiagnosticEvent, ModelFailoverDiagnosticEvent } from "./service-types.js";

export function createHarnessRecorders(runtime: DiagnosticsRecorderRuntime) {
  const {
    harnessDurationHistogram,
    modelFailoverCounter,
    activeTrustedSpans,
    spanWithDuration,
    trustedTraceContext,
    activeTrustedParentContext,
    trackTrustedSpan,
    setSpanAttrs,
    completeTrackedLifecycleSpan,
    addRunAttrs,
    tracesEnabled,
  } = runtime;

  const harnessRunMetricAttrs = (evt: HarnessRunDiagnosticEvent) => ({
    "carapace.harness.id": normalizeDiagnosticValue(evt.harnessId, "unknown"),
    "carapace.harness.plugin": normalizeDiagnosticValue(evt.pluginId),
    ...(evt.type === "harness.run.started"
      ? {}
      : {
          "carapace.outcome": evt.type === "harness.run.error" ? "error" : evt.outcome,
        }),
    "carapace.provider": normalizeDiagnosticValue(evt.provider, "unknown"),
    "carapace.model": normalizeDiagnosticValue(evt.model, "unknown"),
    ...(evt.channel ? { "carapace.channel": normalizeDiagnosticValue(evt.channel) } : {}),
  });

  const recordHarnessRunStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "harness.run.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled || !metadata.trusted) {
      return;
    }
    trackTrustedSpan(
      evt,
      metadata,
      spanWithDuration("carapace.harness.run", harnessRunMetricAttrs(evt), undefined, {
        parentContext: activeTrustedParentContext(evt, metadata),
        startTimeMs: evt.ts,
      }),
    );
  };

  const recordHarnessRunCompleted = (
    evt: Extract<DiagnosticEventPayload, { type: "harness.run.completed" }>,
    metadata: DiagnosticEventMetadata,
    privateData: DiagnosticEventPrivateData,
  ) => {
    harnessDurationHistogram.record(evt.durationMs, harnessRunMetricAttrs(evt));
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      ...harnessRunMetricAttrs(evt),
    };
    if (evt.resultClassification) {
      spanAttrs["carapace.harness.result_classification"] = normalizeDiagnosticValue(
        evt.resultClassification,
      );
    }
    if (typeof evt.yieldDetected === "boolean") {
      spanAttrs["carapace.harness.yield_detected"] = evt.yieldDetected;
    }
    if (evt.itemLifecycle) {
      spanAttrs["carapace.harness.items.started"] = evt.itemLifecycle.startedCount;
      spanAttrs["carapace.harness.items.completed"] = evt.itemLifecycle.completedCount;
      spanAttrs["carapace.harness.items.active"] = evt.itemLifecycle.activeCount;
    }
    // Redacted message goes on the span only, never the low-cardinality metric attrs.
    const redactedError = normalizeOtelErrorMessage(privateData.errorMessage);
    if (redactedError) {
      spanAttrs["carapace.error"] = redactedError;
    }
    const trustedTrace = trustedTraceContext(evt, metadata);
    const trackedSpan = trustedTrace?.spanId
      ? activeTrustedSpans.get(trustedTrace.spanId)
      : undefined;
    const span =
      trackedSpan ??
      spanWithDuration("carapace.harness.run", spanAttrs, evt.durationMs, {
        parentContext: activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    setSpanAttrs(span, spanAttrs);
    if (evt.outcome === "error") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: redactedError ?? "error",
      });
    }
    if (trackedSpan && trustedTrace?.spanId) {
      completeTrackedLifecycleSpan(trustedTrace, trackedSpan, evt.ts);
      return;
    }
    span.end(evt.ts);
  };

  const recordHarnessRunError = (
    evt: Extract<DiagnosticEventPayload, { type: "harness.run.error" }>,
    metadata: DiagnosticEventMetadata,
    privateData: DiagnosticEventPrivateData,
  ) => {
    const errorType = normalizeDiagnosticValue(evt.errorCategory, "other");
    const attrs = {
      ...harnessRunMetricAttrs(evt),
      "carapace.harness.phase": evt.phase,
      "carapace.errorCategory": errorType,
    };
    harnessDurationHistogram.record(evt.durationMs, attrs);
    if (!tracesEnabled) {
      return;
    }
    // Redacted message goes on the span only; attrs above feed the metric.
    const redactedError = normalizeOtelErrorMessage(privateData.errorMessage);
    const spanAttrs: Record<string, string | number | boolean> = {
      ...attrs,
      "error.type": errorType,
      ...(redactedError ? { "carapace.error": redactedError } : {}),
      ...(evt.cleanupFailed ? { "carapace.harness.cleanup_failed": true } : {}),
    };
    const trustedTrace = trustedTraceContext(evt, metadata);
    const trackedSpan = trustedTrace?.spanId
      ? activeTrustedSpans.get(trustedTrace.spanId)
      : undefined;
    const span =
      trackedSpan ??
      spanWithDuration("carapace.harness.run", spanAttrs, evt.durationMs, {
        parentContext: activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    setSpanAttrs(span, spanAttrs);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: redactedError ?? errorType,
    });
    // Retain on the error path too: for the carapace harness this span is the only
    // ancestor a late child can attach to, and aborted turns emit no run.completed.
    if (trackedSpan && trustedTrace?.spanId) {
      completeTrackedLifecycleSpan(trustedTrace, trackedSpan, evt.ts);
      return;
    }
    span.end(evt.ts);
  };

  const recordContextAssembled = (
    evt: Extract<DiagnosticEventPayload, { type: "context.assembled" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      "carapace.context.message_count": evt.messageCount,
      "carapace.context.history_text_chars": evt.historyTextChars,
      "carapace.context.history_image_blocks": evt.historyImageBlocks,
      "carapace.context.max_message_text_chars": evt.maxMessageTextChars,
      "carapace.context.system_prompt_chars": evt.systemPromptChars,
      "carapace.context.prompt_chars": evt.promptChars,
      "carapace.context.prompt_images": evt.promptImages,
    };
    addRunAttrs(spanAttrs, evt);
    if (evt.contextTokenBudget !== undefined) {
      spanAttrs["carapace.context.token_budget"] = evt.contextTokenBudget;
    }
    if (evt.reserveTokens !== undefined) {
      spanAttrs["carapace.context.reserve_tokens"] = evt.reserveTokens;
    }
    const span = spanWithDuration("carapace.context.assembled", spanAttrs, 0, {
      parentContext: activeTrustedParentContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    span.end(evt.ts);
  };

  const recordModelFailover = (
    evt: ModelFailoverDiagnosticEvent,
    metadata: DiagnosticEventMetadata,
  ) => {
    const metricAttrs: Record<string, string> = {
      "carapace.failover.reason": normalizeDiagnosticValue(evt.reason, "unknown"),
      "carapace.failover.suspended":
        evt.suspended === undefined ? "unknown" : String(evt.suspended),
      "carapace.lane": normalizeDiagnosticLane(evt.lane, "unknown"),
      "carapace.model": normalizeDiagnosticValue(evt.fromModel),
      "carapace.provider": normalizeDiagnosticValue(evt.fromProvider),
      "carapace.failover.to_model": normalizeDiagnosticValue(evt.toModel),
      "carapace.failover.to_provider": normalizeDiagnosticValue(evt.toProvider),
    };
    modelFailoverCounter.add(1, metricAttrs);
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      "carapace.failover.reason": normalizeDiagnosticValue(evt.reason, "unknown"),
    };
    if (evt.fromProvider) {
      spanAttrs["carapace.provider"] = evt.fromProvider;
    }
    if (evt.fromModel) {
      spanAttrs["carapace.model"] = evt.fromModel;
    }
    if (evt.toProvider) {
      spanAttrs["carapace.failover.to_provider"] = evt.toProvider;
    }
    if (evt.toModel) {
      spanAttrs["carapace.failover.to_model"] = evt.toModel;
    }
    if (evt.lane) {
      spanAttrs["carapace.lane"] = normalizeDiagnosticLane(evt.lane, "unknown");
    }
    if (evt.suspended !== undefined) {
      spanAttrs["carapace.failover.suspended"] = evt.suspended;
    }
    if (evt.cascadeDepth !== undefined) {
      spanAttrs["carapace.failover.cascade_depth"] = evt.cascadeDepth;
    }
    const span = spanWithDuration("carapace.model.failover", spanAttrs, 0, {
      parentContext: activeTrustedParentContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    span.end(evt.ts);
  };

  return {
    recordHarnessRunStarted,
    recordHarnessRunCompleted,
    recordHarnessRunError,
    recordContextAssembled,
    recordModelFailover,
  };
}
