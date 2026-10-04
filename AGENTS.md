# glitchdraft agent notes

## extension build / reload

no-build MV3, plain js in `extension/` (loaded raw by `extension/manifest.json`).
bump `version` patch in the manifest in the same edit as any extension change.
reload with `pwsh tools/reload-extension.ps1` — it opens `extension/reload.html`,
which messages bg to blank its tab + call `chrome.runtime.reload()`, so manifest
bumps are picked up too. Extensions Reloader (`start msedge
http://reload.extensions`) is JS-only and never re-reads the manifest; the manual
button on `edge://extensions` is fallback.

## deploy / quota locations

- vercel prod project `glitchdraft` sits under the `bayazid10@gmail.com` profile and
  is wired to **gitlab** `fahadbinhussain/glitchdraft`, not github — pushing
  `FahadBinHussain/glitchdraft` does not deploy it. check:
  `pwsh C:\Users\Admin\Downloads\mainframe\vercel-account.ps1 deployments bayazid10@gmail.com --project glitchdraft`
  live: `https://glitchdraft-l72wses5j-qwertys-projects-2eec9040.vercel.app`
  (root and `/api/health` both 200).
- neon project `glitchdraft` = `lively-bonus-32409865` (ap-southeast-1) under
  `bayazid190@gmail.com`. current-cycle usage:
  `pwsh C:\Users\Admin\Downloads\mainframe\neon-account.ps1 api bayazid190@gmail.com GET /projects/lively-bonus-32409865/consumption`
  → `compute_time_seconds` (CU-seconds; /3600 = CU-hours). quota resets the 1st of
  the month (`quota_reset_at` from `projects-json`).
- gotcha: `suspend_timeout_seconds: 0` = plan default (300s), `-1` = never suspend.
  scale-to-zero works fine here — operations log shows suspend/start ~every 3h.
- CU burn source: `extension/draftSync.js` polls `getDraft` every 2s while a chat
  tab is open, so backend → Neon stays warm; ~12 CU-h in 4 days ≈ the whole 100 CU-h
  monthly quota in one cycle. raise that interval before touching db config.
