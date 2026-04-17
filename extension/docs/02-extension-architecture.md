# Extension Architecture

## Entry Points

- `manifest.json`
  - MV3 service worker: `background.js`.
  - content scripts on Messenger/Facebook/Discord/WhatsApp targets.
  - popup UI: `popup.html` + `popup.js`.

## Main Files

- `background.js`
  - Receives `chrome.runtime.sendMessage` actions.
  - Chooses active provider (`neon` or `firebase`) from storage.
  - Routes CRUD calls to service adapter.
- `content.js`
  - Floating UI creation, rendering, editing, delete/use/copy actions.
  - URL/chat detection and per-chat load/save behavior.
  - Position drag/resize save and restore.
  - Sync status UI panel.
- `draftSync.js`
  - Polling for remote changes:
    - messages: every 2s.
    - positions: every 10s.
  - Lazy rename helper for legacy chat IDs.
- `draftImport.js`
  - Import selection dialog and batch import.
  - Export all drafts/settings.
- `popup.js`
  - Saves Firebase config.
  - Saves Neon config as JSON with required `apiBaseUrl` and `apiKey`.
  - Validates Neon config is API URL (blocks `postgresql://`).

## Background Action Contract

Supported message actions:

- `sync`
- `saveDraft`
- `getDraft`
- `getAllDrafts`
- `deleteDraft`
- `renameDraft`
- `getSyncStatus`
- `saveSettings`
- `getSettings`

## Provider Selection Logic

In `background.js`:

1. If `chrome.storage.local.neonConfig.apiBaseUrl` exists -> Neon provider.
2. Else if `firebaseConfig` exists -> Firebase provider.
3. Else -> request fails with not configured error.

## Notes on Current Behavior

- Sync status now performs a real connectivity check via `getSettings` before marking as connected.
- Position save/load uses settings endpoints and local cache.
- Extension includes broad host permissions (`http://*/*`, `https://*/*`) for backend URL flexibility.
