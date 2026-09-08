// swift-tools-version: 6.3

import PackageDescription

let package = Package(
    name: "CarapaceKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
        .watchOS(.v11),
    ],
    products: [
        .library(name: "CarapaceProtocol", targets: ["CarapaceProtocol"]),
        .library(name: "CarapaceNativeState", targets: ["CarapaceNativeState"]),
        .library(name: "CarapaceKit", targets: ["CarapaceKit"]),
        .library(name: "CarapaceChatUI", targets: ["CarapaceChatUI"]),
    ],
    traits: [
        .trait(name: "Talk", description: "ElevenLabs cloud TTS / talk support"),
        .default(enabledTraits: ["Talk"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.1"),
        .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.11.1"),
        .package(url: "https://github.com/mgriebling/SwiftMath", exact: "1.7.3"),
        .package(url: "https://github.com/swiftlang/swift-markdown", exact: "0.8.0"),
    ],
    targets: [
        .target(
            name: "CarapaceProtocol",
            path: "Sources/CarapaceProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CarapaceNativeState",
            path: "Sources/CarapaceNativeState",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CarapaceKit",
            dependencies: [
                "CarapaceNativeState",
                "CarapaceProtocol",
                .product(
                    name: "ElevenLabsKit",
                    package: "ElevenLabsKit",
                    condition: .when(platforms: [.iOS, .macOS], traits: ["Talk"])),
            ],
            path: "Sources/CarapaceKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CarapaceChatUI",
            dependencies: [
                "CarapaceKit",
                "CarapaceProtocol",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "Markdown", package: "swift-markdown"),
                .product(name: "SwiftMath", package: "SwiftMath"),
            ],
            path: "Sources/CarapaceChatUI",
            resources: [
                .copy("Resources/Mermaid"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "CarapaceKitTests",
            dependencies: [
                "CarapaceKit",
                "CarapaceChatUI",
                "CarapaceProtocol",
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Tests/CarapaceKitTests",
            resources: [.copy("Fixtures")],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
        .testTarget(
            name: "CarapaceNativeStateTests",
            dependencies: ["CarapaceNativeState"],
            path: "Tests/CarapaceNativeStateTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
