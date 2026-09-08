package ai.carapace.app.ui.chat

import ai.carapace.app.PendingAssistantAutoSend
import ai.carapace.app.SessionCatalog
import ai.carapace.app.SessionCatalogEntry
import ai.carapace.app.SessionCatalogHost
import ai.carapace.app.chat.ChatComposerOwner
import ai.carapace.app.chat.ChatMessageContent
import ai.carapace.app.chat.ChatPlanStep
import ai.carapace.app.chat.ChatPlanStepStatus
import ai.carapace.app.chat.ChatProgressCard
import ai.carapace.app.chat.ChatSessionEntry
import ai.carapace.app.chat.ChatThinkingLevelOption
import ai.carapace.app.chat.SessionBranch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatScreenTest {
  @Test
  fun thinkingGaugeSemanticsExposeEffortAndFastModeState() {
    val options = listOf("off", "medium").map { ChatThinkingLevelOption(id = it, label = it) }

    assertEquals(
      "Medium, Fast mode: On",
      chatThinkingChipStateDescription(fastMode = true, thinkingLevel = "medium", thinkingOptions = options),
    )
    assertEquals(
      "High, Fast mode: Off",
      chatThinkingChipStateDescription(fastMode = false, thinkingLevel = "high", thinkingOptions = emptyList()),
    )
  }

  @Test
  fun assistantContentUsesTheFullRowWhileUserMessagesRemainBubbles() {
    assertEquals(1f, chatBubbleWidthFraction(isUser = false), 0.0001f)
    assertEquals(0.78f, chatBubbleWidthFraction(isUser = true), 0.0001f)
    assertEquals(24, CHAT_BUBBLE_CORNER_RADIUS_DP)
  }

  @Test
  fun progressCardCompletionControlsTheAttachedPanelState() {
    val note = ChatProgressCard(revision = 1, updatedAt = 1L, markdown = "note", steps = emptyList())
    val completed = note.copy(steps = listOf(ChatPlanStep("Done", ChatPlanStepStatus.Completed)))
    val paused = note.copy(steps = listOf(ChatPlanStep("Waiting", ChatPlanStepStatus.InProgress)))

    assertFalse(progressCardIsComplete(note, hasActiveRun = true))
    assertTrue(progressCardIsComplete(note, hasActiveRun = false))
    assertTrue(progressCardIsComplete(completed, hasActiveRun = true))
    assertFalse(progressCardIsComplete(paused, hasActiveRun = false))
  }

  @Test
  fun fastModeControlRequiresSupportAndAnIdleConnectedChat() {
    fun enabled(
      supported: Boolean = true,
      adminAuthorized: Boolean = true,
      connected: Boolean = true,
      gatewayAvailable: Boolean = true,
      loading: Boolean = false,
      sending: Boolean = false,
      activeRun: Boolean = false,
      streaming: Boolean = false,
      settingsMutationPending: Boolean = false,
    ) = chatFastModeControlEnabled(supported, adminAuthorized, connected, gatewayAvailable, loading, sending, activeRun, streaming, settingsMutationPending)

    assertTrue(enabled())
    assertFalse(enabled(supported = false))
    assertFalse(enabled(adminAuthorized = false))
    assertFalse(enabled(connected = false))
    assertFalse(enabled(gatewayAvailable = false))
    assertFalse(enabled(loading = true))
    assertFalse(enabled(sending = true))
    assertFalse(enabled(activeRun = true))
    assertFalse(enabled(streaming = true))
    assertFalse(enabled(settingsMutationPending = true))
  }

  @Test
  fun branchMessageCountUsesCountNeutralCopy() {
    assertEquals("Messages: 1", branchMessageCountText(1))
    assertEquals("Messages: 2", branchMessageCountText(2))
    assertEquals(
      "Messages: 2",
      branchMetadataText(SessionBranch("leaf", "", 2, updatedAt = null, active = false)),
    )
  }

  @Test
  fun longUserMessagesProduceABoundedPlainTextPreview() {
    assertNull(ChatUserMessageDisclosurePolicy.collapsedPreview("Short prompt"))
    assertNull(ChatUserMessageDisclosurePolicy.collapsedPreview(List(12) { "line" }.joinToString("\n")))
    assertNull(ChatUserMessageDisclosurePolicy.collapsedPreview("a".repeat(700)))
    assertEquals(
      List(12) { "line" }.joinToString("\n") + "…",
      ChatUserMessageDisclosurePolicy.collapsedPreview(List(13) { "line" }.joinToString("\n")),
    )
    assertEquals(
      "a".repeat(700) + "…",
      ChatUserMessageDisclosurePolicy.collapsedPreview("a".repeat(701)),
    )
  }

  @Test
  fun disclosureDoesNotReorderMixedUserContent() {
    val mixedContent =
      listOf(
        ChatMessageContent(type = "text", text = "a".repeat(701)),
        ChatMessageContent(type = "image", fileName = "photo.png", base64 = "AAAA"),
        ChatMessageContent(type = "text", text = "caption"),
      )

    assertFalse(shouldUseUserMessageDisclosure(isUser = true, content = mixedContent))
  }

  @Test
  fun realtimeTalkLaunchRequestsPermissionBeforeSetupOrStart() {
    assertEquals(
      ChatRealtimeTalkLaunch.RequestPermission,
      resolveChatRealtimeTalkLaunch(hasMicPermission = false, requiresSetup = true),
    )
    assertEquals(
      ChatRealtimeTalkLaunch.ShowSetupMessage,
      resolveChatRealtimeTalkLaunch(hasMicPermission = true, requiresSetup = true),
    )
    assertEquals(
      ChatRealtimeTalkLaunch.StartTalk,
      resolveChatRealtimeTalkLaunch(hasMicPermission = true, requiresSetup = false),
    )
  }

  @Test
  fun composerPrimaryActionSendsDraftsDuringRunsAndKeepsTalkStopIndependent() {
    assertEquals(
      ChatComposerPrimaryAction.Stop,
      resolveChatComposerPrimaryAction(talkActive = true, runActive = true, hasContent = true),
    )
    assertEquals(
      ChatComposerPrimaryAction.None,
      resolveChatComposerPrimaryAction(talkActive = true, runActive = false, hasContent = true),
    )
    assertEquals(
      ChatComposerPrimaryAction.Send,
      resolveChatComposerPrimaryAction(talkActive = false, runActive = true, hasContent = true),
    )
    assertEquals(
      ChatComposerPrimaryAction.Send,
      resolveChatComposerPrimaryAction(talkActive = false, runActive = false, hasContent = true),
    )
    assertEquals(
      ChatComposerPrimaryAction.Stop,
      resolveChatComposerPrimaryAction(talkActive = false, runActive = true, hasContent = false),
    )
    assertEquals(
      ChatComposerPrimaryAction.StartTalk,
      resolveChatComposerPrimaryAction(talkActive = false, runActive = false, hasContent = false),
    )
  }

  @Test
  fun resolvesPendingAssistantAutoSendOnlyWhenChatIsReady() {
    val owner = ChatComposerOwner(gatewayStableId = "gateway", agentId = "main", sessionKey = "agent:main:device")
    val pending = PendingAssistantAutoSend(prompt = "  summarize mail  ", owner = owner)
    assertNull(
      resolvePendingAssistantAutoSend(
        pending = pending,
        currentOwner = owner,
        healthOk = false,
        pendingRunCount = 0,
      ),
    )
    assertNull(
      resolvePendingAssistantAutoSend(
        pending = pending,
        currentOwner = owner,
        healthOk = true,
        pendingRunCount = 1,
      ),
    )
    assertNull(
      resolvePendingAssistantAutoSend(
        pending = pending,
        currentOwner = owner.copy(sessionKey = "agent:main:other"),
        healthOk = true,
        pendingRunCount = 0,
      ),
    )
    assertEquals(
      pending,
      resolvePendingAssistantAutoSend(
        pending = pending,
        currentOwner = owner,
        healthOk = true,
        pendingRunCount = 0,
      ),
    )
  }

  @Test
  fun healthyEmptyChatShowsStarterStateInsteadOfLoadingPlaceholder() {
    assertFalse(
      showChatLoadingPlaceholder(
        historyLoading = true,
        healthOk = true,
        gatewayOffline = false,
      ),
    )
    assertTrue(
      showChatLoadingPlaceholder(
        historyLoading = true,
        healthOk = false,
        gatewayOffline = false,
      ),
    )
  }

  @Test
  fun headerSessionTitleNeverExposesRoutingKeys() {
    assertEquals("New chat", chatHeaderSessionTitle(session = null) { "New chat" })
    assertEquals(
      "New chat",
      chatHeaderSessionTitle(ChatSessionEntry(key = "agent:main:main", updatedAtMs = null)) { "New chat" },
    )
    assertEquals(
      "Release planning",
      chatHeaderSessionTitle(
        ChatSessionEntry(
          key = "agent:main:thread-1",
          updatedAtMs = null,
          displayName = "Release planning",
        ),
      ) {
        "New chat"
      },
    )
  }

  @Test
  fun headerProjectLabelComesOnlyFromTheMatchingCatalogSession() {
    val matching =
      SessionCatalogEntry(
        catalogId = "codex",
        hostId = "local",
        threadId = "thread-1",
        cwd = "/root/carapace",
        status = "idle",
        archived = false,
        sessionKey = "agent:main:thread-1",
        canContinue = true,
      )
    val catalog =
      SessionCatalog(
        id = "codex",
        label = "Codex",
        hosts =
          listOf(
            SessionCatalogHost(
              catalogId = "codex",
              hostId = "local",
              label = "Local",
              kind = "local",
              connected = true,
              sessions = listOf(matching),
            ),
          ),
      )

    assertEquals("carapace", chatHeaderProjectLabel("agent:main:thread-1", listOf(catalog)))
    assertNull(chatHeaderProjectLabel("agent:main:other", listOf(catalog)))
    assertNull(chatHeaderProjectLabel("", listOf(catalog)))
  }
}
