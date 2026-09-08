import Foundation
import CarapaceKit
import SwiftUI

private struct CarapaceChatPreviewTransport: CarapaceChatTransport {
    enum Scenario {
        case connected
        case empty
        case loading
        case error
        case systemNotices
    }

    let scenario: Scenario

    init(scenario: Scenario = .connected) {
        self.scenario = scenario
    }

    func requestHistory(sessionKey: String) async throws -> CarapaceChatHistoryPayload {
        switch self.scenario {
        case .connected:
            break
        case .empty:
            return CarapaceChatHistoryPayload(
                sessionKey: sessionKey,
                sessionId: "preview-empty-session",
                messages: [],
                thinkingLevel: "medium")
        case .loading:
            try await Task.sleep(nanoseconds: 60_000_000_000)
            return CarapaceChatHistoryPayload(
                sessionKey: sessionKey,
                sessionId: "preview-loading-session",
                messages: [],
                thinkingLevel: "medium")
        case .error:
            throw NSError(
                domain: "CarapaceChatPreviewTransport",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Gateway not connected. Check Tailscale and retry."])
        case .systemNotices:
            return CarapaceChatHistoryPayload(
                sessionKey: sessionKey,
                sessionId: "preview-system-notices",
                messages: [
                    Self.systemNotice(
                        text: "[System] Resume the interrupted turn with internal recovery context.",
                        sourceTool: "main_session_restart_recovery",
                        timestamp: 1),
                    Self.systemNotice(
                        text: "[System] Gateway restarted after installing an update.",
                        sourceTool: "restart-sentinel",
                        timestamp: 2),
                    Self.historyMarker(
                        kind: "compaction",
                        id: "preview-compaction",
                        timestamp: 3,
                        tokensBefore: 48000,
                        tokensAfter: 19500),
                    Self.historyMarker(
                        kind: "reset",
                        id: "preview-reset",
                        timestamp: 4),
                ],
                thinkingLevel: "medium")
        }

        return CarapaceChatHistoryPayload(
            sessionKey: sessionKey,
            sessionId: "preview-session",
            messages: [
                Self.message(
                    role: "user",
                    text: "Can you check the gateway status and summarize anything risky?",
                    timestamp: 1),
                Self.message(
                    role: "assistant",
                    text: "Gateway is reachable. The only notable item is that push relay "
                        + "is still using local distribution, so device tests should stay "
                        + "on the local lane.",
                    timestamp: 2),
                Self.toolCall(
                    id: "tool-preview-1",
                    name: "gateway.status",
                    arguments: ["deep": AnyCodable(true)],
                    timestamp: 3),
                Self.toolResult(
                    toolCallId: "tool-preview-1",
                    name: "gateway.status",
                    text: "status=ok, channels=ios,macos, lastHeartbeat=12s",
                    timestamp: 4),
            ],
            thinkingLevel: "medium")
    }

    func listModels(agentID _: String?) async throws -> [CarapaceChatModelChoice] {
        [
            CarapaceChatModelChoice(
                modelID: "gpt-5.6-luna",
                name: "GPT-5.6 Luna",
                provider: "openai",
                contextWindow: 400_000),
            CarapaceChatModelChoice(
                modelID: "sonnet-4.6",
                name: "Claude Sonnet 4.6",
                provider: "anthropic",
                contextWindow: 200_000),
        ]
    }

    func sendMessage(
        sessionKey _: String,
        message _: String,
        thinking _: String,
        idempotencyKey: String,
        attachments _: [CarapaceChatAttachmentPayload]) async throws -> CarapaceChatSendResponse
    {
        CarapaceChatSendResponse(runId: idempotencyKey, status: "ok")
    }

    func listSessions(
        limit _: Int?,
        search _: String?,
        archived _: Bool) async throws -> CarapaceChatSessionsListResponse
    {
        CarapaceChatSessionsListResponse(
            ts: 0,
            path: nil,
            count: 2,
            defaults: CarapaceChatSessionsDefaults(
                modelProvider: "openai",
                model: "gpt-5.6-luna",
                contextTokens: 400_000,
                thinkingLevels: [
                    CarapaceChatThinkingLevelOption(id: "off", label: "off"),
                    CarapaceChatThinkingLevelOption(id: "medium", label: "medium"),
                    CarapaceChatThinkingLevelOption(id: "high", label: "high"),
                ],
                thinkingDefault: "medium",
                mainSessionKey: "main"),
            sessions: [
                Self.session(key: "main", displayName: "Main", updatedAt: 2),
                Self.session(key: "ios-preview", displayName: "iOS preview", updatedAt: 1),
            ])
    }

    func requestHealth(timeoutMs _: Int) async throws -> Bool {
        switch self.scenario {
        case .connected, .empty, .loading, .systemNotices:
            true
        case .error:
            false
        }
    }

    func events() -> AsyncStream<CarapaceChatTransportEvent> {
        AsyncStream { continuation in
            continuation.finish()
        }
    }

    func setActiveSessionKey(_: String) async throws {}

    private static func message(role: String, text: String, timestamp: Double) -> AnyCodable {
        AnyCodable([
            "role": role,
            "content": [["type": "text", "text": text]],
            "timestamp": timestamp,
        ])
    }

    private static func systemNotice(text: String, sourceTool: String, timestamp: Double) -> AnyCodable {
        AnyCodable([
            "role": "user",
            "content": [["type": "text", "text": text]],
            "timestamp": timestamp,
            "provenance": [
                "kind": "internal_system",
                "sourceTool": sourceTool,
            ],
        ])
    }

    private static func historyMarker(
        kind: String,
        id: String,
        timestamp: Double,
        tokensBefore: Double? = nil,
        tokensAfter: Double? = nil) -> AnyCodable
    {
        var marker: [String: Any] = ["kind": kind, "id": id]
        marker["tokensBefore"] = tokensBefore
        marker["tokensAfter"] = tokensAfter
        return AnyCodable([
            "role": "system",
            "content": [],
            "timestamp": timestamp,
            "__carapace": marker,
        ])
    }

    private static func toolCall(
        id: String,
        name: String,
        arguments: [String: AnyCodable],
        timestamp: Double) -> AnyCodable
    {
        AnyCodable([
            "role": "assistant",
            "content": [
                [
                    "type": "toolCall",
                    "id": id,
                    "name": name,
                    "arguments": AnyCodable(arguments),
                ],
            ],
            "timestamp": timestamp,
        ])
    }

    private static func toolResult(
        toolCallId: String,
        name: String,
        text: String,
        timestamp: Double) -> AnyCodable
    {
        AnyCodable([
            "role": "tool",
            "content": [["type": "text", "text": text]],
            "timestamp": timestamp,
            "toolCallId": toolCallId,
            "toolName": name,
        ])
    }

    private static func session(
        key: String,
        displayName: String,
        updatedAt: Double) -> CarapaceChatSessionEntry
    {
        CarapaceChatSessionEntry(
            key: key,
            kind: nil,
            displayName: displayName,
            surface: "ios",
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: updatedAt,
            sessionId: nil,
            systemSent: nil,
            abortedLastRun: nil,
            thinkingLevel: "medium",
            verboseLevel: nil,
            inputTokens: 2500,
            outputTokens: 900,
            totalTokens: 3400,
            modelProvider: "openai",
            model: "gpt-5.6-luna",
            contextTokens: 400_000)
    }
}

#if os(iOS)
#Preview("Chat") {
    CarapaceChatPreview(scenario: .connected)
}

