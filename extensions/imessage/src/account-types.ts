// Imessage plugin module implements account types behavior.
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

export type IMessageAccountConfig = Omit<
  NonNullable<NonNullable<CarapaceConfig["channels"]>["imessage"]>,
  "accounts" | "defaultAccount"
>;
