import Foundation
import Testing
@testable import CarapaceKit

struct WatchChatDeliveryStoreTests {
    @Test func `command receipt and ack use a closed bounded wire family`() throws {
        let command = Self.command(body: .quickReply(
            promptId: "prompt", actionId: "yes", actionLabel: "Yes", note: "A note"))
        let payload = try CarapaceWatchChatDeliveryCodec.encode(command)
        #expect(try CarapaceWatchChatDeliveryCodec.decodeCommandStructure(payload) == command)
        #expect(command
            .text == "Watch reply: Yes\npromptId=prompt\nactionId=yes\nreplyId=command\nsentAtMs=1000\nnote=A note")
        let receipt = Self.terminal(command)
        let receiptPayload = try CarapaceWatchChatDeliveryCodec.encode(receipt)
        #expect(try CarapaceWatchChatDeliveryCodec.decodeReceipt(receiptPayload) == receipt)
        let ack = CarapaceWatchChatDeliveryReceiptAck(
            context: command.context, commandId: command.commandId, receiptId: "receipt")
        #expect(try CarapaceWatchChatDeliveryCodec.decodeReceiptAck(
            CarapaceWatchChatDeliveryCodec.encode(ack)) == ack)
        let rejected = Self.rejection(command, code: "routing_changed")
        #expect(try CarapaceWatchChatDeliveryCodec.decodeReceipt(
            CarapaceWatchChatDeliveryCodec.encode(rejected)) == rejected)
        #expect(rejected.isFinal && rejected.terminal == nil)
        #expect(throws: CarapaceWatchChatDeliveryError.self) {
            try CarapaceWatchChatDeliveryCodec.validateReceipt(Self.rejection(command, code: "capacity"))
        }

        var extraField = payload
        extraField["transport"] = "sendMessage"
        #expect(throws: CarapaceWatchChatDeliveryError.self) {
            try CarapaceWatchChatDeliveryCodec.decodeCommandStructure(extraField)
        }
        var mixedBody = payload
        var body = try #require(payload["body"] as? [String: Any])
        body["chat"] = ["text": "another command"]
        mixedBody["body"] = body
        #expect(throws: CarapaceWatchChatDeliveryError.self) {
            try CarapaceWatchChatDeliveryCodec.decodeCommandStructure(mixedBody)
        }
    }

    @Test(arguments: [String(repeating: "a", count: 4001), String(repeating: "👨‍👩‍👧‍👦", count: 1000)])
    func `oversize commands reject while replies keep a bounded grapheme safe ellipsis`(text: String) throws {
        #expect(throws: CarapaceWatchChatDeliveryError.self) {
            try CarapaceWatchChatDeliveryCodec.validateCommand(Self.command(body: .chat(text: text)), nowMs: 1000)
        }
        let bounded = CarapaceWatchChatDeliveryCodec.boundedReplyText(text)
        #expect(bounded.hasSuffix("…"))
        #expect(bounded.count <= 4000)
        #expect(bounded.utf8.count <= 16384)
        #expect(text.hasPrefix(String(bounded.dropLast())))
        try CarapaceWatchChatDeliveryCodec.validateReceipt(Self.terminal(Self.command(), text: bounded))
    }

    @Test func `opaque contexts and command identities remain byte exact`() {
        let composed = "caf\u{00E9}"
        let decomposed = "cafe\u{0301}"
        #expect(composed == decomposed)
        let left = Self.context(gateway: composed)
        let right = Self.context(gateway: decomposed)
        #expect(left != right)
        #expect(Set([left, right]).count == 2)
        #expect(Self.command(id: composed) != Self.command(id: decomposed))
        #expect(Self.command(context: left) != Self.command(context: right))
    }

    @Test func `reopen keeps unsent commands and terminal receipt precedes durable acknowledgment`() async throws {
        try await Self.withDatabase { url in
            let command = Self.command()
            let writer = CarapaceWatchChatDeliveryStore(databaseURL: url)
            try await writer.enqueue(command, nowMs: 1000)
            let reopened = CarapaceWatchChatDeliveryStore(databaseURL: url)
            #expect(try await reopened.pendingCommands(nowMs: 1001) == [command])
            try await reopened.enqueue(command, nowMs: 1001)
            let terminal = Self.terminal(command)
            let acknowledgment = try #require(await reopened.record(terminal, nowMs: 1002))

            let afterAck = CarapaceWatchChatDeliveryStore(databaseURL: url)
            #expect(try await afterAck.entries(context: command.context, nowMs: 1003).map(\.receipt) == [terminal])
            #expect(try await afterAck.pendingCommands(nowMs: 1003).isEmpty)
            #expect(try await afterAck.record(terminal, nowMs: 1003) == acknowledgment)
            #expect(try await afterAck.record(.init(
                context: command.context, commandId: command.commandId, state: .admitted(atMs: 1001)), nowMs: 1003) ==
                nil)
            #expect(try await afterAck.entries(context: command.context, nowMs: 1003).first?.receipt == terminal)
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await afterAck.record(Self.terminal(command, text: "Different result"), nowMs: 1003)
            }
        }
    }

    @Test func `admission stops command replay and terminal receipts survive a second reopen`() async throws {
        try await Self.withDatabase { url in
            let command = Self.command()
            let store = CarapaceWatchChatDeliveryStore(databaseURL: url)
            try await store.enqueue(command, nowMs: 1000)
            #expect(try await store.record(.init(
                context: command.context, commandId: command.commandId, state: .admitted(atMs: 1001)), nowMs: 1001) ==
                nil)
            let reopened = CarapaceWatchChatDeliveryStore(databaseURL: url)
            #expect(try await reopened.pendingCommands(nowMs: 1002).isEmpty)
            let terminal = Self.terminal(command)
            #expect(try await reopened.record(terminal, nowMs: 1002)?.receiptId == "receipt")
            let restored = CarapaceWatchChatDeliveryStore(databaseURL: url)
            #expect(try await restored.entries(context: command.context, nowMs: 1003).first?.receipt == terminal)
        }
    }

    @Test func `different global agent or Unicode gateway cannot adopt a command receipt`() async throws {
        try await Self.withDatabase { url in
            let store = CarapaceWatchChatDeliveryStore(databaseURL: url)
            let command = Self.command(context: Self.context(gateway: "caf\u{00E9}"))
            try await store.enqueue(command, nowMs: 1000)
            for context in [
                Self.context(gateway: "cafe\u{0301}"),
                Self.context(gateway: "caf\u{00E9}", agent: "other"),
                Self.context(gateway: "caf\u{00E9}", generation: "replacement"),
            ] {
                await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                    try await store.record(Self.terminal(Self.command(context: context)), nowMs: 1001)
                }
            }
            #expect(try await store.pendingCommands(nowMs: 1001) == [command])
            let other = Self.command(context: Self.context(gateway: "cafe\u{0301}"))
            try await store.enqueue(other, nowMs: 1001)
            #expect(try await store.pendingCommands(nowMs: 1001).count == 2)
        }
    }

    @Test func `only a held stale route receipt purges its generation`() async throws {
        try await Self.withDatabase { url in
            let store = CarapaceWatchChatDeliveryStore(databaseURL: url)
            let old = Self.command()
            let sibling = Self.command(id: "sibling", context: Self.context(agent: "other"))
            let replacement = Self.command(id: "new", context: Self.context(generation: "new"))
            let otherGateway = Self.command(id: "elsewhere", context: Self.context(gateway: "other"))
            for command in [old, sibling, replacement, otherGateway] {
                try await store.enqueue(command, nowMs: 1000)
            }
            let unknown = Self.command(id: "unknown")
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await store.record(Self.staleReceipt(unknown), nowMs: 1001)
            }
            #expect(try await store.pendingCommands(nowMs: 1001).count == 4)
            #expect(try await store.record(Self.staleReceipt(old), nowMs: 1001) == nil)
            let remaining = try await store.pendingCommands(nowMs: 1002)
            #expect(remaining.count == 2)
            #expect(remaining.contains(replacement))
            #expect(remaining.contains(otherGateway))
        }
    }

    @Test func `expiry retains original time and saved outcomes without reopening admission`() async throws {
        try await Self.withDatabase { url in
            let store = CarapaceWatchChatDeliveryStore(databaseURL: url)
            let command = Self.command()
            try await store.enqueue(command, nowMs: 1000)
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await store.enqueue(Self.command(submittedAtMs: 1001), nowMs: 1001)
            }
            let completed = Self.command(id: "newer-finalized", submittedAtMs: 1001)
            let terminal = Self.terminal(completed)
            try await store.enqueue(completed, nowMs: 1001)
            #expect(try await store.record(terminal, nowMs: 1002)?.receiptId == "receipt")
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await store.record(.init(
                    context: command.context,
                    commandId: command.commandId,
                    state: .admitted(atMs: command.expiresAtMs)), nowMs: command.expiresAtMs)
            }
            #expect(try await store.expiredEntries(nowMs: command.expiresAtMs).map(\.command) == [command])
            let rejection = Self.rejection(command, code: "expired")
            #expect(try await store.record(rejection, nowMs: command.expiresAtMs) == nil)
            #expect(try await store.receipt(context: command.context, commandId: command.commandId) == rejection)
            #expect(try await store.expiredEntries(nowMs: command.expiresAtMs).first?.receipt == rejection)
            let expired = try await store.expiredEntries(nowMs: completed.expiresAtMs)
            #expect(expired.map(\.command) == [command, completed])
            #expect(expired.last?.receipt == terminal)
            #expect(try await store.pruneExpired(nowMs: completed.expiresAtMs) == 2)
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await store.enqueue(command, nowMs: command.expiresAtMs)
            }
            #expect(try await store.pendingCommands(nowMs: command.expiresAtMs).isEmpty)
        }
    }

    @Test func `permanent rejection reopens without custody or a renewed deadline`() async throws {
        try await Self.withDatabase { url in
            let store = CarapaceWatchChatDeliveryStore(databaseURL: url)
            let command = Self.command()
            let rejection = Self.rejection(command, code: "routing_changed")
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await store.record(rejection, nowMs: 1000)
            }
            #expect(try await store.pendingCommands(nowMs: 1000).isEmpty)
            try await store.enqueue(command, nowMs: 1000)
            #expect(try await store.record(rejection, nowMs: 1001) == nil)
            let restored = CarapaceWatchChatDeliveryStore(databaseURL: url)
            #expect(try await restored.pendingCommands(nowMs: 1002).isEmpty)
            let entry = try #require(try await restored.entries(context: command.context, nowMs: 1002).first)
            #expect(entry.command == command)
            #expect(entry.receipt == rejection)
            #expect(entry.receipt?.terminal == nil)
            #expect(try await restored.record(rejection, nowMs: 1003) == nil)
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await restored.record(Self.rejection(command, code: "clock_error"), nowMs: 1003)
            }
            #expect(try await restored.pruneExpired(nowMs: command.expiresAtMs) == 1)
        }
    }

    @Test(arguments: [false, true])
    func `actual custody outranks a retransmission denial in either arrival order`(rejectionFirst: Bool) async throws {
        try await Self.withDatabase { url in
            let store = CarapaceWatchChatDeliveryStore(databaseURL: url)
            for isTerminal in [false, true] {
                let command = Self.command(id: isTerminal ? "terminal" : "admitted")
                try await store.enqueue(command, nowMs: 1000)
                let rejection = Self.rejection(command, code: "identity_conflict")
                let custody = isTerminal ? Self.terminal(command) : CarapaceWatchChatDeliveryReceipt(
                    context: command.context, commandId: command.commandId, state: .admitted(atMs: 1001))
                for receipt in rejectionFirst ? [rejection, custody] : [custody, rejection] {
                    _ = try await store.record(receipt, nowMs: 1002)
                }
                #expect(try await store.receipt(context: command.context, commandId: command.commandId) == custody)
                #expect(try await store.isPending(command, nowMs: 1003) == false)
                #expect(try await store.record(Self.staleReceipt(command), nowMs: 1003) == nil)
                #expect(try await store.receipt(context: command.context, commandId: command.commandId) == nil)
            }
        }
    }

    @Test(arguments: [Int64(-1), Int64.max, Int64(301_001)])
    func `invalid or future submission time cannot be admitted`(time: Int64) throws {
        #expect(throws: CarapaceWatchChatDeliveryError.self) {
            try CarapaceWatchChatDeliveryCodec.validateCommand(Self.command(submittedAtMs: time), nowMs: 1000)
        }
    }

    @Test(arguments: [false, true])
    func `capacity bounds pending and all unexpired commands without evicting input`(admitted: Bool) async throws {
        try await Self.withDatabase { url in
            let store = CarapaceWatchChatDeliveryStore(databaseURL: url)
            let limit = admitted ? 1024 : 128
            for index in 0..<limit {
                let command = Self.command(id: "command-\(index)")
                try await store.enqueue(command, nowMs: 1000)
                if admitted {
                    _ = try await store.record(.init(
                        context: command.context,
                        commandId: command.commandId,
                        state: .admitted(atMs: 1001)), nowMs: 1001)
                }
            }
            await #expect(throws: CarapaceWatchChatDeliveryError.self) {
                try await store.enqueue(Self.command(id: "overflow"), nowMs: 1001)
            }
            #expect(try await store.entries(context: Self.context(), nowMs: 1001).count == limit)
        }
    }

    private static func withDatabase(_ body: (URL) async throws -> Void) async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await body(directory.appendingPathComponent("watch.sqlite"))
    }

    private static func context(
        gateway: String = "gateway",
        generation: String = "generation",
        agent: String = "main")
        -> CarapaceWatchChatDeliveryContext
    {
        CarapaceWatchChatDeliveryContext(
            gatewayStableID: gateway,
            routeGeneration: generation,
            agentId: agent,
            sessionKey: "global",
            deliverySessionKey: "global",
            sessionRoutingContract: "agent-scoped-v1")
    }

    private static func command(
        id: String = "command",
        context: CarapaceWatchChatDeliveryContext = Self.context(),
        submittedAtMs: Int64 = 1000,
        body: CarapaceWatchChatDeliveryBody = .chat(text: "Hello"))
        -> CarapaceWatchChatDeliveryCommand
    {
        CarapaceWatchChatDeliveryCommand(context: context, commandId: id, submittedAtMs: submittedAtMs, body: body)
    }

    private static func terminal(_ command: CarapaceWatchChatDeliveryCommand, text: String = "A saved reply")
        -> CarapaceWatchChatDeliveryReceipt
    {
        CarapaceWatchChatDeliveryReceipt(
            context: command.context,
            commandId: command.commandId,
            state: .terminal(.init(
                receiptId: "receipt",
                outcome: .reply(text: text),
                runId: command.commandId,
                completedAtMs: 1002)))
    }

    private static func staleReceipt(_ command: CarapaceWatchChatDeliveryCommand) -> CarapaceWatchChatDeliveryReceipt {
        self.rejection(command, code: CarapaceWatchChatDeliveryCodec.staleRouteCode)
    }

    private static func rejection(_ command: CarapaceWatchChatDeliveryCommand, code: String)
        -> CarapaceWatchChatDeliveryReceipt
    {
        CarapaceWatchChatDeliveryReceipt(
            context: command.context,
            commandId: command.commandId,
            state: .rejected(code: code, message: "Review this message on iPhone."))
    }
}
