import { webKitHostWindow, type WebKitHostMessages } from "./native-webkit-bridge.ts";

export type NativeNavState = Omit<WebKitHostMessages["carapaceNav"], "type">;

export function postNativeNavState(state: NativeNavState): void {
  try {
    webKitHostWindow()?.webkit?.messageHandlers?.carapaceNav?.postMessage({
      type: "nav-state",
      ...state,
    });
  } catch {
    // WebKit may remove a handler while the document is being replaced.
  }
}
