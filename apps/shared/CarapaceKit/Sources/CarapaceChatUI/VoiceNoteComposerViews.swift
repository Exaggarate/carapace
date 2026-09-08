import SwiftUI

/// Host-provided voice-note recording state for the shared chat composer.
public struct CarapaceChatVoiceNoteControl {
    public var recorder: CarapaceVoiceNoteRecorder
    public var isTalkActive: Bool

    public init(recorder: CarapaceVoiceNoteRecorder, isTalkActive: Bool) {
        self.recorder = recorder
        self.isTalkActive = isTalkActive
    }
}

struct CarapaceVoiceNoteButton: View {
    let control: CarapaceChatVoiceNoteControl
    let compact: Bool
    let isComposerEnabled: Bool
    let isAttachmentInputEnabled: Bool

    var isRecordingEnabled: Bool {
        self.isComposerEnabled
            && self.isAttachmentInputEnabled
            && !self.control.isTalkActive
            && !self.control.recorder.isRequestingPermission
    }

    var body: some View {
        Button {
            Task { await self.control.recorder.start() }
        } label: {
            if self.control.recorder.isRequestingPermission {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Image(systemName: "mic")
                    .font(CarapaceChatTypography.display(size: 15, weight: .semibold, relativeTo: .subheadline))
            }
        }
        .help("Record Voice Note")
        .accessibilityLabel("Record voice note")
        .accessibilityIdentifier("chat-voice-note-record")
        .modifier(VoiceNoteButtonChrome(compact: self.compact))
        .controlSize(.small)
        .foregroundStyle(.secondary)
        .contentShape(Rectangle())
        .disabled(!self.isRecordingEnabled)
    }
}

struct CarapaceVoiceNoteRecordingRow: View {
    let recorder: CarapaceVoiceNoteRecorder
    var embedded = false

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(CarapaceChatTheme.danger)
                .frame(width: 9, height: 9)

            // Live capture wave replaces a static "Recording" label; the level is
            // real recorder metering, so silence reads flat and speech moves.
            TalkWaveformView(phase: .listening(level: self.recorder.level, speechActive: false))
                .frame(maxWidth: .infinity, minHeight: 26, maxHeight: 26)
                .accessibilityLabel("Recording")

            Text(carapaceVoiceNoteDurationLabel(self.recorder.elapsedSeconds))
                .font(CarapaceChatTypography.mono(size: 13, relativeTo: .footnote))
                .foregroundStyle(.secondary)

            Spacer(minLength: 8)

            Button {
                self.recorder.cancel()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityLabel("Cancel voice note")

            Button {
                self.recorder.finish()
            } label: {
                Image(systemName: "checkmark")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .accessibilityLabel("Finish voice note")
        }
        .padding(.horizontal, self.embedded ? 2 : 14)
        .padding(.vertical, self.embedded ? 2 : 10)
        .background {
            if !self.embedded {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(CarapaceChatTheme.composerField)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(CarapaceChatTheme.composerBorder))
            }
        }
    }
}

private struct VoiceNoteButtonChrome: ViewModifier {
    let compact: Bool

    func body(content: Content) -> some View {
        if self.compact {
            content.buttonStyle(.plain)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}
