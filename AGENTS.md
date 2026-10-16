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
  the README hero badge (`img.shields.io/github/v/release/...`) is automatic —
  it follows the latest github release, and `.github/workflows/release-extension.yml`
  builds that release name from `extension/manifest.json` on every push, so the
  public version claim needs no manual sync (don't reintroduce a static
  version badge).

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
  `pwsh C:\Users\Admin\Downloads\automata-private\bitwarden.com\env-sync.ps1 -Repo glitchdraft`,
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
  gotcha (2026-10-08): `wm dismiss-keyguard` does nothing once the device lock is
  a SECURE pattern — a `uiautomator dump` then shows `Draw pattern or use
  fingerprint to unlock` and any `input tap` lands on the lock screen, not the
  overlay. the earlier wake+dismiss flow only worked while the lock was still
  swipe/trusted. run `svc power stayon true` at session start so the keyguard
  never re-engages, and if the pattern screen is up, ask the user to unlock —
  do not try to clear locksettings.

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
  com.discord/0 com.whatsapp/0 com.instagram.android/0 org.telegram.messenger/0`
  (the installed app packages from `TARGET_PACKAGES` in `hook/GlitchDraftHook.kt`).
  no reboot needed — verify it stuck with
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

- vercel prod project `glitchdraft` sits under the `bayazid10@gmail.com` profile (`prj_nJRpupJDYFif4BOlHydLBmz4pTk5` on `team_Mei5kaLVoB1zzUAgNmbxDq2R` / `qwertys-projects-2eec9040`).
- backend code deploys = vercel CLI directly using the mainframe account helper (with token from Bitwarden vault):
  `pwsh C:\Users\Admin\Downloads\mainframe\vercel-account.ps1 run bayazid10@gmail.com deploy --prod --yes`
  run from the repo root. one-time link (already done, `.vercel/` is gitignored):
  `... run bayazid10@gmail.com link --yes --project glitchdraft --scope qwertys-projects-2eec9040`.
  verify: the command prints `readyState: READY` + `Aliased https://glitchdraft.vercel.app`;
  then check `/api/health`.
  check deployments:
  `pwsh C:\Users\Admin\Downloads\mainframe\vercel-account.ps1 deployments bayazid10@gmail.com --project glitchdraft`
  live: `https://glitchdraft.vercel.app` (and `/api/health` both 200).
- deploy gotchas (2026-10-08 — all three failed a green build until fixed):
  1. project `rootDirectory=backend` re-roots the build cwd, so `cd backend && ...`
     in `vercel.json` always dies with `cd: backend: No such file or directory`.
     commands must assume cwd = backend (`pnpm install`, `pnpm build`, output `.next`).
  2. Vercel's pnpm 10/11 blocks dependency postinstalls — `pnpm install` exits 1
     with `ERR_PNPM_IGNORED_BUILDS`. `backend/pnpm-workspace.yaml` carries
     `allowBuilds: { esbuild: true }` (pnpm 11 removed `onlyBuiltDependencies`,
     and pnpm 11 ignores a `pnpm` field in package.json; `allowBuilds` works on
     pnpm >= 10.26, which is what the builder picks). local repro: `CI=1 pnpm install`
     in `backend/`.
  3. the CLI uploads the whole tree unless `.vercelignore` excludes it — `android/`
     alone is 139 MB and the upload aborted with repeated `fetch failed` (an
     earlier attempt also hit `EBUSY` on the helper's temp global-config = retry
     once). ignore rules REPLACE .gitignore, so `*.apk` must be listed explicitly.
  4. an EMPTY `vercel-account.ps1 run ... deploy` output means the CLI never ran:
     scoop's pnpm bin held a bare extensionless posix shim (`...\bin\vercel`)
     that PATH resolves before the real `%USERPROFILE%\.pnpm-global\bin\vercel.ps1`
     and hangs forever — rename it `.bak`, assert `vercel --version` prints, and
     confirm a new deployment exists (helper `deployments` subcommand) before
     believing a deploy happened (details in mainframe AGENTS, 2026-10-15).
