import AppKit
import Foundation
import CarapaceChatUI
import CarapaceKit
import CarapaceProtocol
import OSLog
import SwiftUI

private let webChatSwiftLogger = Logger(subsystem: "ai.carapace", category: "WebChatSwiftUI")
private let webChatThinkingLevelDefaultsKey = "carapace.webchat.thinkingLevel"
private let webChatVerboseLevelDefaultsKey = "carapace.webchat.verboseLevel"

private enum WebChatSwiftUILayout {
    static let windowSize = NSSize(width: 960, height: 700)
    static let windowMinSize = NSSize(width: 640, height: 420)
    static let windowFrameAutosaveName = "CarapaceChatWindow"
}

enum WebChatTracePreferences {
    static func displayOptions(defaults: UserDefaults = AppDefaults.standard) -> CarapaceChatDisplayOptions {
        if let legacyValue = defaults.object(
            forKey: CarapaceChatWindowShell.assistantTraceDefaultsKey) as? Bool
        {
            for key in [
                CarapaceChatWindowShell.assistantReasoningDefaultsKey,
                CarapaceChatWindowShell.assistantToolActivityDefaultsKey,
            ] where defaults.object(forKey: key) == nil {
                defaults.set(legacyValue, forKey: key)
            }
        }

        var options: CarapaceChatDisplayOptions = []
        if defaults.object(forKey: CarapaceChatWindowShell.assistantReasoningDefaultsKey) as? Bool ?? true {
            options.insert(.reasoning)
        }
        if defaults.object(forKey: CarapaceChatWindowShell.assistantToolActivityDefaultsKey) as? Bool ?? true {
            options.insert(.toolActivity)
        }
        return options
    }
}

/// SwiftUI's native toolbar bridge may restore visible title chrome while it
/// installs toolbar items. Keep the full-window chat's titlebar merged.
private final class WebChatWindow: NSWindow {
    var pinnedTitle: String?

    override var title: String {
        didSet {
            // SwiftUI toolbar bridging may replace the operator-facing Gateway
            // name with a session key. Keep Mission Control/window lists useful.
            if let pinnedTitle, title != pinnedTitle {
                self.title = pinnedTitle
            }
        }
    }

    override var titleVisibility: NSWindow.TitleVisibility {
        didSet {
            if self.titleVisibility != .hidden {
                self.titleVisibility = .hidden
            }
        }
    }
}

struct MacGatewayChatTransport: CarapaceChatGatewayTransport {
    var chatGatewayAgentID: String? {
        self.routingIdentity.currentAgentID()
    }

    func requestChatGateway(_ request: CarapaceChatGatewayRequest) async throws -> Data {
        try await self.connection.request(request)
    }

    /// Shared across transport value copies so the live view model and its
    /// snapshot observer cannot diverge on the owner of the bare global alias.
    private final class RoutingIdentity: @unchecked Sendable {
        private let lock = NSLock()
        private var defaultGlobalAgentID: String?

        init(defaultGlobalAgentID: String?) {
            self.defaultGlobalAgentID = Self.normalized(defaultGlobalAgentID)
        }

        func update(defaultGlobalAgentID: String?) {
            self.lock.withLock {
                self.defaultGlobalAgentID = Self.normalized(defaultGlobalAgentID)
            }
        }

        func currentAgentID() -> String? {
            self.lock.withLock { self.defaultGlobalAgentID }
        }

        private static func normalized(_ agentID: String?) -> String? {
            let normalized = agentID?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return normalized?.isEmpty == false ? normalized : nil
        }
    }

    typealias SessionTarget = CarapaceChatSessionTarget

    let connection: GatewayConnection
    let outboxGatewayID: String?
    private let routingIdentity: RoutingIdentity

    init(
        connection: GatewayConnection = .shared,
        outboxGatewayID: String? = nil,
        defaultGlobalAgentID: String? = nil)
    {
        self.connection = connection
        self.outboxGatewayID = outboxGatewayID
        self.routingIdentity = RoutingIdentity(defaultGlobalAgentID: defaultGlobalAgentID)
    }

    func updateDefaultGlobalAgentID(_ agentID: String?) {
        self.routingIdentity.update(defaultGlobalAgentID: agentID)
    }

    func currentOutboxGatewayMatchesConnection() async -> Bool {
        guard self.connection === GatewayConnection.shared,
              let outboxGatewayID
        else { return true }
        let currentGatewayID = await MainActor.run { MacChatTranscriptCache.currentGatewayID() }
        return currentGatewayID == outboxGatewayID
    }

    func requireCurrentOutboxGateway() async throws {
        guard await self.currentOutboxGatewayMatchesConnection() else {
            throw CarapaceChatTransportSendError.notDispatched
        }
    }

    func sessionTarget(for sessionKey: String, overrideAgentID: String? = nil) -> SessionTarget {
        CarapaceChatSessionTarget.resolve(
            sessionKey,
            selectedAgentID: self.routingIdentity.currentAgentID(),
            overrideAgentID: overrideAgentID,
            policy: .preserveBareKeys)
    }

    var outboxRequiresSessionRoutingContract: Bool {
        true
    }

