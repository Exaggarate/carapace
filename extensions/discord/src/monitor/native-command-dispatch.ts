// Discord plugin module implements native command dispatch behavior.
import type { ChatCommandDefinition, CommandArgs } from "carapace/plugin-sdk/command-auth-native";
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import type { PluginCommandCatalogDecision } from "carapace/plugin-sdk/plugin-command-runtime";
import type { ReplyPayload } from "carapace/plugin-sdk/reply-dispatch-runtime";
import type { ResolvedAgentRoute } from "carapace/plugin-sdk/routing";
import type {
  ButtonInteraction,
  CommandInteraction,
  StringSelectMenuInteraction,
} from "../internal/discord.js";
import type { DiscordLivePolicyReader } from "./live-policy.js";
import type { DiscordDispatchReplyFromConfig } from "./native-command.types.js";
import type { ThreadBindingManager } from "./thread-bindings.js";

type DiscordConfig = NonNullable<CarapaceConfig["channels"]>["discord"];

type DispatchDiscordCommandInteractionParams = {
  interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction;
  prompt: string;
  command: ChatCommandDefinition;
  commandArgs?: CommandArgs;
  cfg: CarapaceConfig;
  readPolicy?: DiscordLivePolicyReader;
  discordConfig: DiscordConfig;
  accountId: string;
  sessionPrefix: string;
  preferFollowUp: boolean;
  threadBindings: ThreadBindingManager;
  responseEphemeral?: boolean;
  suppressReplies?: boolean;
  dispatchReplyFromConfig?: DiscordDispatchReplyFromConfig;
  pluginCommandDispatch: PluginCommandCatalogDecision;
};

export type DispatchDiscordCommandInteractionResult = {
  accepted: boolean;
  effectiveRoute?: ResolvedAgentRoute;
  hiddenFinalReply?: ReplyPayload;
};

export type DispatchDiscordCommandInteraction = (
  params: DispatchDiscordCommandInteractionParams,
) => Promise<DispatchDiscordCommandInteractionResult>;
