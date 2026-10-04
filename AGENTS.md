# glitchdraft agent notes

## extension build / reload

no-build MV3, plain js in `extension/` (loaded raw by `extension/manifest.json`).
bump `version` patch in the manifest in the same edit as any extension change.
reload with `pwsh tools/reload-extension.ps1` — it opens `extension/reload.html`,
which messages bg to blank its tab + call `chrome.runtime.reload()`, so manifest
bumps are picked up too. Extensions Reloader (`start msedge
http://reload.extensions`) is JS-only and never re-reads the manifest; the manual
button on `edge://extensions` is fallback.

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
