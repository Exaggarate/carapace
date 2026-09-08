package ai.carapace.app.ui

import ai.carapace.app.NodeRuntime
import ai.carapace.app.R
import ai.carapace.app.gateway.normalizeGatewayTlsFingerprintInput
import ai.carapace.app.i18n.nativeString
import ai.carapace.app.ui.design.ClawTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
internal fun GatewayTrustDialog(
  prompt: NodeRuntime.GatewayTrustPrompt,
  confirmLabel: String,
  cancelLabel: String,
  onAccept: (String?) -> Unit,
  onUseSystemTrust: () -> Unit,
  onDecline: () -> Unit,
) {
  val manualEntry = prompt.fingerprintSha256 == null
  var manualFingerprint by
    rememberSaveable(prompt.endpoint.stableId, prompt.probeFailure) {
      mutableStateOf("")
    }
  val normalizedManualFingerprint = normalizeGatewayTlsFingerprintInput(manualFingerprint)
  val message =
    when {
      manualEntry -> {
        nativeString(
          "The gateway certificate could not be read automatically. Paste the SHA-256 fingerprint obtained on the gateway host.",
        )
      }

      prompt.previousFingerprintSha256.isNullOrBlank() -> {
        stringResource(R.string.gateway_trust_first_seen, prompt.fingerprintSha256)
      }

      else -> {
        stringResource(
          R.string.gateway_trust_changed,
          prompt.previousFingerprintSha256,
          prompt.fingerprintSha256,
        )
      }
    }

  FoldAwarePrompt(
    onDismissRequest = onDecline,
    containerColor = ClawTheme.colors.surfaceRaised,
    title = stringResource(R.string.trust_this_gateway),
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(message, style = ClawTheme.type.body, color = ClawTheme.colors.textMuted)
        if (prompt.systemTrustAvailable) {
          Text(
            nativeString("This gateway now presents a certificate trusted by this device."),
            style = ClawTheme.type.body,
            color = ClawTheme.colors.textMuted,
          )
        }
        if (manualEntry) {
          OutlinedTextField(
            value = manualFingerprint,
            onValueChange = { manualFingerprint = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(nativeString("SHA-256 fingerprint")) },
            singleLine = true,
          )
        }
      }
    },
    actions = {
      if (prompt.systemTrustAvailable) {
        TextButton(onClick = onUseSystemTrust) {
          Text(nativeString("Use system trust"))
        }
      }
      TextButton(onClick = onDecline) {
        Text(cancelLabel)
      }
      TextButton(
        onClick = { onAccept(if (manualEntry) normalizedManualFingerprint else null) },
        enabled = !manualEntry || normalizedManualFingerprint != null,
      ) {
        Text(confirmLabel)
      }
    },
  )
}
