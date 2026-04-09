import Foundation

/// A single message in a support chat thread.
///
/// Mirrors the `ChatMessage` interface in the `donkey-swift/chat` package.
/// `sender` is typically `"user"` or `"admin"` but is kept as a plain
/// String so future roles don't break the SDK.
///
/// The server may return `created_at` as either an ISO-8601 string or a
/// Date-equivalent value depending on the db driver round-trip, so we
/// capture it as a raw String and expose a computed `createdAtDate`.
public struct ChatMessage: Decodable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let userId: String
    public let sender: String
    public let message: String
    public let messageType: String
    public let readAt: String?
    public let createdAt: String

    private enum CodingKeys: String, CodingKey {
        case id
        case userId      = "user_id"
        case sender
        case message
        case messageType = "message_type"
        case readAt      = "read_at"
        case createdAt   = "created_at"
    }

    public init(
        id: Int,
        userId: String,
        sender: String,
        message: String,
        messageType: String = "text",
        readAt: String? = nil,
        createdAt: String
    ) {
        self.id = id
        self.userId = userId
        self.sender = sender
        self.message = message
        self.messageType = messageType
        self.readAt = readAt
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id          = (try? c.decode(Int.self, forKey: .id)) ?? 0
        self.userId      = (try? c.decode(String.self, forKey: .userId)) ?? ""
        self.sender      = (try? c.decode(String.self, forKey: .sender)) ?? "user"
        self.message     = (try? c.decode(String.self, forKey: .message)) ?? ""
        self.messageType = (try? c.decode(String.self, forKey: .messageType)) ?? "text"
        self.readAt      = try? c.decode(String.self, forKey: .readAt)
        self.createdAt   = (try? c.decode(String.self, forKey: .createdAt)) ?? ""
    }

    /// Parses `createdAt` as an ISO-8601 date, or nil if the server sent a
    /// format the iOS ISO8601 parser can't handle.
    public var createdAtDate: Date? {
        ISO8601DateFormatter().date(from: createdAt)
    }
}

/// Paged response wrapper for `GET /api/v1/support-chat/history`.
public struct ChatHistoryResponse: Decodable, Sendable, Equatable {
    public let messages: [ChatMessage]
    public let hasMore: Bool

    private enum CodingKeys: String, CodingKey {
        case messages
        case hasMore = "has_more"
    }

    public init(messages: [ChatMessage], hasMore: Bool) {
        self.messages = messages
        self.hasMore = hasMore
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.messages = (try? c.decode([ChatMessage].self, forKey: .messages)) ?? []
        self.hasMore  = (try? c.decode(Bool.self, forKey: .hasMore)) ?? false
    }
}

/// Response for `POST /api/v1/support-chat/send`.
public struct ChatSendResponse: Decodable, Sendable, Equatable {
    public let status: String
    public let id: Int
    public let createdAt: String

    private enum CodingKeys: String, CodingKey {
        case status
        case id
        case createdAt = "created_at"
    }

    public init(status: String, id: Int, createdAt: String) {
        self.status = status
        self.id = id
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.status    = (try? c.decode(String.self, forKey: .status)) ?? "ok"
        self.id        = (try? c.decode(Int.self, forKey: .id)) ?? 0
        self.createdAt = (try? c.decode(String.self, forKey: .createdAt)) ?? ""
    }
}

/// Response for `GET /api/v1/support-chat/unread-count`.
public struct ChatUnreadCount: Decodable, Sendable, Equatable {
    public let count: Int

    public init(count: Int) {
        self.count = count
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.count = (try? c.decode(Int.self, forKey: .count)) ?? 0
    }

    private enum CodingKeys: String, CodingKey { case count }
}

/// An attachment reference passed when sending a message. The server-side
/// upload route accepts multipart and returns one of these — the SDK does
/// not implement the upload itself (see TODO in ChatClient).
public struct ChatAttachmentInput: Codable, Sendable, Equatable {
    public let url: String
    public let contentType: String
    public let fileName: String?
    public let sizeBytes: Int?

    private enum CodingKeys: String, CodingKey {
        case url
        case contentType = "content_type"
        case fileName    = "file_name"
        case sizeBytes   = "size_bytes"
    }

    public init(url: String, contentType: String, fileName: String? = nil, sizeBytes: Int? = nil) {
        self.url = url
        self.contentType = contentType
        self.fileName = fileName
        self.sizeBytes = sizeBytes
    }
}