    func requestHistory(sessionKey: String) async throws -> CarapaceChatHistoryPayload {
        let target = self.sessionTarget(for: sessionKey)
        return try await self.connection.chatHistory(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
    }

    func gatewayAdvertisesMethod(_ method: String) async -> Bool? {
        guard let lease = await self.connection.captureServerLease() else { return nil }
        return await self.connection.supportsServerMethod(method, ifCurrentServerLease: lease)
    }

    func fetchProgressCard(sessionKey: String, agentID: String?) async throws -> ProgressCard? {
        let target = self.sessionTarget(for: sessionKey, overrideAgentID: agentID)
        let request = CarapaceChatGatewayRequests.progressCardGet(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
        guard let route = await self.connection.captureServerLease() else { throw CancellationError() }
        if request.params["agentId"] != nil {
            guard let supported = await self.connection.supportsServerCapability(
                .progressCardAgentScope,
                ifCurrentServerLease: route) else { throw CancellationError() }
            guard supported else {
                throw CarapaceChatProgressCardError.ownerScopeUnavailable
            }
        }
        let data = try await self.connection.request(
            method: request.method,
            params: request.params,
            timeoutMs: request.timeoutMs,
            ifCurrentServerLease: route)
        return try CarapaceChatGatewayPayloadCodec.decodeProgressCard(
            data,
            agentID: CarapaceChatSessionKey.agentID(from: target.sessionKey) ?? target.agentID)
    }

    func requestFullMessage(sessionKey: String, messageID: String) async throws -> CarapaceChatMessage? {
        let target = self.sessionTarget(for: sessionKey)
        let request = try Self.fullMessageRequest(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            messageID: messageID)
        let data = try await connection.request(request)
        let result = try JSONDecoder().decode(ChatMessageGetResult.self, from: data)
        guard result.ok, let encodedMessage = result.message else { return nil }
        return try JSONDecoder().decode(
            CarapaceChatMessage.self,
            from: JSONEncoder().encode(encodedMessage))
    }

    static func fullMessageRequest(
        sessionKey: String,
        agentID: String?,
        messageID: String) throws -> CarapaceChatGatewayRequest
    {
        let params = ChatMessageGetParams(
            sessionkey: sessionKey,
            agentid: agentID,
            messageid: messageID,
            maxchars: 500_000)
        let encoded = try JSONEncoder().encode(params)
        return try CarapaceChatGatewayRequest(
            method: "chat.message.get",
            params: JSONDecoder().decode([String: AnyCodable].self, from: encoded),
            timeoutMs: 15000)
    }

    func resolveInlineWidgetResource(
        path: String,
        replacing failedResource: CarapaceChatWidgetResource?) async -> CarapaceChatWidgetResource?
    {
        // Node mode may still own a different Gateway; widgets follow this chat connection.
        await CarapaceChatWidgetURLResolver.resolveResource(
            target: path,
            replacing: failedResource,
            currentSurfaceRoutes: {
                await (node: nil, operatorSurface: self.connection.canvasPluginSurfaceRoute())
            },
            refreshNodeSurfaceRoute: { _ in nil },
            refreshOperatorSurfaceRoute: { observed in
                await self.connection.refreshCanvasPluginSurfaceRoute(replacing: observed?.url)
            })
    }

    func resolveInlineWidgetURL(path: String, replacing failedURL: URL?) async -> URL? {
        await self.resolveInlineWidgetResource(
            path: path,
            replacing: failedURL.map { CarapaceChatWidgetResource(url: $0) })?.url
    }

    func listModels(agentID: String?) async throws -> [CarapaceChatModelChoice] {
        do {
            let data = try await connection.request(CarapaceChatGatewayRequests.modelsList(agentID: agentID))
            return try CarapaceChatGatewayPayloadCodec.decodeModelChoices(data)
        } catch {
            webChatSwiftLogger.warning(
                "models.list failed; hiding model picker: \(error.localizedDescription, privacy: .public)")
            return []
        }
    }

    func acquireSwarmRouteLease() async -> CarapaceChatSwarmRouteLease? {
        guard let lease = await self.connection.captureServerLease() else { return nil }
        let transport = self
        return CarapaceChatSwarmRouteLease(
            isEnabled: { sessionKey in
                try await transport.isSwarmEnabled(sessionKey: sessionKey, serverLease: lease)
            },
            listChildSessions: { parentKey in
                try await transport.listChildSessions(parentKey: parentKey, serverLease: lease)
            })
    }

    func isSwarmEnabled(sessionKey: String) async throws -> Bool {
        try await self.isSwarmEnabled(sessionKey: sessionKey, serverLease: nil)
    }

    private func isSwarmEnabled(
        sessionKey: String,
        serverLease: GatewayConnection.ServerLease?) async throws -> Bool
    {
        let request = CarapaceChatGatewayRequests.chatMetadata(
            sessionKey: sessionKey,
            fallbackAgentID: self.routingIdentity.currentAgentID())
        let data: Data = if let serverLease {
            try await self.connection.request(
                method: request.method,
                params: request.params,
                timeoutMs: request.timeoutMs,
                ifCurrentServerLease: serverLease)
        } else {
            try await self.connection.request(request)
        }
        return try JSONDecoder().decode(CarapaceChatMetadataCapabilities.self, from: data).swarmEnabled
    }

    func listSessions(
        limit: Int?,
        search: String?,
        archived: Bool) async throws -> CarapaceChatSessionsListResponse
    {
        let request = self.sessionsListRequest(
            limit: limit,
            search: search,
            archived: archived)
        let data = try await connection.request(request)
        let decoded = try JSONDecoder().decode(CarapaceChatSessionsListResponse.self, from: data)
        let mainSessionKey = await connection.cachedMainSessionKey()
        let defaults = decoded.defaults.map {
            CarapaceChatSessionsDefaults(
                modelProvider: $0.modelProvider,
                model: $0.model,
                contextTokens: $0.contextTokens,
                thinkingLevels: $0.thinkingLevels,
                thinkingOptions: $0.thinkingOptions,
                thinkingDefault: $0.thinkingDefault,
                mainSessionKey: mainSessionKey)
        } ?? CarapaceChatSessionsDefaults(
            model: nil,
            contextTokens: nil,
            mainSessionKey: mainSessionKey)
        return CarapaceChatSessionsListResponse(
            ts: decoded.ts,
            path: decoded.path,
            count: decoded.count,
            totalCount: decoded.totalCount,
            offset: decoded.offset,
            nextOffset: decoded.nextOffset,
            hasMore: decoded.hasMore,
            defaults: defaults,
            sessions: decoded.sessions)
    }

    func sessionsListRequest(
        limit: Int?,
        search: String?,
        archived: Bool) -> CarapaceChatGatewayRequest
    {
        CarapaceChatGatewayRequests.sessionsList(
            limit: limit,
            search: search,
            archived: archived,
            agentID: self.routingIdentity.currentAgentID())
    }

    func listChildSessions(parentKey: String) async throws -> [CarapaceChatSessionEntry] {
        try await self.listChildSessions(parentKey: parentKey, serverLease: nil)
    }

    private func listChildSessions(
        parentKey: String,
        serverLease: GatewayConnection.ServerLease?) async throws -> [CarapaceChatSessionEntry]
    {
        try await CarapaceChatChildSessionPager.collect { offset in
            let request = CarapaceChatGatewayRequests.sessionsList(
                limit: 10000,
                search: nil,
                archived: false,
                includeGlobal: false,
                spawnedBy: parentKey,
                offset: offset,
                configuredAgentsOnly: true)
            let data: Data = if let serverLease {
                try await self.connection.request(
                    method: request.method,
                    params: request.params,
                    timeoutMs: request.timeoutMs,
                    ifCurrentServerLease: serverLease)
            } else {
                try await self.connection.request(request)
            }
            return try JSONDecoder().decode(CarapaceChatSessionsListResponse.self, from: data)
        }
    }

    func listAgents() async throws -> CarapaceChatAgentsListResponse? {
        let data = try await connection.request(CarapaceChatGatewayRequests.agentsList())
        return try CarapaceChatGatewayPayloadCodec.decodeAgentsList(data)
    }

    func listSessionGroups() async throws -> CarapaceChatSessionGroupsResponse? {
        let data = try await connection.request(CarapaceChatGatewayRequests.sessionGroupsList())
        return try JSONDecoder().decode(CarapaceChatSessionGroupsResponse.self, from: data)
    }

    func putSessionGroups(names: [String]) async throws -> CarapaceChatSessionGroupsMutationResponse {
        let request = CarapaceChatGatewayRequests.sessionGroupsPut(names: names)
        let data = try await connection.request(request)
        return try JSONDecoder().decode(CarapaceChatSessionGroupsMutationResponse.self, from: data)
    }

    func renameSessionGroup(
        name: String,
        to: String) async throws -> CarapaceChatSessionGroupsMutationResponse
    {
        let request = CarapaceChatGatewayRequests.sessionGroupsRename(name: name, to: to)
        let data = try await connection.request(request)
        return try JSONDecoder().decode(CarapaceChatSessionGroupsMutationResponse.self, from: data)
    }

    func deleteSessionGroup(name: String) async throws -> CarapaceChatSessionGroupsMutationResponse {
        let request = CarapaceChatGatewayRequests.sessionGroupsDelete(name: name)
        let data = try await connection.request(request)
        return try JSONDecoder().decode(CarapaceChatSessionGroupsMutationResponse.self, from: data)
    }

    func setSessionModel(sessionKey: String, model: String?) async throws {
        let target = self.sessionTarget(for: sessionKey)
        _ = try await self.patchSessionModel(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            model: model)
    }

    func patchSessionSettings(
        sessionKey: String,
        agentID: String?,
        patch: CarapaceChatSessionSettingsPatch) async throws -> CarapaceChatModelPatchResult?
    {
        try await self.patchSessionSettings(
            sessionKey: sessionKey,
            agentID: agentID,
            patch: patch,
            serverLease: nil)
    }

    private func patchSessionSettings(
        sessionKey: String,
        agentID: String?,
        patch: CarapaceChatSessionSettingsPatch,
        serverLease: GatewayConnection.ServerLease?) async throws -> CarapaceChatModelPatchResult?
    {
        let target = CarapaceChatSessionTarget.resolve(
            sessionKey,
            selectedAgentID: self.routingIdentity.currentAgentID(),
            overrideAgentID: agentID,
            policy: .preserveBareKeys)
        let request = Self.sessionSettingsRequest(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            patch: patch)
        let data: Data = if let serverLease {
            try await self.connection.request(
                method: request.method,
                params: request.params,
                timeoutMs: request.timeoutMs,
                ifCurrentServerLease: serverLease)
        } else {
            try await self.connection.request(request)
        }
        return try JSONDecoder().decode(CarapaceChatModelPatchResult.self, from: data)
    }

    static func sessionSettingsRequest(
        sessionKey: String,
        agentID: String?,
        patch: CarapaceChatSessionSettingsPatch) -> CarapaceChatGatewayRequest
    {
        CarapaceChatGatewayRequests.patchSessionSettings(
            sessionKey: sessionKey,
            agentID: agentID,
            model: patch.model,
            thinkingLevel: patch.thinkingLevel,
            fastMode: patch.fastMode,
            verboseLevel: patch.verboseLevel)
    }

    func acquireSessionSettingsRouteLease() async -> CarapaceChatSessionSettingsRouteLease? {
        guard await self.currentOutboxGatewayMatchesConnection() else { return nil }
        guard let serverLease = await connection.captureServerLease() else { return nil }
        let transport = self
        return CarapaceChatSessionSettingsRouteLease { sessionKey, agentID, patch in
            try await transport.requireCurrentOutboxGateway()
            return try await transport.patchSessionSettings(
                sessionKey: sessionKey,
                agentID: agentID,
                patch: patch,
                serverLease: serverLease)
        }
    }

    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [CarapaceChatAttachmentPayload]) async throws -> CarapaceChatSendResponse
    {
        let target = self.sessionTarget(for: sessionKey)
        return try await self.connection.chatSend(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            message: message,
            thinking: thinking,
            idempotencyKey: idempotencyKey,
            attachments: attachments)
    }

    func sendMessage(
        sessionKey: String,
        agentID: String?,
        expectedSessionRoutingContract: String?,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [CarapaceChatAttachmentPayload]) async throws -> CarapaceChatSendResponse
    {
        let target = self.sessionTarget(for: sessionKey)
        try await self.requireCurrentOutboxGateway()
        guard let route = await connection.captureRoute(),
              let supportsRoutingContract = await connection.supportsServerCapability(
                  .chatSendRoutingContract,
                  ifCurrentRoute: route)
        else { throw CarapaceChatTransportSendError.notDispatched }
        // Outbox replay is capability-gated in acquireOutboxRouteLease. A
        // live send keeps its captured route on older gateways and omits the
        // unsupported atomic routing field.
        let guardedContract = CarapaceChatSessionRoutingContract.expectedValue(
            expectedSessionRoutingContract,
            serverSupportsGuard: supportsRoutingContract)
        return try await self.connection.chatSend(
            sessionKey: target.sessionKey,
            agentID: agentID ?? target.agentID,
            expectedSessionRoutingContract: guardedContract,
            message: message,
            thinking: thinking,
            idempotencyKey: idempotencyKey,
            attachments: attachments,
            ifCurrentRoute: route,
            distinguishPreDispatchRouteChange: true)
    }

    func acquireOutboxRouteLease() async -> CarapaceChatTransportRouteLeaseResult {
        guard self.outboxGatewayID != nil,
              await self.currentOutboxGatewayMatchesConnection()
        else { return .unavailable(reason: nil) }
        guard let route = await connection.captureRoute() else { return .unavailable(reason: nil) }
        guard let supportsRoutingContract = await connection.supportsServerCapability(
            .chatSendRoutingContract,
            ifCurrentRoute: route)
        else { return .unavailable(reason: nil) }
        guard supportsRoutingContract else {
            return .unavailable(
                reason: CarapaceChatTransportUpgradeMessage.routingContract,
                allowsLiveSend: true)
        }
        let supportsSettingsCAS = await connection.supportsServerCapability(
            .sessionSettingsCAS,
            ifCurrentRoute: route) == true
        guard let routingIdentity = try? await connection.sessionRoutingIdentity(
            ifCurrentRoute: route)
        else { return .unavailable(reason: nil) }
        let routingContract = routingIdentity.contract
        return .available(CarapaceChatTransportRouteLease(
            sendTargetedMessageWithSettings: { sessionKey, agentID, settings, message, thinking, id, attachments in
                try await self.requireCurrentOutboxGateway()
                return try await self.connection.chatSend(
                    sessionKey: sessionKey,
                    agentID: agentID,
                    expectedSessionRoutingContract: routingContract,
                    expectedSessionSettings: settings,
                    message: message,
                    thinking: thinking,
                    idempotencyKey: id,
                    attachments: attachments,
                    ifCurrentRoute: route,
                    distinguishPreDispatchRouteChange: true)
            },
            requestTargetedHistory: { sessionKey, agentID in
                try await self.requireCurrentOutboxGateway()
                return try await self.connection.chatHistory(
                    sessionKey: sessionKey,
                    agentID: agentID,
                    ifCurrentRoute: route)
            },
            sessionRoutingContract: routingContract,
            supportsSessionSettingsCAS: supportsSettingsCAS))
    }

    func synthesizeSpeech(text: String) async throws -> CarapaceChatSpeechClip {
        // Capture the lease before validating the pinned gateway: a gateway
        // switch after validation then fails the request via the lease guard
        // instead of re-routing the text to the newly selected gateway.
        guard let serverLease = await connection.captureServerLease() else {
            throw CarapaceChatTransportSendError.notDispatched
        }
        try await self.requireCurrentOutboxGateway()
        return try await MacChatMessageSpeechClient.synthesize(
            text: text,
            serverLease: serverLease,
            connection: self.connection)
    }

    func loadMediaArtifact(
        sessionKey: String,
        artifactId: String,
        kind: CarapaceChatMediaKind,
        playback: CarapaceChatPlaybackMode?) async throws -> CarapaceChatLoadedMedia?
    {
        guard let serverLease = await connection.captureServerLease() else {
            throw CarapaceChatTransportSendError.notDispatched
        }
        let target = self.sessionTarget(for: sessionKey)
        return try await self.connection.loadMediaArtifact(
            sessionKey: target.sessionKey,
            agentID: target.agentID,
            artifactId: artifactId,
            kind: kind,
            playback: playback,
            ifCurrentServerLease: serverLease)
    }

    var supportsSlashCommandCatalog: Bool {
        true
    }

    func createSession(
        key: String,
        label: String?,
        agentID explicitAgentID: String?,
        parentSessionKey: String?,
        worktree: Bool?,
        worktreeBaseRef: String?) async throws -> CarapaceChatCreateSessionResponse
    {
        let agentID = explicitAgentID
            ?? CarapaceChatSessionKey.agentID(from: key)
            ?? parentSessionKey.flatMap { CarapaceChatSessionKey.agentID(from: $0) }
            ?? self.routingIdentity.currentAgentID()
        let request = CarapaceChatGatewayRequests.createSession(
            key: key,
            agentID: agentID,
            label: label,
            parentSessionKey: parentSessionKey,
            worktree: worktree,
            worktreeBaseRef: worktreeBaseRef)
        let data = try await connection.request(request)
        return try JSONDecoder().decode(CarapaceChatCreateSessionResponse.self, from: data)
    }

    func patchSession(
        key: String,
        expectedSessionID: String? = nil,
        label: String??,
        category: String??,
        color: String?? = nil,
        pinned: Bool?,
        archived: Bool?,
        unread: Bool?) async throws
    {
        if let routeLease = await self.acquireSessionMutationRouteLease() {
            try await routeLease.patchSession(
                key: key,
                expectedSessionID: expectedSessionID,
                label: label,
                category: category,
                color: color,
                pinned: pinned,
                archived: archived,
                unread: unread)
            return
        }
        throw CarapaceChatTransportSendError.notDispatched
    }

    func requestHealth(timeoutMs: Int) async throws -> Bool {
        try await self.connection.healthOK(timeoutMs: timeoutMs)
    }

    func waitForRunCompletion(
        runId rawRunId: String,
        timeoutMs: Int) async -> CarapaceChatRunObservation
    {
        let runId = rawRunId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !runId.isEmpty,
              let route = await connection.captureRoute()
        else { return .unavailable }
        do {
            let request = CarapaceChatGatewayRequests.agentWait(runID: runId, timeoutMs: timeoutMs)
            let data = try await connection.request(
                request,
                ifCurrentRoute: route)
            return try CarapaceChatGatewayPayloadCodec.decodeAgentWaitObservation(data)
        } catch {
            webChatSwiftLogger.warning(
                "agent.wait failed runId=\(runId, privacy: .public) "
                    + "error=\(error.localizedDescription, privacy: .public)")
            return .unavailable
        }
    }

    func compactSession(sessionKey: String) async throws {
        let target = self.sessionTarget(for: sessionKey)
        let request = CarapaceChatGatewayRequests.compactSession(
            sessionKey: target.sessionKey,
            agentID: target.agentID)
        let response = try await connection.request(request, retryTransportFailures: false)
        try CarapaceSessionsCompactResponse.requireSuccess(from: response)
    }

    func events() -> AsyncStream<CarapaceChatTransportEvent> {
        AsyncStream { continuation in
            let task = Task {
                do {
                    try await self.connection.refresh()
                } catch {
                    webChatSwiftLogger.error("gateway refresh failed \(error.localizedDescription, privacy: .public)")
                }

                let stream = await self.connection.subscribe()
                var hasSeenSnapshot = false
                for await delivery in stream {
                    if Task.isCancelled {
                        return
                    }
                    guard delivery.isCurrent, let push = delivery.push else { continue }
                    if case .snapshot = push {
                        if hasSeenSnapshot {
                            continuation.yield(.routeChanged)
                        }
                        hasSeenSnapshot = true
                    }
                    if let evt = Self.mapPushToTransportEvent(push) {
                        continuation.yield(evt)
                    }
                }
            }

            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
    }

    static func mapPushToTransportEvent(_ push: GatewayPush) -> CarapaceChatTransportEvent? {
        switch push {
        case let .snapshot(hello):
            let ok = (try? JSONDecoder().decode(
                CarapaceGatewayHealthOK.self,
                from: JSONEncoder().encode(hello.snapshot.health)))?.ok ?? true
            return .health(ok: ok)

        case let .event(evt):
            return CarapaceChatGatewayPayloadCodec.event(from: evt)

        case .seqGap:
            return .seqGap
        }
    }
}

// MARK: - Window controller

private enum MacChatMessageSpeechError: LocalizedError {
    case invalidRequest
    case emptyAudio
    case unsupportedTransport

    var errorDescription: String? {
        switch self {
        case .invalidRequest:
            "Failed to encode tts.speak request"
        case .emptyAudio:
            "Gateway tts.speak returned empty audio"
        case .unsupportedTransport:
            "Gateway TTS is unavailable for this chat transport"
        }
    }
}

private enum MacChatMessageSpeechClient {
    private static let requestTimeoutMs: Double = 60000

    static func synthesize(
        text: String,
        serverLease: GatewayConnection.ServerLease,
        connection: GatewayConnection) async throws -> CarapaceChatSpeechClip
    {
        let encoded = try JSONEncoder().encode(TtsSpeakParams(text: text))
        guard let params = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] else {
            throw MacChatMessageSpeechError.invalidRequest
        }
        let responseData = try await connection.request(
            method: "tts.speak",
            params: params.mapValues(AnyCodable.init),
            timeoutMs: self.requestTimeoutMs,
            ifCurrentServerLease: serverLease)
        let response = try JSONDecoder().decode(TtsSpeakResult.self, from: responseData)
        guard let audioData = Data(base64Encoded: response.audiobase64), !audioData.isEmpty else {
            throw MacChatMessageSpeechError.emptyAudio
        }
        return CarapaceChatSpeechClip(
            data: audioData,
            outputFormat: response.outputformat,
            mimeType: response.mimetype,
            fileExtension: response.fileextension)
    }
}

@MainActor
private struct MacChatSurface: View {
    @State private var viewModel: CarapaceChatViewModel
    @State private var appState = AppStateStore.shared
    @State private var talkController = TalkModeController.shared
    @State private var audioInputCatalog = MacChatAudioInputCatalog()
    @AppStorage(CarapaceChatWindowShell.assistantReasoningDefaultsKey, store: AppDefaults.standard)
    private var showsReasoning = WebChatTracePreferences.displayOptions().contains(.reasoning)
    @AppStorage(CarapaceChatWindowShell.assistantToolActivityDefaultsKey, store: AppDefaults.standard)
    private var showsToolActivity = WebChatTracePreferences.displayOptions().contains(.toolActivity)

