// Discord plugin module implements approval runtime behavior.
export {
  isChannelExecApprovalClientEnabledFromConfig,
  matchesApprovalRequestFilters,
  getExecApprovalReplyMetadata,
} from "carapace/plugin-sdk/approval-client-runtime";
export { resolveApprovalApprovers } from "carapace/plugin-sdk/approval-auth-runtime";
export { createApproverRestrictedNativeApprovalCapability } from "carapace/plugin-sdk/approval-delivery-runtime";
export {
  createChannelApproverDmTargetResolver,
  createChannelNativeOriginTargetResolver,
} from "carapace/plugin-sdk/approval-native-runtime";
