import Foundation
import Testing
@testable import CarapaceChatUI

private func textContent(_ text: String) -> CarapaceChatMessageContent {
    CarapaceChatMessageContent(type: "text", text: text, mimeType: nil, fileName: nil, content: nil)
}

private func typedTextContent(_ type: String?, _ text: String) -> CarapaceChatMessageContent {
    CarapaceChatMessageContent(type: type, text: text, mimeType: nil, fileName: nil, content: nil)
}

private func toolCallContent(name: String) -> CarapaceChatMessageContent {
    CarapaceChatMessageContent(
        type: "toolCall",
        text: nil,
        mimeType: nil,
        fileName: nil,
        content: nil,
        id: "call-1",
        name: name)
}

private func thinkingContent(_ thinking: String) -> CarapaceChatMessageContent {
    CarapaceChatMessageContent(
        type: "thinking",
        text: nil,
        thinking: thinking,
        mimeType: nil,
        fileName: nil,
        content: nil)
}

@Suite("ChatMessageVisibleText")
struct ChatMessageVisibleTextTests {
    @Test func `assistant visible text skips non text blocks`() {
        let message = CarapaceChatMessage(
            role: "assistant",
            content: [
                textContent("Here is the answer."),
                toolCallContent(name: "exec"),
                textContent("And a follow-up."),
            ],
            timestamp: 1)

        #expect(ChatMessageVisibleText.visibleText(in: message)
            == "Here is the answer.\nAnd a follow-up.")
    }

    @Test func `user text passes through without assistant parsing`() {
        let message = CarapaceChatMessage(
            role: "user",
            content: [textContent("What is <final>up</final>?")],
            timestamp: 1)

        #expect(ChatMessageVisibleText.visibleText(in: message) == "What is <final>up</final>?")
    }

    @Test func `assistant copy excludes thinking while user copy stays exact`() {
        let assistant = CarapaceChatMessage(
            role: "assistant",
            content: [textContent("<think>private reasoning</think>\nVisible **answer**")],
            timestamp: 1)
        let user = CarapaceChatMessage(
            role: "user",
            content: [textContent("Keep <think>this literal tag</think>")],
            timestamp: 1)

        #expect(ChatMessageVisibleText.copyText(in: assistant) == "Visible **answer**")
        #expect(ChatMessageVisibleText.copyText(in: user) == "Keep <think>this literal tag</think>")
    }

    @Test func `assistant display includes structured thinking only when enabled`() {
        let message = CarapaceChatMessage(
            role: "assistant",
            content: [
                thinkingContent("Check the persisted state."),
                textContent("Here is the answer."),
                toolCallContent(name: "read"),
            ],
            timestamp: 1)

        #expect(ChatMessageVisibleText.displayText(in: message, includeThinking: false)
            == "Here is the answer.")
        #expect(ChatMessageVisibleText.displayText(in: message, includeThinking: true)
            == "<think>\nCheck the persisted state.\n</think>\nHere is the answer.")
        #expect(ChatMessageVisibleText.copyText(in: message) == "Here is the answer.")
    }

    @Test func `assistant display preserves responses text types`() {
        let message = CarapaceChatMessage(
            role: "assistant",
            content: [
                typedTextContent("thinking", "private"),
                typedTextContent("output_text", "visible output"),
                typedTextContent("input_text", "visible input"),
                typedTextContent("tool_result", "tool payload"),
                typedTextContent(nil, "legacy visible"),
            ],
            timestamp: 1)

        #expect(
            ChatMessageVisibleText.displayText(in: message, includeThinking: false) ==
                "visible output\nvisible input\nlegacy visible")
    }

    @Test func `responses text visibility follows the chat role contract`() {
        let cases: [(role: String, type: String, expected: Bool)] = [
            ("user", "input_text", true),
            ("assistant", "input_text", true),
            ("assistant", "output_text", true),
            ("user", "output_text", false),
            ("developer", "input_text", false),
            ("toolResult", "input_text", false),
        ]

        for entry in cases {
            #expect(
                ChatMessageVisibleText.isVisibleContentType(entry.type, role: entry.role)
                    == entry.expected)
        }
    }

    @Test func `history decode retains transcript metadata and system row facts`() throws {
        let metadata = try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: Data(#"{"role":"assistant","content":"short","__carapace":{"id":"msg-1","truncated":true}}"#.utf8))
        let marker = try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: Data(#"{"role":"assistant","content":"short\n...(truncated)...","__carapace":{"id":"msg-2"}}"#.utf8))
        let notice = try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: Data(
                #"{"role":"user","content":"[System] resumed","provenance":{"kind":"internal_system","originSessionId":"origin-1","sourceSessionKey":"agent:main","sourceChannel":"system","sourceTool":"restart-sentinel"}}"#
                    .utf8))
        let historyMarker = try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: Data(
                #"{"role":"system","content":[],"__carapace":{"kind":"compaction","id":"compact-1","tokensBefore":22000,"tokensAfter":9000}}"#
                    .utf8))

        #expect(metadata.transcriptMessageID == "msg-1")
        #expect(metadata.isTruncated)
        #expect(marker.transcriptMessageID == "msg-2")
        #expect(marker.isTruncated)
        #expect(notice.provenance == CarapaceChatInputProvenance(
            kind: "internal_system",
            originSessionId: "origin-1",
            sourceSessionKey: "agent:main",
            sourceChannel: "system",
            sourceTool: "restart-sentinel"))
        #expect(historyMarker.historyMarker == CarapaceChatHistoryMarker(
            kind: "compaction",
            id: "compact-1",
            tokensBefore: 22000,
            tokensAfter: 9000))
    }

    @Test @MainActor func `transcript metadata survives message coding round trip`() throws {
        let original = try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: Data(
                #"{"role":"assistant","content":"short","timestamp":1,"__carapace":{"id":"msg-round-trip","runId":"run-round-trip","truncated":true}}"#
                    .utf8))

        let adopted = CarapaceChatViewModel.adoptingCanonicalMessage(
            original,
            over: CarapaceChatMessage(role: "assistant", content: [textContent("short")], timestamp: 0))
        let cacheable = try #require(CarapaceChatSQLiteTranscriptCache.cacheableMessages([adopted]).first)
        let encoded = try JSONEncoder().encode(cacheable)
        let decoded = try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: encoded)
        let encodedObject = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        let encodedMetadata = encodedObject["__carapace"] as? [String: Any]
        let systemRow = CarapaceChatMessage(
            role: "system",
            content: [],
            timestamp: 2,
            provenance: CarapaceChatInputProvenance(
                kind: "internal_system",
                sourceTool: "restart-sentinel"),
            historyMarker: CarapaceChatHistoryMarker(
                kind: "compaction",
                id: "compact-round-trip",
                tokensBefore: 10000,
                tokensAfter: 4000))
        let decodedSystemRow = try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: JSONEncoder().encode(systemRow))

        #expect(decoded.transcriptMessageID == "msg-round-trip")
        #expect(encodedMetadata?["runId"] as? String == "run-round-trip")
        #expect(decoded.isTruncated)
        #expect(decodedSystemRow.provenance == systemRow.provenance)
        #expect(decodedSystemRow.historyMarker == systemRow.historyMarker)
    }

    @Test func `legacy trace mapping sets both independent display options`() {
        #expect(CarapaceChatDisplayOptions.assistantTrace(true) == [.reasoning, .toolActivity])
        #expect(CarapaceChatDisplayOptions.assistantTrace(false).isEmpty)
        #expect(CarapaceChatDisplayOptions.reasoning != .toolActivity)
    }

    @Test func `has visible text ignores tool blank and thinking only messages`() {
        let toolOnly = CarapaceChatMessage(
            role: "assistant",
            content: [toolCallContent(name: "exec")],
            timestamp: 1)
        let blank = CarapaceChatMessage(
            role: "assistant",
            content: [textContent("   ")],
            timestamp: 1)
        let spoken = CarapaceChatMessage(
            role: "assistant",
            content: [textContent("Say this")],
            timestamp: 1)
        let thinkingOnly = CarapaceChatMessage(
            role: "assistant",
            content: [textContent("<think>Do not speak this</think>")],
            timestamp: 1)

        #expect(!ChatMessageVisibleText.hasVisibleText(in: toolOnly))
        #expect(!ChatMessageVisibleText.hasVisibleText(in: blank))
        #expect(!ChatMessageVisibleText.hasVisibleText(in: thinkingOnly))
        #expect(ChatMessageVisibleText.hasVisibleText(in: spoken))
    }
}