    private let usesPrimaryAppRuntime: Bool
    private let speech: CarapaceChatSpeechController
    private let voiceNoteRecorder: CarapaceVoiceNoteRecorder

    init(
        viewModel: CarapaceChatViewModel,
        usesPrimaryAppRuntime: Bool,
        speech: CarapaceChatSpeechController,
        voiceNoteRecorder: CarapaceVoiceNoteRecorder)
    {
        _viewModel = State(initialValue: viewModel)
        self.usesPrimaryAppRuntime = usesPrimaryAppRuntime
        self.speech = speech
        self.voiceNoteRecorder = voiceNoteRecorder
    }

    var body: some View {
        CarapaceChatWindowShell(
            viewModel: self.viewModel,
            userAccent: ColorHexSupport.color(fromHex: self.appState.effectiveAccentHex),
            displayOptions: self.displayOptions,
            emptyAssistantIntro: Self.emptyAssistantIntro,
            emptyAssistantPrompts: Self.emptyAssistantPrompts,
            talkControl: self.talkControl,
            voiceNoteControl: self.voiceNoteControl,
            speech: self.speech,
            mediaPlaybackAllowed: {
                !AppStateStore.shared.talkEnabled &&
                    !self.voiceNoteRecorder.ownsPendingChatAttachment
            })
            .onAppear { self.audioInputCatalog.start() }
            .onDisappear { self.audioInputCatalog.stop() }
    }

