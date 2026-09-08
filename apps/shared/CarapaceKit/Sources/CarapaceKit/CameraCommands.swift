import Foundation

public enum CarapaceCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
    case ptzStatus = "camera.ptz.status"
    case ptzControl = "camera.ptz.control"
}

public enum CarapaceCameraPTZOperation: String, Codable, Sendable {
    case set
    case move
    case home
}

public struct CarapaceCameraPTZAxisValues: Codable, Sendable, Equatable {
    public var panDegrees: Double?
    public var tiltDegrees: Double?
    public var zoomPercent: Double?

    public init(
        panDegrees: Double? = nil,
        tiltDegrees: Double? = nil,
        zoomPercent: Double? = nil)
    {
        self.panDegrees = panDegrees
        self.tiltDegrees = tiltDegrees
        self.zoomPercent = zoomPercent
    }
}

public struct CarapaceCameraPTZStatusParams: Codable, Sendable, Equatable {
    public var deviceId: String

    public init(deviceId: String) {
        self.deviceId = deviceId
    }
}

public struct CarapaceCameraPTZControlParams: Codable, Sendable, Equatable {
    public var deviceId: String
    public var operation: CarapaceCameraPTZOperation
    public var target: CarapaceCameraPTZAxisValues?
    public var delta: CarapaceCameraPTZAxisValues?

    public init(
        deviceId: String,
        operation: CarapaceCameraPTZOperation,
        target: CarapaceCameraPTZAxisValues? = nil,
        delta: CarapaceCameraPTZAxisValues? = nil)
    {
        self.deviceId = deviceId
        self.operation = operation
        self.target = target
        self.delta = delta
    }
}

public enum CarapaceCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum CarapaceCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum CarapaceCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct CarapaceCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: CarapaceCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: CarapaceCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: CarapaceCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: CarapaceCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct CarapaceCameraClipParams: Codable, Sendable, Equatable {
    public var facing: CarapaceCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: CarapaceCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: CarapaceCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: CarapaceCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
