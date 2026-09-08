package ai.carapace.app.ui

import ai.carapace.app.GatewayClawHubSkillSearchState
import ai.carapace.app.MainViewModel
import ai.carapace.app.NodeApp
import ai.carapace.app.NodeRuntime
import ai.carapace.app.NodeRuntimeMode
import ai.carapace.app.SecurePrefs
import ai.carapace.app.closeNodeRuntimeTestFixture
import ai.carapace.app.ui.design.ClawDesignTheme
import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelStore
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SkillsSettingsScreenTest {
  @get:Rule
  val composeRule = createComposeRule()

  @Test
  fun auditDetailsRemainReadableForSuccessAndRejection() {
    val app = RuntimeEnvironment.getApplication() as NodeApp
    val originalRuntime = app.peekRuntime()
    val prefs = SecurePrefs(app, app.getSharedPreferences("skills-settings-${UUID.randomUUID()}", Context.MODE_PRIVATE))
    val runtime = NodeRuntime(app, prefs, NodeRuntimeMode.ScreenshotFixture)
    val runtimeField = NodeApp::class.java.getDeclaredField("runtimeInstance").apply { isAccessible = true }
    runtimeField.set(app, runtime)
    val viewModel = MainViewModel(app, prefs, SavedStateHandle())
    val viewModels = ViewModelStore().apply { put("skills", viewModel) }

    @Suppress("UNCHECKED_CAST")
    val state =
      NodeRuntime::class.java
        .getDeclaredField("_clawHubSkillSearchState")
        .apply { isAccessible = true }
        .get(runtime) as MutableStateFlow<GatewayClawHubSkillSearchState>

    try {
      viewModel.refreshSkills()
      composeRule.setContent {
        ClawDesignTheme { SkillsSettingsScreen(viewModel = viewModel, onBack = {}) }
      }
      composeRule.onNodeWithText("Browse").performClick()

      for (isError in listOf(false, true)) {
        val message = if (isError) "Blocked by ClawHub." else "Installed @alice/alpha."
        composeRule.runOnIdle {
          state.value =
            GatewayClawHubSkillSearchState(
              errorText = "$message\n\nClawHub audit details.".takeIf { isError },
              messageText = "$message\n\nClawHub audit details.".takeUnless { isError },
            )
        }

        composeRule.onNodeWithText(message).performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("ClawHub audit details.").assertDoesNotExist()
        composeRule.onNodeWithText("Review").performScrollTo().performClick()
        composeRule.onNodeWithText("ClawHub audit details.").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Acknowledge Gateway warning and install").assertDoesNotExist()
        composeRule.onNodeWithText("Dismiss").performScrollTo().performClick()
        composeRule.onNodeWithText(message).assertDoesNotExist()
      }
    } finally {
      viewModels.clear()
      runtimeField.set(app, originalRuntime)
      closeNodeRuntimeTestFixture(runtime)
    }
  }

  @Test
  fun missingItemCopyHandlesZeroOneAndMany() {
    assertEquals("No missing items", skillMissingItemsText(0))
    assertEquals("1 missing item", skillMissingItemsText(1))
    assertEquals("2 missing items", skillMissingItemsText(2))
  }

  @Test
  fun missingSetupCopyUsesExplicitSingularAndPluralForms() {
    assertEquals(
      "This skill needs 1 setup item. Android shows what is installed; setup/config changes stay on desktop or CLI.",
      skillMissingConfigurationText(1),
    )
    assertEquals(
      "This skill needs 2 setup items. Android shows what is installed; setup/config changes stay on desktop or CLI.",
      skillMissingConfigurationText(2),
    )
  }
}
