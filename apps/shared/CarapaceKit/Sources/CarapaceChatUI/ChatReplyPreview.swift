import SwiftUI

struct ChatReplyPreview: View {
    let target: CarapaceChatReplyTarget
    let onCancel: () -> Void

    var body: some View {
        let preview = ChatReplyQuote.previewText(self.target.text)
        HStack(spacing: 6) {
            Image(systemName: "message")
                .foregroundStyle(.secondary)
            Text(String(format: String(localized: "Replying to %@"), self.target.senderLabel))
                .font(CarapaceChatTypography.captionSemiBold)
                .lineLimit(1)
            Text(preview.text + (preview.isTruncated ? "..." : ""))
                .font(CarapaceChatTypography.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 4)
            Button(action: self.onCancel) {
                Image(systemName: "xmark")
                    .font(CarapaceChatTypography.captionSemiBold)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(localized: "Cancel reply"))
            .help(String(localized: "Cancel reply"))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(CarapaceChatTheme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}
