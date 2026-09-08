// Signal plugin module implements account types behavior.
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

type SignalChannelConfig = Exclude<NonNullable<CarapaceConfig["channels"]>["signal"], undefined>;

export type SignalAccountConfig = Omit<SignalChannelConfig, "accounts" | "defaultAccount">;

export type SignalTransportConfig = NonNullable<SignalChannelConfig["transport"]>;
