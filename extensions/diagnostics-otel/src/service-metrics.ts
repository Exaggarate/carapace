import type { Meter, MetricOptions } from "@opentelemetry/api";
import {
  AGENT_DURATION_MS_BUCKETS,
  CONTEXT_TOKENS_BUCKETS,
  GEN_AI_OPERATION_DURATION_BUCKETS,
  GEN_AI_TOKEN_USAGE_BUCKETS,
} from "./service-constants.js";

const DEFAULT_METRIC_NAME_PREFIX = "carapace.";

export function createDiagnosticsMetrics(
  meter: Meter,
  metricNamePrefix = DEFAULT_METRIC_NAME_PREFIX,
) {
  const resolveMetricName = (name: `carapace.${string}`) =>
    `${metricNamePrefix}${name.slice(DEFAULT_METRIC_NAME_PREFIX.length)}`;
  const createCounter = (name: `carapace.${string}`, options?: MetricOptions) =>
    meter.createCounter(resolveMetricName(name), options);
  const createHistogram = (name: `carapace.${string}`, options?: MetricOptions) =>
    meter.createHistogram(resolveMetricName(name), options);

  return {
    gcDurationHistogram: createHistogram("carapace.gc.duration_ms", {
      unit: "ms",
      description: "Elapsed garbage collection duration for the hosting JavaScript isolate",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    gatewayEventLoopDelayMaxHistogram: createHistogram("carapace.gateway.event_loop.delay_max_ms", {
      unit: "ms",
      description: "Maximum event-loop delay per completed Gateway observation window",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    gatewayEventLoopObservedCounter: createCounter("carapace.gateway.event_loop.observed_ms", {
      unit: "ms",
      description: "Elapsed time covered by completed Gateway event-loop observation windows",
    }),
    gatewayRpcRequestsCounter: createCounter("carapace.gateway.rpc.requests", {
      unit: "1",
      description: "Authenticated Gateway WebSocket requests received",
    }),
    gatewayRpcOutcomesCounter: createCounter("carapace.gateway.rpc.outcomes", {
      unit: "1",
      description: "Gateway RPC observations by phase and outcome",
    }),
    gatewayRpcFirstResponseHistogram: createHistogram("carapace.gateway.rpc.first_response_ms", {
      unit: "ms",
      description: "Elapsed time until the first Gateway RPC response is sent",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    gatewayRpcHandlerHistogram: createHistogram("carapace.gateway.rpc.handler_ms", {
      unit: "ms",
      description: "Gateway RPC handler duration until return or throw",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    gatewayRpcAdmissionHistogram: createHistogram("carapace.gateway.rpc.admission_ms", {
      unit: "ms",
      description: "Elapsed time from Gateway RPC receipt until handler invocation",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    gatewayRpcQueueWaitHistogram: createHistogram("carapace.gateway.rpc.queue_wait_ms", {
      unit: "ms",
      description: "Gateway operator request start queue wait",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    tokensCounter: createCounter("carapace.tokens", {
      unit: "1",
      description: "Token usage by type",
    }),
    genAiTokenUsageHistogram: meter.createHistogram("gen_ai.client.token.usage", {
      unit: "{token}",
      description: "Number of input and output tokens used by GenAI client operations",
      advice: {
        explicitBucketBoundaries: GEN_AI_TOKEN_USAGE_BUCKETS,
      },
    }),
    genAiOperationDurationHistogram: meter.createHistogram("gen_ai.client.operation.duration", {
      unit: "s",
      description: "GenAI client operation duration",
      advice: {
        explicitBucketBoundaries: GEN_AI_OPERATION_DURATION_BUCKETS,
      },
    }),
    costCounter: createCounter("carapace.cost.usd", {
      unit: "1",
      description: "Estimated model cost (USD)",
    }),
    durationHistogram: createHistogram("carapace.run.duration_ms", {
      unit: "ms",
      description: "Agent run duration",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    harnessDurationHistogram: createHistogram("carapace.harness.duration_ms", {
      unit: "ms",
      description: "Agent harness lifecycle duration",
      advice: { explicitBucketBoundaries: AGENT_DURATION_MS_BUCKETS },
    }),
    contextHistogram: createHistogram("carapace.context.tokens", {
      unit: "1",
      description: "Context window size and usage",
      advice: { explicitBucketBoundaries: CONTEXT_TOKENS_BUCKETS },
    }),
    webhookReceivedCounter: createCounter("carapace.webhook.received", {
      unit: "1",
      description: "Webhook requests received",
    }),
    webhookErrorCounter: createCounter("carapace.webhook.error", {
      unit: "1",
      description: "Webhook processing errors",
    }),
    webhookDurationHistogram: createHistogram("carapace.webhook.duration_ms", {
      unit: "ms",
      description: "Webhook processing duration",
    }),
    messageQueuedCounter: createCounter("carapace.message.queued", {
      unit: "1",
      description: "Messages queued for processing",
    }),
    messageReceivedCounter: createCounter("carapace.message.received", {
      unit: "1",
      description: "Inbound messages received",
    }),
    messageDispatchStartedCounter: createCounter("carapace.message.dispatch.started", {
      unit: "1",
      description: "Inbound message dispatch attempts started",
    }),
    messageDispatchCompletedCounter: createCounter("carapace.message.dispatch.completed", {
      unit: "1",
      description: "Inbound message dispatch attempts completed",
    }),
    messageDispatchDurationHistogram: createHistogram("carapace.message.dispatch.duration_ms", {
      unit: "ms",
      description: "Inbound message dispatch duration",
    }),
    messageProcessedCounter: createCounter("carapace.message.processed", {
      unit: "1",
      description: "Messages processed by outcome",
    }),
    messageDurationHistogram: createHistogram("carapace.message.duration_ms", {
      unit: "ms",
      description: "Message processing duration",
    }),
    messageDeliveryStartedCounter: createCounter("carapace.message.delivery.started", {
      unit: "1",
      description: "Outbound message delivery attempts started",
    }),
    messageDeliveryDurationHistogram: createHistogram("carapace.message.delivery.duration_ms", {
      unit: "ms",
      description: "Outbound message delivery duration",
    }),
    queueDepthHistogram: createHistogram("carapace.queue.depth", {
      unit: "1",
      description: "Queue depth on enqueue/dequeue",
    }),
    queueWaitHistogram: createHistogram("carapace.queue.wait_ms", {
      unit: "ms",
      description: "Queue wait time before execution",
    }),
    laneEnqueueCounter: createCounter("carapace.queue.lane.enqueue", {
      unit: "1",
      description: "Command queue lane enqueue events",
    }),
    laneDequeueCounter: createCounter("carapace.queue.lane.dequeue", {
      unit: "1",
      description: "Command queue lane dequeue events",
    }),
    sessionStateCounter: createCounter("carapace.session.state", {
      unit: "1",
      description: "Session state transitions",
    }),
    sessionTurnCreatedCounter: createCounter("carapace.session.turn.created", {
      unit: "1",
      description: "Agent session turns created",
    }),
    sessionStuckCounter: createCounter("carapace.session.stuck", {
      unit: "1",
      description: "Sessions stuck in processing",
    }),
    sessionStuckAgeHistogram: createHistogram("carapace.session.stuck_age_ms", {
      unit: "ms",
      description: "Age of stuck sessions",
    }),
    sessionRecoveryRequestedCounter: createCounter("carapace.session.recovery.requested", {
      unit: "1",
      description: "Session recovery attempts requested",
    }),
    sessionRecoveryCompletedCounter: createCounter("carapace.session.recovery.completed", {
      unit: "1",
      description: "Session recovery attempts completed",
    }),
    sessionRecoveryAgeHistogram: createHistogram("carapace.session.recovery.age_ms", {
      unit: "ms",
      description: "Age of sessions selected for recovery",
    }),
    talkEventCounter: createCounter("carapace.talk.event", {
      unit: "1",
      description: "Talk events emitted by type",
    }),
    talkEventDurationHistogram: createHistogram("carapace.talk.event.duration_ms", {
      unit: "ms",
      description: "Talk event duration when reported",
    }),
    talkAudioBytesHistogram: createHistogram("carapace.talk.audio.bytes", {
      unit: "By",
      description: "Talk audio frame byte lengths",
    }),
    runAttemptCounter: createCounter("carapace.run.attempt", {
      unit: "1",
      description: "Run attempts",
    }),
    toolLoopCounter: createCounter("carapace.tool.loop", {
      unit: "1",
      description: "Detected repetitive tool-call loop events",
    }),
    skillUsedCounter: createCounter("carapace.skill.used", {
      unit: "1",
      description: "Skills used by agent runs",
    }),
    modelCallDurationHistogram: createHistogram("carapace.model_call.duration_ms", {
      unit: "ms",
      description: "Model call duration",
    }),
    modelCallRequestBytesHistogram: createHistogram("carapace.model_call.request_bytes", {
      unit: "By",
      description: "UTF-8 byte size of sanitized model request payloads",
    }),
    modelCallResponseBytesHistogram: createHistogram("carapace.model_call.response_bytes", {
      unit: "By",
      description: "UTF-8 byte size of bounded streamed model response payloads",
    }),
    modelCallTimeToFirstByteHistogram: createHistogram(
      "carapace.model_call.time_to_first_byte_ms",
      {
        unit: "ms",
        description: "Elapsed time before the first streamed model response event",
      },
    ),
    modelFailoverCounter: createCounter("carapace.model.failover", {
      unit: "1",
      description: "Model failovers by source, destination, lane, and reason",
    }),
    toolExecutionDurationHistogram: createHistogram("carapace.tool.execution.duration_ms", {
      unit: "ms",
      description: "Tool execution duration",
    }),
    toolExecutionBlockedCounter: createCounter("carapace.tool.execution.blocked", {
      unit: "1",
      description: "Tool executions blocked by policy or sandbox diagnostics",
    }),
    execProcessDurationHistogram: createHistogram("carapace.exec.duration_ms", {
      unit: "ms",
      description: "Exec process duration",
    }),
    memoryRssHistogram: createHistogram("carapace.memory.rss_bytes", {
      unit: "By",
      description: "Resident set size reported by diagnostic memory samples",
    }),
    memoryHeapUsedHistogram: createHistogram("carapace.memory.heap_used_bytes", {
      unit: "By",
      description: "Heap used bytes reported by diagnostic memory samples",
    }),
    memoryHeapTotalHistogram: createHistogram("carapace.memory.heap_total_bytes", {
      unit: "By",
      description: "Heap total bytes reported by diagnostic memory samples",
    }),
    memoryExternalHistogram: createHistogram("carapace.memory.external_bytes", {
      unit: "By",
      description: "External memory bytes reported by diagnostic memory samples",
    }),
    memoryArrayBuffersHistogram: createHistogram("carapace.memory.array_buffers_bytes", {
      unit: "By",
      description: "ArrayBuffer bytes reported by diagnostic memory samples",
    }),
    memoryPressureCounter: createCounter("carapace.memory.pressure", {
      unit: "1",
      description: "Diagnostic memory pressure events",
    }),
    asyncQueueDroppedCounter: createCounter("carapace.diagnostic.async_queue.dropped", {
      unit: "1",
      description: "Async diagnostic queue drops by dropped event class",
    }),
    payloadLargeCounter: createCounter("carapace.payload.large", {
      unit: "1",
      description: "Oversized payload diagnostics by surface and action",
    }),
    payloadLargeBytesHistogram: createHistogram("carapace.payload.large_bytes", {
      unit: "By",
      description: "Oversized payload byte sizes by surface and action",
    }),
    livenessWarningCounter: createCounter("carapace.liveness.warning", {
      unit: "1",
      description: "Diagnostic liveness warning events",
    }),
    livenessEventLoopDelayP99Histogram: createHistogram(
      "carapace.liveness.event_loop_delay_p99_ms",
      {
        unit: "ms",
        description: "P99 event-loop delay reported by diagnostic liveness warnings",
      },
    ),
    livenessEventLoopDelayMaxHistogram: createHistogram(
      "carapace.liveness.event_loop_delay_max_ms",
      {
        unit: "ms",
        description: "Maximum event-loop delay reported by diagnostic liveness warnings",
      },
    ),
    livenessEventLoopUtilizationHistogram: createHistogram(
      "carapace.liveness.event_loop_utilization",
      {
        unit: "1",
        description: "Event-loop utilization reported by diagnostic liveness warnings",
      },
    ),
    livenessCpuCoreRatioHistogram: createHistogram("carapace.liveness.cpu_core_ratio", {
      unit: "1",
      description:
        "Whole-process CPU usage in core equivalents, including worker and native threads; can exceed 1.",
    }),
    telemetryExporterCounter: createCounter("carapace.telemetry.exporter.events", {
      unit: "1",
      description: "Diagnostic telemetry exporter lifecycle and failure events",
    }),
  };
}

export type DiagnosticsMetrics = ReturnType<typeof createDiagnosticsMetrics>;
