package ai.carapace.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TerminalSettingsScreenTest {
  @Test
  fun terminalUrlBuildsCanonicalFocusPath() {
    val cases =
      listOf(
        "https://gateway.example.com:8443" to
          "https://gateway.example.com:8443/focus/terminal",
        "https://gateway.example.com:8443/carapace/" to
          "https://gateway.example.com:8443/carapace/focus/terminal",
      )

    cases.forEach { (baseUrl, expected) ->
      assertEquals(baseUrl, expected, terminalUrl(baseUrl))
    }
  }
}