    private var talkControl: CarapaceChatTalkControl {
        CarapaceChatTalkControl(
            isEnabled: self.usesPrimaryAppRuntime && self.appState.talkEnabled,
            isListening: self.usesPrimaryAppRuntime &&
                !self.talkController.isPaused && self.talkController.phase == .listening,
            isSpeaking: self.usesPrimaryAppRuntime &&
                !self.talkController.isPaused && self.talkController.phase == .speaking,
            isGatewayConnected: self.viewModel.healthOK,
            statusText: self.talkStatusText,
            // macOS exposes live phase but not the runtime's resolved TTS provider.
            // An empty label avoids presenting stale config as current state.
            providerLabel: "",
            level: self.talkController.level,
            partialTranscript: self.talkController.partialTranscript,
            recentTranscript: self.talkController.recentTranscripts,
            inputDevices: self.audioInputCatalog.chatDevices,
            selectedInputDeviceID: self.appState.voiceWakeMicID.isEmpty ? nil : self.appState.voiceWakeMicID,
            selectInputDevice: { deviceID in
                self.audioInputCatalog.select(deviceID, state: self.appState)
            },
            toggle: { sessionKey in
                guard self.usesPrimaryAppRuntime else { return }
                WebChatManager.shared.recordActiveSessionKey(sessionKey)
                Task {
                    await AppStateStore.shared.setTalkEnabled(!AppStateStore.shared.talkEnabled)
                }
            })
    }

