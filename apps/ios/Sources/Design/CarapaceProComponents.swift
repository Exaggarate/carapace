import CarapaceChatUI
import SwiftUI

enum CarapaceProMetric {
    static let pagePadding: CGFloat = 16
    static let cardRadius: CGFloat = 16
    static let controlRadius: CGFloat = 12
    static let compactControlSize: CGFloat = 36
    static let bottomScrollInset: CGFloat = 96
}

enum CarapaceSpacing {
    static let space1: CGFloat = 4
    static let space2: CGFloat = 8
}

enum CarapaceRadius {
    static let xs: CGFloat = 8
    static let sm: CGFloat = 10
    static let md: CGFloat = 12
}

enum CarapaceTextValue: ExpressibleByStringLiteral {
    case localized(LocalizedStringKey)
    case verbatim(String)

    init(stringLiteral value: String) {
        self = .localized(LocalizedStringKey(value))
    }

    static func localized(_ value: String) -> Self {
        .localized(LocalizedStringKey(value))
    }

    var text: Text {
        switch self {
        case let .localized(key):
            Text(key)
        case let .verbatim(value):
            Text(verbatim: value)
        }
    }
}

struct CarapaceProBackground: View {
    var body: some View {
        Color(uiColor: .systemGroupedBackground)
            .ignoresSafeArea()
    }
}

struct ProCard<Content: View>: View {
    var tint: Color?
    var isProminent: Bool = false
    var padding: CGFloat = 12
    var radius: CGFloat = CarapaceProMetric.cardRadius
    @ViewBuilder var content: Content

    var body: some View {
        self.content
            .padding(self.padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .proPanelSurface(
                tint: self.tint,
                radius: self.radius,
                isProminent: self.isProminent)
    }
}

private struct ProPanelBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    let radius: CGFloat
    let tint: Color?
    let isProminent: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        shape
            .fill(self.fill)
            .overlay {
                shape.strokeBorder(self.borderStyle, lineWidth: 1)
            }
    }

    private var fill: AnyShapeStyle {
        let color = self.isProminent ? UIColor.systemBackground : UIColor.secondarySystemGroupedBackground
        return AnyShapeStyle(Color(uiColor: color))
    }

    private var borderStyle: AnyShapeStyle {
        if let tint {
            return AnyShapeStyle(tint.opacity(self.isProminent ? 0.18 : 0.10))
        }
        return AnyShapeStyle(Color(uiColor: .separator).opacity(self.colorScheme == .dark ? 0.22 : 0.12))
    }
}

private struct CarapaceGlassButtonModifier: ViewModifier {
    let prominent: Bool
    let tint: Color?

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if self.prominent {
                content
                    .font(CarapaceType.subheadSemiBold)
                    .buttonStyle(.glassProminent)
                    .tint(self.tint ?? CarapaceBrand.accent)
            } else {
                content
                    .font(CarapaceType.subheadSemiBold)
                    .buttonStyle(.glass)
                    .tint(self.tint)
            }
        } else if self.prominent {
            content
                .font(CarapaceType.subheadSemiBold)
                .buttonStyle(.borderedProminent)
                .tint(self.tint ?? CarapaceBrand.accent)
        } else {
            content
                .font(CarapaceType.subheadSemiBold)
                .buttonStyle(.bordered)
                .tint(self.tint)
        }
    }
}

private struct CarapaceGlassSurfaceModifier: ViewModifier {
    let radius: CGFloat

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: .rect(cornerRadius: self.radius))
        } else {
            content.background(
                .regularMaterial,
                in: RoundedRectangle(cornerRadius: self.radius, style: .continuous))
        }
    }
}

extension View {
    func proPanelSurface(
        tint: Color? = nil,
        radius: CGFloat = CarapaceProMetric.cardRadius,
        isProminent: Bool = false) -> some View
    {
        modifier(ProPanelSurfaceModifier(
            tint: tint,
            radius: radius,
            isProminent: isProminent))
    }

    func carapaceGlassButton(prominent: Bool = false, tint: Color? = nil) -> some View {
        modifier(CarapaceGlassButtonModifier(prominent: prominent, tint: tint))
    }

