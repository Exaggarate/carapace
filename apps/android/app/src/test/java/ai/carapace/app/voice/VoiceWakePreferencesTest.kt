package ai.carapace.app.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceWakePreferencesTest {
  @Test
  fun sanitizeTrimsDropsEmptyAndUsesDefaults() {
    assertEquals(listOf("hello", "computer"), VoiceWakePreferences.sanitizeTriggerWords(listOf(" hello ", "", "computer")))
    assertEquals(VoiceWakePreferences.defaultTriggerWords, VoiceWakePreferences.sanitizeTriggerWords(emptyList()))
  }

  @Test
  fun sanitizePreservesPhrasePunctuationAndNewlines() {
    assertEquals(
      listOf("hey, carapace", "line\nbreak"),
      VoiceWakePreferences.sanitizeTriggerWords(listOf(" hey, carapace ", "line\nbreak")),
    )
  }

  @Test
  fun matcherRequiresWordBoundariesAndCommand() {
    assertNull(VoiceWakePhraseMatcher.match("recarapace show status", listOf("carapace")))
    assertNull(VoiceWakePhraseMatcher.match("carapace", listOf("carapace")))
    assertNull(VoiceWakePhraseMatcher.match("tell carapace show status", listOf("carapace")))
    assertEquals(
      VoiceWakeMatch(trigger = "Carapace", command = "show status"),
      VoiceWakePhraseMatcher.match("Hey Carapace, show status", listOf("carapace")),
    )
  }

  @Test
  fun matcherUsesEarliestTrigger() {
    assertEquals(
      VoiceWakeMatch(trigger = "computer", command = "ask claude for status"),
      VoiceWakePhraseMatcher.match("computer ask claude for status", listOf("claude", "computer")),
    )
  }

  @Test
  fun matcherSupportsScriptsWithoutWhitespaceWordBoundaries() {
    assertEquals(
      VoiceWakeMatch(trigger = "小龙虾", command = "天气怎么样"),
      VoiceWakePhraseMatcher.match("小龙虾天气怎么样", listOf("小龙虾")),
    )
    assertEquals(
      VoiceWakeMatch(trigger = "โอเพนคลอ", command = "สภาพอากาศ"),
      VoiceWakePhraseMatcher.match("โอเพนคลอสภาพอากาศ", listOf("โอเพนคลอ")),
    )
  }

  @Test
  fun matcherNormalizesSpokenPunctuationAndWhitespace() {
    assertEquals(
      VoiceWakeMatch(trigger = "Hey Carapace", command = "show status"),
      VoiceWakePhraseMatcher.match("Hey Carapace show status", listOf("hey,\ncarapace")),
    )
  }
}