    private var displayOptions: CarapaceChatDisplayOptions {
        var options: CarapaceChatDisplayOptions = []
        if self.showsReasoning {
            options.insert(.reasoning)
        }
        if self.showsToolActivity {
            options.insert(.toolActivity)
        }
        return options
    }

    private var voiceNoteControl: CarapaceChatVoiceNoteControl {
        CarapaceChatVoiceNoteControl(
            recorder: self.voiceNoteRecorder,
            // Enabled Talk Mode owns microphone admission through teardown,
            // even while its visible phase is thinking or speaking.
            isTalkActive: self.appState.talkEnabled)
    }

    private var talkStatusText: String {
        guard self.usesPrimaryAppRuntime else {
            return String(localized: "Talk mode uses the primary Gateway window")
        }
        guard self.appState.talkEnabled else { return String(localized: "Talk mode off") }
        if self.talkController.isPaused {
            return String(localized: "Talk mode paused")
        }
        return switch self.talkController.phase {
        case .idle: String(localized: "Talk mode ready")
        case .listening: String(localized: "Listening")
        case .thinking: String(localized: "Thinking")
        case .speaking: String(localized: "Speaking")
        }
    }

    private static let emptyAssistantIntro = String(localized: "What would you like to work on?")
    private static let emptyAssistantPrompts: [CarapaceChatView.StarterPrompt] = [
        .init(
            id: "check-status",
            title: String(localized: "Check Carapace status"),
            prompt: String(localized: "Summarize the current Carapace status and tell me what needs attention.")),
        .init(
            id: "show-capabilities",
            title: String(localized: "What can you do?"),
            prompt: String(localized: "Show me what you can help with on this Mac right now.")),
        .init(
            id: "catch-up",
            title: String(localized: "Catch me up"),
            prompt: String(localized: "Summarize what happened in my threads since yesterday.")),
    ]
}

/// Bridges the view model's session switches out of the controller. The view
/// model is constructed before `self`, so the closure targets this box and the
/// controller re-points it after initialization.
@MainActor
private final class WebChatSessionKeyRelay {
    var onChange: ((String) -> Void)?
}

@MainActor
final class WebChatSwiftUIWindowController: NSObject, NSWindowDelegate {
    private let sessionKey: String
    private let viewModel: CarapaceChatViewModel
    private let contentController: NSViewController
    private let sessionKeyRelay: WebChatSessionKeyRelay
    private let speech: CarapaceChatSpeechController
    private let voiceNoteRecorder: CarapaceVoiceNoteRecorder
    private var routingIdentityTask: Task<Void, Never>?
    private var window: NSWindow?
    var onClosed: (() -> Void)?
    var onVisibilityChanged: ((Bool) -> Void)?
    /// Fires when the hosted chat switches sessions in place (sidebar,
    /// composer picker, /new) so the owner can track what this surface shows.
    var onSessionKeyChanged: ((String) -> Void)?

