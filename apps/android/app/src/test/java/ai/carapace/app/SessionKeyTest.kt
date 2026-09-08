package ai.carapace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionKeyTest {
  @Test
  fun buildNodeMainSessionKeyUsesStableDeviceScopedSuffix() {
    val key = buildNodeMainSessionKey(deviceId = "1234567890abcdef", agentId = "ops")

    assertEquals("agent:ops:node-1234567890ab", key)
  }

  @Test
  fun buildAndroidAppSessionLabelIncludesDeviceDisplayName() {
    assertEquals("Carapace App · 1234567890ab", buildAndroidAppSessionLabel(null, "1234567890abcdef"))
    assertEquals(
      "Carapace App · Pixel · 1234567890ab",
      buildAndroidAppSessionLabel(" Pixel ", "1234567890abcdef"),
    )
  }

  @Test
  fun buildAndroidAppSessionLabelPreservesUtf16BoundariesAtDisplayNameLimit() {
    val deviceId = "1234567890abcdef"
    val splitPairPrefix = "a".repeat(95)
    assertEquals(
      "Carapace App · $splitPairPrefix · 1234567890ab",
      buildAndroidAppSessionLabel("$splitPairPrefix😀tail", deviceId),
    )

    val completePairPrefix = "a".repeat(94)
    assertEquals(
      "Carapace App · $completePairPrefix😀 · 1234567890ab",
      buildAndroidAppSessionLabel("$completePairPrefix😀tail", deviceId),
    )
  }

  @Test
  fun resolveAgentIdFromMainSessionKeyParsesCanonicalAgentKey() {
    assertEquals("ops", resolveAgentIdFromMainSessionKey("agent:ops:main"))
    assertNull(resolveAgentIdFromMainSessionKey("global"))
  }
}
