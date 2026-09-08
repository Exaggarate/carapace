import SwiftUI
import Testing
@testable import CarapaceChatUI

struct ChatUserAccentInkTests {
    @Test func lightAccentGetsBlackInk() {
        // #fbbf24: the Control UI contract example of a light accent needing black ink.
        let amber = Color(red: 0xFB / 255.0, green: 0xBF / 255.0, blue: 0x24 / 255.0)
        #expect(CarapaceChatTheme.relativeLuminance(of: amber) > 0.179)
        #expect(CarapaceChatTheme.userText(on: amber) == .black)
    }

    @Test func darkAccentKeepsWhiteInk() {
        let crimson = Color(red: 0x8B / 255.0, green: 0x00 / 255.0, blue: 0x00 / 255.0)
        #expect(CarapaceChatTheme.relativeLuminance(of: crimson) <= 0.179)
        #expect(CarapaceChatTheme.userText(on: crimson) == .white)
    }

    @Test func missingAccentKeepsDefaultUserText() {
        #expect(CarapaceChatTheme.userText(on: nil) == CarapaceChatTheme.userText)
    }

    @Test func luminanceMatchesWcagAnchors() {
        #expect(abs(CarapaceChatTheme.relativeLuminance(of: .white) - 1.0) < 0.001)
        #expect(abs(CarapaceChatTheme.relativeLuminance(of: .black) - 0.0) < 0.001)
    }
}