- failed-build logs: REST `GET /v3/deployments/<uid>/events?teamId=team_Mei5kaLVoB1zzUAgNmbxDq2R`
  via `vercel-account.ps1 api bayazid10@gmail.com GET '...'` (the /v13 events path
  400s, and `vercel inspect` shows no log lines).
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
- shared vs forked files between `extension/` and
  `android/app/src/main/assets/glitchdraft/` (contract, 2026-10-05):
  **byte-identical shared files** = `draftSync.js`, `draftImport.js`, `styles.css`
  (verify with `Get-FileHash` on both copies; after editing one, copy it across —
  the copies had drifted: assets kept a shared-pause + position-polling rewrite
  the extension never got, so the extension gained live position sync as part of
  the re-sync). `content.js` is **forked by design**: different format style plus
  platform glue (the injected copy exposes `window.GlitchDraftUseMessage` for the
  native overlay, wires its WebView layout, and also starts
  `gdStartPositionListener`; the extension copy does not). the shared call
  contract is `gdStartRealtimeSync(getCurrentChatId, loadSavedMessages,
  showNotification, applyPositionsToUI, localDirtyFn)` — change that signature in
  BOTH `content.js` files in the same commit. `chrome.runtime.*` works on both
  sides: the injected copy talks to `glitchdraft_shim.js`, which bridges to the
  module. both position-save paths must keep the `localPositionDirty` flag
  (set on local save, 3s grace after save completes) or the 10s poll snaps the
  UI back mid-drag. `getDraft` responses must carry `lastModified` (epoch ms,
  bumped on content-changing PUTs): produced by `background.js handleGet` +
  `neonService.getDraft` + backend `GET /api/drafts/[threadId]` on web, and by
  `glitchdraft_shim.js handleGetDraft` (neon + firestore paths) on android —
  both `content.js` forks render the card's `Modified:` line from it, hidden
  unless it is >1min newer than the message timestamp (added 2026-10-08).
  `lastModified` bumps ONLY when `messages` actually change (backend PUT
  compares against the stored row, 2026-10-15): name-only writes — the
  contactName lazy back-fill and legacy id renames — used to stamp
  `Modified: today` on untouched drafts (seen as a June draft showing
  "Modified: Today, at 11:56 AM" after nothing but a panel open).
- the android panel's cards are NOT drawn by the injected content.js: the
  WebView fork only renders cards inside in-app webviews (whatsapp web etc).
  On native messenger the panel is built by
  `OverlayController.addDraftRow` (kotlin) — created timestamp, conditional
  `Modified:` line, Use/Copy/Edit/Delete. card-level UI changes need the
  native kotlin too. data path: `DraftRepository.Draft` carries the row-level
  `lastModified` (parsed from the GET body in `parseDraftMessagesFromNeon` /
  `parseDraftMessagesFromFirestore`, 0 when absent), render rule identical to
  web: shown only when `lastModified > message.timestamp + 60s`; formatting
  mirrors content.js `formatTimestamp` via the kotlin helper in
  `OverlayController.formatTimestamp`.

## instagram (added 2026-10-10)

- id = `instagram_web_<threadId>_<nameslug>` from URL `/direct/t/<id>\/` — the
  instagram branch MUST come before the `/t/(\d+)` messenger match in
  `getCurrentChatId`, or ig thread ids get saved as `messenger_web_*` rows.
  thread ids hash the participant set, so different logged-in accounts and
  conversations never collide — no account scoping needed (same reasoning as
  the messenger_web fbid). slug from the display name, exact-id read on web.
- name: thread header heading = `a[aria-label^="Open the profile page of "] h2`
  — inbox rows link to profiles too but never contain an h2 (that's the
  discriminator); group threads have no profile link, fallback = last h2
  (own-profile h2 sits earlier in the DOM). check `#chatIdDisplay.title` on the
  open panel for the resolved id.
- "Use" works through the existing generic
  `[contenteditable="true"][role="textbox"]` fallback (IG composer is a
  `div.xzsf02u...[contenteditable]`), no instagram-specific insertion needed.
- both content.js forks carry the id branch; the android copy inlines the slug
  because that fork has no `sanitizeNameSlug` — keep the two slugs byte-equal.
  config.js `SUPPORTED_SITES` and background.js `onInstalled` reload patterns
  must gain instagram.com alongside any manifest site-list change (manifest
  1.2.0). SPA thread switches are picked up by draftSync's 10s tick + on-open
  load, no pushstate hook needed (same as messenger).