    func carapaceGlassSurface(radius: CGFloat = CarapaceProMetric.controlRadius) -> some View {
        modifier(CarapaceGlassSurfaceModifier(radius: radius))
    }
}

private struct ProPanelSurfaceModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let tint: Color?
    let radius: CGFloat
    let isProminent: Bool

    func body(content: Content) -> some View {
        content
            .background {
                ProPanelBackground(
                    radius: self.radius,
                    tint: self.tint,
                    isProminent: self.isProminent)
            }
            .shadow(
                color: self.isProminent
                    ? (self.colorScheme == .dark ? .black.opacity(0.14) : .black.opacity(0.045))
                    : .clear,
                radius: self.isProminent ? 5 : 0,
                y: self.isProminent ? 2 : 0)
    }
}

struct ProIconBadge: View {
    let systemName: String
    let color: Color

    var body: some View {
        Image(systemName: self.systemName)
            .font(CarapaceType.captionSemiBold)
            .foregroundStyle(self.color)
            .frame(width: 30, height: 30)
            .background {
                RoundedRectangle(cornerRadius: CarapaceRadius.xs, style: .continuous)
                    .fill(self.color.opacity(0.12))
            }
    }
}

struct CarapaceSidebarHeaderAction {
    let systemName: String
    let accessibilityLabel: CarapaceTextValue
    let accessibilityIdentifier: String?
    let action: () -> Void

    init(
        systemName: String,
        accessibilityLabel: CarapaceTextValue,
        accessibilityIdentifier: String? = nil,
        action: @escaping () -> Void)
    {
        self.systemName = systemName
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityIdentifier = accessibilityIdentifier
        self.action = action
    }
}

struct CarapaceSidebarControlButton: View {
    let headerAction: CarapaceSidebarHeaderAction

    init(action: CarapaceSidebarHeaderAction) {
        self.headerAction = action
    }

    var body: some View {
        self.identified(self.button.buttonStyle(.plain))
    }

    private var button: some View {
        Button(action: self.headerAction.action) {
            self.icon
        }
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
        .accessibilityLabel(self.headerAction.accessibilityLabel.text)
    }

    private var icon: some View {
        Image(systemName: self.headerAction.systemName)
            .font(CarapaceType.subheadSemiBold)
            .foregroundStyle(CarapaceBrand.accent)
            .frame(
                width: CarapaceProMetric.compactControlSize,
                height: CarapaceProMetric.compactControlSize)
    }

    @ViewBuilder
    private func identified(_ button: some View) -> some View {
        if let accessibilityIdentifier = headerAction.accessibilityIdentifier {
            button.accessibilityIdentifier(accessibilityIdentifier)
        } else {
            button
        }
    }
}

struct CarapaceSidebarHeaderLeadingSlot: View {
    let action: CarapaceSidebarHeaderAction

    var body: some View {
        CarapaceSidebarControlButton(action: self.action)
    }
}

struct CarapaceSidebarToolbarItem: ToolbarContent {
    let action: CarapaceSidebarHeaderAction
    let placement: ToolbarItemPlacement

    @ToolbarContentBuilder
    var body: some ToolbarContent {
        if #available(iOS 26.0, *) {
            ToolbarItem(placement: self.placement) {
                CarapaceSidebarControlButton(action: self.action)
            }
            // Sidebar reveal is intentionally background-free in every host;
            // suppress the toolbar's automatic glass so it cannot reappear.
            .sharedBackgroundVisibility(.hidden)
        } else {
            ToolbarItem(placement: self.placement) {
                CarapaceSidebarControlButton(action: self.action)
            }
        }
    }
}

struct CarapaceGlassControlGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 8) {
                self.content
            }
        } else {
            self.content
        }
    }
}

enum CarapaceNoticeDetail {
    case accent(String)
    case requestID(String)
}

struct CarapaceNoticeBanner: View {
    let icon: String
    let title: CarapaceTextValue
    let message: CarapaceTextValue
    let ownerLabel: CarapaceTextValue
    let tint: Color
    var detail: CarapaceNoticeDetail?
    var primaryActionTitle: CarapaceTextValue?
    var onPrimaryAction: (() -> Void)?
    var secondaryActionTitle: CarapaceTextValue?
    var onSecondaryAction: (() -> Void)?

