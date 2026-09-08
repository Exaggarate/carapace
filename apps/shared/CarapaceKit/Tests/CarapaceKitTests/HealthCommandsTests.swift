import Foundation
import Testing
@testable import CarapaceKit

struct HealthCommandsTests {
    @Test func `health summary periods use the node command wire values`() throws {
        #expect(CarapaceHealthCommand.summary.rawValue == "health.summary")
        #expect(CarapaceHealthSummaryPeriod.allCases.map(\.rawValue) == ["today"])

        let params = CarapaceHealthSummaryParams(period: .today)
        let data = try JSONEncoder().encode(params)
        #expect(String(decoding: data, as: UTF8.self) == #"{"period":"today"}"#)
    }
}