- android native instagram — VERIFIED on device 2026-10-11 (ryujin thread):
  thread key = `ThreadTargetParcelable.A00` (obfuscated class `05v2`), a
  128-bit decimal like `340282366841710301244259786932994007727`, extracted by
  `findIgThreadKeyNumeric` (first `^\d{15,}$` field of the parceled object's
  declared fields). it is NOT the web `/direct/t/<id>` number (17-digit, e.g.
  17846415453040180) — the numeric spaces are disjoint, so cross-device
  matching rides the name slug exactly like messenger. id validation goes
  through `isPlausibleIdValue` / BANNED_ID_VALUES (instagram needs `^\d{6,}$`)
  so `DISPLAY_LOCATION=unavailable` can never become
  `instagram_android_unavailable` again. name (android): Strategy 0 in
  `extractNameFromFragmentView` — a header-zone view whose resource-id
  contains `title` but not `subtitle` (`com.instagram.android:id/header_title`
  → `ryujin`); "blend" is in NOISE_WORDS because an action-button content-desc
  ("Blend") at y=80 used to beat the fallback. thread UI lives in
  `ModalActivity`; navigation recipe = animations off (gotcha below) → tap
  `direct_tab` (540,2272) → inbox row. deliberately NO extractChatId(url)
  instagram branch: native DMs never load instagram.com urls and webviews use
  the injected content.js id — a bare url-derived id would shadow the real row.
- instagram can NEVER get a WM overlay window: `SYSTEM_ALERT_WINDOW` is not in
  its manifest — `appops set com.instagram.android SYSTEM_ALERT_WINDOW allow`
  silently no-ops from shell AND root (stays `default`, `--uid` too),
  `pm grant` SecurityExceptions, and MIUI SecurityCenter's per-app "Open new
  windows while running in the background" = Always allow does not move the
  appop either: addView still throws `BadTokenException ... permission denied
  for window type 2038` (reached via am start
  `com.miui.securitycenter/com.miui.permcenter.permissions.PermissionsEditorActivity`
  `--es extra_pkgname <pkg>` → Other permissions). so `OverlayController` has
  a second attach method, in-window (decor) mode: when `canDrawOverlays()` is
  false, `attachView`/`detachView`/`moveView` route the panel/toggle as
  children of the activity's own decor instead of WM windows (positions stay
  in toggleParams/panelParams x/y, mirrored to translationX/Y). second-method
  rules: the panel header visibly shows `in-window mode — no overlay window
  permission` and the attach log names the mode — never pretend the WM overlay
  is active. `setWindowTouchable` is a no-op in this mode (visibility pairs
  already done by hide/show/togglePanel); the FLAG_NOT_TOUCHABLE invariants of
  the WM path are untouched. the hook now calls `attach()` on EVERY resume (a
  `wantsRemount` predicate only guards the log/icon line) because decor views
  are pinned to one activity — "decor host changed, re-attaching" migrates
  them between activities (MainActivity ↔ ModalActivity). verified live:
  icon at (112,893) screen px (in-window renders ~81px above the old WM mAttrs
  position — same saved numbers, draggable), panel + badge + slug-pick to the
  web row + save merge (msgs 1→2, restored via PUT) + Use insert into the ig
  composer (cleared with a DEL loop, never sent) all work.
- ig gotchas: `uiautomator dump` only works with animations off —
  `settings put global window/transition/animator_duration_scale 0`; the
  panel's Save button sits BEHIND the IME while the keyboard is open, so
  `input tap` on it hits the keyboard — `keyevent KEYCODE_BACK` closes just
  the keyboard, then re-read bounds before tapping; remote quoting: a
  `$( ... )` inside an adb shell string is expanded by pwsh on the PC first
  (`seq: not recognized`) and `grep -e 'two words'` loses its quotes through
  both shell layers — build loops in pwsh or pass multi-keycode
  `input keyevent 67 67 ...`, and filter greps with local Select-String.

## android image attach (added 2026-10-16)

