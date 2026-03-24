# Donkey-Swift

Shared TypeScript packages for iOS app backends. Framework-agnostic services — pure business logic with no HTTP framework dependency.

## Project structure

- `src/` — Package source (auth, sync, push, chat, engage, notify, etc.)
  - Each subdirectory is a package exporting DB interfaces, types, service classes, and error types
  - **Zero HTTP framework dependency** — no Hono, no Express, no Fastify
- `dist/` — Compiled output (committed to repo for GitHub installs)
- `starters/postgres/` — Reference PostgreSQL implementation (Drizzle ORM) — copy and customize
- `starters/hono/` — Reference Hono route wiring — copy and customize
- `mcp/` — MCP server + SQLite FTS5 index for AI-assisted discovery
- `COMPONENTS.md` — Package API catalog (source of truth for MCP index)

## Install

```sh
npm install pacosw1/donkey-swift
```

## Usage

```ts
import { AuthService } from "donkey-swift/auth";
import { ValidationError, NotFoundError } from "donkey-swift/errors";
import type { AuthDB } from "donkey-swift/auth";

// 1. Implement the DB interface with your own ORM
const authDB: AuthDB = { ... };
const auth = new AuthService(config, authDB);

// 2. Call service methods from your routes (any framework)
const result = await auth.authenticateWithApple(identityToken, name);
const user = await auth.getUser(userId);

// 3. Handle errors in your route handler
try {
  const result = await engage.trackEvents(userId, events);
  res.json(result);
} catch (err) {
  if (err instanceof ValidationError) res.status(400).json({ error: err.message });
  else if (err instanceof NotFoundError) res.status(404).json({ error: err.message });
  else res.status(500).json({ error: "internal error" });
}
```

## Conventions

- **Framework-agnostic services.** Services are pure TypeScript classes with plain methods that take arguments and return objects. No HTTP request/response objects, no middleware, no route handlers. The user wires services into their own routes using whatever HTTP framework they want.
- **Typed errors instead of HTTP status codes.** Services throw `ValidationError`, `NotFoundError`, `UnauthorizedError`, etc. from `donkey-swift/errors`. The user maps these to HTTP responses in their route handlers.
- **DB interfaces only — no ORM, no SQL, no tables in `src/`.** Every package defines a DB interface (e.g. `AuthDB`, `SyncDB`, `EngageDB`) that the consumer implements with whatever ORM/driver they want. The hard logic lives here and is tested here, but the database implementation is entirely up to the end user.
- **Generic infrastructure clients belong in `src/`.** Things like `StorageClient` (S3), `SMTPProvider` (nodemailer), `APNsProvider` (HTTP/2), and `AppStoreServerClient` are universal implementations — not app-specific.
- `starters/postgres/` is a **reference DB implementation** (Drizzle ORM). `starters/hono/` is a **reference route wiring** (Hono). Both are examples — not part of the published package.
- **Never add HTTP framework code to `src/`.** No `import { Context } from "hono"`, no `req`/`res`, no middleware. If you need route examples, add them to `starters/hono/`.
- **Never add database-specific code to `src/`.** If a feature needs persistence, define the interface in `src/` and add the Drizzle implementation to `starters/postgres/`.

## Running tests

```sh
npx vitest run
```

## Type-checking

```sh
npx tsc --noEmit
```

## After modifying or adding packages

When you add, remove, or modify any public type, interface, function, or package:

1. **Update `COMPONENTS.md`** — Add/update the entry following the existing format
2. **Rebuild dist** — Run `npx tsc`
3. **Re-index MCP** — Run `cd mcp && node indexer.mjs`
