import type { CarapaceConfig } from "../../config/types.carapace.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { ChannelSetupInput } from "./setup-input.js";

export type ChannelSetupAdapter<Input extends { name?: string } = ChannelSetupInput> = {
  /** Keep root config as an independent identity when the host adds named accounts. */
  configPromotion?: "preserve-root";
  resolveAccountId?: (params: { cfg: CarapaceConfig; accountId?: string; input?: Input }) => string;
  prepareAccountConfigInput?: (params: {
    cfg: CarapaceConfig;
    accountId: string;
    input: Input;
    runtime: RuntimeEnv;
  }) => Promise<Input> | Input;
  resolveBindingAccountId?: (params: {
    cfg: CarapaceConfig;
    agentId: string;
    accountId?: string;
  }) => string | undefined;
  applyAccountName?: (params: {
    cfg: CarapaceConfig;
    accountId: string;
    name?: string;
  }) => CarapaceConfig;
  applyAccountConfig: (params: {
    cfg: CarapaceConfig;
    accountId: string;
    input: Input;
  }) => CarapaceConfig;
  afterAccountConfigWritten?: (params: {
    previousCfg: CarapaceConfig;
    cfg: CarapaceConfig;
    accountId: string;
    input: Input;
    runtime: RuntimeEnv;
  }) => Promise<void> | void;
  validateInput?: (params: {
    cfg: CarapaceConfig;
    accountId: string;
    input: Input;
  }) => string | null;
  singleAccountKeysToMove?: readonly string[];
  namedAccountPromotionKeys?: readonly string[];
  resolveSingleAccountPromotionTarget?: (params: {
    channel: Record<string, unknown>;
  }) => string | undefined;
};