- panel 📎 opens `ACTION_GET_CONTENT image/*` from the panel's activity
  (`panelView?.context as? Activity`, `startActivityForResult`); the result is
  downscaled (bounds decode → inSampleSize → scale ≤1024 → EXIF rotate) and
  re-encoded as JPEG q80 base64 into the SAME row html a web paste produces:
  `<img src="data:image/jpeg;base64,…">` — one shape for both platforms, no
  android-specific html. save merges `text<br><img …>`; the edit path re-appends
  the row's `keptImgTags` so editing text never drops the image; the staged chip
  row (thumbnail + ✕, above the input) clears on chat change and after save;
  image-only drafts save fine. versionName 1.2.0.
- activity-result delivery gotcha: hooking ONLY the app's most-derived override
  (`DelegatingFbFragmentFrameworkActivity.onActivityResult`) logs the install but
  never fires — pick and cancel both came back with zero callbacks. the fix is
  hooking EVERY `onActivityResult(int,int,Intent)` declared in the activity
  class chain (MainActivity walk: DelegatingFbFragmentFrameworkActivity →
  FbFragmentActivity → FragmentActivity → ComponentActivity →
  android.app.Activity). all 5 fire once per result, in super-unwind order, and
  the `android.app.Activity` hook is the first to see the payload
  (`activity-result path fired Activity.onActivityResult/3 … result=-1
  uri=content://media/picker_get_content/…`); an `awaitingImagePick` flag keeps
  the handler single-shot. keep the multi-hook walk — don't "simplify" it back
  to one hook.
- verify on device: 📎 → picker tile (179,1397) → Done (898,2192); lspd log
  shows `activity-result path fired …` then `image pick result result=-1`;
  backend row html contains `data:image/jpeg;base64`. test-row cleanup: if the
  pre-test GET said `exists:false`, DELETE the row after — exact restore is
  `exists:false` again (a GET on a missing row answers 200 with
  `messages:[] contactName:null lastModified:0 exists:false`, so check `exists`).
- testing gotchas: uiautomator xpath `//android.widget.ImageView` matches
  NOTHING — nodes are `<node class="…">`, so query
  `//*[@class='android.widget.ImageView']` or filter by attribute (burned
  twice). `input text 'img%stest'` (space via `%s`) typed `imgt est` — avoid
  `%s` spaces, verify the field with a dump, fix with `KEYCODE_MOVE_END` + a
  `keyevent 67 67 …` burst before retyping.

## telegram (added 2026-10-16 — verification pending)

- code-complete on both surfaces but nothing has been verified against a live
  telegram session yet — don't treat any of it as proven until the verify steps
  at the bottom pass.
- web (extension only): config.js `SUPPORTED_SITES` + background `onInstalled`
  reload pattern + manifest host_permissions `https://web.telegram.org/*`
  (extension 1.3.0). chat key comes from the url hash: `#123…` (user),
  `#-100…`/`#-…` (groups), `#c123…` (channel deep link → `-100123…`),
  `#@name` (usernames are `[a-z0-9_]`, `_` escaped to `-` to stay parseable);
  id = `telegram_web_<key>_<slug>`, name via `.chat-info .chat-title` /
  `.title-wrapper .title` selectors (k + a web versions); a chatless
  web.telegram.org returns null and never falls through to the url sanitizer.
- native android: `GlitchDraftHook.hookTelegramChatNavigation` — tg's
  ChatActivity is NOT an android Fragment (extends tg's own BaseFragment inside
  LaunchActivity), so the generic fragment scan never sees it: hooks
  `org.telegram.ui.ChatActivity.onResume`, reads the `chatId` field +
  `MessagesController.getInstance(account).getChat/getUser` after a 600ms
  settle. id = `telegram_android_<chatIdInt>_<slug>`; id validation is
  `^-?\d{3,}$` under the `telegram` prefix (web hash may be negative, native
  never is). numeric spaces differ between web hash and native chatId, so
  cross-device matching rides the name slug like messenger/instagram.
- slug-pick anchors now `^(messenger|instagram|telegram)_(web|android)_-?\d+_<slug>$`
  in all four implementations (DraftRepository.pickBestRow, neonService,
  firestoreService, glitchdraft_shim.neonPickBySlug) — change one, change all.
