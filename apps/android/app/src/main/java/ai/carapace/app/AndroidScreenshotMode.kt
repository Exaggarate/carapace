package ai.carapace.app

import ai.carapace.app.ui.SettingsRoute
import android.content.Intent

const val extraAndroidScreenshotMode = "carapace.screenshotMode"
const val extraAndroidScreenshotScene = "carapace.screenshotScene"

enum class AndroidScreenshotScene(
  val rawValue: String,
  val homeDestination: HomeDestination,
  internal val settingsRoute: SettingsRoute? = null,
) {
  Home("home", HomeDestination.Connect),
  Chat("chat", HomeDestination.Chat),
  Swarm("swarm", HomeDestination.Chat),
  Settings("settings", HomeDestination.Settings),
  Gateway("gateway", HomeDestination.Settings, SettingsRoute.Gateway),
  Carapace("carapace", HomeDestination.Settings, SettingsRoute.SystemAgent),
  Desktop("desktop", HomeDestination.Settings, SettingsRoute.Desktop),
  VoiceWake("voice-wake", HomeDestination.Settings, SettingsRoute.Voice),
  ;

  companion object {
    fun fromRawValue(raw: String?): AndroidScreenshotScene = entries.firstOrNull { it.rawValue == raw?.trim()?.lowercase() } ?: Home
  }
}

fun parseAndroidScreenshotModeIntent(intent: Intent?): AndroidScreenshotScene? {
  if (intent?.getBooleanExtra(extraAndroidScreenshotMode, false) != true) {
    return null
  }
  return AndroidScreenshotScene.fromRawValue(intent.getStringExtra(extraAndroidScreenshotScene))
}
