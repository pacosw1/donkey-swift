# Donkey-Swift

Shared TypeScript packages for iOS app backends. Interface-based DB, Hono handlers, zero database dependency.

## Project structure

- `src/` — Package source (auth, sync, push, chat, engage, notify, etc.)
  - Each subdirectory is a package exporting DB interfaces, types, and service classes
- `dist/` — Compiled output (committed to repo for GitHub installs)
- `starters/postgres/` — Reference PostgreSQL implementation (Drizzle ORM) — copy and customize
- `mcp/` — MCP server + SQLite FTS5 index for AI-assisted discovery
- `COMPONENTS.md` — Package API catalog (source of truth for MCP index)

## Install

```sh
npm install pacosw1/donkey-swift
```

## Usage

```ts
import { AuthService } from "donkey-swift/auth";
import type { AuthDB } from "donkey-swift/auth";

// Implement the interface with your own DB
const authDB: AuthDB = { ... };
const auth = new AuthService(config, authDB);
```

## Conventions

- **Interfaces only, no concrete implementations.** `src/` contains only DB interfaces, types, config objects, and service logic. No tables, no ORM imports, no SQL — zero database dependency. The hard logic lives here and is tested here, but the storage implementation is entirely up to the end user.
- `starters/postgres/` is a **reference implementation** (Drizzle ORM) that users copy and customize. It is not part of the published package — it exists solely as an example of how to implement the interfaces.
- Every package defines a DB interface (e.g. `AuthDB`, `SyncDB`, `EngageDB`) that the consumer implements with whatever ORM/driver they want (Drizzle, Prisma, raw SQL, etc.)
- Handlers take `(c: Context) => Promise<Response>` — compatible with Hono
- Services are constructed with a config object and a DB interface implementation
- All services are optional in `AppConfig` except `auth` and `health`
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
