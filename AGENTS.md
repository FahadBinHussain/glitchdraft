# glitchdraft agent notes

## extension build / reload

no-build MV3, plain js in `extension/` (loaded raw by `extension/manifest.json`).
bump `version` patch in the manifest in the same edit as any extension change.
reload with `pwsh tools/reload-extension.ps1` — it opens `extension/reload.html`,
which messages bg to blank its tab + call `chrome.runtime.reload()`, so manifest
bumps are picked up too. Extensions Reloader (`start msedge
http://reload.extensions`) is JS-only and never re-reads the manifest; the manual
button on `edge://extensions` is fallback.
- `chrome.runtime.reload()` orphans every already-open content script: its
  runtime dies with the old service worker, so the panel freezes on stale data
  and the sync tick stops — silently, no console error visible to the user
  (seen as "android note doesn't show on web" with the backend row correct).
  background now has a `chrome.runtime.onInstalled` handler that reloads open
  messenger/facebook/discord/whatsapp tabs so fresh code re-injects (manifest
  1.1.7). after any extension reload, confirm the messaging tabs refreshed —
  if the symptom persists on a freshly loaded tab, it's a real sync bug.

## android / lsposed module

- build from repo root: `npm run android:run` (assembleDebug + install + launch
  MainActivity), `android:build:release`, `android:release:apk`. all three go
  through `tools/android.ps1`, which picks a JDK 21 (app/build.gradle pins
  source/target/jvmTarget to 21) and prints which one it used.
- the gradle wrapper (`android/gradlew`, `gradlew.bat`,
  `android/gradle/wrapper/gradle-wrapper.jar`) is committed. an older .gitignore
  rule kept the jar out under "download on demand" — gradlew cannot run without
  it, so that rule was removed.
- release is signed, and only from this repo's helper: `app/build.gradle` wires
  `signingConfigs.release` from `GD_KEYSTORE_FILE` / `GD_KEYSTORE_PASSWORD` /
  `GD_KEY_ALIAS` (+ optional `GD_KEY_PASSWORD`), and `tools/android.ps1` asserts
  them before gradle runs, so a missing keystore fails loudly instead of
  shipping an unsigned apk. credentials never enter the repo: the PKCS12 keystore
  is `android/glitchdraft-release.p12` (gitignored alongside `*.p12`/`*.pfx`) and
  the vars live in the vault item `github.com/FahadBinHussain/glitchdraft /
  .env (development)` (notes) — restore both with
  `pwsh C:\Users\Admin\Downloads\automata-private\tools\env-sync.ps1 -Repo glitchdraft`,
  which writes the repo-root `.env.local` (gitignored: `.env.local`, `**/.env.local`)
  and the p12 itself. gotcha: `.p12` had to be added to the ignore rules by hand —
  `.gitignore` only covered `*.jks`/`*.keystore`, and env-sync's `Is-KeyName`
  already matched `.p12`, so only the ignore line was missing. install-time note:
  the release apk is signed with a different key than the debug build already on
  the phone, so switching means uninstall first (wipes the stored Neon config).
  the copy in `backend/public/` is build output too — gitignored, not committed.
- gotcha: `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` was committed as
  a 0-byte blob, which only surfaced in `mergeReleaseResources`. re-exported at
  48x48 from the hdpi source.
- phone screenshots: `adb exec-out screencap -p > file` corrupts the png under
  pwsh — use `adb shell screencap -p /sdcard/x.png` + `adb pull`. a black frame
  means the screen is off: `adb shell svc power stayon true`,
  `input keyevent KEYCODE_WAKEUP`, `wm dismiss-keyguard`, `cmd statusbar collapse`.

## phone / xposed framework (device 21091116UI)

