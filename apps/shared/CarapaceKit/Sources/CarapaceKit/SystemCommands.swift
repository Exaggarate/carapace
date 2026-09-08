import Foundation

public enum CarapaceSystemCommand: String, Codable, Sendable {
    case run = "system.run"
    case which = "system.which"
    case notify = "system.notify"
    case execApprovalsGet = "system.execApprovals.get"
    case execApprovalsSet = "system.execApprovals.set"
}

public enum CarapaceFileSystemCommand: String, Codable, Sendable {
    case listDir = "fs.listDir"
}

public enum CarapaceNotificationPriority: String, Codable, Sendable {
    case passive
    case active
    case timeSensitive
}

public enum CarapaceNotificationDelivery: String, Codable, Sendable {
    case system
    case overlay
    case auto
}

public struct CarapaceSystemNotifyParams: Codable, Sendable, Equatable {
    public var title: String
    public var body: String
    public var sound: String?
    public var priority: CarapaceNotificationPriority?
    public var delivery: CarapaceNotificationDelivery?

    public init(
        title: String,
        body: String,
        sound: String? = nil,
        priority: CarapaceNotificationPriority? = nil,
        delivery: CarapaceNotificationDelivery? = nil)
    {
        self.title = title
        self.body = body
        self.sound = sound
        self.priority = priority
        self.delivery = delivery
    }
}
