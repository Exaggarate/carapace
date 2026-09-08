import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("device"),
  component: () =>
    import("./device-page.ts").then(() => ({
      header: true,
      render: () => html`<carapace-device-page></carapace-device-page>`,
    })),
});

export const permissionsPage = definePage({
  ...routePageSpec("device-permissions"),
  component: () =>
    import("./permissions-page.ts").then(() => ({
      header: true,
      render: () => html`<carapace-device-permissions-page></carapace-device-permissions-page>`,
    })),
});
