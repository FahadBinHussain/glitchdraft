# Known Issues and Risks

## 1. Polling Cost in Extension

- `draftSync.js` polls frequently (2s for draft sync, 10s for position sync).
- This can increase backend/Firestore load with many active tabs.

## 2. Firestore Provider Collection Scans

- `firestoreService.getDraft` may list all draft docs for messenger ID matching.
- Cost grows with number of stored chats.

## 3. Build Artifacts in Working Tree

- Repo often contains generated folders (`node_modules`, `.next`, Android build outputs).
- Keep `.gitignore` maintained and avoid committing generated outputs.

## 4. Settings Update Semantics

- Partial settings updates previously caused field overwrite.
- Current backend route merges omitted fields, but regressions are possible if client payload behavior changes.

## 5. Provider UX Ambiguity

- Legacy Firestore naming still appears in comments/logs in some areas.
- Maintain clear user-facing wording to prevent DB URL vs API URL confusion.

## 6. Security Considerations

- Extension must never store direct Neon DB credentials.
- API key is required and should be rotated if exposed.
- Backend URL alone should not grant access.

## 7. LSPosed vs Extension Divergence

- LSPosed path still uses Firestore directly.
- Extension supports Neon backend path.
- Feature parity and storage strategy are currently split across platforms.

## 8. Operational Notes

- Vercel deploy does not auto-run DB migrations by default.
- Ensure migration step is part of release process.
