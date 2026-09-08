// Discord type declarations define plugin contracts.
import type { ChannelInboundTurnPlan } from "carapace/plugin-sdk/channel-inbound";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import type { CommandArgValues } from "carapace/plugin-sdk/native-command-registry";

export type DiscordConfig = NonNullable<CarapaceConfig["channels"]>["discord"];
export type DiscordDispatchReplyFromConfig = NonNullable<
  ChannelInboundTurnPlan["dispatchReplyFromConfig"]
>;

export type DiscordCommandArgs = {
  raw?: string;
  values?: CommandArgValues;
};
