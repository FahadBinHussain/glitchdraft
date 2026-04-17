# LSPosed Module

## Purpose

Android in-process overlay for supported messaging apps, with draft persistence through Firestore REST.

## Key Areas

- `DraftRepository.kt`
  - Firestore REST read/write/delete for drafts and settings.
  - Reads Firebase config from `ConfigProvider`.
  - Includes messenger ID normalization logic and list-scan fallback.
- `OverlayController.kt`
  - Builds floating button and panel in host app process.
  - Drag/resize and position persistence.
  - Save/load/edit/delete draft actions.
  - WebView integration for message insertion/image flow.

## Data Path

- Uses Firestore documents:
  - `drafts/{chatId}`
  - `settings/user`

## Important Caveat

- Repository logic includes collection listing to resolve messenger IDs (`listAllDraftIds`), which can be costly at scale.

## Current Scope Relative to Backend

- LSPosed currently remains Firestore-centric.
- Extension has moved toward backend/Neon support, but LSPosed has not been migrated yet.
