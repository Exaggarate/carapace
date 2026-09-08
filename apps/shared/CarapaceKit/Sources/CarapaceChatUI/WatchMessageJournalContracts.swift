import Foundation
import CarapaceKit

public struct CarapaceWatchMessageOwner: Equatable, Sendable {
    public let gatewayStableID: String
    public let routeGeneration: String?

    public init(gatewayStableID: String, routeGeneration: String?) {
        self.gatewayStableID = gatewayStableID
        self.routeGeneration = routeGeneration
    }

    public init(context: CarapaceWatchChatDeliveryContext) {
        self.init(gatewayStableID: context.gatewayStableID, routeGeneration: context.routeGeneration)
    }

    public static func == (lhs: Self, rhs: Self) -> Bool {
        Data(lhs.gatewayStableID.utf8) == Data(rhs.gatewayStableID.utf8) &&
            lhs.routeGeneration == rhs.routeGeneration
    }
}

public struct CarapaceWatchMessageRoute: Equatable, Sendable {
    public let owner: CarapaceWatchMessageOwner
    public let routingIdentity: CarapaceChatSessionRoutingIdentity
}

public enum CarapaceWatchMessagePhase: String, Codable, Sendable {
    case queued
    case sending
    case accepted
    case receiptReady
    case received
    case needsReview
    case tombstone
}

public enum CarapaceWatchMessageReceiptDestination: String, Codable, Sendable {
    case watch
    case phone
}

public struct CarapaceWatchMessageEntry: Identifiable, Equatable, Sendable {
    public let commandId: String
    /// SQLite and the wire protocol distinguish canonically equivalent UTF-8 identifiers.
    public var id: Data {
        Data(self.commandId.utf8)
    }

    public let owner: CarapaceWatchMessageOwner?
    public let command: CarapaceWatchChatDeliveryCommand?
    public let displayText: String?
    public let phase: CarapaceWatchMessagePhase
    public let destination: CarapaceWatchMessageReceiptDestination
    public let admittedAtMs: Int64
    public let expiresAtMs: Int64?
    public let attemptVersion: Int64
    public let acceptedRunID: String?
    public let receipt: CarapaceWatchChatDeliveryReceipt?

    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id &&
            lhs.owner == rhs.owner &&
            lhs.command == rhs.command &&
            lhs.displayText == rhs.displayText &&
            lhs.phase == rhs.phase &&
            lhs.destination == rhs.destination &&
            lhs.admittedAtMs == rhs.admittedAtMs &&
            lhs.expiresAtMs == rhs.expiresAtMs &&
            lhs.attemptVersion == rhs.attemptVersion &&
            lhs.acceptedRunID == rhs.acceptedRunID &&
            lhs.receipt == rhs.receipt
    }
}

public enum CarapaceWatchMessageMutation: Equatable, Sendable {
    case applied
    case missing
    case superseded
}

/// A decoded legacy snapshot, not a second runtime queue. Missing ownership
/// never becomes permission to send an imported message.
public struct CarapaceWatchMessageLegacyImport: Sendable {
    public struct Message: Sendable {
        public let id: String
        public let gatewayStableID: String?
        public let text: String
        public let submittedAtMs: Int64?

        public init(id: String, gatewayStableID: String?, text: String, submittedAtMs: Int64?) {
            self.id = id
            self.gatewayStableID = gatewayStableID
            self.text = text
            self.submittedAtMs = submittedAtMs
        }
    }

    public let messages: [Message]
    public let recentMessageIDs: [String]

    public init(messages: [Message], recentMessageIDs: [String]) {
        self.messages = messages
        self.recentMessageIDs = recentMessageIDs
    }
}
