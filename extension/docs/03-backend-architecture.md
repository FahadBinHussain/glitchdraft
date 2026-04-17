# Backend Architecture (Next.js + Neon + Drizzle)

## Stack

- Next.js App Router API routes.
- Neon Postgres (`@neondatabase/serverless`).
- Drizzle ORM + drizzle-kit migrations.

## Important Files

- `backend/lib/db.ts`: DB client initialization from `DATABASE_URL`.
- `backend/lib/auth.ts`: API key auth check via `x-api-key` or `Authorization: Bearer`.
- `backend/drizzle/schema.ts`: `drafts` and `settings` schema.
- `backend/drizzle.config.ts`: migration config.
- `backend/app/api/...`: REST endpoints.

## Endpoints

- `GET /api/health`
- `GET /api/drafts`
- `GET /api/drafts/:threadId`
- `PUT /api/drafts/:threadId`
- `DELETE /api/drafts/:threadId`
- `GET /api/settings`
- `PUT /api/settings`

## Auth Model

- `API_KEY` is required.
- If `API_KEY` missing/empty, all protected endpoints fail auth.
- Extension sends `x-api-key`.

## Settings Merge Behavior

`PUT /api/settings` merges with existing row:

- If `uiPositions` missing in request, existing `uiPositions` is preserved.
- If `appConfig` missing in request, existing `appConfig` is preserved.

This prevents accidental field wipe during partial updates.

## Data Storage

- `drafts` table keyed by `thread_id`.
- `settings` table keyed by fixed `id = "user"`.

## Deployment Notes

- Vercel deploy does not automatically run migrations unless configured.
- Recommended: run `pnpm db:migrate` explicitly during release workflow.
