import Foundation

extension CarapaceChatSQLiteTranscriptCache {
    nonisolated static func encodeSessionSettingsExpectation(
        _ expectation: CarapaceChatSessionSettingsExpectation?) -> String?
    {
        guard let expectation,
              let data = try? JSONEncoder().encode(expectation)
        else { return nil }
        return String(bytes: data, encoding: .utf8)
    }

    nonisolated static func decodeSessionSettingsExpectation(
        _ raw: String?) throws -> CarapaceChatSessionSettingsExpectation?
    {
        guard let raw, !raw.isEmpty else { return nil }
        return try JSONDecoder().decode(
            CarapaceChatSessionSettingsExpectation.self,
            from: Data(raw.utf8))
    }
}
