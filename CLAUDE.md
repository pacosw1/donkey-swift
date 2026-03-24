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

- Every package defines a DB interface (e.g. `AuthDB`, `SyncDB`, `EngageDB`) — no direct database dependency
- Handlers take `(c: Context) => Promise<Response>` — compatible with Hono
- Services are constructed with a config object and a DB interface implementation
- Apps implement adapters (DB interfaces) using whatever ORM/driver they want
- All services are optional in `AppConfig` except `auth` and `health`

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
