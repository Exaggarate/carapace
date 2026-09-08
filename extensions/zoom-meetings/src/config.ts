import { MeetingPlatformAdapter } from "carapace/plugin-sdk/meeting-runtime";
import { addTimerTimeoutGraceMs } from "carapace/plugin-sdk/number-runtime";
import { REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME } from "carapace/plugin-sdk/realtime-voice";

export const zoomMeetingsConfig = MeetingPlatformAdapter.createPluginConfigSchema({
  defaultRealtimeInstructions: `You are joining a private Zoom meeting as an Carapace voice transport. Keep spoken replies brief and natural. In agent mode, wait for Carapace consult results and speak them exactly. In bidi mode, answer directly and call ${REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME} for deeper reasoning, current information, or tools.`,
  resolveGatewayOperationTimeoutMs: (config) =>
    Math.max(
      60_000,
      addTimerTimeoutGraceMs(
        config.chrome.joinTimeoutMs,
        config.chrome.waitForInCallMs + config.chrome.joinTimeoutMs + 30_000,
      ) ?? 1,
    ),
});

export type ZoomMeetingsConfig = ReturnType<typeof zoomMeetingsConfig.resolveConfig>;
export type ZoomMeetingsMode = ZoomMeetingsConfig["defaultMode"];
export type ZoomMeetingsTransport = "chrome" | "chrome-node";
