import Foundation
import SwabbleKit
import Testing
@testable import Carapace

private let carapaceTranscript = "hey carapace do thing"

private func carapaceSegments(postTriggerStart: TimeInterval) -> [WakeWordSegment] {
    makeSegments(
        transcript: carapaceTranscript,
        words: [
            ("hey", 0.0, 0.1),
            ("carapace", 0.2, 0.1),
            ("do", postTriggerStart, 0.1),
            ("thing", postTriggerStart + 0.2, 0.1),
        ])
}

@Suite struct VoiceWakeManagerExtractCommandTests {
    @Test func extractCommandReturnsNilWhenNoTriggerFound() {
        let transcript = "hello world"
        let segments = makeSegments(
            transcript: transcript,
            words: [("hello", 0.0, 0.1), ("world", 0.2, 0.1)])
        #expect(VoiceWakeManager.extractCommand(from: transcript, segments: segments, triggers: ["carapace"]) == nil)
    }

    @Test func extractCommandTrimsTokensAndResult() {
        let segments = carapaceSegments(postTriggerStart: 0.9)
        let cmd = VoiceWakeManager.extractCommand(
            from: carapaceTranscript,
            segments: segments,
            triggers: ["  carapace  "],
            minPostTriggerGap: 0.3)
        #expect(cmd == "do thing")
    }

    @Test func extractCommandReturnsNilWhenGapTooShort() {
        let segments = carapaceSegments(postTriggerStart: 0.35)
        let cmd = VoiceWakeManager.extractCommand(
            from: carapaceTranscript,
            segments: segments,
            triggers: ["carapace"],
            minPostTriggerGap: 0.3)
        #expect(cmd == nil)
    }

    @Test func extractCommandReturnsNilWhenNothingAfterTrigger() {
        let transcript = "hey carapace"
        let segments = makeSegments(
            transcript: transcript,
            words: [("hey", 0.0, 0.1), ("carapace", 0.2, 0.1)])
        #expect(VoiceWakeManager.extractCommand(from: transcript, segments: segments, triggers: ["carapace"]) == nil)
    }

    @Test func extractCommandIgnoresEmptyTriggers() {
        let segments = carapaceSegments(postTriggerStart: 0.9)
        let cmd = VoiceWakeManager.extractCommand(
            from: carapaceTranscript,
            segments: segments,
            triggers: ["", "   ", "carapace"],
            minPostTriggerGap: 0.3)
        #expect(cmd == "do thing")
    }
}

private func makeSegments(
    transcript: String,
    words: [(String, TimeInterval, TimeInterval)])
-> [WakeWordSegment] {
    var searchStart = transcript.startIndex
    var output: [WakeWordSegment] = []
    for (word, start, duration) in words {
        let range = transcript.range(of: word, range: searchStart..<transcript.endIndex)
        output.append(WakeWordSegment(text: word, start: start, duration: duration, range: range))
        if let range { searchStart = range.upperBound }
    }
    return output
}
