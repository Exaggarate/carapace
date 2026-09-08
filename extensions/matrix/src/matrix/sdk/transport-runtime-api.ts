// Matrix API module exposes the plugin public contract.
import { fetchWithRuntimeDispatcherOrMockedGlobal } from "carapace/plugin-sdk/runtime-fetch";
import {
  closeDispatcher,
  createPinnedDispatcher,
  resolvePinnedHostnameWithPolicy,
  type PinnedDispatcherPolicy,
  type SsrFPolicy,
} from "carapace/plugin-sdk/ssrf-dispatcher";
export { buildTimeoutAbortSignal } from "./timeout-abort-signal.js";

export {
  closeDispatcher,
  createPinnedDispatcher,
  fetchWithRuntimeDispatcherOrMockedGlobal,
  resolvePinnedHostnameWithPolicy,
  type PinnedDispatcherPolicy,
  type SsrFPolicy,
};