    convenience init(
        sessionKey: String,
        agentID: String? = nil,
        initialDraft: String? = nil,
        connection: GatewayConnection = .shared,
        gatewayID: String? = nil,
        windowTitle: String = "Carapace Chat",
        windowAutosaveName: String = WebChatSwiftUILayout.windowFrameAutosaveName)
    {
        // Primary route changes retire the owning window synchronously,
        // so binding the cache identity at construction stays correct. One
        // store instance backs both the transcript cache and the offline
        // command outbox.
        let context: MacChatTranscriptCache.Context? = if let gatewayID {
            MacChatTranscriptCache.makeContext(gatewayID: gatewayID)
        } else {
            MacChatTranscriptCache.makeContext()
        }
        self.init(
            sessionKey: sessionKey,
            agentID: agentID,
            initialDraft: initialDraft,
            connection: connection,
            cachedRoutingIdentity: context?.routingIdentity,
            store: context?.store,
            windowTitle: windowTitle,
            windowAutosaveName: windowAutosaveName)
    }

    convenience init(
        sessionKey: String,
        agentID: String?,
        initialDraft: String? = nil,
        connection: GatewayConnection = .shared,
        cachedRoutingIdentity: CarapaceChatSessionRoutingIdentity?,
        store: CarapaceChatSQLiteTranscriptCache?,
        windowTitle: String = "Carapace Chat",
        windowAutosaveName: String = WebChatSwiftUILayout.windowFrameAutosaveName)
    {
        let explicitAgentID = WebChatRoute.normalizedAgentID(agentID)
        let effectiveAgentID = Self.effectiveAgentID(
            explicitAgentID: explicitAgentID,
            cachedDefaultAgentID: cachedRoutingIdentity?.defaultAgentID)
        self.init(
            sessionKey: sessionKey,
            initialDraft: initialDraft,
            transport: MacGatewayChatTransport(
                connection: connection,
                outboxGatewayID: store?.gatewayID,
                defaultGlobalAgentID: effectiveAgentID),
            initialActiveAgentID: effectiveAgentID,
            explicitAgentID: explicitAgentID,
            initialSessionRoutingContract: cachedRoutingIdentity?.contract,
            transcriptCache: store,
            outbox: store,
            windowTitle: windowTitle,
            windowAutosaveName: windowAutosaveName)
    }

