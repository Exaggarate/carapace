import CryptoKit
import Foundation
import GRDB
import CarapaceKit

extension CarapaceWatchMessageJournal {
    static var nowMs: Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    static func encode(_ value: some Encodable) throws -> String {
        let data = try CarapaceWatchChatDeliveryCodec.canonicalData(value)
        guard let result = String(bytes: data, encoding: .utf8) else {
            throw CocoaError(.fileWriteInapplicableStringEncoding)
        }
        return result
    }

    static func fingerprint(_ command: CarapaceWatchChatDeliveryCommand) throws -> Data {
        try Data(SHA256.hash(data: CarapaceWatchChatDeliveryCodec.canonicalData(command)))
    }

    static func storeNotDispatched(_ db: Database, entry: CarapaceWatchMessageEntry) throws {
        try db.execute(
            sql: "UPDATE watch_message_journal SET phase = 'queued' WHERE command_id = ?",
            arguments: [entry.commandId])
    }

    static func storeAccepted(_ db: Database, entry: CarapaceWatchMessageEntry, runID: String) throws {
        try db.execute(
            sql: "UPDATE watch_message_journal SET phase = 'accepted', accepted_run_id = ? WHERE command_id = ?",
            arguments: [runID, entry.commandId])
    }

    static func terminalReceipt(
        _ command: CarapaceWatchChatDeliveryCommand,
        outcome: CarapaceWatchChatDeliveryOutcome,
        runID: String?,
        nowMs: Int64) -> CarapaceWatchChatDeliveryReceipt
    {
        CarapaceWatchChatDeliveryReceipt(
            context: command.context,
            commandId: command.commandId,
            state: .terminal(CarapaceWatchChatDeliveryTerminal(
                receiptId: UUID().uuidString, outcome: outcome, runId: runID, completedAtMs: nowMs)))
    }

    static func storeTerminal(
        _ db: Database,
        entry: CarapaceWatchMessageEntry,
        outcome: CarapaceWatchChatDeliveryOutcome,
        nowMs: Int64) throws
    {
        guard let command = entry.command else { throw DatabaseError(message: "The Watch command is missing.") }
        let receipt = self.terminalReceipt(command, outcome: outcome, runID: entry.acceptedRunID, nowMs: nowMs)
        try CarapaceWatchChatDeliveryCodec.validateReceipt(receipt)
        try db.execute(
            sql: """
            UPDATE watch_message_journal SET phase = ?, receipt_json = ?
            WHERE command_id = ? AND attempt_version = ?
            """,
            arguments: [
                entry.destination == .phone ? "received" : "receiptReady",
                self.encode(receipt), entry.commandId, entry.attemptVersion,
            ])
    }

    static func requireImport(_ db: Database) throws {
        guard try self.hasImportedLegacyMessages(db) else {
            throw CarapaceWatchChatDeliveryError(
                code: "migration_pending", message: "Open Carapace on iPhone to finish restoring Watch messages.")
        }
    }

    static func requireGatewayAvailable(_ db: Database, gatewayID: String) throws {
        let pending = try Bool.fetchOne(
            db,
            sql: """
            SELECT EXISTS(SELECT 1 FROM forgotten_gateways
                WHERE gateway_hash = ? AND cleanup_phase IN (1, 2, 3))
            """,
            arguments: [CarapaceClientDatabases.gatewayIdentityHash(gatewayID)]) == true
        guard !pending else {
            throw CarapaceWatchChatDeliveryError(
                code: "gateway_removal_pending", message: "Finish removing or restoring this Gateway on iPhone.")
        }
    }

    static func requireContext(
        _ db: Database,
        context: CarapaceWatchChatDeliveryContext,
        matchRoutingContract: Bool) throws
    {
        try self.requireGatewayAvailable(db, gatewayID: context.gatewayStableID)
        let row = try self.requirePersistedGeneration(db, context: context)
        if matchRoutingContract {
            guard let identity = CarapaceChatSessionRoutingIdentity(
                scope: row["scope"], mainSessionKey: row["main_session_key"], defaultAgentID: row["default_agent_id"]),
                identity.contract.utf8.elementsEqual(context.sessionRoutingContract.utf8)
            else {
                throw CarapaceWatchChatDeliveryError(
                    code: "routing_changed",
                    message: String(localized: """
                    The Gateway's session routing changed. Start a new message from its current Watch context.
                    """))
            }
        }
    }

    static func requirePersistedGeneration(
        _ db: Database,
        context: CarapaceWatchChatDeliveryContext) throws -> Row
    {
        guard let row = try Row.fetchOne(
            db,
            sql: "SELECT * FROM gateway_routing_identity WHERE gateway_id = ?",
            arguments: [context.gatewayStableID]),
            let generation: String = row["watch_route_generation"],
            generation.utf8.elementsEqual(context.routeGeneration.utf8)
        else { throw self.staleRoute() }
        return row
    }

