import Foundation

public enum CarapaceNodeErrorCode: String, Codable, Sendable {
    case notPaired = "NOT_PAIRED"
    case unauthorized = "UNAUTHORIZED"
    case backgroundUnavailable = "NODE_BACKGROUND_UNAVAILABLE"
    case invalidRequest = "INVALID_REQUEST"
    case unavailable = "UNAVAILABLE"
    /// Rejected before a command handler or progress frame; safe for bounded admission recovery.
    case notReady = "NODE_NOT_READY"
    case systemRunDenied = "SYSTEM_RUN_DENIED"
}

public struct CarapaceNodeError: Error, Codable, Sendable, Equatable {
    public var code: CarapaceNodeErrorCode
    public var message: String
    public var retryable: Bool?
    public var retryAfterMs: Int?

    public init(
        code: CarapaceNodeErrorCode,
        message: String,
        retryable: Bool? = nil,
        retryAfterMs: Int? = nil)
    {
        self.code = code
        self.message = message
        self.retryable = retryable
        self.retryAfterMs = retryAfterMs
    }
}
