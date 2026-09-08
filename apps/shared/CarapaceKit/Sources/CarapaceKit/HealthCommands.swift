import Foundation

public enum CarapaceHealthCommand: String, Codable, Sendable {
    case summary = "health.summary"
}

public enum CarapaceHealthSummaryPeriod: String, Codable, Sendable, CaseIterable {
    case today
}

public struct CarapaceHealthSummaryParams: Codable, Sendable, Equatable {
    public var period: CarapaceHealthSummaryPeriod

    public init(period: CarapaceHealthSummaryPeriod) {
        self.period = period
    }
}

public struct CarapaceHealthSummaryPayload: Codable, Sendable, Equatable {
    public var period: CarapaceHealthSummaryPeriod
    public var startISO: String
    public var endISO: String
    public var timeZoneIdentifier: String
    public var stepCount: Int?
    public var sleepDurationMinutes: Int?
    public var restingHeartRateBpm: Double?
    public var workoutCount: Int?
    public var workoutDurationMinutes: Int?

    public init(
        period: CarapaceHealthSummaryPeriod,
        startISO: String,
        endISO: String,
        timeZoneIdentifier: String,
        stepCount: Int?,
        sleepDurationMinutes: Int?,
        restingHeartRateBpm: Double?,
        workoutCount: Int?,
        workoutDurationMinutes: Int?)
    {
        self.period = period
        self.startISO = startISO
        self.endISO = endISO
        self.timeZoneIdentifier = timeZoneIdentifier
        self.stepCount = stepCount
        self.sleepDurationMinutes = sleepDurationMinutes
        self.restingHeartRateBpm = restingHeartRateBpm
        self.workoutCount = workoutCount
        self.workoutDurationMinutes = workoutDurationMinutes
    }
}
