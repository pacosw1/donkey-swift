/** OpenAPI 3.1 spec generator for the donkeygo API. */
function str(desc = "") { return { type: "string", description: desc }; }
function strFmt(format, desc = "") { return { type: "string", format, description: desc }; }
function int(desc = "") { return { type: "integer", description: desc }; }
function intRange(min, max, desc = "") { return { type: "integer", minimum: min, maximum: max, description: desc }; }
function bool(desc = "") { return { type: "boolean", description: desc }; }
function arr(items) { return { type: "array", items }; }
function ref(name) { return { $ref: `#/components/schemas/${name}` }; }
function obj(properties, required) {
    const s = { type: "object", properties };
    if (required?.length)
        s.required = required;
    return s;
}
function strEnum(values, desc = "") { return { type: "string", enum: values, description: desc }; }
function nullStr(desc = "") { return { type: ["string", "null"], description: desc }; }
function nullStrFmt(format, desc = "") { return { type: ["string", "null"], format, description: desc }; }
function buildPathItem(route) {
    const op = {
        summary: route.summary,
        tags: route.tags,
        responses: {
            [route.response.status]: {
                description: route.response.description,
                ...(route.response.schema ? {
                    content: { "application/json": { schema: route.response.schema } },
                } : {}),
            },
        },
    };
    if (route.auth) {
        op.security = [{ bearerAuth: [] }];
    }
    if (route.parameters?.length) {
        op.parameters = route.parameters;
    }
    if (route.requestBody) {
        const contentType = route.requestContentType ?? "application/json";
        op.requestBody = {
            required: true,
            content: { [contentType]: { schema: route.requestBody } },
        };
    }
    return op;
}
function addRoute(paths, route) {
    if (!paths[route.path])
        paths[route.path] = {};
    paths[route.path][route.method.toLowerCase()] = buildPathItem(route);
}
// ── Route definitions ──────────────────────────────────────────────────────
function authRoutes() {
    return [
        {
            method: "POST", path: "/api/v1/auth/apple",
            summary: "Sign in with Apple", tags: ["Auth"], auth: false,
            requestBody: obj({ identity_token: str("Apple identity token"), name: str("User display name"), platform: strEnum(["ios", "web"], "Client platform") }, ["identity_token"]),
            response: { status: 200, description: "Authenticated", schema: ref("AuthResponse") },
        },
        {
            method: "GET", path: "/api/v1/auth/me",
            summary: "Get current user", tags: ["Auth"], auth: true,
            response: { status: 200, description: "Current user", schema: ref("User") },
        },
        {
            method: "POST", path: "/api/v1/auth/logout",
            summary: "Sign out (clears session cookie)", tags: ["Auth"], auth: true,
            response: { status: 200, description: "Logged out" },
        },
    ];
}
function engageRoutes() {
    return [
        {
            method: "POST", path: "/api/v1/events",
            summary: "Track analytics events (batched)", tags: ["Engage"], auth: true,
            requestBody: obj({ events: { type: "array", maxItems: 100, items: ref("Event") } }, ["events"]),
            response: { status: 200, description: "Events tracked", schema: obj({ tracked: int() }) },
        },
        {
            method: "PUT", path: "/api/v1/subscription",
            summary: "Sync subscription status from StoreKit", tags: ["Engage"], auth: true,
            requestBody: obj({
                product_id: str(), status: strEnum(["active", "expired", "cancelled", "trial", "free"]),
                expires_at: nullStrFmt("date-time"), original_transaction_id: str(),
                price_cents: int(), currency_code: str(),
            }, ["status"]),
            response: { status: 200, description: "Subscription updated", schema: ref("Subscription") },
        },
        {
            method: "POST", path: "/api/v1/sessions",
            summary: "Report session start/end", tags: ["Engage"], auth: true,
            requestBody: obj({
                session_id: str(), action: strEnum(["start", "end"]),
                app_version: str(), os_version: str(), country: str(), duration_s: int("Seconds (sent on end)"),
            }, ["session_id", "action"]),
            response: { status: 200, description: "Session recorded" },
        },
        {
            method: "GET", path: "/api/v1/user/eligibility",
            summary: "Get paywall trigger and engagement data", tags: ["Engage"], auth: true,
            response: { status: 200, description: "Eligibility", schema: ref("Eligibility") },
        },
        {
            method: "POST", path: "/api/v1/feedback",
            summary: "Submit user feedback", tags: ["Engage"], auth: true,
            requestBody: obj({
                type: strEnum(["positive", "negative", "bug", "feature", "general"]),
                message: str("Feedback message"), app_version: str(),
            }, ["message"]),
            response: { status: 201, description: "Feedback received" },
        },
    ];
}
function notifyRoutes() {
    return [
        {
            method: "POST", path: "/api/v1/notifications/devices",
            summary: "Register device for push notifications", tags: ["Notifications"], auth: true,
            requestBody: obj({
                token: str("APNs device token"), platform: strEnum(["ios", "macos", "web"], "Platform"),
                device_model: str("Device model"), os_version: str("OS version"), app_version: str("App version"),
            }, ["token"]),
            response: { status: 201, description: "Device registered" },
        },
        {
            method: "DELETE", path: "/api/v1/notifications/devices",
            summary: "Disable device token", tags: ["Notifications"], auth: true,
            requestBody: obj({ token: str("Token to disable") }, ["token"]),
            response: { status: 200, description: "Device disabled" },
        },
        {
            method: "GET", path: "/api/v1/notifications/preferences",
            summary: "Get notification preferences", tags: ["Notifications"], auth: true,
            response: { status: 200, description: "Preferences", schema: ref("NotificationPreferences") },
        },
        {
            method: "PUT", path: "/api/v1/notifications/preferences",
            summary: "Update notification preferences", tags: ["Notifications"], auth: true,
            requestBody: ref("NotificationPreferences"),
            response: { status: 200, description: "Updated preferences", schema: ref("NotificationPreferences") },
        },
        {
            method: "POST", path: "/api/v1/notifications/opened",
            summary: "Track notification open", tags: ["Notifications"], auth: true,
            requestBody: obj({ notification_id: str("Notification ID") }),
            response: { status: 200, description: "Recorded" },
        },
    ];
}
function chatRoutes() {
    return [
        {
            method: "GET", path: "/api/v1/chat",
            summary: "Get chat history", tags: ["Chat"], auth: true,
            parameters: [
                { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
                { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
                { name: "since_id", in: "query", description: "Return messages newer than this ID", schema: int() },
            ],
            response: { status: 200, description: "Chat messages", schema: obj({ messages: arr(ref("ChatMessage")), has_more: bool() }) },
        },
        {
            method: "POST", path: "/api/v1/chat",
            summary: "Send chat message", tags: ["Chat"], auth: true,
            requestBody: obj({ message: str("Message text (max 5000 chars)"), message_type: strEnum(["text", "image"]) }, ["message"]),
            response: { status: 201, description: "Message sent" },
        },
        {
            method: "GET", path: "/api/v1/chat/unread",
            summary: "Get unread message count", tags: ["Chat"], auth: true,
            response: { status: 200, description: "Unread count", schema: obj({ count: int() }) },
        },
    ];
}
function syncRoutes() {
    return [
        {
            method: "GET", path: "/api/v1/sync/changes",
            summary: "Get changes since timestamp (delta sync)", tags: ["Sync"], auth: true,
            parameters: [
                { name: "since", in: "query", description: "ISO8601 timestamp. Omit for full sync.", schema: strFmt("date-time") },
                { name: "X-Device-ID", in: "header", description: "Unique device identifier" },
            ],
            response: { status: 200, description: "Sync changes", schema: ref("SyncChanges") },
        },
        {
            method: "POST", path: "/api/v1/sync/batch",
            summary: "Batch upsert entities with version-based conflict detection", tags: ["Sync"], auth: true,
            parameters: [
                { name: "X-Device-ID", in: "header", description: "Unique device identifier for change tracking" },
                { name: "X-Idempotency-Key", in: "header", description: "UUID for request deduplication" },
            ],
            requestBody: obj({ items: arr(ref("BatchItem")) }, ["items"]),
            response: { status: 200, description: "Batch results", schema: ref("BatchResponse") },
        },
        {
            method: "DELETE", path: "/api/v1/sync/{entity_type}/{id}",
            summary: "Delete entity and record tombstone", tags: ["Sync"], auth: true,
            parameters: [
                { name: "entity_type", in: "path", required: true, schema: str() },
                { name: "id", in: "path", required: true, schema: str() },
                { name: "X-Device-ID", in: "header", description: "Unique device identifier" },
            ],
            response: { status: 200, description: "Deleted" },
        },
    ];
}
function flagsRoutes() {
    return [
        {
            method: "GET", path: "/api/v1/flags/{key}",
            summary: "Check if a feature flag is enabled", tags: ["Flags"], auth: true,
            parameters: [{ name: "key", in: "path", required: true, schema: str() }],
            response: { status: 200, description: "Flag status", schema: obj({ key: str(), enabled: bool() }) },
        },
        {
            method: "POST", path: "/api/v1/flags/check",
            summary: "Batch check feature flags", tags: ["Flags"], auth: true,
            requestBody: obj({ keys: arr(str()) }, ["keys"]),
            response: { status: 200, description: "Flag statuses", schema: obj({ flags: { type: "object", additionalProperties: bool() } }) },
        },
    ];
}
function receiptRoutes() {
    return [
        {
            method: "POST", path: "/api/v1/receipt/verify",
            summary: "Verify a StoreKit 2 signed transaction", tags: ["Receipts"], auth: true,
            requestBody: obj({ transaction: str("JWS-signed transaction from StoreKit 2") }, ["transaction"]),
            response: { status: 200, description: "Verification result", schema: ref("VerifyResponse") },
        },
        {
            method: "POST", path: "/api/v1/receipt/webhook",
            summary: "Apple App Store Server Notifications V2 webhook", tags: ["Receipts"], auth: false,
            requestBody: obj({ signedPayload: str("JWS-signed notification payload from Apple") }, ["signedPayload"]),
            response: { status: 200, description: "Webhook processed", schema: obj({ status: str() }) },
        },
    ];
}
function lifecycleRoutes() {
    return [
        {
            method: "GET", path: "/api/v1/user/lifecycle",
            summary: "Get user lifecycle stage and engagement score", tags: ["Lifecycle"], auth: true,
            response: { status: 200, description: "Lifecycle data", schema: ref("EngagementScore") },
        },
        {
            method: "POST", path: "/api/v1/user/lifecycle/ack",
            summary: "Acknowledge a lifecycle prompt", tags: ["Lifecycle"], auth: true,
            requestBody: obj({
                prompt_type: strEnum(["review", "paywall", "winback", "milestone"], "Prompt type"),
                action: strEnum(["shown", "accepted", "dismissed"], "User action"),
            }, ["prompt_type", "action"]),
            response: { status: 200, description: "Acknowledged" },
        },
    ];
}
function accountRoutes() {
    return [
        {
            method: "DELETE", path: "/api/v1/account",
            summary: "Delete account and all associated data", tags: ["Account"], auth: true,
            response: { status: 200, description: "Account deleted" },
        },
        {
            method: "POST", path: "/api/v1/account/anonymize",
            summary: "Anonymize account (remove PII)", tags: ["Account"], auth: true,
            response: { status: 200, description: "Account anonymized" },
        },
        {
            method: "GET", path: "/api/v1/account/export",
            summary: "Export all user data (GDPR)", tags: ["Account"], auth: true,
            response: { status: 200, description: "User data export", schema: ref("UserDataExport") },
        },
    ];
}
function attestRoutes() {
    return [
        {
            method: "POST", path: "/api/v1/attest/challenge",
            summary: "Generate attestation challenge", tags: ["Attest"], auth: true,
            response: { status: 200, description: "Challenge", schema: obj({ nonce: str("Hex-encoded challenge") }) },
        },
        {
            method: "POST", path: "/api/v1/attest/verify",
            summary: "Verify device attestation", tags: ["Attest"], auth: true,
            requestBody: obj({ key_id: str("App Attest key ID"), attestation: str("Base64-encoded attestation object"), nonce: str("Challenge nonce") }, ["key_id", "attestation", "nonce"]),
            response: { status: 200, description: "Verification result", schema: obj({ status: str() }) },
        },
        {
            method: "POST", path: "/api/v1/attest/assert",
            summary: "Verify assertion from attested device", tags: ["Attest"], auth: true,
            requestBody: obj({ assertion: str("Base64-encoded assertion"), client_data: str("Client data used in assertion"), nonce: str("Challenge nonce") }, ["assertion", "nonce"]),
            response: { status: 200, description: "Assertion result", schema: obj({ status: str() }) },
        },
    ];
}
function paywallRoutes() {
    return [
        {
            method: "GET", path: "/api/v1/paywall/config",
            summary: "Get paywall content (server-driven, multi-lang)", tags: ["Paywall"], auth: false,
            parameters: [{ name: "locale", in: "query", schema: { type: "string", default: "en" } }],
            response: { status: 200, description: "Paywall config", schema: ref("PaywallConfig") },
        },
    ];
}
function analyticsRoutes() {
    return [
        {
            method: "GET", path: "/admin/api/analytics/dau",
            summary: "Daily active users time series", tags: ["Analytics"], auth: true,
            parameters: [{ name: "since", in: "query", schema: strFmt("date-time") }],
            response: { status: 200, description: "DAU time series", schema: obj({ data: arr(ref("DAURow")) }) },
        },
        {
            method: "GET", path: "/admin/api/analytics/events",
            summary: "Event counts grouped by event name", tags: ["Analytics"], auth: true,
            parameters: [
                { name: "since", in: "query", schema: strFmt("date-time") },
                { name: "event", in: "query", description: "Optional event name filter", schema: str() },
            ],
            response: { status: 200, description: "Event counts", schema: obj({ data: arr(ref("EventRow")) }) },
        },
        {
            method: "GET", path: "/admin/api/analytics/mrr",
            summary: "Subscription and revenue summary", tags: ["Analytics"], auth: true,
            response: { status: 200, description: "MRR breakdown", schema: obj({ breakdown: arr(ref("SubStats")), new_30d: int(), churned_30d: int() }) },
        },
        {
            method: "GET", path: "/admin/api/analytics/summary",
            summary: "Overview stats (DAU, MAU, total users, active subs)", tags: ["Analytics"], auth: true,
            response: { status: 200, description: "Summary stats", schema: obj({ dau: int(), mau: int(), total_users: int(), active_subscriptions: int() }) },
        },
    ];
}
function healthRoutes() {
    return [
        {
            method: "GET", path: "/health",
            summary: "Liveness probe", tags: ["Health"], auth: false,
            response: { status: 200, description: "OK", schema: obj({ status: str() }) },
        },
        {
            method: "GET", path: "/ready",
            summary: "Readiness probe (runs health checks)", tags: ["Health"], auth: false,
            response: { status: 200, description: "Ready", schema: obj({ status: str(), checks: { type: "object", additionalProperties: str() } }) },
        },
    ];
}
// ── Schema definitions ─────────────────────────────────────────────────────
function allSchemas() {
    return {
        User: obj({
            id: str(), apple_sub: str(), email: str(), name: str(),
            created_at: strFmt("date-time"), last_login_at: strFmt("date-time"),
        }),
        AuthResponse: obj({ token: str("JWT session token (7-day expiry)"), user: ref("User") }),
        Event: obj({ event: str("Event name"), metadata: { type: "object", description: "Arbitrary metadata" }, timestamp: strFmt("date-time") }),
        Subscription: obj({
            user_id: str(), product_id: str(),
            status: strEnum(["active", "expired", "cancelled", "trial", "free"]),
            expires_at: nullStrFmt("date-time"), updated_at: strFmt("date-time"),
        }),
        Eligibility: obj({
            paywall_trigger: nullStr("Trigger name or null"),
            days_active: int(), total_logs: int(), streak: int(), is_pro: bool(),
        }),
        NotificationPreferences: obj({
            user_id: str(), push_enabled: bool(),
            interval_seconds: intRange(300, 86400), wake_hour: intRange(0, 23),
            sleep_hour: intRange(0, 23), timezone: str(), stop_after_goal: bool(),
        }),
        DeviceToken: obj({
            id: str(), token: str(), platform: strEnum(["ios", "macos", "web"]),
            device_name: str(), app_version: str(), enabled: bool(),
            is_current: bool(), last_seen_at: strFmt("date-time"),
        }),
        ChatMessage: obj({
            id: int(), user_id: str(), sender: strEnum(["user", "admin"]),
            message: str(), message_type: strEnum(["text", "image"]),
            read_at: nullStrFmt("date-time"), created_at: strFmt("date-time"),
        }),
        SyncChanges: obj({
            deleted: arr(ref("SyncDeletedEntry")), synced_at: strFmt("date-time"),
        }),
        SyncDeletedEntry: obj({ entity_type: str(), entity_id: str(), deleted_at: strFmt("date-time") }),
        BatchItem: obj({
            client_id: str("Client-generated ID"), entity_type: str("Entity type"),
            entity_id: str("Server entity ID"), version: int("Version for conflict detection"),
            fields: { type: "object", description: "Entity-specific fields" },
        }, ["client_id", "entity_type", "version", "fields"]),
        BatchResponseItem: obj({ client_id: str(), server_id: str(), version: int() }),
        BatchError: obj({
            client_id: str(), error: str(), is_conflict: bool(), server_version: int(),
        }),
        BatchResponse: obj({
            items: arr(ref("BatchResponseItem")), errors: arr(ref("BatchError")),
            synced_at: strFmt("Server timestamp", "date-time"),
        }),
        PaywallConfig: obj({
            headline: str(), headline_accent: str(), subtitle: str(),
            member_count: str(), rating: str(),
            features: arr(obj({ emoji: str(), color: str(), text: str(), bold: str() })),
            reviews: arr(obj({ title: str(), username: str(), time_label: str(), description: str(), rating: int() })),
            footer_text: str(), trial_text: str(), cta_text: str(), version: int(),
        }),
        EngagementScore: obj({
            user_id: str(),
            stage: strEnum(["new", "activated", "engaged", "monetized", "loyal", "at_risk", "dormant", "churned"], "Lifecycle stage"),
            score: intRange(0, 100, "Engagement score"),
            days_since_active: int(), total_sessions: int(),
            aha_reached: bool(), is_pro: bool(), created_days_ago: int(),
            prompt: ref("LifecyclePrompt"),
        }),
        LifecyclePrompt: obj({
            type: strEnum(["review", "paywall", "winback", "milestone"]),
            title: str(), body: str(), reason: str(),
        }),
        VerifyResponse: obj({
            verified: bool("Whether the transaction was successfully verified"),
            status: str("Subscription status"), product_id: str("App Store product identifier"),
            transaction_id: str("Apple transaction ID"), expires_at: nullStrFmt("date-time", "Subscription expiration date"),
        }),
        UserDataExport: obj({
            user: { type: "object" }, subscription: { type: "object" },
            events: { type: "object" }, sessions: { type: "object" },
            feedback: { type: "object" }, chat_messages: { type: "object" },
            device_tokens: { type: "object" }, notification_preferences: { type: "object" },
            transactions: { type: "object" }, app_data: { type: "object" },
        }),
        DAURow: obj({ date: strFmt("date", "Date in YYYY-MM-DD format"), dau: int("Daily active user count") }),
        EventRow: obj({ date: strFmt("date"), event: str("Event name"), count: int(), unique_users: int() }),
        SubStats: obj({ status: str("Subscription status"), count: int() }),
    };
}
// ── Public API ──────────────────────────────────────────────────────────────
export function openApiSpec() {
    const paths = {};
    const allRoutes = [
        ...authRoutes(),
        ...engageRoutes(),
        ...notifyRoutes(),
        ...chatRoutes(),
        ...syncRoutes(),
        ...flagsRoutes(),
        ...receiptRoutes(),
        ...lifecycleRoutes(),
        ...accountRoutes(),
        ...attestRoutes(),
        ...paywallRoutes(),
        ...analyticsRoutes(),
        ...healthRoutes(),
    ];
    for (const route of allRoutes) {
        addRoute(paths, route);
    }
    return {
        openapi: "3.1.0",
        info: {
            title: "DonkeyGo API",
            version: "1.0.0",
            description: "Shared backend API for iOS app backends. Interface-based DB, Hono-powered.",
        },
        servers: [
            { url: "/", description: "Current server" },
        ],
        paths,
        components: {
            schemas: allSchemas(),
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                },
            },
        },
        tags: [
            { name: "Auth", description: "Authentication (Apple Sign-In)" },
            { name: "Engage", description: "Events, subscriptions, sessions, feedback" },
            { name: "Notifications", description: "Push notification devices and preferences" },
            { name: "Chat", description: "In-app support chat" },
            { name: "Sync", description: "Offline-first delta sync" },
            { name: "Flags", description: "Feature flags with rollout" },
            { name: "Receipts", description: "StoreKit 2 receipt verification" },
            { name: "Lifecycle", description: "User lifecycle stages and prompts" },
            { name: "Account", description: "Account management (delete, anonymize, export)" },
            { name: "Attest", description: "Device attestation (App Attest)" },
            { name: "Paywall", description: "Server-driven paywall content" },
            { name: "Analytics", description: "Admin analytics dashboards" },
            { name: "Admin", description: "Admin panel endpoints" },
            { name: "Health", description: "Health and readiness probes" },
        ],
    };
}
//# sourceMappingURL=openapi.js.map