    static func staleRoute() -> CarapaceWatchChatDeliveryError {
        CarapaceWatchChatDeliveryError(
            code: CarapaceWatchChatDeliveryCodec.staleRouteCode,
            message: String(localized: """
            This Watch message belongs to a retired Gateway route. Open Carapace on iPhone.
            """))
    }

    static func deleteExpired(_ db: Database, nowMs: Int64) throws -> Int {
        // Imported needsReview text has no send deadline and is preserved until
        // explicit discard/Forget. Fresh IDs never acquire a renewed deadline.
        try db.execute(
            sql: "DELETE FROM watch_message_journal WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= ?",
            arguments: [nowMs])
        return db.changesCount
    }

    static func fetchEntries(_ db: Database, owner: CarapaceWatchMessageOwner?) throws -> [CarapaceWatchMessageEntry] {
        let filter = owner == nil ? "" : " WHERE gateway_id = ? AND route_generation IS ?"
        let arguments: StatementArguments = if let owner {
            [owner.gatewayStableID, owner.routeGeneration]
        } else {
            []
        }
        return try Row.fetchAll(
            db,
            sql: """
            SELECT * FROM watch_message_journal\(filter)
            ORDER BY CASE kind WHEN 'quickReply' THEN 0 ELSE 1 END, admitted_at_ms, command_id
            """,
            arguments: arguments).map(self.decode)
    }

    static func fetch(_ db: Database, id: String) throws -> CarapaceWatchMessageEntry? {
        try Row.fetchOne(db, sql: "SELECT * FROM watch_message_journal WHERE command_id = ?", arguments: [id])
            .map(self.decode)
    }

    static func requireEntry(_ db: Database, id: String) throws -> CarapaceWatchMessageEntry {
        guard let entry = try self.fetch(db, id: id) else {
            throw DatabaseError(message: "The Watch delivery record is missing.")
        }
        return entry
    }

    static func missingOrSuperseded(_ db: Database, id: String) throws -> CarapaceWatchMessageMutation {
        try self.fetch(db, id: id) == nil ? .missing : .superseded
    }

    static func current(
        _ db: Database,
        expected: ClaimIdentity,
        phases: [CarapaceWatchMessagePhase],
        nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) throws -> CarapaceWatchMessageEntry?
    {
        guard let current = try self.fetch(db, id: expected.commandId),
              let command = current.command, try self.fingerprint(command) == expected.fingerprint,
              current.owner == expected.owner, current.expiresAtMs == expected.expiresAtMs,
              current.attemptVersion == expected.attemptVersion,
              phases.contains(current.phase), expected.expiresAtMs > nowMs
        else { return nil }
        do {
            // Settlement records owned work; cancellable Forget only pauses new dispatch.
            // Committed Forget deletes this generation and still fences late callbacks.
            _ = try self.requirePersistedGeneration(db, context: command.context)
        } catch is CarapaceWatchChatDeliveryError {
            return nil
        }
        return current
    }

    static func decode(_ row: Row) throws -> CarapaceWatchMessageEntry {
        let phaseValue: String = row["phase"]
        let destinationValue: String = row["receipt_destination"]
        guard let phase = CarapaceWatchMessagePhase(rawValue: phaseValue),
              let destination = CarapaceWatchMessageReceiptDestination(rawValue: destinationValue)
        else { throw DatabaseError(message: "The saved Watch delivery state is unreadable.") }
        let command: CarapaceWatchChatDeliveryCommand?
        let receipt: CarapaceWatchChatDeliveryReceipt?
        do {
            let commandJSON: String? = row["command_json"]
            command = try commandJSON.map { try JSONDecoder().decode(
                CarapaceWatchChatDeliveryCommand.self,
                from: Data($0.utf8)) }
            let receiptJSON: String? = row["receipt_json"]
            receipt = try receiptJSON.map { try JSONDecoder().decode(
                CarapaceWatchChatDeliveryReceipt.self,
                from: Data($0.utf8)) }
        } catch {
            throw DatabaseError(message: "The saved Watch delivery payload is unreadable.")
        }
        let gatewayID: String? = row["gateway_id"]
        let owner = gatewayID.map { CarapaceWatchMessageOwner(
            gatewayStableID: $0,
            routeGeneration: row["route_generation"]) }
        return CarapaceWatchMessageEntry(
            commandId: row["command_id"],
            owner: owner,
            command: command,
            displayText: command?.text ?? row["legacy_text"],
            phase: phase,
            destination: destination,
            admittedAtMs: row["admitted_at_ms"],
            expiresAtMs: row["expires_at_ms"],
            attemptVersion: row["attempt_version"],
            acceptedRunID: row["accepted_run_id"],
            receipt: receipt)
    }
}
