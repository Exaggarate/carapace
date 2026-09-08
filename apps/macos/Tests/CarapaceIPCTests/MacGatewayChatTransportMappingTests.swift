import Foundation
import CarapaceChatUI
import CarapaceKit
import CarapaceProtocol
import Testing
@testable import Carapace

struct MacGatewayChatTransportMappingTests {
    private actor RequestRecorder {
        var payloads: [Data] = []

        func append(_ data: Data) {
            self.payloads.append(data)
        }

        func snapshot() -> [Data] {
            self.payloads
        }
    }

    @Test(arguments: [false, true, nil] as [Bool?])
    func `progress requests negotiate owner scope on the connected server`(supportsOwner: Bool?) async throws {
        let recorder = RequestRecorder()
        let socketSession = GatewayTestWebSocketSession(taskFactory: {
            GatewayTestWebSocketTask(sendHook: { socket, message, sendIndex in
                guard sendIndex > 0 else { return }
                let data: Data = switch message {
                case let .data(value): value
                case let .string(value): Data(value.utf8)
                @unknown default: throw URLError(.cannotParseResponse)
                }
                let frame = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
                let id = try #require(frame["id"] as? String)
                var payload = "{}"
                if frame["method"] as? String == "progressCard.get" {
                    let params = try #require(frame["params"] as? [String: Any])
                    try await recorder.append(JSONSerialization.data(withJSONObject: params))
                    // A released server's closed schema rejects the extra owner field.
                    #expect(supportsOwner == true || params["agentId"] == nil)
                    let owner = params["agentId"] as? String ??
                        CarapaceChatSessionKey.agentID(from: params["sessionKey"] as? String) ?? "main"
                    payload = #"{"card":{"sessionKey":"agent:\#(owner):global","revision":1,"updatedAt":10,"markdown":"\#(owner)","steps":[]}}"#
                }
                socket
                    .emitReceiveSuccess(.data(Data(#"{"type":"res","id":"\#(id)","ok":true,"payload":\#(payload)}"#
                            .utf8)))
            }, receiveHook: { socket, receiveIndex in
                if receiveIndex == 0 { return .data(GatewayWebSocketTestSupport.connectChallengeData()) }
                let hello = GatewayWebSocketTestSupport.connectOkData(
                    id: socket.snapshotConnectRequestID() ?? "connect",
                    methods: ["progressCard.get"],
                    capabilities: supportsOwner == true ? ["progress-card-agent-scope-v1"] : [])
                guard supportsOwner == nil else { return .data(hello) }
                var frame = try #require(JSONSerialization.jsonObject(with: hello) as? [String: Any])
                var payload = try #require(frame["payload"] as? [String: Any])
                var features = try #require(payload["features"] as? [String: Any])
                features.removeValue(forKey: "capabilities")
                payload["features"] = features
                frame["payload"] = payload
                return try .data(JSONSerialization.data(withJSONObject: frame))
            })
        })
        let gateway = GatewayConnection(
            configProvider: { (url: URL(string: "ws://127.0.0.1:1")!, token: nil, password: nil) },
            sessionBox: WebSocketSessionBox(session: socketSession))
        do {
            _ = try await gateway.request(method: "health", params: nil)
            let transport = MacGatewayChatTransport(connection: gateway, defaultGlobalAgentID: "main")
            let ordinary = try await transport.fetchProgressCard(
                sessionKey: "agent:research:global",
                agentID: "research")
            #expect(ordinary?.markdown == "research")
            if supportsOwner == true {
                let global = try await transport.fetchProgressCard(sessionKey: "global", agentID: "research")
                #expect(global?.markdown == "research")
            } else {
                do {
                    _ = try await transport.fetchProgressCard(sessionKey: "global", agentID: "research")
                    Issue.record("Unadvertised owner-scoped progress must not dispatch")
                } catch let error as NSError {
                    #expect(error.localizedDescription == CarapaceChatTransportUpgradeMessage.progressCardAgentScope)
                }
            }
            let params = try await recorder.snapshot().map {
                try #require(JSONSerialization.jsonObject(with: $0) as? [String: String])
            }
            #expect(params == (supportsOwner == true ? [
                ["sessionKey": "agent:research:global"],
                ["sessionKey": "global", "agentId": "research"],
            ] : [["sessionKey": "agent:research:global"]]))
            await gateway.shutdown()
        } catch {
            await gateway.shutdown()
            throw error
        }
    }

    private func withSessionTransport(
        _ run: (MacGatewayChatTransport, RequestRecorder) async throws -> Void) async throws
    {
        let recorder = RequestRecorder()
        let session = GatewayTestWebSocketSession(taskFactory: {
            GatewayTestWebSocketTask(sendHook: { socket, message, sendIndex in
                guard sendIndex > 0 else { return }
                let id = try #require(GatewayWebSocketTestSupport.requestID(from: message))
                let method = try #require(GatewayWebSocketTestSupport.requestMethod(from: message))
                if method != "health" {
                    let data: Data = switch message {
                    case let .data(value): value
                    case let .string(value): Data(value.utf8)
                    @unknown default: throw URLError(.cannotParseResponse)
                    }
                    await recorder.append(data)
                }
                let payload = switch method {
                case "agents.list": GatewayWebSocketTestSupport.agentCatalogPayload
                case "sessions.rewind": #"{"editorText":"rewound draft"}"#
                case "sessions.fork": #"{"sessionKey":"forked","editorText":"continued draft"}"#
                default: #"{"ok":true}"#
                }
                socket.emitReceiveSuccess(.data(Data(
                    #"{"type":"res","id":"\#(id)","ok":true,"payload":\#(payload)}"#.utf8)))
            }, receiveHook: { socket, receiveIndex in
                if receiveIndex == 0 { return .data(GatewayWebSocketTestSupport.connectChallengeData()) }
                return .data(GatewayWebSocketTestSupport.connectOkData(
                    id: socket.snapshotConnectRequestID() ?? "connect",
                    methods: ["agents.list", "sessions.patch", "sessions.delete", "sessions.rewind", "sessions.fork"],
                    capabilities: ["session-unread-ack-contract"]))
            })
        })
        let gateway = GatewayConnection(
            configProvider: { (url: URL(string: "ws://127.0.0.1:1")!, token: nil, password: nil) },
            sessionBox: WebSocketSessionBox(session: session))
        do {
            _ = try await gateway.request(method: "health", params: nil)
            let transport = MacGatewayChatTransport(connection: gateway, defaultGlobalAgentID: "agent-a")
            try await run(transport, recorder)
            await gateway.shutdown()
        } catch {
            await gateway.shutdown()
            throw error
        }
    }

    @Test func `new session rosters preserve selectable choices on their captured connection`() async throws {
        try await self.withSessionTransport { transport, recorder in
            let expected = CarapaceChatAgentsListResponse(
                defaultId: "system",
                agents: [
                    CarapaceChatAgentChoice(id: "zeta", name: " Zeta ", workspaceGit: true),
                    CarapaceChatAgentChoice(id: "legacy"),
                    CarapaceChatAgentChoice(id: "alpha", workspaceGit: false),
                ])
            #expect(try await transport.listAgents() == expected)
            let lease = try #require(await transport.acquireNewSessionRouteLease())
            #expect(try await lease.listAgents() == expected)
            await transport.connection.shutdown()
            await #expect(throws: Error.self) {
                _ = try await lease.listAgents()
            }
            let frames = try await recorder.snapshot().map {
                try #require(JSONSerialization.jsonObject(with: $0) as? [String: Any])
            }
            #expect(frames.map { $0["method"] as? String } == ["agents.list", "agents.list"])
            #expect(frames.allSatisfy { ($0["params"] as? [String: Any])?.isEmpty == true })
        }
    }

    @Test func `mutation lease resolves the current global agent for each request`() async throws {
        try await self.withSessionTransport { transport, recorder in
            let lease = try #require(await transport.acquireSessionMutationRouteLease())
            try await lease.patchSession(
                key: "global",
                label: nil,
                category: nil,
                pinned: true,
                archived: nil,
                unread: nil)
            let observerTransport = transport
            observerTransport.updateDefaultGlobalAgentID(" Agent-B ")
            try await lease.patchSession(
                key: "global",
                label: nil,
                category: nil,
                color: .some(nil),
                pinned: nil,
                archived: nil,
                unread: nil)
            try await lease.deleteSession(key: "agent:agent-b:work")

            let frames = try await recorder.snapshot().map {
                try #require(JSONSerialization.jsonObject(with: $0) as? [String: Any])
            }
            let methods = frames.map { $0["method"] as? String }
            try #require(methods == ["sessions.patch", "sessions.patch", "sessions.delete"])
            let params = try frames.map { try #require($0["params"] as? [String: Any]) }
            #expect(params[0]["key"] as? String == "global")
            #expect(params[0]["agentId"] as? String == "agent-a")
            #expect(params[1]["key"] as? String == "global")
            #expect(params[1]["agentId"] as? String == "agent-b")
            #expect(params[1]["color"] is NSNull)
            #expect(params[2]["key"] as? String == "agent:agent-b:work")
            #expect(params[2]["agentId"] == nil)
            #expect(params[2]["deleteTranscript"] as? Bool == true)
        }
    }

    @Test func `mac chat advertises typed agent rosters and inline widgets`() {
        #expect(GatewayConnection.operatorClientCaps == [
            CarapaceGatewayClientCapability.agentKind,
            CarapaceGatewayClientCapability.inlineWidgets,
            CarapaceGatewayClientCapability.usageRefreshing,
        ])
    }

    @Test func `bare global session target carries normalized selected agent`() {
        let transport = MacGatewayChatTransport(defaultGlobalAgentID: "  Agent-A  ")

        #expect(transport.sessionTarget(for: " GLOBAL ") == .init(
            sessionKey: "GLOBAL",
            agentID: "agent-a"))
        #expect(transport.sessionTarget(for: "agent:agent-a:main") == .init(
            sessionKey: "agent:agent-a:main",
            agentID: nil))
        #expect(transport.sessionTarget(for: "main") == .init(
            sessionKey: "main",
            agentID: nil))

        let snapshotObserverTransport = transport
        snapshotObserverTransport.updateDefaultGlobalAgentID("Agent-B")
        #expect(transport.sessionTarget(for: "global") == .init(
            sessionKey: "global",
            agentID: "agent-b"))
    }

    @Test func `bare global session target tolerates missing selected agent`() {
        let transport = MacGatewayChatTransport()

        #expect(transport.sessionTarget(for: "global") == .init(
            sessionKey: "global",
            agentID: nil))
    }

    @Test func `session list request follows the current routing agent`() {
        let transport = MacGatewayChatTransport(defaultGlobalAgentID: "  Agent-A  ")

        let first = transport.sessionsListRequest(limit: 50, search: nil, archived: false)
        #expect(first.params["agentId"]?.value as? String == "agent-a")

        transport.updateDefaultGlobalAgentID("Agent-B")
        let second = transport.sessionsListRequest(limit: nil, search: "recent", archived: true)
        #expect(second.params["agentId"]?.value as? String == "agent-b")

        let unowned = MacGatewayChatTransport()
            .sessionsListRequest(limit: nil, search: nil, archived: false)
        #expect(unowned.params["agentId"] == nil)
    }

    @Test func `fixed connection does not inherit app wide cache routing`() async throws {
        let url = try #require(URL(string: "wss://fixed.example"))
        let connection = GatewayConnection(configProvider: {
            (url: url, token: nil, password: nil)
        })
        let transport = MacGatewayChatTransport(
            connection: connection,
            outboxGatewayID: "manual-fixed")

        #expect(await transport.currentOutboxGatewayMatchesConnection())
        await connection.shutdown()
    }

    @Test func `session settings request preserves verbosity patch`() {
        let request = MacGatewayChatTransport.sessionSettingsRequest(
            sessionKey: "global",
            agentID: "reviewer",
            patch: CarapaceChatSessionSettingsPatch(
                model: .some("openai/gpt-5.6-sol"),
                thinkingLevel: .some(nil),
                fastMode: .some(.on),
                verboseLevel: .some("full")))

        #expect(request.method == "sessions.patch")
        #expect(request.params["key"]?.value as? String == "global")
        #expect(request.params["agentId"]?.value as? String == "reviewer")
        #expect(request.params["model"]?.value as? String == "openai/gpt-5.6-sol")
        #expect(request.params["thinkingLevel"]?.value is NSNull)
        #expect(request.params["fastMode"]?.value as? Bool == true)
        #expect(request.params["verboseLevel"]?.value as? String == "full")
    }

    @Test func `full message request uses generated gateway field names`() throws {
        let request = try MacGatewayChatTransport.fullMessageRequest(
            sessionKey: "global",
            agentID: "reviewer",
            messageID: "msg-42")

        #expect(request.method == "chat.message.get")
        #expect(request.params["sessionKey"]?.value as? String == "global")
        #expect(request.params["agentId"]?.value as? String == "reviewer")
        #expect(request.params["messageId"]?.value as? String == "msg-42")
        #expect(request.params["maxChars"]?.value as? Int == 500_000)
    }

    @Test func `message rewind and fork dispatch resolved session targets`() async throws {
        try await self.withSessionTransport { transport, recorder in
            transport.updateDefaultGlobalAgentID(" Reviewer ")
            let rewind = try await transport.rewindSession(sessionKey: "global", entryId: " msg-42 ")
            let fork = try await transport.forkSessionAtMessage(sessionKey: "agent:reviewer:main", entryId: "msg-43")

            #expect(rewind.editorText == "rewound draft")
            #expect(fork.sessionKey == "forked")
            #expect(fork.editorText == "continued draft")
            let frames = try await recorder.snapshot().map {
                try #require(JSONSerialization.jsonObject(with: $0) as? [String: Any])
            }
            #expect(frames.map { $0["method"] as? String } == ["sessions.rewind", "sessions.fork"])
            #expect(frames.map { $0["params"] as? [String: String] } == [
                ["sessionKey": "global", "agentId": "reviewer", "entryId": "msg-42"],
                ["sessionKey": "agent:reviewer:main", "entryId": "msg-43"],
            ])
        }
    }

    @Test func `legacy trace preference migrates to independent defaults once`() throws {
        let suiteName = "MacGatewayChatTransportMappingTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(false, forKey: CarapaceChatWindowShell.assistantTraceDefaultsKey)

        #expect(WebChatTracePreferences.displayOptions(defaults: defaults).isEmpty)
        #expect(defaults.object(forKey: CarapaceChatWindowShell.assistantReasoningDefaultsKey) as? Bool == false)
        #expect(defaults.object(forKey: CarapaceChatWindowShell.assistantToolActivityDefaultsKey) as? Bool == false)

        defaults.set(true, forKey: CarapaceChatWindowShell.assistantReasoningDefaultsKey)
        #expect(WebChatTracePreferences.displayOptions(defaults: defaults) == [.reasoning])
    }

    @Test func `snapshot maps to health`() {
        let snapshot = Snapshot(
            presence: [],
            health: ["ok": CarapaceProtocol.AnyCodable(false)],
            stateversion: StateVersion(presence: 1, health: 1),
            uptimems: 123,
            configpath: nil,
            statedir: nil,
            sessiondefaults: nil,
            authmode: nil,
            updateavailable: nil)

        let hello = HelloOk(
            type: "hello",
            _protocol: 2,
            server: [:],
            features: [:],
            snapshot: snapshot,
            controluitabs: nil,
            pluginsurfaceurls: nil,
            auth: [:],
            policy: [:])

        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.snapshot(hello))
        switch mapped {
        case let .health(ok):
            #expect(ok == false)
        default:
            Issue.record("expected .health from snapshot, got \(String(describing: mapped))")
        }
    }

    @Test func `health event maps to health`() {
        let frame = EventFrame(
            type: "event",
            event: "health",
            payload: CarapaceProtocol.AnyCodable(["ok": CarapaceProtocol.AnyCodable(true)]),
            seq: 1,
            stateversion: nil)

        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.event(frame))
        switch mapped {
        case let .health(ok):
            #expect(ok == true)
        default:
            Issue.record("expected .health from health event, got \(String(describing: mapped))")
        }
    }

    @Test func `tick event maps to tick`() {
        let frame = EventFrame(type: "event", event: "tick", payload: nil, seq: 1, stateversion: nil)
        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.event(frame))
        #expect({
            if case .tick = mapped {
                return true
            }
            return false
        }())
    }

    @Test func `sessions changed event maps to authoritative refresh signal`() {
        let payload = CarapaceProtocol.AnyCodable([
            "sessionKey": CarapaceProtocol.AnyCodable("agent:main:main"),
            "agentId": CarapaceProtocol.AnyCodable("main"),
            "reason": CarapaceProtocol.AnyCodable("command-metadata"),
        ])
        let frame = EventFrame(
            type: "event",
            event: "sessions.changed",
            payload: payload,
            seq: 1,
            stateversion: nil)

        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.event(frame))
        guard case let .sessionsChanged(change) = mapped else {
            Issue.record("expected .sessionsChanged, got \(String(describing: mapped))")
            return
        }
        #expect(change == .init(
            sessionKey: "agent:main:main",
            agentId: "main",
            reason: "command-metadata"))
    }

    @Test func `chat event maps to chat`() {
        let payload = CarapaceProtocol.AnyCodable([
            "runId": CarapaceProtocol.AnyCodable("run-1"),
            "sessionKey": CarapaceProtocol.AnyCodable("main"),
            "state": CarapaceProtocol.AnyCodable("final"),
        ])
        let frame = EventFrame(type: "event", event: "chat", payload: payload, seq: 1, stateversion: nil)
        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.event(frame))

        switch mapped {
        case let .chat(chat):
            #expect(chat.runId == "run-1")
            #expect(chat.sessionKey == "main")
            #expect(chat.state == "final")
        default:
            Issue.record("expected .chat from chat event, got \(String(describing: mapped))")
        }
    }

    @Test func `session message event maps to session message`() {
        let payload = CarapaceProtocol.AnyCodable([
            "sessionKey": CarapaceProtocol.AnyCodable("agent:main:main"),
            "messageId": CarapaceProtocol.AnyCodable("msg-1"),
            "messageSeq": CarapaceProtocol.AnyCodable(7),
            "message": CarapaceProtocol.AnyCodable([
                "role": CarapaceProtocol.AnyCodable("user"),
                "content": CarapaceProtocol.AnyCodable([
                    CarapaceProtocol.AnyCodable([
                        "type": CarapaceProtocol.AnyCodable("text"),
                        "text": CarapaceProtocol.AnyCodable("spoken transcript"),
                    ]),
                ]),
                "timestamp": CarapaceProtocol.AnyCodable(1234.5),
            ]),
        ])
        let frame = EventFrame(type: "event", event: "session.message", payload: payload, seq: 1, stateversion: nil)
        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.event(frame))

        switch mapped {
        case let .sessionMessage(message):
            #expect(message.sessionKey == "agent:main:main")
            #expect(message.messageId == "msg-1")
            #expect(message.messageSeq == 7)
            #expect(message.message?.role == "user")
            #expect(message.message?.content.first?.text == "spoken transcript")
        default:
            Issue.record("expected .sessionMessage from session.message event, got \(String(describing: mapped))")
        }
    }

    @Test func `unknown event maps to nil`() {
        let frame = EventFrame(
            type: "event",
            event: "unknown",
            payload: CarapaceProtocol.AnyCodable(["a": CarapaceProtocol.AnyCodable(1)]),
            seq: 1,
            stateversion: nil)
        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.event(frame))
        #expect(mapped == nil)
    }

    @Test func `seq gap maps to seq gap`() {
        let mapped = MacGatewayChatTransport.mapPushToTransportEvent(.seqGap(expected: 1, received: 9))
        #expect({
            if case .seqGap = mapped {
                return true
            }
            return false
        }())
    }
}
