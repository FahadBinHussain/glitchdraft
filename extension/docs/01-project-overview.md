# Project Overview

## Purpose

GlitchDraft lets users save and reuse chat drafts (text + images) across messaging platforms.

## Repository Structure

- `extension/`: primary Chrome/Edge extension (Manifest V3).
- `backend/`: Next.js API backend using Neon Postgres and Drizzle ORM.
- `lsposed-module/`: Android LSPosed module for in-app overlay and Firestore access.
- `userscript/`: legacy Tampermonkey userscript for Messenger.
- `docs/`: project knowledge and runbooks.

## Current Architecture Direction

- Extension supports dual providers:
  - Firestore direct REST (`firebaseConfig`).
  - Backend API (`neonConfig` with `apiBaseUrl` + `apiKey`).
- Provider selection precedence in extension background:
  1. Neon if configured.
  2. Firebase if Neon not configured.
- Backend is the preferred secure path for Neon (DB credentials stay server-side).

## Key Runtime Components

- UI and chat automation: `extension/content.js`.
- Background request routing: `extension/background.js`.
- Data provider adapters:
  - `extension/firestoreService.js`
  - `extension/neonService.js`
- Sync/poll logic: `extension/draftSync.js`.
- Import/export logic: `extension/draftImport.js`.

## Main Data Domains

- Draft messages by thread/chat ID.
- UI settings:
  - `uiPositions` (floating panel/toggle position and size).
  - `appConfig` (theme/debug and related settings).
