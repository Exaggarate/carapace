// Whatsapp plugin module implements account types behavior.
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

export type WhatsAppAccountConfig = NonNullable<
  NonNullable<NonNullable<CarapaceConfig["channels"]>["whatsapp"]>["accounts"]
>[string];