- the framework on this phone is **Vector** (`zygisk_vector`), not stock LSPosed:
  `zygisk_lsposed` also sits in /data/adb/modules but carries a `disable` marker,
  and no Xposed manager app is installed at all (org.lsposed.manager absent).
  manage it with the CLI that ships inside the module:
  `adb shell su -c '/data/adb/modules/zygisk_vector/cli status'` →
  subcommands `modules ls|enable|disable`, `scope ls|add|set|rm`
  (`scope set MODULE_PKG <app/0> ...` — MODULE_PKG is required, omitting it NPEs).
  config db: `/data/adb/lspd/config/modules_config.db` (Vector still uses the
  lspd paths), logs: `/data/adb/lspd/log/*.log`.
- uninstalling/reinstalling the module app **resets it to enabled=0 and wipes its
  scope** — this happened when the debug build was swapped for the signed release
  apk. restore with `modules enable com.fahad.glitchdraft.lsposed` +
  `scope set com.fahad.glitchdraft.lsposed com.facebook.orca/0 com.facebook.katana/0
  com.discord/0 com.whatsapp/0` (the 4 installed packages from `TARGET_PACKAGES`
  in `hook/GlitchDraftHook.kt`). no reboot needed — verify it stuck with
  `su -c 'grep -a -h glitchdraft /data/adb/lspd/log/*.log | tail'`: a
  `Loading legacy module ... /data/app/~~<path>/base.apk` line must appear with
  the current path after `am force-stop com.facebook.orca` + relaunch.
- gotchas: MIUI pops a transient "Can't open this app / contact your IT admin"
  dialog on first launch of a fresh install — the process is already running and
  it clears itself, don't chase it. `adb shell input text` sometimes appends a
  stray character (check field length before saving), and the IME opening
  reflows the layout, so re-read button bounds from `uiautomator dump` right
  before tapping instead of reusing earlier coordinates. `uiautomator dump`
  prints a MIUI theme_config stack trace but still writes the xml.
- overlay tap testing: `dumpsys window windows` mAttrs coords sit ~one status bar
  (~81px) above real screen pixels — `input tap` needs SCREEN coords, so measure
  the icon's blue bbox programmatically in a screencap png (`System.Drawing`,
  full 1080x2400) instead of trusting mAttrs or eyeballing a rendered image
  (viewers scale coords). ground truth for panel state = the window's `fl=` line:
  `NOT_TOUCHABLE` present = closed, gone = open; second check is
  `uiautomator dump` grepping for `Type a draft`. screencap/screenrecord here
  return STALE frames (lagged minutes; video frames can predate the tap — the
  wall clock in the frame tells you), so never conclude "panel didn't open" from
  a frame alone. screenrecord files only get their moov after `--time-limit` —
  wait past it or ffmpeg reports `moov atom not found`.
- fixed: the panel window was touch-swallowing. a TYPE_APPLICATION_OVERLAY window
  eats taps over its whole frame even when its root view is GONE, unless it has
  `FLAG_NOT_TOUCHABLE` — the default panel (55,550)(880x1265) covered the toggle
  at (44,825), so every icon tap died invisibly. `OverlayController` now creates
  the panel with `FLAG_NOT_TOUCHABLE` and flips it in `togglePanel()`/`hide()`/
  `show()` via `setWindowTouchable()`, and builds the panel BEFORE the toggle so
  the icon stacks above it. when touching overlay code, keep both invariants.

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
- CU burn source: `extension/draftSync.js` polled `getDraft` every 2s while a chat
  tab was open, ~12 CU-h in 4 days ≈ the whole 100 CU-h monthly quota in one cycle.
  Now 10s and fully paused on `document.hidden` — only a hidden tab lets the compute
  reach scale-to-zero, a visible tab keeps it awake no matter the interval.
  `extension/draftSync.js` and `android/app/src/main/assets/glitchdraft/draftSync.js`
  are the same script: edit both.

## known issues

- fixed: `handleChatChange()` called `loadDraftsFromCloud()`, which existed nowhere —
  every chat switch threw a ReferenceError (`extension/content.js`,
  `android/.../content.js`) and only rendered because the sync tick's
  `loadSavedMessages()` covered for it. It now calls `loadSavedMessages()` directly,
  which is the real fetch-and-render path. don't reintroduce a second loader.

## cross-platform draft matching (web <-> android)

