import { SpanStatusCode } from "@opentelemetry/api";
import { normalizeDiagnosticValue } from "carapace/plugin-sdk/diagnostic-runtime";
import { redactSensitiveText } from "../api.js";
import type { DiagnosticEventMetadata, DiagnosticEventPayload } from "../api.js";
import {
  assignGenAiSpanIdentityAttrs,
  assignPositiveNumberAttr,
} from "./service-genai-attributes.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { MessageDeliveryDiagnosticEvent, TrustedSpanAliasOwner } from "./service-types.js";

export function createUsageRecorders(runtime: DiagnosticsRecorderRuntime) {
  const {
    tokensCounter,
    genAiTokenUsageHistogram,
    costCounter,
    durationHistogram,
    contextHistogram,
    webhookReceivedCounter,
    webhookErrorCounter,
    webhookDurationHistogram,
    messageQueuedCounter,
    messageReceivedCounter,
    messageDispatchStartedCounter,
    messageDispatchCompletedCounter,
    messageDispatchDurationHistogram,
    messageProcessedCounter,
    messageDurationHistogram,
    messageDeliveryStartedCounter,
    messageDeliveryDurationHistogram,
    queueDepthHistogram,
    tracer,
    activeTrustedSpans,
    activeTrustedSpanAliases,
    trustedSpanAliasKey,
    spanWithDuration,
    trustedTraceContext,
    internalOrTrustedTraceContext,
    internalOrTrustedExplicitParentContext,
    activeTrustedParentContext,
    activeInternalOrTrustedContext,
    trackTrustedSpan,
    trackInternalOrTrustedSpan,
    getTrackedInternalOrTrustedSpan,
    setSpanAttrs,
    completeTrackedLifecycleSpan,
    addRunAttrs,
    tracesEnabled,
  } = runtime;

  const recordModelUsage = (
    evt: Extract<DiagnosticEventPayload, { type: "model.usage" }>,
    metadata: DiagnosticEventMetadata,
    hostPluginId?: string,
  ) => {
    const attrs = {
      "carapace.channel": evt.channel ?? "unknown",
      "carapace.agent": normalizeDiagnosticValue(evt.agentId),
      "carapace.provider": evt.provider ?? "unknown",
      "carapace.model": evt.model ?? "unknown",
    };
    const genAiAttrs: Record<string, string> = {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": normalizeDiagnosticValue(evt.provider),
      "gen_ai.request.model": normalizeDiagnosticValue(evt.model),
    };

    const usage = evt.usage;
    if (usage.input) {
      tokensCounter.add(usage.input, { ...attrs, "carapace.token": "input" });
      genAiTokenUsageHistogram.record(usage.input, {
        ...genAiAttrs,
        "gen_ai.token.type": "input",
      });
    }
    if (usage.output) {
      tokensCounter.add(usage.output, { ...attrs, "carapace.token": "output" });
      genAiTokenUsageHistogram.record(usage.output, {
        ...genAiAttrs,
        "gen_ai.token.type": "output",
      });
    }
    if (usage.cacheRead) {
      tokensCounter.add(usage.cacheRead, { ...attrs, "carapace.token": "cache_read" });
    }
    if (usage.cacheWrite) {
      tokensCounter.add(usage.cacheWrite, { ...attrs, "carapace.token": "cache_write" });
    }
    if (usage.promptTokens) {
      tokensCounter.add(usage.promptTokens, { ...attrs, "carapace.token": "prompt" });
    }
    if (usage.total) {
      tokensCounter.add(usage.total, { ...attrs, "carapace.token": "total" });
    }

    if (evt.costUsd) {
      costCounter.add(evt.costUsd, attrs);
    }
    if (evt.durationMs) {
      durationHistogram.record(evt.durationMs, attrs);
    }
    if (evt.context?.limit) {
      contextHistogram.record(evt.context.limit, {
        ...attrs,
        "carapace.context": "limit",
      });
    }
    if (evt.context?.used) {
      contextHistogram.record(evt.context.used, {
        ...attrs,
        "carapace.context": "used",
      });
    }

    if (!tracesEnabled) {
      return;
    }
    const genAiInputTokens =
      usage.promptTokens ?? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    const spanAttrs: Record<string, string | number> = {
      ...attrs,
      "carapace.tokens.input": usage.input ?? 0,
      "carapace.tokens.output": usage.output ?? 0,
      "carapace.tokens.cache_read": usage.cacheRead ?? 0,
      "carapace.tokens.cache_write": usage.cacheWrite ?? 0,
      "carapace.tokens.total": usage.total ?? 0,
    };
    if (metadata.trusted && metadata.internal && hostPluginId) {
      spanAttrs["carapace.plugin"] = normalizeDiagnosticValue(hostPluginId);
    }
    assignGenAiSpanIdentityAttrs(spanAttrs, evt);
    assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.input_tokens", genAiInputTokens);
    assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.output_tokens", usage.output);
    assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.cache_read.input_tokens", usage.cacheRead);
    assignPositiveNumberAttr(
      spanAttrs,
      "gen_ai.usage.cache_creation.input_tokens",
      usage.cacheWrite,
    );

    const span = spanWithDuration("carapace.model.usage", spanAttrs, evt.durationMs, {
      parentContext: activeTrustedParentContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    span.end(evt.ts);
  };

  const recordWebhookReceived = (
    evt: Extract<DiagnosticEventPayload, { type: "webhook.received" }>,
  ) => {
    const attrs = {
      "carapace.channel": evt.channel ?? "unknown",
      "carapace.webhook": evt.updateType ?? "unknown",
    };
    webhookReceivedCounter.add(1, attrs);
  };

  const recordWebhookProcessed = (
    evt: Extract<DiagnosticEventPayload, { type: "webhook.processed" }>,
  ) => {
    const attrs = {
      "carapace.channel": normalizeDiagnosticValue(evt.channel),
      "carapace.webhook": normalizeDiagnosticValue(evt.updateType),
    };
    if (typeof evt.durationMs === "number") {
      webhookDurationHistogram.record(evt.durationMs, attrs);
    }
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number> = { ...attrs };
    const span = spanWithDuration("carapace.webhook.processed", spanAttrs, evt.durationMs);
    span.end();
  };

  const recordWebhookError = (evt: Extract<DiagnosticEventPayload, { type: "webhook.error" }>) => {
    const attrs = {
      "carapace.channel": normalizeDiagnosticValue(evt.channel),
      "carapace.webhook": normalizeDiagnosticValue(evt.updateType),
    };
    webhookErrorCounter.add(1, attrs);
    if (!tracesEnabled) {
      return;
    }
    const redactedError = redactSensitiveText(evt.error);
    const spanAttrs: Record<string, string | number> = {
      ...attrs,
      "carapace.error": redactedError,
    };
    const span = tracer.startSpan("carapace.webhook.error", {
      attributes: spanAttrs,
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: redactedError });
    span.end();
  };

  const recordMessageQueued = (
    evt: Extract<DiagnosticEventPayload, { type: "message.queued" }>,
  ) => {
    const attrs = {
      "carapace.channel": normalizeDiagnosticValue(evt.channel),
      "carapace.source": normalizeDiagnosticValue(evt.source),
    };
    messageQueuedCounter.add(1, attrs);
    if (typeof evt.queueDepth === "number") {
      queueDepthHistogram.record(evt.queueDepth, attrs);
    }
  };

  const recordMessageReceived = (
    evt: Extract<DiagnosticEventPayload, { type: "message.received" }>,
  ) => {
    messageReceivedCounter.add(1, {
      "carapace.channel": normalizeDiagnosticValue(evt.channel),
      "carapace.source": normalizeDiagnosticValue(evt.source),
    });
  };

  const recordMessageDispatchStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "message.dispatch.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs = {
      "carapace.channel": normalizeDiagnosticValue(evt.channel),
      "carapace.source": normalizeDiagnosticValue(evt.source),
    };
    messageDispatchStartedCounter.add(1, attrs);
    if (!tracesEnabled) {
      return;
    }
    const traceContext = internalOrTrustedTraceContext(evt, metadata);
    if (!traceContext?.spanId || activeTrustedSpans.has(traceContext.spanId)) {
      return;
    }
    trackInternalOrTrustedSpan(
      evt,
      metadata,
      spanWithDuration("carapace.message.processed", attrs, undefined, {
        parentContext: internalOrTrustedExplicitParentContext(evt, metadata),
        startTimeMs: evt.ts,
      }),
    );
  };

  const recordMessageDispatchCompleted = (
    evt: Extract<DiagnosticEventPayload, { type: "message.dispatch.completed" }>,
  ) => {
    const attrs = {
      "carapace.channel": normalizeDiagnosticValue(evt.channel),
      "carapace.outcome": evt.outcome,
      "carapace.reason": normalizeDiagnosticValue(evt.reason, "none"),
      "carapace.source": normalizeDiagnosticValue(evt.source),
    };
    messageDispatchCompletedCounter.add(1, attrs);
    messageDispatchDurationHistogram.record(evt.durationMs, attrs);
  };

  const recordMessageProcessed = (
    evt: Extract<DiagnosticEventPayload, { type: "message.processed" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs = {
      "carapace.channel": normalizeDiagnosticValue(evt.channel),
      "carapace.outcome": evt.outcome ?? "unknown",
    };
    messageProcessedCounter.add(1, attrs);
    if (typeof evt.durationMs === "number") {
      messageDurationHistogram.record(evt.durationMs, attrs);
    }
    if (!tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number> = { ...attrs };
    if (evt.reason) {
      spanAttrs["carapace.reason"] = normalizeDiagnosticValue(evt.reason, "unknown");
    }
    const trackedSpan = getTrackedInternalOrTrustedSpan(evt, metadata);
    const span =
      trackedSpan ??
      spanWithDuration("carapace.message.processed", spanAttrs, evt.durationMs, {
        parentContext: internalOrTrustedExplicitParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    setSpanAttrs(span, spanAttrs);
    if (evt.outcome === "error" && evt.error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: redactSensitiveText(evt.error) });
    }
    const traceContext = internalOrTrustedTraceContext(evt, metadata);
    if (trackedSpan && traceContext?.spanId) {
      completeTrackedLifecycleSpan(traceContext, trackedSpan, evt.ts);
      return;
    }
    span.end(evt.ts);
  };

  const messageDeliveryAttrs = (evt: MessageDeliveryDiagnosticEvent): Record<string, string> => ({
    "carapace.channel": normalizeDiagnosticValue(evt.channel),
    "carapace.delivery.kind": normalizeDiagnosticValue(evt.deliveryKind, "other"),
  });

  const recordMessageDeliveryStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "message.delivery.started" }>,
  ) => {
    messageDeliveryStartedCounter.add(1, messageDeliveryAttrs(evt));
  };

  const recordMessageDeliveryCompleted = (
    evt: Extract<DiagnosticEventPayload, { type: "message.delivery.completed" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs = {
      ...messageDeliveryAttrs(evt),
      "carapace.outcome": "completed",
    };
    messageDeliveryDurationHistogram.record(evt.durationMs, attrs);
    if (!tracesEnabled) {
      return;
    }
    const span = spanWithDuration(
      "carapace.message.delivery",
      {
        ...attrs,
        "carapace.delivery.result_count": evt.resultCount,
      },
      evt.durationMs,
      { parentContext: activeInternalOrTrustedContext(evt, metadata), endTimeMs: evt.ts },
    );
    span.end(evt.ts);
  };

  const recordMessageDeliveryError = (
    evt: Extract<DiagnosticEventPayload, { type: "message.delivery.error" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    const attrs = {
      ...messageDeliveryAttrs(evt),
      "carapace.outcome": "error",
      "carapace.errorCategory": normalizeDiagnosticValue(evt.errorCategory, "other"),
    };
    messageDeliveryDurationHistogram.record(evt.durationMs, attrs);
    if (!tracesEnabled) {
      return;
    }
    const span = spanWithDuration("carapace.message.delivery", attrs, evt.durationMs, {
      parentContext: activeInternalOrTrustedContext(evt, metadata),
      endTimeMs: evt.ts,
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: redactSensitiveText(evt.errorCategory),
    });
    span.end(evt.ts);
  };

  const recordRunStarted = (
    evt: Extract<DiagnosticEventPayload, { type: "run.started" }>,
    metadata: DiagnosticEventMetadata,
  ) => {
    if (!tracesEnabled || !metadata.trusted) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {};
    addRunAttrs(spanAttrs, evt);
    const span = trackTrustedSpan(
      evt,
      metadata,
      spanWithDuration("carapace.run", spanAttrs, undefined, {
        parentContext: activeTrustedParentContext(evt, metadata),
        startTimeMs: evt.ts,
      }),
    );
    const parentSpanId = trustedTraceContext(evt, metadata)?.parentSpanId;
    if (parentSpanId && !activeTrustedSpans.has(parentSpanId)) {
      const owner: TrustedSpanAliasOwner = { kind: "run", id: evt.runId };
      activeTrustedSpanAliases.set(trustedSpanAliasKey(parentSpanId, owner), {
        span,
        spanId: parentSpanId,
        owner,
      });
    }
  };

  return {
    recordModelUsage,
    recordWebhookReceived,
    recordWebhookProcessed,
    recordWebhookError,
    recordMessageQueued,
    recordMessageReceived,
    recordMessageDispatchStarted,
    recordMessageDispatchCompleted,
    recordMessageProcessed,
    recordMessageDeliveryStarted,
    recordMessageDeliveryCompleted,
    recordMessageDeliveryError,
    recordRunStarted,
  };
}
