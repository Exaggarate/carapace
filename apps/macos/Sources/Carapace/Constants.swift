import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-carapace writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.carapace.mac"
var gatewayLaunchdLabel: String {
    AppProfile.current.gatewayLaunchAgentLabel
}

let nodeLaunchdLabel = "ai.carapace.node"
let onboardingVersionKey = "carapace.onboardingVersion"
let onboardingSeenKey = "carapace.onboardingSeen"
let onboardingSystemAgentPendingKey = "carapace.onboardingSystemAgentPending"
// Pre-rename releases persisted pending activations under the Crestodian key.
let onboardingSystemAgentPendingRetiredKey = "carapace.onboardingCrestodianPending"
let currentOnboardingVersion = 8
let pauseDefaultsKey = "carapace.pauseEnabled"
let iconAnimationsEnabledKey = "carapace.iconAnimationsEnabled"
let swabbleEnabledKey = "carapace.swabbleEnabled"
let swabbleTriggersKey = "carapace.swabbleTriggers"
let voiceWakeTriggerChimeKey = "carapace.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "carapace.voiceWakeSendChime"
let showDockIconKey = "carapace.showDockIcon"
let appIconStyleKey = "carapace.appIconStyle"
let defaultVoiceWakeTriggers = ["carapace"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "carapace.voiceWakeMicID"
let voiceWakeMicNameKey = "carapace.voiceWakeMicName"
let voiceWakeLocaleKey = "carapace.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "carapace.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "carapace.voicePushToTalkEnabled"
let voiceWakeTriggersTalkModeKey = "carapace.voiceWakeTriggersTalkMode"
let talkEnabledKey = "carapace.talkEnabled"
let talkRealtimeRelayEnabledKey = "carapace.talkRealtimeRelayEnabled"
let talkPhaseSoundsEnabledKey = "carapace.talkPhaseSoundsEnabled"
let talkShiftToStopEnabledKey = "carapace.talkShiftToStopEnabled"
let iconOverrideKey = "carapace.iconOverride"
let connectionModeKey = "carapace.connectionMode"
let remoteTargetKey = "carapace.remoteTarget"
let remoteIdentityKey = "carapace.remoteIdentity"
let remoteProjectRootKey = "carapace.remoteProjectRoot"
let remoteCliPathKey = "carapace.remoteCliPath"
let canvasEnabledKey = "carapace.canvasEnabled"
let quickChatEnabledKey = "carapace.quickChatEnabled"
let cameraEnabledKey = "carapace.cameraEnabled"
let computerControlEnabledKey = "carapace.computerControlEnabled"
let computerControlProviderKey = "carapace.computerControlProvider"
let cookieSyncEnabledKey = "carapace.cookieSyncEnabled"
let cookieSyncIntoProfileKey = "carapace.cookieSyncIntoProfile"
let cookieSyncDomainsKey = "carapace.cookieSyncDomains"

func isTalkRealtimeRelayEnabled(defaults: UserDefaults = AppDefaults.standard) -> Bool {
    defaults.object(forKey: talkRealtimeRelayEnabledKey) as? Bool ?? false
}

func isComputerControlEnabled(
    defaults: UserDefaults = AppDefaults.standard,
    launchPlan: AppLaunchRuntimePlan = .current) -> Bool
{
    // object(forKey:) preserves an explicit false; bool(forKey:) would conflate it with an unset default.
    let storedValue = defaults.object(forKey: computerControlEnabledKey) as? Bool ?? true
    return launchPlan.resolveComputerControlEnabled(storedValue)
}

let activeComputerPresenceEnabledKey = "carapace.activeComputerPresenceEnabled"
let locationModeKey = "carapace.locationMode"
let locationPreciseKey = "carapace.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "carapace.peekabooBridgeEnabled"
let deepLinkKeyKey = "carapace.deepLinkKey"
let cliInstallPromptedVersionKey = "carapace.cliInstallPromptedVersion"
let cliInstallPolicyKey = "carapace.cliInstallPolicy"
let cliManagedRestartPendingKey = "carapace.cliManagedRestartPending"
let postAppUpdateReceiptKey = "carapace.postAppUpdateReceipt"
let lastLaunchedAppVersionKey = "carapace.lastLaunchedAppVersion"
let cliValidatedExecutableKey = "carapace.cliValidatedExecutable"
let cliValidatedVersionKey = "carapace.cliValidatedVersion"
let macNodeIdentityProfileKey = "carapace.macNodeIdentityProfile"
let heartbeatsEnabledKey = "carapace.heartbeatsEnabled"
let debugPaneEnabledKey = "carapace.debugPaneEnabled"
let debugFileLogEnabledKey = "carapace.debug.fileLogEnabled"
let appLogLevelKey = "carapace.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
