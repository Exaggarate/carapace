import Foundation
import Testing
@testable import Carapace

@Suite(.serialized)
struct GatewayLaunchAgentManagerTests {
    @Test func `attach-only marker belongs to the selected state directory`() {
        let stateDirectory = URL(fileURLWithPath: "/tmp/carapace-elevation-state", isDirectory: true)

        #expect(GatewayLaunchAgentManager.disableLaunchAgentMarkerURL(in: stateDirectory).path ==
            "/tmp/carapace-elevation-state/disable-launchagent")
    }

    @Test func `gateway launchd artifacts follow default and named profile labels`() {
        let home = URL(fileURLWithPath: "/Users/test", isDirectory: true)
        let directory = URL(fileURLWithPath: "/state/service-env", isDirectory: true)
        let base = AppProfile(environment: [:])
        let work = AppProfile(environment: ["CARAPACE_PROFILE": "work"])

        #expect(GatewayLaunchAgentManager.plistURL(homeDirectory: home, profile: base).path ==
            "/Users/test/Library/LaunchAgents/ai.carapace.gateway.plist")
        #expect(GatewayLaunchAgentManager.plistURL(homeDirectory: home, profile: work).path ==
            "/Users/test/Library/LaunchAgents/ai.carapace.work.plist")
        let baseArtifacts = GatewayLaunchAgentManager.generatedEnvironmentArtifacts(
            directory: directory,
            profile: base)
        let workArtifacts = GatewayLaunchAgentManager.generatedEnvironmentArtifacts(
            directory: directory,
            profile: work)
        #expect(baseArtifacts.environment.path == "/state/service-env/ai.carapace.gateway.env")
        #expect(baseArtifacts.wrapper.path == "/state/service-env/ai.carapace.gateway-env-wrapper.sh")
        #expect(workArtifacts.environment.path == "/state/service-env/ai.carapace.work.env")
        #expect(workArtifacts.wrapper.path == "/state/service-env/ai.carapace.work-env-wrapper.sh")
    }

    @Test func `gateway daemon command selects named profile at the root`() async throws {
        let root = try makeTempDirForTests()
        defer { try? FileManager.default.removeItem(at: root) }
        let executable = root.appendingPathComponent("node_modules/.bin/carapace")
        try makeExecutableForTests(at: executable)
        let command = await CommandResolver.carapaceCommand(
            subcommand: "gateway",
            extraArgs: ["status", "--json"],
            configRoot: ["gateway": ["mode": "local"]],
            projectRoot: root,
            profile: AppProfile(environment: ["CARAPACE_PROFILE": "work"]))

        #expect(command == [
            executable.path, "--profile", "work", "gateway", "status", "--json",
        ])
    }

    @Test func `daemon commands tolerate first run state migrations`() {
        #expect(GatewayLaunchAgentManager.startupMigrationTolerance >= 120)
    }

    @Test func `malformed canonical profile claims fail closed`() throws {
        let home = try makeTempDirForTests()
        defer { try? FileManager.default.removeItem(at: home) }
        let agents = home.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(
            fromPropertyList: [
                "ProgramArguments": ["node", "carapace.mjs", "gateway"],
                "EnvironmentVariables": [
                    "CARAPACE_SERVICE_MARKER": "carapace",
                    "CARAPACE_SERVICE_KIND": "gateway",
                ],
            ],
            format: .xml,
            options: 0)
        try data.write(to: agents.appendingPathComponent("ai.carapace.p1402.plist"))

        let claim = GatewayLaunchAgentManager.conflictingProfileClaimOwner(
            port: 55636,
            excludingLabel: "ai.carapace.p2380",
            homeDirectory: home)

        #expect(claim?.contains("p1402") == true)
    }

    @Test func `same prefix ssh tunnel is not a profile Gateway claim`() throws {
        let home = try makeTempDirForTests()
        defer { try? FileManager.default.removeItem(at: home) }
        let agents = home.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(
            fromPropertyList: [
                "ProgramArguments": ["/usr/bin/ssh", "-N", "-L", "55636:127.0.0.1:18789"],
            ],
            format: .xml,
            options: 0)
        try data.write(to: agents.appendingPathComponent("ai.carapace.gateway-tunnel.plist"))
        try Data("not a plist".utf8).write(to: agents.appendingPathComponent("ai.carapace.unrelated.plist"))

        #expect(GatewayLaunchAgentManager.conflictingProfileClaimOwner(
            port: 55636,
            excludingLabel: "ai.carapace.qa",
            homeDirectory: home) == nil)
    }

    @Test func `default generated Gateway claim is recognized`() throws {
        let home = try makeTempDirForTests()
        defer { try? FileManager.default.removeItem(at: home) }
        let agents = home.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(
            fromPropertyList: [
                "ProgramArguments": ["node", "carapace.mjs", "gateway", "--port", "18789"],
                "EnvironmentVariables": [
                    "CARAPACE_SERVICE_MARKER": "carapace",
                    "CARAPACE_SERVICE_KIND": "gateway",
                ],
            ],
            format: .xml,
            options: 0)
        try data.write(to: agents.appendingPathComponent("ai.carapace.gateway.plist"))

        #expect(GatewayLaunchAgentManager.conflictingProfileClaimOwner(
            port: 18789,
            excludingLabel: "ai.carapace.qa",
            homeDirectory: home)?.contains("default") == true)
    }

    @Test func `reads Gateway service ownership command directly from launchd`() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("carapace-gateway-\(UUID().uuidString).plist")
        defer { try? FileManager.default.removeItem(at: url) }
        let arguments = [
            "/Users/Test/.carapace/tools/node/bin/node",
            "/Users/Test/.carapace/lib/node_modules/carapace/dist/index.js",
            "gateway",
        ]
        let data = try PropertyListSerialization.data(
            fromPropertyList: ["ProgramArguments": arguments],
            format: .xml,
            options: 0)
        try data.write(to: url, options: .atomic)

        #expect(GatewayLaunchAgentManager._testLaunchdProgramArguments(plistURL: url) == arguments)
        try Data("not a plist".utf8).write(to: url, options: .atomic)
        #expect(GatewayLaunchAgentManager._testLaunchdProgramArguments(plistURL: url) == nil)
        try FileManager.default.removeItem(at: url)
        #expect(GatewayLaunchAgentManager._testLaunchdProgramArguments(plistURL: url) == [])
    }

    @Test func `daemon status exposes only a loaded running gateway pid`() {
        #expect(GatewayLaunchAgentManager._testRunningGatewayPID(from: """
        {
          "service": {
            "loaded": true,
            "runtime": { "status": "running", "pid": 4242 }
          }
        }
        """) == 4242)

        let rejected = [
            #"{"service":{"loaded":false,"runtime":{"status":"running","pid":4242}}}"#,
            #"{"service":{"loaded":true,"runtime":{"status":"stopped","pid":4242}}}"#,
            #"{"service":{"loaded":true,"runtime":{"status":"running","pid":0}}}"#,
            #"{"service":{"loaded":true,"runtime":{"status":"running","pid":2147483648}}}"#,
            #"{"service":{"loaded":true,"runtime":{"status":"running","pid":"4242"}}}"#,
            #"{"service":{"loaded":true,"runtime":{"status":"running"}}}"#,
            #"{"service":null}"#,
            "not-json",
        ]
        for json in rejected {
            #expect(GatewayLaunchAgentManager._testRunningGatewayPID(from: json) == nil)
        }
    }

    @Test func `attach only runtime override blocks gateway launch agent writes`() async throws {
        try await TestIsolation.withIsolatedState {
            let dir = FileManager().temporaryDirectory
                .appendingPathComponent("carapace-attach-only-\(UUID().uuidString)", isDirectory: true)
            let marker = dir.appendingPathComponent("disable-launchagent")
            try FileManager().createDirectory(at: dir, withIntermediateDirectories: true)
            defer { try? FileManager().removeItem(at: dir) }
            defer {
                GatewayLaunchAgentManager.setTestingDisableLaunchAgentMarkerURL(nil)
                GatewayLaunchAgentManager.setTestingInterceptDaemonCommands(false)
                GatewayLaunchAgentManager.clearTestingDaemonCommandCalls()
            }

            GatewayLaunchAgentManager.setTestingDisableLaunchAgentMarkerURL(marker)
            GatewayLaunchAgentManager.setTestingInterceptDaemonCommands(true)
            GatewayLaunchAgentManager.clearTestingDaemonCommandCalls()

            let error = GatewayLaunchAgentManager.applyAttachOnlyRuntimeOverride()
            let installError = await GatewayLaunchAgentManager.set(
                enabled: true,
                bundlePath: "/Applications/Carapace.app",
                port: 18789)
            let uninstallError = await GatewayLaunchAgentManager.set(
                enabled: false,
                bundlePath: "/Applications/Carapace.app",
                port: 18789)
            let kickstartError = await GatewayLaunchAgentManager.kickstart()

            #expect(error == nil)
            #expect(installError == nil)
            #expect(uninstallError == nil)
            #expect(kickstartError == nil)
            #expect(FileManager().fileExists(atPath: marker.path))
            #expect(GatewayLaunchAgentManager.testingDaemonCommandCallsSnapshot().isEmpty)
        }
    }

    @Test func `unintercepted daemon commands fail closed during tests`() async {
        await TestIsolation.withIsolatedState {
            let marker = FileManager.default.temporaryDirectory
                .appendingPathComponent("carapace-no-disable-marker-\(UUID().uuidString)")
            defer {
                GatewayLaunchAgentManager.setTestingDisableLaunchAgentMarkerURL(nil)
                GatewayLaunchAgentManager.setTestingInterceptDaemonCommands(false)
            }

            GatewayLaunchAgentManager.setTestingDisableLaunchAgentMarkerURL(marker)
            GatewayLaunchAgentManager.setTestingInterceptDaemonCommands(false)

            let error = await GatewayLaunchAgentManager.kickstart()

            #expect(error == "Gateway daemon commands require explicit interception during tests")
        }
    }

    @Test(arguments: ["failure-with-hints", "failure-hints-only", "failure-without-hints", "success"])
    func `gateway daemon failures preserve actionable recovery hints`(_ scenario: String) async {
        await TestIsolation.withIsolatedState {
            let marker = FileManager.default.temporaryDirectory
                .appendingPathComponent("carapace-no-disable-marker-\(UUID().uuidString)")
            defer {
                GatewayLaunchAgentManager.setTestingDisableLaunchAgentMarkerURL(nil)
                GatewayLaunchAgentManager.setTestingInterceptDaemonCommands(false)
                GatewayLaunchAgentManager.setTestingDaemonStatusPayload(nil)
            }

            let payload = switch scenario {
            case "failure-with-hints":
                """
                {"ok":false,"error":"Gateway service not installed.",
                "hints":["carapace gateway install","carapace gateway start","third hint"]}
                """
            case "failure-hints-only":
                #"{"ok":false,"hints":["carapace gateway install","carapace gateway start"]}"#
            case "failure-without-hints":
                #"{"ok":false,"error":"Gateway service not installed."}"#
            default:
                #"{"ok":true,"message":"Gateway already started."}"#
            }
            let expected: String? = switch scenario {
            case "failure-with-hints":
                "Gateway service not installed. (carapace gateway install · carapace gateway start)"
            case "failure-hints-only": "carapace gateway install · carapace gateway start"
            case "failure-without-hints": "Gateway service not installed."
            default: nil
            }

            GatewayLaunchAgentManager.setTestingDisableLaunchAgentMarkerURL(marker)
            GatewayLaunchAgentManager.setTestingInterceptDaemonCommands(true)
            GatewayLaunchAgentManager.setTestingDaemonStatusPayload(payload)

            #expect(await GatewayLaunchAgentManager.kickstart() == expected)
        }
    }

    @Test func `launch agent plist snapshot parses args and env`() throws {
        let url = FileManager().temporaryDirectory
            .appendingPathComponent("carapace-launchd-\(UUID().uuidString).plist")
        let plist: [String: Any] = [
            "ProgramArguments": ["carapace", "gateway", "--port", "18789", "--bind", "loopback"],
            "EnvironmentVariables": [
                "CARAPACE_GATEWAY_TOKEN": " secret ",
                "CARAPACE_GATEWAY_PASSWORD": "pw",
            ],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: url, options: [.atomic])
        defer { try? FileManager().removeItem(at: url) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(url: url))
        #expect(snapshot.port == 18789)
        #expect(snapshot.bind == "loopback")
        #expect(snapshot.token == "secret")
        #expect(snapshot.password == "pw")
    }

    @Test func `launch agent plist snapshot merges canonical generated environment`() throws {
        let directory = FileManager().temporaryDirectory
            .appendingPathComponent("carapace-launchd-env-\(UUID().uuidString)", isDirectory: true)
        let plistURL = directory.appendingPathComponent("ai.carapace.gateway.plist")
        let environmentFileURL = directory.appendingPathComponent("ai.carapace.gateway.env")
        let wrapperURL = directory.appendingPathComponent("ai.carapace.gateway-env-wrapper.sh")
        try FileManager().createDirectory(at: directory, withIntermediateDirectories: true)
        try "#!/bin/sh\n".write(to: wrapperURL, atomically: true, encoding: .utf8)
        try """
        # Generated by Carapace. Do not edit while the gateway service is installed.
        export CUSTOM_GATEWAY_TOKEN='custom-token'
        export CARAPACE_GATEWAY_PASSWORD='service'\\''pass'
        export CARAPACE_GATEWAY_TOKEN=' service-token '

        """.write(to: environmentFileURL, atomically: true, encoding: .utf8)
        let plist: [String: Any] = [
            "ProgramArguments": [
                "/bin/sh",
                wrapperURL.path,
                environmentFileURL.path,
                "carapace",
                "gateway",
                "--port",
                "18789",
            ],
            "EnvironmentVariables": ["CARAPACE_GATEWAY_TOKEN": "stale-inline-token"],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: plistURL, options: [.atomic])
        defer { try? FileManager().removeItem(at: directory) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(
            url: plistURL,
            generatedEnvironmentFileURL: environmentFileURL,
            generatedEnvironmentWrapperURL: wrapperURL))
        #expect(snapshot.environment["CUSTOM_GATEWAY_TOKEN"] == "custom-token")
        #expect(snapshot.token == "service-token")
        #expect(snapshot.password == "service'pass")
        #expect(snapshot.port == 18789)
    }

    @Test func `launch agent plist snapshot ignores unreferenced generated environment`() throws {
        let directory = FileManager().temporaryDirectory
            .appendingPathComponent("carapace-launchd-env-\(UUID().uuidString)", isDirectory: true)
        let plistURL = directory.appendingPathComponent("ai.carapace.gateway.plist")
        let environmentFileURL = directory.appendingPathComponent("ai.carapace.gateway.env")
        let wrapperURL = directory.appendingPathComponent("ai.carapace.gateway-env-wrapper.sh")
        try FileManager().createDirectory(at: directory, withIntermediateDirectories: true)
        try "#!/bin/sh\n".write(to: wrapperURL, atomically: true, encoding: .utf8)
        try "export CARAPACE_GATEWAY_TOKEN='unreferenced-token'\n"
            .write(to: environmentFileURL, atomically: true, encoding: .utf8)
        let plist: [String: Any] = [
            "ProgramArguments": ["carapace", "gateway"],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: plistURL, options: [.atomic])
        defer { try? FileManager().removeItem(at: directory) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(
            url: plistURL,
            generatedEnvironmentFileURL: environmentFileURL,
            generatedEnvironmentWrapperURL: wrapperURL))
        #expect(snapshot.token == nil)
        #expect(snapshot.environment.isEmpty)
    }

    @Test func `launch agent plist snapshot allows missing bind`() throws {
        let url = FileManager().temporaryDirectory
            .appendingPathComponent("carapace-launchd-\(UUID().uuidString).plist")
        let plist: [String: Any] = [
            "ProgramArguments": ["carapace", "gateway", "--port", "18789"],
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: url, options: [.atomic])
        defer { try? FileManager().removeItem(at: url) }

        let snapshot = try #require(LaunchAgentPlist.snapshot(url: url))
        #expect(snapshot.port == 18789)
        #expect(snapshot.bind == nil)
    }
}