    init(
        sessionKey: String,
        initialDraft: String? = nil,
        transport: any CarapaceChatTransport,
        initialActiveAgentID: String? = nil,
        explicitAgentID: String? = nil,
        initialSessionRoutingContract: String? = nil,
        transcriptCache: (any CarapaceChatTranscriptCache)? = nil,
        outbox: (any CarapaceChatCommandOutbox)? = nil,
        windowTitle: String = "Carapace Chat",
        windowAutosaveName: String = WebChatSwiftUILayout.windowFrameAutosaveName)
    {
        self.sessionKey = sessionKey
        let initialActiveAgentID = WebChatRoute.normalizedAgentID(initialActiveAgentID)
        let voiceNoteRecorder = CarapaceVoiceNoteRecorder()
        voiceNoteRecorder.setCaptureAdmissionHandler {
            !AppStateStore.shared.talkEnabled
        }
        self.voiceNoteRecorder = voiceNoteRecorder
        let speech = CarapaceChatSpeechController { text in
            guard let transport = transport as? MacGatewayChatTransport else {
                throw MacChatMessageSpeechError.unsupportedTransport
            }
            return try await transport.synthesizeSpeech(text: text)
        }
        self.speech = speech
        let sessionKeyRelay = WebChatSessionKeyRelay()
        self.sessionKeyRelay = sessionKeyRelay
        let vm = CarapaceChatViewModel(
            sessionKey: sessionKey,
            transport: transport,
            activeAgentId: initialActiveAgentID,
            sessionRoutingContract: initialSessionRoutingContract,
            attachmentOwnerIsActive: { voiceNoteRecorder.ownsPendingChatAttachment },
            transcriptCache: transcriptCache,
            outbox: outbox,
            initialThinkingLevel: Self.persistedThinkingLevel(),
            initialVerboseLevel: Self.persistedVerboseLevel(),
            onSessionChanged: { key in
                sessionKeyRelay.onChange?(key)
            },
            onThinkingPreferenceChanged: { level in
                if let level {
                    AppDefaults.standard.set(level, forKey: webChatThinkingLevelDefaultsKey)
                } else {
                    AppDefaults.standard.removeObject(forKey: webChatThinkingLevelDefaultsKey)
                }
            },
            onVerbosePreferenceChanged: { level in
                Self.persistVerbosePreference(level)
            })
        if let initialDraft,
           !initialDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            vm.input = initialDraft
        }
        self.viewModel = vm
        let explicitAgentID = WebChatRoute.normalizedAgentID(explicitAgentID)
        let gatewayTransport = transport as? MacGatewayChatTransport
        let usesPrimaryAppRuntime = gatewayTransport.map { $0.connection === GatewayConnection.shared } ?? false
        // Custom transports have no Gateway owner; never attach them to the primary connection.
        if let gatewayTransport {
            let chatConnection = gatewayTransport.connection
            self.routingIdentityTask = Task { @MainActor [weak vm] in
                let pushes = await chatConnection.subscribe()
                for await delivery in pushes {
                    guard !Task.isCancelled, let vm else { return }
                    guard delivery.isCurrent, case .snapshot = delivery.push else { continue }
                    let routingIdentity = try? await chatConnection.sessionRoutingIdentity(
                        ifCurrentRoute: delivery.serverLease.route)
                    guard !Task.isCancelled else { return }
                    guard delivery.isCurrent else { continue }
                    if let routingIdentity {
                        // An explicit navigation agent owns this window; gateway
                        // default refreshes only supply the fallback route.
                        let effectiveAgentID = Self.effectiveAgentID(
                            explicitAgentID: explicitAgentID,
                            cachedDefaultAgentID: routingIdentity.defaultAgentID)
                        gatewayTransport.updateDefaultGlobalAgentID(effectiveAgentID)
                        // Keep request and cache ownership in lockstep before the
                        // persistence await can admit a roster refresh.
                        vm.syncDeliveryIdentity(
                            activeAgentId: effectiveAgentID,
                            sessionRoutingContract: routingIdentity.contract)
                        if let store = transcriptCache as? CarapaceChatSQLiteTranscriptCache,
                           !usesPrimaryAppRuntime || store.gatewayID == MacChatTranscriptCache.currentGatewayID(),
                           let persistedIdentity = CarapaceChatSessionRoutingIdentity(
                               contract: routingIdentity.contract)
                        {
                            await store.storeSessionRoutingIdentity(persistedIdentity)
                        }
                    }
                }
            }
        }
        // Full window: native split-view shell with sessions sidebar and
        // toolbar pickers bridged into the NSToolbar.
        let hosting = NSHostingController(rootView: MacChatSurface(
            viewModel: vm,
            usesPrimaryAppRuntime: usesPrimaryAppRuntime,
            speech: speech,
            voiceNoteRecorder: voiceNoteRecorder))
        self.contentController = hosting
        super.init()
        self.window = Self.makeWindow(
            contentViewController: self.contentController,
            title: windowTitle,
            autosaveName: windowAutosaveName)
        self.window?.delegate = self
        sessionKeyRelay.onChange = { [weak self] key in
            self?.onSessionKeyChanged?(key)
        }
    }

