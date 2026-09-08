import Foundation
import Testing
@testable import CarapaceChatUI

#if os(macOS)
import AppKit
#endif

#if os(macOS)
private func luminance(_ color: NSColor) throws -> CGFloat {
    let rgb = try #require(color.usingColorSpace(.deviceRGB))
    return 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent
}
#endif

@Suite struct ChatThemeTests {
    @Test(arguments: ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"])
    func `session colors normalize and adapt`(name: String) throws {
        let color = try #require(CarapaceSessionColor(name: " \(name.uppercased()) "))
        #expect(color.rawValue == name)
        #expect(CarapaceChatTheme.relativeLuminance(of: color.tint(in: .dark)) >
            CarapaceChatTheme.relativeLuminance(of: color.tint(in: .light)))
    }

    @Test(arguments: [nil, "", "gray", "grey", "default", "reset", "none", "#ff0000"] as [String?])
    func `unknown session color has no decoration`(name: String?) {
        #expect(CarapaceSessionColor(name: name) == nil)
    }

    @Test func assistantBubbleResolvesForLightAndDark() throws {
        #if os(macOS)
        let lightAppearance = try #require(NSAppearance(named: .aqua))
        let darkAppearance = try #require(NSAppearance(named: .darkAqua))

        let lightResolved = CarapaceChatTheme.resolvedAssistantBubbleColor(for: lightAppearance)
        let darkResolved = CarapaceChatTheme.resolvedAssistantBubbleColor(for: darkAppearance)
        #expect(try luminance(lightResolved) > luminance(darkResolved))
        #else
        #expect(Bool(true))
        #endif
    }
}
