import SwiftUI

struct CarapaceDocsScreen: View {
    private let docsURL = URL(string: "https://github.com/Exaggarate/carapace")!
    private let gatewayURL = URL(string: "https://github.com/Exaggarate/carapace")!
    private let pairingURL = URL(string: "https://github.com/Exaggarate/carapace")!
    let headerSidebarAction: CarapaceSidebarHeaderAction?
    let usesNativeNavigationChrome: Bool
    let gatewayAction: (() -> Void)?

    init(
        headerSidebarAction: CarapaceSidebarHeaderAction? = nil,
        usesNativeNavigationChrome: Bool = false,
        gatewayAction: (() -> Void)? = nil)
    {
        self.headerSidebarAction = headerSidebarAction
        self.usesNativeNavigationChrome = usesNativeNavigationChrome
        self.gatewayAction = gatewayAction
    }

    var body: some View {
        ZStack {
            CarapaceProBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !self.usesNativeNavigationChrome {
                        self.headerCard
                    }
                    self.linkCard
                }
                .padding(.vertical, 18)
                .font(CarapaceType.body)
            }
        }
        .navigationTitle("Docs")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(self.usesNativeNavigationChrome ? .visible : .hidden, for: .navigationBar)
        .toolbar {
            if self.usesNativeNavigationChrome, let gatewayAction {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: gatewayAction) {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .font(CarapaceType.subheadSemiBold)
                    }
                    .accessibilityLabel("Gateway settings")
                }
            }
            if self.usesNativeNavigationChrome, let headerSidebarAction {
                CarapaceSidebarToolbarItem(
                    action: headerSidebarAction,
                    placement: .topBarLeading)
            }
        }
    }

    private var headerCard: some View {
        ProCard(radius: CarapaceProMetric.cardRadius) {
            CarapaceAdaptiveHeaderRow(
                title: "Docs",
                subtitle: "Gateway setup, pairing, channels, and mobile node reference.",
                titleFont: CarapaceType.headline,
                subtitleFont: CarapaceType.caption)
            {
                HStack(spacing: 10) {
                    if let headerSidebarAction {
                        CarapaceSidebarHeaderLeadingSlot(action: headerSidebarAction)
                    }
                    ProIconBadge(systemName: "book", color: CarapaceBrand.accent)
                }
            } accessory: {
                self.gatewayPill
            }
        }
        .padding(.horizontal, CarapaceProMetric.pagePadding)
    }

    @ViewBuilder
    private var gatewayPill: some View {
        if let gatewayAction {
            Button(action: gatewayAction) {
                CarapaceGatewayCompactPill()
            }
            .buttonBorderShape(.capsule)
            .carapaceGlassButton()
            .accessibilityHint("Opens Settings / Gateway")
        } else {
            CarapaceGatewayCompactPill()
        }
    }

    private var linkCard: some View {
        ProCard(padding: 0, radius: CarapaceProMetric.cardRadius) {
            VStack(spacing: 0) {
                self.docsLinkRow(
                    title: "Docs Home",
                    detail: "Browse the current Carapace reference.",
                    icon: "book",
                    url: self.docsURL)
                Divider().padding(.leading, 58)
                self.docsLinkRow(
                    title: "Gateway",
                    detail: "Connection, auth, and diagnostics.",
                    icon: "network",
                    url: self.gatewayURL)
                Divider().padding(.leading, 58)
                self.docsLinkRow(
                    title: "Pairing",
                    detail: "Mobile setup codes, QR, and node approval.",
                    icon: "qrcode",
                    url: self.pairingURL)
            }
        }
        .padding(.horizontal, CarapaceProMetric.pagePadding)
    }

    private func docsLinkRow(title: String, detail: String, icon: String, url: URL) -> some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                ProIconBadge(systemName: icon, color: CarapaceBrand.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(CarapaceType.subheadSemiBold)
                    Text(detail)
                        .font(CarapaceType.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right")
                    .font(CarapaceType.captionBold)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
