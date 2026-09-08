// Device Pair API module exposes the plugin public contract.
export {
  approveDevicePairing,
  clearDeviceBootstrapTokens,
  issueDeviceBootstrapToken,
  PAIRING_SETUP_BOOTSTRAP_PROFILE,
  listDevicePairing,
  revokeDeviceBootstrapToken,
  type DeviceBootstrapProfile,
} from "carapace/plugin-sdk/device-bootstrap";
export { definePluginEntry, type CarapacePluginApi } from "carapace/plugin-sdk/plugin-entry";
export {
  resolveGatewayBindUrl,
  resolveTailnetHostWithRunner,
  resolveTailscaleServeGatewayUrlsWithRunner,
} from "carapace/plugin-sdk/core";
export { resolveAdvertisedLanHost } from "carapace/plugin-sdk/gateway-runtime";
export {
  resolvePreferredCarapaceTmpDir,
  runPluginCommandWithTimeout,
} from "carapace/plugin-sdk/sandbox";
export { resolveGatewayPort } from "carapace/plugin-sdk/gateway-config-runtime";
export { renderQrPngBase64, renderQrPngDataUrl, writeQrPngTempFile } from "./qr-image.js";
