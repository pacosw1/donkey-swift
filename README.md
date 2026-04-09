# Donkey-Swift

Framework-agnostic TypeScript services for iOS app backends. Each package exports pure business logic with DB interfaces you implement using any ORM or driver -- no HTTP framework dependency, no database lock-in.

## Install

```sh
npm install pacosw1/donkey-swift
```

## Quick Start

```typescript
import { AuthService } from "donkey-swift/auth";
import type { AuthDB } from "donkey-swift/auth";

// 1. Implement the DB interface with your ORM
const authDB: AuthDB = {
  async upsertUserByAppleSub(id, appleSub, email, name) { /* ... */ },
  async userById(id) { /* ... */ },
};

// 2. Create the service
const auth = new AuthService({ jwtSecret: "...", appleBundleId: "com.you.app" }, authDB);

// 3. Use it
const { token, user } = await auth.authenticateWithApple(identityToken);
```

## Packages

| Package | Description |
|---------|-------------|
| `errors` | Typed errors (ValidationError, NotFoundError, etc.) with HTTP status mapping |
| `middleware` | Rate limiter, bearer token extraction, request ID generation |
| `migrate` | SQL migration runner (idempotent, IF NOT EXISTS) |
| `health` | Liveness and readiness probes with pluggable checks |
| `logging` | Structured JSON logging and persisted client/server error reporting |
| `logbuf` | Ring-buffer log capture for admin panels |
| `scheduler` | Periodic background task runner (setInterval-based) |
| `auth` | Apple Sign-In, JWT sessions, optional server-side session store |
| `engage` | Event tracking, subscriptions, sessions, feedback, paywall eligibility |
| `notify` | Push notification device registration, preferences, delivery scheduling |
| `push` | APNs provider with JWT auth, HTTP/2, rich payloads, bad token detection |
| `chat` | In-app support chat with WebSocket real-time delivery and push fallback |
| `email` | SMTP email sending with template rendering |
| `sync` | Offline-first delta sync with version-based conflict detection |
| `storage` | S3-compatible object storage client |
| `receipt` | StoreKit 2 server-side receipt verification and App Store webhooks |
| `paywall` | Server-driven paywall content with locale fallback and versioning |
| `attest` | Apple App Attest device verification (CBOR, cert chain, assertions) |
| `account` | Account deletion, anonymization, and GDPR data export |
| `flags` | Feature flags with rollout %, per-user overrides, typed values, caching |
| `lifecycle` | User lifecycle stages, engagement scoring, contextual prompts |
| `analytics` | Admin dashboards (DAU, MRR, retention, revenue, events) |
| `appstore` | App Store Server API v2 client (transaction history, subscription mgmt) |
| `attribution` | Campaign/source/channel attribution with tracked links, clicks, and conversions |
| `promo` | Influencer promo codes, redemption tracking, commission calculation |
| `grants` | Manual premium grants with expiry and revocation |
| `conversion` | Discount offers for converting free users, with dismissal tracking |

## Error Handling

All services throw typed errors from `donkey-swift/errors`:

```typescript
import { ValidationError, NotFoundError, errorToStatus } from "donkey-swift/errors";

try {
  await auth.getUser(userId);
} catch (err) {
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message }, 404);
  }
  const status = errorToStatus(err);
  return c.json({ error: err.message }, status);
}
```

## Starter Templates

See [`starters/postgres/`](./starters/postgres/) for a reference PostgreSQL implementation using Drizzle ORM. Copy and customize for your app.

## API Reference

See [COMPONENTS.md](./COMPONENTS.md) for the full API catalog with every interface, type, and function signature.
