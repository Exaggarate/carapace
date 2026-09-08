export function hasNativeBrowserBridge(): boolean {
  const host:
    | (Window & {
        webkit?: { messageHandlers?: { carapaceBrowser?: { postMessage?: unknown } } };
      })
    | undefined = typeof window === "undefined" ? undefined : window;
  return typeof host?.webkit?.messageHandlers?.carapaceBrowser?.postMessage === "function";
}
