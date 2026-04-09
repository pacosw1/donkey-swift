import Foundation
import DonkeyCore

/// Client for device-facing notification routes.
///
///   POST /api/v1/notifications/devices                    — register APNs token
///   POST /api/v1/notifications/devices/disable            — revoke token on logout
///   GET  /api/v1/notifications/preferences                — read prefs
///   PUT  /api/v1/notifications/preferences/update         — update prefs
///
/// Admin dispatch / scheduling lives under `/api/v1/admin/*` and is out of
/// scope for this client — iOS only consumes the device-facing surface.
public struct NotifyClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    // MARK: Device registration

    /// Register the current device's APNs token with the backend.
    ///
    /// `apnsEnvironment` and `buildChannel` are forwarded as extra metadata —
    /// the bible-app `registerNotificationRoutes` handler writes them to
    /// `device_tokens` so the admin dashboard can route pushes to the right
    /// environment (sandbox vs production APNs) per device.
    @discardableResult
    public func registerDevice(
        token: String,
        platform: String = "ios",
        deviceModel: String? = nil,
        osVersion: String? = nil,
        appVersion: String? = nil,
        apnsTopic: String? = nil,
        apnsEnvironment: String? = nil,
        buildChannel: String? = nil
    ) async throws -> StatusResponse {
        let body = RegisterDeviceRequest(
            token: token,
            platform: platform,
            deviceModel: deviceModel,
            osVersion: osVersion,
            appVersion: appVersion,
            apnsTopic: apnsTopic,
            apnsEnvironment: apnsEnvironment,
            buildChannel: buildChannel
        )
        return try await client.request(
            "\(basePath)/notifications/devices",
            method: .post,
            body: body
        )
    }

    /// Disable a previously-registered APNs token. Call on sign-out so the
    /// server stops sending pushes to a device that no longer has an
    /// authenticated session.
    @discardableResult
    public func disableDevice(token: String) async throws -> StatusResponse {
        try await client.request(
            "\(basePath)/notifications/devices/disable",
            method: .post,
            body: DisableRequest(token: token)
        )
    }

    // MARK: Preferences

    public func getPreferences() async throws -> NotificationPreferences {
        try await client.request(
            "\(basePath)/notifications/preferences",
            method: .get
        )
    }

    @discardableResult
    public func updatePreferences(_ update: NotificationPreferencesUpdate) async throws -> NotificationPreferences {
        try await client.request(
            "\(basePath)/notifications/preferences/update",
            method: .put,
            body: update
        )
    }

    // MARK: Wire types

    public struct StatusResponse: Decodable, Sendable, Equatable {
        public let status: String

        public init(status: String) {
            self.status = status
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.status = (try? c.decode(String.self, forKey: .status)) ?? "ok"
        }

        private enum CodingKeys: String, CodingKey { case status }
    }

    private struct RegisterDeviceRequest: Encodable, Sendable {
        let token: String
        let platform: String
        let deviceModel: String?
        let osVersion: String?
        let appVersion: String?
        let apnsTopic: String?
        let apnsEnvironment: String?
        let buildChannel: String?

        private enum CodingKeys: String, CodingKey {
            case token
            case platform
            case deviceModel     = "device_model"
            case osVersion       = "os_version"
            case appVersion      = "app_version"
            case apnsTopic       = "apns_topic"
            case apnsEnvironment = "apns_environment"
            case buildChannel    = "build_channel"
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(token, forKey: .token)
            try c.encode(platform, forKey: .platform)
            try c.encodeIfPresent(deviceModel, forKey: .deviceModel)
            try c.encodeIfPresent(osVersion, forKey: .osVersion)
            try c.encodeIfPresent(appVersion, forKey: .appVersion)
            try c.encodeIfPresent(apnsTopic, forKey: .apnsTopic)
            try c.encodeIfPresent(apnsEnvironment, forKey: .apnsEnvironment)
            try c.encodeIfPresent(buildChannel, forKey: .buildChannel)
        }
    }

    private struct DisableRequest: Encodable, Sendable {
        let token: String
    }
}