- chat ids: `messenger_web_<fbid>_<nameSlug>` (web, from url `/t/<id>`) vs
  `messenger_android_<threadKey>_<nameSlug>`. numeric spaces are disjoint, so the
  only shared key is the name slug — and a slug alone is ambiguous: ids go stale
  on renames (Fatima's thread also has a `..._cat_fren` row, Fahmida's also has a
  `..._fatima_afroz` row), so `firstOrNull { endsWith(slug) }` picked the wrong
  person's draft (Cat Fren showed Fatima's note).
- rule: rank slug candidates by (1) `slugify(contactName) == requested slug`,
  (2) web row over android row (web reads its exact id, android follows it),
  (3) newest `lastModified`. implemented identically in
  `DraftRepository.pickBestRow` (kotlin), `neonService.findDocByNameSlug`,
  the `firestoreService` slug sort, and `glitchdraft_shim.neonPickBySlug` —
  change one, change all. anchor is `^messenger_(web|android)_\d+_<slug>$`
  (plain `endsWith` over-matches: slug `messenger` would hit `_1_messenger`).
  `slugify` must stay a mirror of `content.js sanitizeNameSlug`.
- never PUT `contactName: null` — the backend `/api/drafts/[threadId]` PUT
  replaces wholesale, and a wiped contactName silently breaks name matching
  afterwards. saves pass the live display name when known and otherwise re-send
  the stored one (`DraftRepository.saveDraft`, shim `handleSaveDraft`).
- slug picks are read-only: no `needsRename` on slug hits (only legacy bare/no-slug
  numeric ids rename) — a read must never move/delete another chat's row.
- verify on device: open the chat, tap the icon (112,973 real screen px), then
  `su -c 'grep -a -h DraftRepo /data/adb/lspd/log/*.log | tail'` — the log line
  prints `slug '...' pick=... name='...' (req=...)`; panel header shows the row id.
- gotchas: `adb install -r` can drop the `SYSTEM_ALERT_WINDOW` appop — overlay logs
  "overlay permission not granted — skipping attach"; re-grant with
  `adb shell appops set com.facebook.orca SYSTEM_ALERT_WINDOW allow` (plus the
  module pkg). screencap frames go stale/out-of-order during rapid tap sequences —
  confirm state with `uiautomator dump` (grep `Type a draft`) + dumpsys `fl=` flags
  instead of trusting a screenshot.
- the open android panel used to fetch only on open/chat-change/local edits, so a
  web-side edit or delete never appeared until the panel was reopened (seen as
  "deleted lol on web, android still shows it" — backend row was already correct).
  `OverlayController` now runs a 10s sync tick while the panel is visible
  (start/stop wired in `togglePanel`/`show`/`hide`/`detach`), re-rendering only on
  content change — same visible-only rule as web `draftSync.js` for neon quota.
  verify like the tick test: open panel, PUT a marker draft via the backend,
  `uiautomator dump` within ~13s for the marker, PUT the original back, dump again.
- backend row hygiene (2026-10-05): one canonical row per thread. duplicate slug
  rows (rename leftovers: Peak ×6, Fatima ×6, Fahmida ×3, …) merged — union of
  messages with exact `timestamp|html` dedupe, newest-`lastModified` row is
  canonical, `contactName` = the candidate whose slug matches the canonical id;
  16 stale/empty rows deleted; id slugs renamed to match `contactName` so
  `pickBestRow` criterion 1 holds everywhere. backup (personal drafts — never
  commit): `C:\tmp\glitchdraft-drafts-backup-20261005.json`. order matters: PUT
  the canonical BEFORE deleting sources — a failed PUT with succeeded deletes
  leaves a gap only the backup can fill (hit exactly that: pwsh
  `ConvertTo-Json` on the wrapped plan threw "Argument types do not match",
  all PUTs 500'd, deletes ran; rebuilt bodies from plain hashtables and
  restored from backup). verification rule: every original `(ts|html)` must be
  findable in the final canonical row, and final row count = backup − deleted.
