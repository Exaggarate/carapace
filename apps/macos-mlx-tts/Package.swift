// swift-tools-version: 6.3
// Isolated MLX TTS helper package. Keep this out of apps/macos/Package.swift so
// normal macOS app tests do not compile the full MLX audio stack.

import PackageDescription

let package = Package(
    name: "CarapaceMLXTTS",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .executable(name: "carapace-mlx-tts", targets: ["CarapaceMLXTTSHelper"]),
    ],
    dependencies: [
        // Progressive Fish chunks and cancellation are newer than the latest tagged release.
        .package(
            url: "https://github.com/Blaizzy/mlx-audio-swift",
            revision: "3506fb93cc3b9e4a642079d5384eaca0373962e6"),
        .package(path: "../shared/CarapaceMLXTTSProtocol"),
    ],
    targets: [
        .target(
            name: "CarapaceMLXTTSRuntime",
            dependencies: [
                .product(name: "MLXAudioCore", package: "mlx-audio-swift"),
                .product(name: "MLXAudioTTS", package: "mlx-audio-swift"),
                .product(name: "CarapaceMLXTTSProtocol", package: "CarapaceMLXTTSProtocol"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "CarapaceMLXTTSHelper",
            dependencies: [
                "CarapaceMLXTTSRuntime",
                .product(name: "CarapaceMLXTTSProtocol", package: "CarapaceMLXTTSProtocol"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "CarapaceMLXTTSRuntimeTests",
            dependencies: [
                "CarapaceMLXTTSRuntime",
                .product(name: "CarapaceMLXTTSProtocol", package: "CarapaceMLXTTSProtocol"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
    ])
