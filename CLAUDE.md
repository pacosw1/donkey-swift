# Donkey-Swift

Shared TypeScript packages for iOS app backends. Interface-based DB, Hono handlers, zero database dependency.

## Project structure

- `packages/donkey-swift/` — Core library (published npm package)
  - `src/` — Package source (auth, sync, push, chat, engage, notify, etc.)
  - Each subdirectory is a package exporting DB interfaces, types, and service classes
- `apps/web/` — SvelteKit admin panel app
- `starters/postgres/` — Reference implementation with PostgreSQL (Drizzle ORM)
- `mcp/` — MCP server + SQLite FTS5 index for AI-assisted discovery
- `COMPONENTS.md` — Package API catalog (source of truth for MCP index)

## Conventions

- Every package defines a DB interface (e.g. `AuthDB`, `SyncDB`, `EngageDB`) — no direct database dependency in the library
- Handlers take `(c: Context) => Promise<Response>` — compatible with Hono
- Services are constructed with a config object and a DB interface implementation
- Use `httputil.jsonResponse` / `httputil.errorResponse` for raw Response helpers
- All services are optional in `AppConfig` except `auth` and `health`

## Running tests

```sh
cd packages/donkey-swift && npx vitest run
```

## Type-checking

```sh
cd packages/donkey-swift && npx tsc --noEmit
```

## After modifying or adding packages

When you add, remove, or modify any public type, interface, function, or package:

1. **Update `COMPONENTS.md`** — Add/update the entry following the existing format (## package, ### DB Interface, ### Types, ### Service, ### Functions)
2. **Re-index MCP** — Run `cd mcp && node indexer.mjs` to rebuild the SQLite FTS5 search index

Both steps are required. The MCP index is how LLMs discover packages — if you skip step 2, the new package won't be findable.
