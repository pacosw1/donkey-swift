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
        .library(name: "DonkeyCore",    targets: ["DonkeyCore"]),
        .library(name: "DonkeyFlags",   targets: ["DonkeyFlags"]),
        .library(name: "DonkeyAuth",    targets: ["DonkeyAuth"]),
        .library(name: "DonkeyEngage",  targets: ["DonkeyEngage"]),
        .library(name: "DonkeyPaywall", targets: ["DonkeyPaywall"]),
        .library(name: "DonkeyReceipt", targets: ["DonkeyReceipt"]),
        .library(name: "DonkeyNotify",  targets: ["DonkeyNotify"]),
        .library(name: "DonkeyChat",    targets: ["DonkeyChat"]),
        .library(name: "DonkeyAccount", targets: ["DonkeyAccount"]),
        .library(name: "DonkeySync",    targets: ["DonkeySync"]),
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
        // Paywall client — server-driven paywall config + dismiss flow.
        .target(
            name: "DonkeyPaywall",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyPaywall"
        ),
        // Receipt client — StoreKit 2 transaction JWS verification.
        .target(
            name: "DonkeyReceipt",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyReceipt"
        ),
        // Notify client — APNs device registration + notification preferences.
        .target(
            name: "DonkeyNotify",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyNotify"
        ),
        // Chat client — user-facing support chat (history, send, unread).
        .target(
            name: "DonkeyChat",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyChat"
        ),
        // Account client — GDPR export + account deletion.
        .target(
            name: "DonkeyAccount",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeyAccount"
        ),
        // Sync client — offline delta sync (pull, push batch, delete).
        .target(
            name: "DonkeySync",
            dependencies: ["DonkeyCore"],
            path: "swift/Sources/DonkeySync"
        ),

        // Test targets
        .testTarget(
            name: "DonkeyCoreTests",
            dependencies: ["DonkeyCore"],
            path: "swift/Tests/DonkeyCoreTests"
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
        .testTarget(
            name: "DonkeyPaywallTests",
            dependencies: ["DonkeyPaywall"],
            path: "swift/Tests/DonkeyPaywallTests"
        ),
        .testTarget(
            name: "DonkeyReceiptTests",
            dependencies: ["DonkeyReceipt"],
            path: "swift/Tests/DonkeyReceiptTests"
        ),
        .testTarget(
            name: "DonkeyNotifyTests",
            dependencies: ["DonkeyNotify"],
            path: "swift/Tests/DonkeyNotifyTests"
        ),
        .testTarget(
            name: "DonkeyChatTests",
            dependencies: ["DonkeyChat"],
            path: "swift/Tests/DonkeyChatTests"
        ),
        .testTarget(
            name: "DonkeyAccountTests",
            dependencies: ["DonkeyAccount"],
            path: "swift/Tests/DonkeyAccountTests"
        ),
        .testTarget(
            name: "DonkeySyncTests",
            dependencies: ["DonkeySync"],
            path: "swift/Tests/DonkeySyncTests"
        ),
    ]
)
