import type { CarapaceConfig } from "../../config/types.carapace.js";
import "./local.js";

type GatewayHealthProbeAuth = {
  token?: string;
  password?: string;
  unresolvedRefReason?: string;
};

type TestApi = {
  resolveGatewayHealthProbeToken(nextConfig: CarapaceConfig): Promise<GatewayHealthProbeAuth>;
};

function getTestApi(): TestApi {
  return (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for("carapace.onboardNonInteractiveLocalTestApi")
  ] as TestApi;
}

export const resolveGatewayHealthProbeToken: TestApi["resolveGatewayHealthProbeToken"] = (
  nextConfig,
) => getTestApi().resolveGatewayHealthProbeToken(nextConfig);
