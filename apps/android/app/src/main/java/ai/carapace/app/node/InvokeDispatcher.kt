package ai.carapace.app.node

import ai.carapace.app.gateway.GatewaySession
import ai.carapace.app.protocol.CarapaceCalendarCommand
import ai.carapace.app.protocol.CarapaceCallLogCommand
import ai.carapace.app.protocol.CarapaceCameraCommand
import ai.carapace.app.protocol.CarapaceCapability
import ai.carapace.app.protocol.CarapaceContactsCommand
import ai.carapace.app.protocol.CarapaceDeviceCommand
import ai.carapace.app.protocol.CarapaceLocationCommand
import ai.carapace.app.protocol.CarapaceMobileUiCommand
import ai.carapace.app.protocol.CarapaceMotionCommand
import ai.carapace.app.protocol.CarapaceNotificationsCommand
import ai.carapace.app.protocol.CarapacePhotosCommand
import ai.carapace.app.protocol.CarapaceSmsCommand
import ai.carapace.app.protocol.CarapaceSystemCommand
import ai.carapace.app.protocol.CarapaceTalkCommand

/** Owns Android command bindings and their live advertised/invoke availability. */
class InvokeDispatcher(
  cameraHandler: CameraHandler,
  locationHandler: LocationHandler,
  deviceHandler: DeviceHandler,
  notificationsHandler: NotificationsHandler,
  systemHandler: SystemHandler,
  talkHandler: TalkHandler,
  photosHandler: PhotosHandler,
  contactsHandler: ContactsHandler,
  calendarHandler: CalendarHandler,
  motionHandler: MotionHandler,
  smsHandler: SmsHandler,
  debugHandler: DebugHandler,
  callLogHandler: CallLogHandler,
  mobileUiHandler: MobileUiHandler,
  private val isForeground: () -> Boolean,
  cameraEnabled: () -> Boolean,
  locationEnabled: () -> Boolean,
  sendSmsAvailable: () -> Boolean,
  private val readSmsAvailable: () -> Boolean,
  smsSearchPossible: () -> Boolean,
  callLogAvailable: () -> Boolean,
  photosAvailable: () -> Boolean,
  installedAppsSharingEnabled: () -> Boolean,
  debugBuild: () -> Boolean,
  motionActivityAvailable: () -> Boolean,
  motionPedometerAvailable: () -> Boolean,
  mobileUiAvailable: () -> Boolean,
  private val voiceWakeAvailable: () -> Boolean,
) {
  private class CommandGate(
    val isAvailable: () -> Boolean,
    val unavailable: GatewaySession.InvokeResult,
    val isAdvertised: () -> Boolean = isAvailable,
  )

  private class Command(
    val name: String,
    val invoke: suspend (String?) -> GatewaySession.InvokeResult,
    val gate: CommandGate? = null,
    val requiresForeground: Boolean = false,
  )

  private val cameraGate =
    CommandGate(cameraEnabled, unavailable("CAMERA_DISABLED", "enable Camera in Settings"))
  private val locationGate =
    CommandGate(locationEnabled, unavailable("LOCATION_DISABLED", "enable Location in Settings"))
  private val motionActivityGate =
    CommandGate(motionActivityAvailable, unavailable("MOTION_UNAVAILABLE", "accelerometer not available"))
  private val motionPedometerGate =
    CommandGate(motionPedometerAvailable, unavailable("PEDOMETER_UNAVAILABLE", "step counter not available"))
  private val smsUnavailable = unavailable("SMS_UNAVAILABLE", "SMS not available on this device")
  private val smsSendGate = CommandGate(sendSmsAvailable, smsUnavailable)
  private val smsSearchGate =
    CommandGate(
      isAvailable = { readSmsAvailable() || smsSearchPossible() },
      unavailable = smsUnavailable,
      // Search is advertised before READ_SMS is granted so its handler can request permission.
      isAdvertised = smsSearchPossible,
    )
  private val callLogGate =
    CommandGate(callLogAvailable, unavailable("CALL_LOG_UNAVAILABLE", "call log not available on this build"))
  private val photosGate =
    CommandGate(photosAvailable, unavailable("PHOTOS_UNAVAILABLE", "photos not available on this build"))
  private val installedAppsGate =
    CommandGate(installedAppsSharingEnabled, unavailable("INSTALLED_APPS_SHARING_DISABLED", "enable Installed Apps in Settings"))
  private val debugGate =
    CommandGate(debugBuild, unavailable("INVALID_REQUEST", "unknown command"))
  private val mobileUiGate =
    CommandGate(mobileUiAvailable, unavailable("MOBILE_UI_UNAVAILABLE", "accessibility service is not connected"))

  // Keep protocol ordering stable. The same entries advertise and dispatch each bound handler.
  private val commands =
    listOf(
      Command(CarapaceSystemCommand.Notify.rawValue, systemHandler::handleSystemNotify),
      Command(CarapaceTalkCommand.PttStart.rawValue, talkHandler::handlePttStart),
      Command(CarapaceTalkCommand.PttStop.rawValue, talkHandler::handlePttStop),
      Command(CarapaceTalkCommand.PttCancel.rawValue, talkHandler::handlePttCancel),
      Command(CarapaceTalkCommand.PttOnce.rawValue, talkHandler::handlePttOnce, requiresForeground = true),
      Command(CarapaceCameraCommand.List.rawValue, cameraHandler::handleList, cameraGate, requiresForeground = true),
      Command(CarapaceCameraCommand.Snap.rawValue, cameraHandler::handleSnap, cameraGate, requiresForeground = true),
      Command(CarapaceCameraCommand.Clip.rawValue, cameraHandler::handleClip, cameraGate, requiresForeground = true),
      Command(CarapaceLocationCommand.Get.rawValue, locationHandler::handleLocationGet, locationGate),
      Command(CarapaceDeviceCommand.Status.rawValue, deviceHandler::handleDeviceStatus),
      Command(CarapaceDeviceCommand.Info.rawValue, deviceHandler::handleDeviceInfo),
      Command(CarapaceDeviceCommand.Permissions.rawValue, deviceHandler::handleDevicePermissions),
      Command(CarapaceDeviceCommand.Health.rawValue, deviceHandler::handleDeviceHealth),
      Command(CarapaceDeviceCommand.Apps.rawValue, deviceHandler::handleDeviceApps, installedAppsGate),
      Command(CarapaceNotificationsCommand.List.rawValue, notificationsHandler::handleNotificationsList),
      Command(CarapaceNotificationsCommand.Actions.rawValue, notificationsHandler::handleNotificationsActions),
      Command(CarapacePhotosCommand.Latest.rawValue, photosHandler::handlePhotosLatest, photosGate),
      Command(CarapaceContactsCommand.Search.rawValue, contactsHandler::handleContactsSearch),
      Command(CarapaceContactsCommand.Add.rawValue, contactsHandler::handleContactsAdd),
      Command(CarapaceCalendarCommand.Events.rawValue, calendarHandler::handleCalendarEvents),
      Command(CarapaceCalendarCommand.Add.rawValue, calendarHandler::handleCalendarAdd),
      Command(CarapaceMotionCommand.Activity.rawValue, motionHandler::handleMotionActivity, motionActivityGate),
      Command(CarapaceMotionCommand.Pedometer.rawValue, motionHandler::handleMotionPedometer, motionPedometerGate),
      Command(CarapaceSmsCommand.Send.rawValue, smsHandler::handleSmsSend, smsSendGate),
      Command(CarapaceSmsCommand.Search.rawValue, smsHandler::handleSmsSearch, smsSearchGate),
      Command(CarapaceCallLogCommand.Search.rawValue, callLogHandler::handleCallLogSearch, callLogGate),
      Command(CarapaceMobileUiCommand.Observe.rawValue, mobileUiHandler::handleObserve, mobileUiGate),
      Command(CarapaceMobileUiCommand.Act.rawValue, mobileUiHandler::handleAct, mobileUiGate),
      Command("debug.logs", { debugHandler.handleLogs() }, debugGate),
      Command("debug.ed25519", { debugHandler.handleEd25519() }, debugGate),
    )
  private val commandsByName = commands.associateBy(Command::name)

  suspend fun handleInvoke(
    command: String,
    paramsJson: String?,
  ): GatewaySession.InvokeResult {
    val binding = commandsByName[command] ?: return unavailable("INVALID_REQUEST", "unknown command")
    if (binding.requiresForeground && !isForeground()) {
      return unavailable("NODE_BACKGROUND_UNAVAILABLE", "command requires foreground")
    }
    val gate = binding.gate
    if (gate != null && !gate.isAvailable()) return gate.unavailable
    return binding.invoke(paramsJson)
  }

  fun buildInvokeCommands(): List<String> {
    // A settings change must not split a command family within one connect payload.
    val availability = mutableMapOf<CommandGate, Boolean>()
    return commands
      .filter { command ->
        val gate = command.gate
        gate == null || availability.getOrPut(gate, gate.isAdvertised)
      }.map(Command::name)
  }

  fun buildCapabilities(): List<String> =
    buildList {
      add(CarapaceCapability.Device.rawValue)
      add(CarapaceCapability.Notifications.rawValue)
      add(CarapaceCapability.System.rawValue)
      if (cameraGate.isAvailable()) add(CarapaceCapability.Camera.rawValue)
      // A promptable search alone does not advertise the SMS capability.
      if (smsSendGate.isAvailable() || readSmsAvailable()) add(CarapaceCapability.Sms.rawValue)
      add(CarapaceCapability.Talk.rawValue)
      if (locationGate.isAvailable()) add(CarapaceCapability.Location.rawValue)
      if (photosGate.isAvailable()) add(CarapaceCapability.Photos.rawValue)
      add(CarapaceCapability.Contacts.rawValue)
      add(CarapaceCapability.Calendar.rawValue)
      if (motionActivityGate.isAvailable() || motionPedometerGate.isAvailable()) add(CarapaceCapability.Motion.rawValue)
      if (callLogGate.isAvailable()) add(CarapaceCapability.CallLog.rawValue)
      if (voiceWakeAvailable()) add(CarapaceCapability.VoiceWake.rawValue)
      if (mobileUiGate.isAvailable()) add(CarapaceCapability.MobileUI.rawValue)
    }

  private fun unavailable(
    code: String,
    message: String,
  ): GatewaySession.InvokeResult = GatewaySession.InvokeResult.error(code, "$code: $message")
}

/** Talk-mode command adapter implemented by the voice subsystem. */
interface TalkHandler {
  /** Starts a push-to-talk capture session and keeps it open until stop or cancel. */
  suspend fun handlePttStart(paramsJson: String?): GatewaySession.InvokeResult

  /** Finishes the active push-to-talk capture and submits recognized speech. */
  suspend fun handlePttStop(paramsJson: String?): GatewaySession.InvokeResult

  /** Aborts the active push-to-talk capture without submitting speech. */
  suspend fun handlePttCancel(paramsJson: String?): GatewaySession.InvokeResult

  /** Runs a bounded one-shot push-to-talk capture. */
  suspend fun handlePttOnce(paramsJson: String?): GatewaySession.InvokeResult
}
