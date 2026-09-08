import type {
  CarapacePluginApi,
  CarapacePluginNodeInvokePolicy,
} from "carapace/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

type PolicyContext = Parameters<CarapacePluginNodeInvokePolicy["handle"]>[0];

function registerLogbookPolicies(): CarapacePluginNodeInvokePolicy[] {
  const policies: CarapacePluginNodeInvokePolicy[] = [];
  plugin.register({
    pluginConfig: {},
    lifecycle: { registerRuntimeLifecycle() {} },
    session: { controls: { registerControlUiDescriptor: () => {} } },
    registerNodeInvokePolicy: (policy: CarapacePluginNodeInvokePolicy) => policies.push(policy),
    registerService: () => {},
    registerGatewayMethod: () => {},
  } as unknown as CarapacePluginApi);
  return policies;
}

describe("logbook gateway methods", () => {
  it("keeps only process-wide status independent of the authenticated profile", () => {
    const registrations: Array<{ method: string; options: unknown }> = [];
    plugin.register({
      pluginConfig: {},
      lifecycle: { registerRuntimeLifecycle() {} },
      session: { controls: { registerControlUiDescriptor: () => {} } },
      registerNodeInvokePolicy: () => {},
      registerService: () => {},
      registerGatewayMethod: (method: string, _handler: unknown, options: unknown) => {
        registrations.push({ method, options });
      },
    } as unknown as CarapacePluginApi);

    expect(registrations.find((entry) => entry.method === "logbook.status")?.options).toEqual({
      scope: "operator.read",
      profileAccess: "independent",
    });
    for (const registration of registrations.filter((entry) => entry.method !== "logbook.status")) {
      expect(registration.options).not.toHaveProperty("profileAccess");
    }
  });
});

describe("logbook snapshot invoke policy", () => {
  it("blocks logbook.snapshot when gateway.nodes.commands.deny lists screen.snapshot", async () => {
    const [policy] = registerLogbookPolicies();
    expect(policy?.commands).toEqual(["logbook.snapshot"]);
    const invokeNode = vi.fn();
    const result = await policy!.handle({
      nodeId: "node-1",
      command: "logbook.snapshot",
      params: undefined,
      config: { gateway: { nodes: { commands: { deny: ["screen.snapshot"] } } } },
      invokeNode,
    } as unknown as PolicyContext);
    expect(result).toMatchObject({ ok: false, code: "SCREEN_CAPTURE_DENIED" });
    expect(invokeNode).not.toHaveBeenCalled();
  });

  it("invokes the node when screen.snapshot is not denied", async () => {
    const [policy] = registerLogbookPolicies();
    const invokeNode = vi.fn().mockResolvedValue({ ok: true, payloadJSON: null });
    const result = await policy!.handle({
      nodeId: "node-1",
      command: "logbook.snapshot",
      params: undefined,
      config: { gateway: { nodes: { commands: { deny: ["camera.snap"] } } } },
      invokeNode,
    } as unknown as PolicyContext);
    expect(result).toMatchObject({ ok: true });
    expect(invokeNode).toHaveBeenCalledTimes(1);
  });
});
