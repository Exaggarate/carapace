package ai.carapace.app.protocol

import org.junit.Assert.assertTrue
import org.junit.Test

class CarapaceProtocolConstantsTest {
  @Test
  fun generatedCapabilitiesAreUniqueProtocolIds() {
    val values = CarapaceCapability.entries.map { it.rawValue }

    assertTrue(values.isNotEmpty())
    assertTrue(values.all { it.isNotBlank() && "." !in it })
    assertTrue(values.size == values.toSet().size)
  }

  @Test
  fun generatedCommandGroupsMatchTheirNamespaces() {
    val groups =
      listOf(
        CarapaceCameraCommand.NamespacePrefix to CarapaceCameraCommand.entries.map { it.rawValue },
        CarapaceSmsCommand.NamespacePrefix to CarapaceSmsCommand.entries.map { it.rawValue },
        CarapaceTalkCommand.NamespacePrefix to CarapaceTalkCommand.entries.map { it.rawValue },
        CarapaceLocationCommand.NamespacePrefix to CarapaceLocationCommand.entries.map { it.rawValue },
        CarapaceDeviceCommand.NamespacePrefix to CarapaceDeviceCommand.entries.map { it.rawValue },
        CarapaceNotificationsCommand.NamespacePrefix to CarapaceNotificationsCommand.entries.map { it.rawValue },
        CarapaceSystemCommand.NamespacePrefix to CarapaceSystemCommand.entries.map { it.rawValue },
        CarapacePhotosCommand.NamespacePrefix to CarapacePhotosCommand.entries.map { it.rawValue },
        CarapaceContactsCommand.NamespacePrefix to CarapaceContactsCommand.entries.map { it.rawValue },
        CarapaceCalendarCommand.NamespacePrefix to CarapaceCalendarCommand.entries.map { it.rawValue },
        CarapaceMotionCommand.NamespacePrefix to CarapaceMotionCommand.entries.map { it.rawValue },
        CarapaceCallLogCommand.NamespacePrefix to CarapaceCallLogCommand.entries.map { it.rawValue },
      )

    val commands = groups.flatMap { (prefix, values) -> values.onEach { assertTrue(it.startsWith(prefix)) } }
    assertTrue(commands.size == commands.toSet().size)
  }
}
