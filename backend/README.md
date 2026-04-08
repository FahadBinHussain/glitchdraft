# GlitchDraft Next Backend

Next.js API backend for GlitchDraft using Neon Postgres + Drizzle.

## 1) Install

```bash
pnpm install
```

## 2) Configure env

Copy `.env.example` to `.env` and set:

- `DATABASE_URL` from Neon
- `API_KEY` (required)

## 3) Run migration

```bash
pnpm db:migrate
```

## 4) Start

```bash
pnpm dev
```

Health check:

- `GET /api/health`

## API shape (extension-compatible)

- `GET /api/drafts/:threadId` -> `{ success, messages, contactName, exists }`
- `PUT /api/drafts/:threadId` body `{ messages, contactName }`
- `DELETE /api/drafts/:threadId`
- `GET /api/drafts` -> `{ success, drafts }`
- `GET /api/settings` -> `{ success, settings: { uiPositions, appConfig } }`
- `PUT /api/settings` body `{ uiPositions, appConfig }`

Pass `API_KEY` as header on every request:

- `x-api-key: <API_KEY>`
