import Foundation
import DonkeyCore

/// Client for in-app support chat (user-facing).
///
///   GET  /api/v1/support-chat/history       — paged message history
///   POST /api/v1/support-chat/send          — send a message
///   GET  /api/v1/support-chat/unread-count  — unread count for the user
///
/// Admin endpoints (`adminListChats`, `adminReply`, …) live on the same
/// backend but are called from `web-admin` and are intentionally not
/// exposed here.
///
/// TODO: `POST /api/v1/support-chat/upload` is a multipart endpoint —
/// implementing it properly requires `multipart/form-data` body building,
/// which is out of scope for the initial SDK port. Callers that need to
/// attach media today should POST the multipart themselves and then pass
/// the returned `ChatAttachmentInput` to `sendMessage(..., attachment:)`.
public struct ChatClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    // MARK: History

    /// Fetch the history window for the current user. Matches the
    /// `ChatService.getMessages` signature with `limit`/`offset`/`since_id`.
    public func getHistory(
        limit: Int = 50,
        offset: Int = 0,
        sinceId: Int? = nil
    ) async throws -> ChatHistoryResponse {
        var query: [String: String] = [
            "limit": String(limit),
            "offset": String(offset),
        ]
        if let sinceId { query["since_id"] = String(sinceId) }

        let path = "\(basePath)/support-chat/history" + encodeQuery(query)
        return try await client.request(path, method: .get)
    }

    // MARK: Send

    /// Send a new message into the user's support thread. Pass an
    /// `attachment` previously obtained from the upload endpoint — see the
    /// TODO on this type for upload status.
    @discardableResult
    public func sendMessage(
        _ message: String,
        messageType: String = "text",
        attachment: ChatAttachmentInput? = nil
    ) async throws -> ChatSendResponse {
        let body = SendRequest(
            message: message,
            messageType: messageType,
            attachment: attachment
        )
        return try await client.request(
            "\(basePath)/support-chat/send",
            method: .post,
            body: body
        )
    }

    // MARK: Unread

    public func unreadCount() async throws -> ChatUnreadCount {
        try await client.request(
            "\(basePath)/support-chat/unread-count",
            method: .get
        )
    }

    // MARK: Attachment download

    /// Build the fully-qualified URL for an attachment token. Callers should
    /// then fetch this URL directly (it returns raw bytes, not JSON, so it
    /// does not go through `DonkeyClient.request`). The token is returned
    /// by the upload endpoint or embedded in message URLs by the server.
    public func attachmentURL(token: String) async -> URL {
        let base = await client.baseURL
        let path = "\(basePath)/support-chat/attachments/\(token)"
        return URL(string: path, relativeTo: base)?.absoluteURL
            ?? base.appendingPathComponent(path)
    }

    // MARK: Wire types

    private struct SendRequest: Encodable, Sendable {
        let message: String
        let messageType: String
        let attachment: ChatAttachmentInput?

        private enum CodingKeys: String, CodingKey {
            case message
            case messageType = "message_type"
            case attachment
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(message, forKey: .message)
            try c.encode(messageType, forKey: .messageType)
            try c.encodeIfPresent(attachment, forKey: .attachment)
        }
    }

    private func encodeQuery(_ params: [String: String]) -> String {
        guard !params.isEmpty else { return "" }
        var components = URLComponents()
        components.queryItems = params
            .sorted { $0.key < $1.key }
            .map { URLQueryItem(name: $0.key, value: $0.value) }
        return "?" + (components.percentEncodedQuery ?? "")
    }
}