#Preview("Chat connected") {
    CarapaceChatPreview(scenario: .connected)
}

#Preview("Chat empty") {
    CarapaceChatPreview(
        scenario: .empty,
        sessionKey: "empty-preview")
}

#Preview("Chat loading") {
    CarapaceChatPreview(
        scenario: .loading,
        sessionKey: "loading-preview")
}

#Preview("Chat gateway error") {
    CarapaceChatPreview(
        scenario: .error,
        sessionKey: "error-preview")
}

#Preview("System notices") {
    CarapaceChatPreview(
        scenario: .systemNotices,
        sessionKey: "system-notices-preview")
}

#Preview("Onboarding chat") {
    CarapaceChatView(
        viewModel: CarapaceChatViewModel(
            sessionKey: "ios-preview",
            transport: CarapaceChatPreviewTransport()),
        showsSessionSwitcher: false,
        style: .onboarding,
        markdownVariant: .standard,
        userAccent: CarapaceChatTheme.accent)
}
#endif

private struct CarapaceChatPreview: View {
    let scenario: CarapaceChatPreviewTransport.Scenario
    var sessionKey: String = "main"

    var body: some View {
        CarapaceChatView(
            viewModel: CarapaceChatViewModel(
                sessionKey: self.sessionKey,
                transport: CarapaceChatPreviewTransport(scenario: self.scenario)),
            showsSessionSwitcher: true,
            style: .standard,
            markdownVariant: .standard,
            userAccent: CarapaceChatTheme.accent,
            showsAssistantTrace: true)
    }
}
