/** Tracks plugin API lifecycle callbacks registered during runtime activation. */
import type { CarapacePluginApi } from "./types.js";

const LATE_CALLABLE_PLUGIN_API_METHODS: ReadonlySet<string> = new Set<keyof CarapacePluginApi>([
  "clearRunContext",
  "emitAgentEvent",
  "enqueueNextTurnInjection",
  "getRunContext",
  "sendSessionAttachment",
  "scheduleSessionTurn",
  "setRunContext",
  "unscheduleSessionTurnsByTag",
]);

/** True when a plugin API method remains callable after registration. */
export function isLateCallablePluginApiMethod(methodName: string): boolean {
  return LATE_CALLABLE_PLUGIN_API_METHODS.has(methodName);
}
