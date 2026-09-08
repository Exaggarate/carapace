// swift-tools-version: 6.3
// Package manifest for the Carapace macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Carapace",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "CarapaceIPC", targets: ["CarapaceIPC"]),
        .library(name: "CarapaceDiscovery", targets: ["CarapaceDiscovery"]),
        .executable(name: "Carapace", targets: ["Carapace"]),
        .executable(name: "carapace-mac", targets: ["CarapaceMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", exact: "3.0.1"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.15.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.6"),
        .package(
            url: "https://github.com/Exaggarate/carapace/Peekaboo.git",
            revision: "44eff916c3330739108cc1d73683338d4250503a"),
        .package(url: "https://github.com/pointfreeco/swift-concurrency-extras", from: "1.4.1"),
        .package(path: "../shared/CarapaceKit"),
        .package(path: "../shared/CarapaceMLXTTSProtocol"),
        .package(path: "../swabble"),
    ],
    targets: [
        .target(
            name: "CarapaceCameraPTZNative",
            path: "Sources/CarapaceCameraPTZNative",
            publicHeadersPath: "include",
            linkerSettings: [
                .linkedFramework("CoreFoundation"),
                .linkedFramework("IOKit"),
            ]),
        .target(
            name: "CarapaceIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CarapaceDiscovery",
            dependencies: [
                .product(name: "CarapaceKit", package: "CarapaceKit"),
                .product(name: "Subprocess", package: "swift-subprocess"),
            ],
            path: "Sources/CarapaceDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Carapace",
            dependencies: [
                "CarapaceIPC",
                "CarapaceDiscovery",
                "CarapaceCameraPTZNative",
                .product(name: "CarapaceNativeState", package: "CarapaceKit"),
                .product(name: "CarapaceKit", package: "CarapaceKit"),
                .product(name: "CarapaceChatUI", package: "CarapaceKit"),
                .product(name: "CarapaceMLXTTSProtocol", package: "CarapaceMLXTTSProtocol"),
                .product(name: "CarapaceProtocol", package: "CarapaceKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
                .product(name: "ConcurrencyExtras", package: "swift-concurrency-extras"),
                .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
            ],
            exclude: [
                "Resources/Info.plist",
                "Resources/Localizable.xcstrings",
            ],
            resources: [
                .copy("Resources/Carapace.icns"),
                .copy("Resources/NativeSessionCatalogs.json"),
                .copy("Resources/AppIcons"),
                .copy("Resources/DeviceModels"),
                .copy("Resources/ProviderIcons"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "CarapaceMacCLI",
            dependencies: [
                "CarapaceIPC",
                "CarapaceDiscovery",
                .product(name: "CarapaceKit", package: "CarapaceKit"),
                .product(name: "CarapaceProtocol", package: "CarapaceKit"),
            ],
            path: "Sources/CarapaceMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "CarapaceIPCTests",
            dependencies: [
                "CarapaceIPC",
                "Carapace",
                "CarapaceMacCLI",
                "CarapaceDiscovery",
                .product(name: "CarapaceChatUI", package: "CarapaceKit"),
                .product(name: "CarapaceKit", package: "CarapaceKit"),
                .product(name: "CarapaceMLXTTSProtocol", package: "CarapaceMLXTTSProtocol"),
                .product(name: "CarapaceProtocol", package: "CarapaceKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
