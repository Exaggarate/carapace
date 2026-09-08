import Foundation
import Testing
@testable import Carapace

struct LaunchAgentManagerTests {
    @Test func `active profile performs no login agent reads or writes`() async {
        let profile = AppProfile(environment: ["CARAPACE_PROFILE": "work"])
        var writes: [String] = []
        LaunchAgentManager._testResetLaunchctlCalls()

        #expect(await !(LaunchAgentManager.status(profile: profile)))
        #expect(await !(LaunchAgentManager.set(
            enabled: true,
            bundlePath: "/Applications/Carapace.app",
            profile: profile,
            writePlist: { writes.append($0) })))
        #expect(await !(LaunchAgentManager.set(
            enabled: false,
            bundlePath: "/Applications/Carapace.app",
            profile: profile,
            writePlist: { writes.append($0) })))
        #expect(writes.isEmpty)
        #expect(LaunchAgentManager._testLaunchctlCallSnapshot().isEmpty)
    }

    @Test func `enabling an already loaded login job only refreshes its plist`() async {
        var persistedBundlePaths: [String] = []
        let reloaded = await LaunchAgentManager.set(
            enabled: true,
            bundlePath: "/Applications/Carapace.app",
            loaded: true,
            writePlist: { persistedBundlePaths.append($0) })

        #expect(reloaded == false)
        #expect(persistedBundlePaths == ["/Applications/Carapace.app"])
    }

    @Test func `launch at login plist does not keep app alive after manual quit`() throws {
        let plist = LaunchAgentManager.plistContents(bundlePath: "/Applications/Carapace.app")
        let data = try #require(plist.data(using: .utf8))
        let object = try #require(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])

        #expect(object["RunAtLoad"] as? Bool == true)
        #expect(object["KeepAlive"] == nil)

        let args = try #require(object["ProgramArguments"] as? [String])
        #expect(args == ["/Applications/Carapace.app/Contents/MacOS/Carapace"])
    }

    @MainActor
    @Test func `launch at login plist preserves normalized profile environment once`() async throws {
        let bundlePath = "/Applications/R&D <Team>/Carapace.app"
        let logDirectory = "/tmp/carapace-login-&<logs>"
        try await TestIsolation.withEnvValues([
            "CARAPACE_CONFIG_PATH": "  /tmp/custom&<carapace>\"'.json  ",
            "CARAPACE_LOG_DIR": logDirectory,
            "CARAPACE_STATE_DIR": "/tmp/carapace-state",
        ]) {
            let plist = LaunchAgentManager.plistContents(
                bundlePath: bundlePath,
                preferredPaths: ["/tmp/custom&<bin>", "/usr/bin"])
            let data = try #require(plist.data(using: .utf8))
            let object = try #require(
                PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])

            let environment = try #require(object["EnvironmentVariables"] as? [String: String])
            #expect(object["ProgramArguments"] as? [String] == ["\(bundlePath)/Contents/MacOS/Carapace"])
            #expect(object["StandardOutPath"] as? String == "\(logDirectory)/carapace-stdout.log")
            #expect(object["StandardErrorPath"] as? String == "\(logDirectory)/carapace-stdout.log")
            #expect(environment["CARAPACE_CONFIG_PATH"] == "/tmp/custom&<carapace>\"'.json")
            #expect(environment["CARAPACE_STATE_DIR"] == "/tmp/carapace-state")
            #expect(environment["PATH"]?.contains("/tmp/custom&<bin>") == true)
            #expect(plist.components(separatedBy: "<key>CARAPACE_CONFIG_PATH</key>").count == 2)
            #expect(plist.components(separatedBy: "<key>CARAPACE_STATE_DIR</key>").count == 2)
        }
    }

    @MainActor
    @Test func `launch at login plist omits unset and blank profile environment`() async throws {
        try await TestIsolation.withEnvValues([
            "CARAPACE_CONFIG_PATH": nil,
            "CARAPACE_STATE_DIR": " \n ",
        ]) {
            let plist = LaunchAgentManager.plistContents(bundlePath: "/Applications/Carapace.app")
            let data = try #require(plist.data(using: .utf8))
            let object = try #require(
                PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])

            let environment = try #require(object["EnvironmentVariables"] as? [String: String])
            #expect(environment.keys.sorted() == ["PATH"])
            #expect(!plist.contains("CARAPACE_CONFIG_PATH"))
            #expect(!plist.contains("CARAPACE_STATE_DIR"))
        }
    }
}
