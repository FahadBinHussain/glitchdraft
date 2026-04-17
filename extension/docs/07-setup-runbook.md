# Setup and Runbook

## Prerequisites

- Node.js + pnpm
- Neon database
- Chrome/Edge (Developer Mode for extension)

## Backend Local Setup

1. Go to `backend/`.
2. Create `.env`:
   - `DATABASE_URL=<your neon postgres url>`
   - `API_KEY=<strong secret>`
3. Install:
   - `pnpm install`
4. Migrate:
   - `pnpm db:migrate`
5. Run:
   - `pnpm dev`
6. Verify:
   - open `http://localhost:3000/api/health`

## Extension Local Setup

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Load unpacked `extension/`.
4. Open popup and configure:
   - Neon JSON:
     ```json
     {
       "apiBaseUrl": "http://localhost:3000",
       "apiKey": "<same API_KEY as backend>"
     }
     ```
5. Reload extension after manifest/content changes.

## Quick Validation Checklist

- Popup shows active backend as Neon.
- In chat panel, sync status shows connected.
- Save a draft, refresh page, draft still appears.
- Move/resize panel, refresh page, position persists.
- DB has data in:
  - `drafts`
  - `settings.ui_positions`

## Deploy Flow (Typical)

1. Deploy backend to Vercel.
2. Set Vercel env:
   - `DATABASE_URL`
   - `API_KEY`
3. Run migration during release workflow (manual or CI step).
4. Update extension Neon config `apiBaseUrl` to deployed URL.
