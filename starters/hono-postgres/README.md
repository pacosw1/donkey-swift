# Starter: Hono + PostgreSQL

A complete, working server using donkey-swift with Hono and PostgreSQL.

## Setup

```sh
# 1. Copy this directory into your project
cp -r starters/hono-postgres/ my-server/
cd my-server/

# 2. Configure environment
cp env.example .env
# Edit .env with your values

# 3. Install dependencies
npm install hono @hono/node-server postgres drizzle-orm donkey-swift

# 4. Implement your DB adapters
# See starters/postgres/ for Drizzle ORM examples of every interface

# 5. Run
npx tsx index.ts
```

## What's included

- All 25 donkey-swift services wired to routes
- Auth middleware (Bearer token + session cookie)
- Admin middleware (API key)
- Rate limiting (100 req/min per IP)
- Request ID + logging
- Global error handler (ServiceError → HTTP status)
- CORS
- Graceful shutdown

## What you need to add

1. **DB adapters** — Replace the `null as any` placeholders with your real implementations. Copy from `starters/postgres/` and adapt to your schema.

2. **Migrations** — Create your database tables. The schema is in `starters/postgres/schema.ts`.

3. **App-specific routes** — Add your domain logic alongside the donkey-swift routes.

## Routes

| Method | Path | Auth | Service |
|--------|------|------|---------|
| POST | /api/v1/auth/apple | - | auth |
| GET | /api/v1/auth/me | user | auth |
| POST | /api/v1/auth/logout | user | auth |
| POST | /api/v1/events | user | engage |
| GET | /api/v1/sync/changes | user | sync |
| POST | /api/v1/sync/batch | user | sync |
| POST | /api/v1/chat | user | chat |
| POST | /api/v1/receipt/verify | user | receipt |
| POST | /api/v1/receipt/webhook | - | receipt |
| GET | /api/v1/user/lifecycle | user | lifecycle |
| POST | /api/v1/promo/redeem | user | promo |
| GET | /api/v1/promo/portal/:token | - | promo |
| GET | /api/v1/conversion/offer | user | conversion |
| GET | /admin/api/analytics/* | admin | analytics |
| GET | /admin/api/flags | admin | flags |
| POST | /admin/api/grants | admin | grants |
| ... | *see index.ts for full list* | | |
