// swift-tools-version: 5.9
//
// DonkeyClient — unified Swift SDK for donkey-swift backend services.
//
// This Package.swift lives at the repo root because SwiftPM requires it there,
// but the actual Swift sources live under `swift/Sources/…` so they stay
// cleanly separated from the TypeScript packages under `src/…`. Target
// definitions below use `path:` to reach into `swift/Sources`.
//
// Products map 1:1 onto the backend service modules. Consumers only import
// what they need:
//
//     .product(name: "DonkeyCore",  package: "donkey-swift"),
//     .product(name: "DonkeyFlags", package: "donkey-swift"),
//

import PackageDescription

let package = Package(
    name: "DonkeyClient",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "DonkeyCore",   targets: ["DonkeyCore"]),
        .library(name: "DonkeyFlags",  targets: ["DonkeyFlags"]),
        .library(name: "DonkeyAuth",   targets: ["DonkeyAuth"]),
        .library(name: "DonkeyEngage", targets: ["DonkeyEngage"]),
    ],
    targets: [
        // Transport, auth token provider, errors, AnyCodable. Every other
        // module depends on this one.
        .target(
            name: "DonkeyCore",
            path: "swift/Sources/DonkeyCore"
        ),
        // Flags client — mirrors the backend `flags` package. Sends
        // `POST /api/v1/flags/evaluate` with a FlagContext, decodes
        // per-key EvaluationResult values.
        .target(
            name: "DonkeyFlags",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyFlags"
        ),
        // Auth client — Apple Sign-In, session refresh, logout, /me.
        .target(
            name: "DonkeyAuth",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyAuth"
        ),
        // Engage client — event tracking, paywall eligibility, feedback,
        // session reporting, subscription updates.
        .target(
            name: "DonkeyEngage",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyEngage"
        ),
        .testTarget(
            name: "DonkeyFlagsTests",
            dependencies: ["DonkeyFlags"],
            path: "swift/Tests/DonkeyFlagsTests"
        ),
        .testTarget(
            name: "DonkeyAuthTests",
            dependencies: ["DonkeyAuth"],
            path: "swift/Tests/DonkeyAuthTests"
        ),
        .testTarget(
            name: "DonkeyEngageTests",
            dependencies: ["DonkeyEngage"],
            path: "swift/Tests/DonkeyEngageTests"
        ),
    ]
)