    func applyDraftIfEmpty(_ draft: String?) {
        guard self.viewModel.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let draft,
              !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }
        self.viewModel.input = draft
    }

    func show() {
        guard let window else { return }
        self.ensureWindowSize()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.onVisibilityChanged?(true)
    }

    func cascade(from source: WebChatSwiftUIWindowController?) {
        guard let window,
              let sourceWindow = source?.window,
              sourceWindow !== window
        else { return }
        let bounds = sourceWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        window.setFrame(
            WindowPlacement.cascadedFrame(from: sourceWindow.frame, in: bounds),
            display: false)
    }

    func close() {
        self.window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        guard notification.object as? NSWindow === self.window else { return }
        self.routingIdentityTask?.cancel()
        self.routingIdentityTask = nil
        self.viewModel.detachTransport()
        self.onVisibilityChanged?(false)
        let onClosed = self.onClosed
        self.onClosed = nil
        self.window = nil
        onClosed?()
    }

    static func persistedThinkingLevel(defaults: UserDefaults = AppDefaults.standard) -> String? {
        let stored = defaults.string(forKey: webChatThinkingLevelDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard let stored,
              ["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max", "ultra"].contains(stored)
        else {
            return nil
        }
        return stored
    }

    static func persistedVerboseLevel(defaults: UserDefaults = AppDefaults.standard) -> String? {
        let stored = defaults.string(forKey: webChatVerboseLevelDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return CarapaceChatViewModel.verboseLevelOptions.contains(stored ?? "") ? stored : nil
    }

    static func persistVerbosePreference(_ level: String?, defaults: UserDefaults = AppDefaults.standard) {
        if let level {
            defaults.set(level, forKey: webChatVerboseLevelDefaultsKey)
        } else {
            defaults.removeObject(forKey: webChatVerboseLevelDefaultsKey)
        }
    }

    static func effectiveAgentID(
        explicitAgentID: String?,
        cachedDefaultAgentID: String?) -> String?
    {
        WebChatRoute.normalizedAgentID(explicitAgentID)
            ?? WebChatRoute.normalizedAgentID(cachedDefaultAgentID)
    }

    private static func makeWindow(
        contentViewController: NSViewController,
        title: String,
        autosaveName: String) -> NSWindow
    {
        let window = WebChatWindow(
            contentRect: NSRect(origin: .zero, size: WebChatSwiftUILayout.windowSize),
            styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false)
        window.title = title
        window.pinnedTitle = title
        window.contentViewController = contentViewController
        // Attaching an NSHostingController resets scene bridging to `.all`;
        // opt back into toolbar items only so SwiftUI cannot restore the title.
        (contentViewController as? NSHostingController<MacChatSurface>)?
            .sceneBridgingOptions = [.toolbars]
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        // Keep the SwiftUI toolbar controls, but merge their unified row
        // with the traffic lights instead of stacking it below a title band.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.toolbarStyle = .unified
        window.titlebarSeparatorStyle = .none
        window.isMovableByWindowBackground = true
        window.center()
        window.setFrameAutosaveName(autosaveName)
        WindowPlacement.ensureOnScreen(window: window, defaultSize: WebChatSwiftUILayout.windowSize)
        window.minSize = WebChatSwiftUILayout.windowMinSize
        return window
    }

    private func ensureWindowSize() {
        guard let window else { return }
        let current = window.frame.size
        let min = WebChatSwiftUILayout.windowMinSize
        if current.width < min.width || current.height < min.height {
            let frame = WindowPlacement.centeredFrame(size: WebChatSwiftUILayout.windowSize)
            window.setFrame(frame, display: false)
        }
    }

    #if DEBUG
    var _testWindow: NSWindow? {
        self.window
    }

    var _testSceneBridgingOptions: NSHostingSceneBridgingOptions? {
        (self.contentController as? NSHostingController<MacChatSurface>)?.sceneBridgingOptions
    }

    var _testDraft: String {
        self.viewModel.input
    }
    #endif
}
