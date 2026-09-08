// swift-tools-version: 6.3

import PackageDescription

let package = Package(
    name: "CarapaceMLXTTSProtocol",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "CarapaceMLXTTSProtocol", targets: ["CarapaceMLXTTSProtocol"]),
    ],
    targets: [
        .target(name: "CarapaceMLXTTSProtocol"),
        .testTarget(
            name: "CarapaceMLXTTSProtocolTests",
            dependencies: ["CarapaceMLXTTSProtocol"]),
    ])