    var body: some View {
        ProCard(tint: self.tint, padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    ProIconBadge(systemName: self.icon, color: self.tint)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            self.title.text
                                .font(CarapaceType.subheadSemiBold)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                            self.ownerLabel.text
                                .font(CarapaceType.captionSemiBold)
                                .foregroundStyle(.secondary)
                        }

                        self.message.text
                            .font(CarapaceType.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)

                        self.detailView
                    }
                }

                if self.onPrimaryAction != nil || self.onSecondaryAction != nil {
                    CarapaceGlassControlGroup {
                        HStack(spacing: 10) {
                            if let primaryActionTitle, let onPrimaryAction {
                                Button(action: onPrimaryAction) {
                                    primaryActionTitle.text
                                        .font(CarapaceType.captionSemiBold)
                                }
                                .font(CarapaceType.captionSemiBold)
                                .carapaceGlassButton(prominent: true)
                                .controlSize(.small)
                            }
                            if let secondaryActionTitle, let onSecondaryAction {
                                Button(action: onSecondaryAction) {
                                    secondaryActionTitle.text
                                        .font(CarapaceType.captionSemiBold)
                                }
                                .font(CarapaceType.captionSemiBold)
                                .carapaceGlassButton()
                                .controlSize(.small)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var detailView: some View {
        if let detail {
            switch detail {
            case let .accent(value):
                Text(value)
                    .font(CarapaceType.captionMedium)
                    .foregroundStyle(self.tint)
                    .fixedSize(horizontal: false, vertical: true)
            case let .requestID(value):
                Text(verbatim: String(
                    format: String(localized: "Request ID: %@"),
                    value))
                    .font(CarapaceType.monoSmallMedium)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
}

struct CarapaceAdaptiveHeaderRow<Leading: View, Accessory: View>: View {
    let title: CarapaceTextValue
    let subtitle: CarapaceTextValue?
    var titleFont: Font = CarapaceType.title3SemiBold
    var subtitleFont: Font = CarapaceType.subhead
    var subtitleLineLimit: Int? = 2
    @ViewBuilder let leading: Leading
    @ViewBuilder let accessory: Accessory

    init(
        title: CarapaceTextValue,
        subtitle: CarapaceTextValue? = nil,
        titleFont: Font = CarapaceType.title3SemiBold,
        subtitleFont: Font = CarapaceType.subhead,
        subtitleLineLimit: Int? = 2,
        @ViewBuilder leading: () -> Leading,
        @ViewBuilder accessory: () -> Accessory)
    {
        self.title = title
        self.subtitle = subtitle
        self.titleFont = titleFont
        self.subtitleFont = subtitleFont
        self.subtitleLineLimit = subtitleLineLimit
        self.leading = leading()
        self.accessory = accessory()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            self.horizontalLayout
            self.stackedLayout
        }
    }

    private var horizontalLayout: some View {
        HStack(alignment: .top, spacing: 12) {
            self.leading

            self.titleBlock
                .layoutPriority(1)

            Spacer(minLength: 8)

            self.accessory
                .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var stackedLayout: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                self.leading

                self.titleBlock
                    .layoutPriority(1)

                Spacer(minLength: 8)
            }

            HStack {
                Spacer(minLength: 0)
                self.accessory
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            self.title.text
                .font(self.titleFont)
                .lineLimit(2)
                .minimumScaleFactor(0.86)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle {
                subtitle.text
                    .font(self.subtitleFont)
                    .foregroundStyle(.secondary)
                    .lineLimit(self.subtitleLineLimit)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Shared switch indicator replacing the 3 duplicated capsule toggles.
/// Native Toggle only hits the switch edge on iOS 26; this full-width button approach
/// gives the whole row a tap target.
struct CarapaceToggleIndicator: View {
    let isOn: Bool

    var body: some View {
        Capsule()
            .fill(self.isOn ? CarapaceBrand.accent : Color.secondary.opacity(0.35))
            .frame(width: 52, height: 32)
            .overlay(alignment: self.isOn ? .trailing : .leading) {
                Circle()
                    .fill(Color.white)
                    .frame(width: 28, height: 28)
                    .padding(2)
                    .shadow(color: Color.black.opacity(0.14), radius: 1, x: 0, y: 1)
            }
    }
}

enum CarapaceStatusTone {
    case ok
    case warn
    case danger
    case info
    case accent
    case teal
    case muted

    var color: Color {
        switch self {
        case .ok: CarapaceBrand.ok
        case .warn: CarapaceBrand.warn
        case .danger: CarapaceBrand.danger
        case .info: CarapaceBrand.info
        case .accent: CarapaceBrand.accent
        case .teal: CarapaceBrand.teal
        case .muted: CarapaceBrand.textSecondary
        }
    }
}

struct CarapaceStatusBadge: View {
    @Environment(\.colorScheme) private var colorScheme
    let label: CarapaceTextValue
    let tone: CarapaceStatusTone

    var body: some View {
        HStack(spacing: CarapaceSpacing.space1 + 2) {
            Circle()
                .fill(self.tone.color)
                .frame(width: 7, height: 7)
                .shadow(color: self.tone.color.opacity(0.55), radius: 3)
            self.label.text
                .font(CarapaceType.caption2SemiBold)
                .foregroundStyle(self.tone.color)
        }
        .padding(.horizontal, CarapaceSpacing.space2)
        .padding(.vertical, 5)
        .background {
            Capsule()
                .fill(self.tone.color.opacity(self.colorScheme == .dark ? 0.14 : 0.10))
        }
    }
}

struct ProValuePill: View {
    @Environment(\.colorScheme) private var colorScheme
    let value: String
    let color: Color

    var body: some View {
        Text(self.value)
            .font(CarapaceType.footnoteSemiBold)
            .foregroundStyle(self.color)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background {
                Capsule()
                    .fill(self.color.opacity(self.colorScheme == .dark ? 0.12 : 0.08))
            }
    }
}

struct CarapaceProMark: View {
    var size: CGFloat = 42
    var shadowRadius: CGFloat = 10
    /// Opt-in tap Easter eggs; leave off when the mark sits inside a control.
    var interactive = false

    var body: some View {
        CarapaceMascotView(interactive: self.interactive)
            .frame(width: self.size, height: self.size)
            .shadow(color: CarapaceBrand.accent.opacity(0.18), radius: self.shadowRadius, y: self.shadowRadius / 3)
            .accessibilityLabel("Carapace")
    }
}

struct ProProgressBar: View {
    let progress: Double
    var color: Color = CarapaceBrand.accentHot

    var body: some View {
        GeometryReader { proxy in
            let clamped = max(0, min(self.progress, 1))
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.10))
                Capsule()
                    .fill(self.color)
                    .frame(width: proxy.size.width * clamped)
            }
        }
        .frame(height: 3)
    }
}

struct CarapaceGatewayCompactPill: View {
    @Environment(NodeAppModel.self) private var appModel

    var body: some View {
        CarapaceStatusBadge(label: .verbatim(self.title), tone: self.tone)
            .accessibilityLabel(
                String(
                    format: String(localized: "Gateway %@"),
                    self.title))
    }

    private var title: String {
        switch GatewayStatusBuilder.build(appModel: self.appModel) {
        case .connected:
            String(localized: "Online")
        case .connecting:
            String(localized: "Connecting")
        case .error:
            String(localized: "Attention")
        case .disconnected:
            String(localized: "Offline")
        }
    }

    private var tone: CarapaceStatusTone {
        switch GatewayStatusBuilder.build(appModel: self.appModel) {
        case .connected:
            .ok
        case .connecting:
            .accent
        case .error:
            .warn
        case .disconnected:
            .muted
        }
    }
}

struct ProStatusRow: View {
    let icon: String
    let title: CarapaceTextValue
    let detail: CarapaceTextValue
    let value: String?
    let color: Color
    var actionTitle: CarapaceTextValue?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ProIconBadge(systemName: self.icon, color: self.color)
            VStack(alignment: .leading, spacing: 4) {
                self.title.text
                    .font(CarapaceType.subheadSemiBold)
                    .lineLimit(1)
                self.detail.text
                    .font(CarapaceType.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                if let value {
                    ProValuePill(value: value, color: self.color)
                }
                if let actionTitle, let action {
                    Button(action: action) {
                        actionTitle.text
                            .font(CarapaceType.captionSemiBold)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}
