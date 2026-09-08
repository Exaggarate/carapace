import Foundation

public enum CarapaceDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum CarapaceBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum CarapaceThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum CarapaceNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum CarapaceNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct CarapaceBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: CarapaceBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: CarapaceBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct CarapaceThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: CarapaceThermalState

    public init(state: CarapaceThermalState) {
        self.state = state
    }
}

public struct CarapaceStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct CarapaceNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: CarapaceNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [CarapaceNetworkInterfaceType]

    public init(
        status: CarapaceNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [CarapaceNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct CarapaceDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: CarapaceBatteryStatusPayload
    public var thermal: CarapaceThermalStatusPayload
    public var storage: CarapaceStorageStatusPayload
    public var network: CarapaceNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: CarapaceBatteryStatusPayload,
        thermal: CarapaceThermalStatusPayload,
        storage: CarapaceStorageStatusPayload,
        network: CarapaceNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct CarapaceDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
