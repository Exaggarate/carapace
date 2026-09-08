export type WebKitHostMessages = {
  carapaceLink: { type: "open-link"; url: string; target: "external" };
  carapaceUpdate: { type: "start-update" };
  carapaceNav: { type: "nav-state"; collapsed: boolean; width: number };
  carapaceWindowDrag: { type: "window-drag" };
  carapaceGateways:
    | { type: "select" | "open-window" | "set-primary"; id: string }
    | { type: "open-settings" };
  carapaceNotifications:
    | { type: "status" | "request-permission" | "send-test" }
    | {
        type: "background-session-completed";
        runId: string;
        path: string;
        search?: string;
      };
};

type WebKitMessageHandler<Message> = {
  postMessage(message: Message): void;
};

type WebKitHostWindow = Window & {
  webkit?: {
    messageHandlers?: {
      [Name in keyof WebKitHostMessages]?: WebKitMessageHandler<WebKitHostMessages[Name]>;
    };
  };
};

export function webKitHostWindow(): WebKitHostWindow | undefined {
  // SAFETY: WebKit owns this optional ambient bridge and the mapped contract narrows every handler.
  return typeof window === "undefined" ? undefined : (window as WebKitHostWindow);
}