- verify (when unparked): web — Edge with `--remote-debugging-port=9222
  --profile-directory=Default`, open a web.telegram.org chat, panel id starts
  `telegram_web_`; android — open a native chat, panel id
  `telegram_android_<int>_<slug>`, save a draft, confirm the backend row +
  slug-pick round-trip. delete any test row after.

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
  change one, change all. anchor is
  `^(messenger|instagram|telegram)_(web|android)_-?\d+_<slug>$` (plain `endsWith`
  over-matches: slug `messenger` would hit `_1_messenger`). the web-over-android
  preference is `id.contains("_web_")` on both sides (counts instagram rows
  too), and firestoreService's legacy bare/no-slug fallbacks are deliberately
  gated to `threadId.startsWith("messenger_")` — instagram never had those
  formats and a bare-numeric hit could rename a real messenger row away.
  `slugify` must stay a mirror of `content.js sanitizeNameSlug`.
- never PUT `contactName: null` — the backend `/api/drafts/[threadId]` PUT
  replaces wholesale, and a wiped contactName silently breaks name matching
  afterwards. saves pass the live display name when known and otherwise re-send
  the stored one (`DraftRepository.saveDraft`, shim `handleSaveDraft`).
- slug picks are read-only: no `needsRename` on slug hits (only legacy bare/no-slug
  numeric ids rename) — a read must never move/delete another chat's row.
- verify on device: open the chat, tap the icon (112,973 real screen px in WM
  mode, (112,893) in-window), then
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
- backend row hygiene (2026-10-05, second pass 2026-10-15): one canonical row
  per thread. the first pass merged rename leftovers (Peak ×6, Fatima ×6,
  Fahmida ×3, …): union of messages with exact `timestamp|html` dedupe,
  newest-`lastModified` row canonical, `contactName` = the candidate whose slug
  matches the canonical id; 16 stale/empty rows deleted; id slugs renamed to
  match `contactName` so `pickBestRow` criterion 1 holds everywhere. the load
  race then re-created the duplicates (62 rows by 2026-10-15: Cat Fren ×14,
  Jarif ×5, … with foreign messages + crossed names), fixed by the guard below;
  the second pass deleted 43 clone/pollution rows + fixed 4 crossed names
  (Jarif/Rima/Fardin back to their names, ig ryujin — the ig name had been
  clobbered to the own-profile name, breaking criterion 1), leaving 19 canonical
  rows. message homes were assigned from the oct-5 backup: every backup key had
  exactly one backup group, the 5 post-backup keys in >1 group went to their
  only backup-group member (or, for the edited pair, the row carrying the
  same-ts successor). verified: 0 keys from the pre-cleanup snapshot lost; the
  only 2 oct-5 keys absent are documented user actions — the 05-24 13:58
  Segoe draft edited in place (same ts, html now `50:40 e dek…`) and a discord
  link draft the user deleted on 10-14. name-only PUTs kept every
  `lastModified` frozen (no `Modified:` stamps). backups (personal drafts —
  never commit): `C:\tmp\glitchdraft-drafts-backup-20261005.json` and
  `C:\tmp\glitchdraft-drafts-backup-20261015.json`; repair script
  `C:\tmp\gd-repair-20261015.ps1` (dry-run default, `-Apply` writes, PUTs
  canonicals before deletes). order matters: PUT the canonical BEFORE deleting
  sources — a failed PUT with succeeded deletes leaves a gap only the backup can
  fill (hit exactly that on 10-05: pwsh `ConvertTo-Json` on the wrapped plan
  threw "Argument types do not match", all PUTs 500'd, deletes ran; rebuilt
  bodies from plain hashtables and restored from backup). verification rule:
  every original `(ts|html)` must be findable in the final canonical row (minus
  documented user edits/deletes), and final row count = backup − deleted.
- load-race guard (2026-10-15): `loadSavedMessages`' getDraft callback re-derives
  `getCurrentChatId()` first and bails when it no longer matches the id captured
  at request time. before this, a chat switch during the GET round-trip let the
  lazy back-fill PUT a slug-picked row's messages + the NEW chat's name under the
  OLD chat's id — that mass-created the duplicate
  `messenger_web_<fbid>_<foreign-slug>` rows (64-row clone storm, second hygiene
  pass 2026-10-15). one guard covers render + `lazyRenameIfNeeded` + back-fill.
  the android assets fork has no load-time write path (no name back-fill at all),
  so it needs no guard — only the extension's load path can create rows; keep it
  that way: a load must never PUT unless the chat id is re-verified stable at
  response time.
