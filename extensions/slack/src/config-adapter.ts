import { formatAllowFromLowercase } from "carapace/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
} from "carapace/plugin-sdk/channel-config-helpers";
import {
  listSlackAccountIds,
  resolveDefaultSlackAccountId,
  resolveSlackAccount,
  resolveSlackConfigAccessorAccount,
  type ResolvedSlackAccount,
  type SlackConfigAccessorAccount,
} from "./accounts.js";
import { SLACK_CHANNEL } from "./setup-shared.js";

export const slackBaseConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedSlackAccount,
  SlackConfigAccessorAccount
>({
  sectionKey: SLACK_CHANNEL,
  listAccountIds: listSlackAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveSlackAccount),
  resolveAccessorAccount: resolveSlackConfigAccessorAccount,
  defaultAccountId: resolveDefaultSlackAccountId,
  clearBaseFields: ["botToken", "appToken", "userToken", "signingSecret", "name"],
  resolveAllowFrom: (account) => account.allowFrom,
  formatAllowFrom: (allowFrom) => formatAllowFromLowercase({ allowFrom }),
  resolveDefaultTo: (account) => account.defaultTo,
});
