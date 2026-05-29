# GlitchDraft

Save and sync chat drafts across browser and Android/WebView surfaces, with Firestore or an optional Next.js + Neon backend path.

## What It Does

- Browser extension draft panel for chat surfaces such as Messenger, Discord, and WhatsApp Web.
- Userscript path for lightweight browser injection experiments.
- Android/LSPosed module path for WebView-style chat draft overlays.
- Firestore sync path for quick personal setup.
- Optional Next.js + Neon backend with Drizzle routes for draft and settings storage.
- Text and image draft workflows depending on the target surface.

## Comparison

`✅` means the tool is built around that capability. `partial` means it has a related feature, but
not the same workflow or depth. `-` means it is not the point of that tool.

| Capability | GlitchDraft | [Form History Control II](https://chromewebstore.google.com/detail/form-history-control-ii/lpcccgcdjibejkgiaeijbmkpbnbkglkb) | [Textarea Cache](https://addons.mozilla.org/en-US/firefox/addon/textarea-cache/) | [Form Recover](https://formrecover.com/) / Form Recovery | [Typio Form Recovery](https://typiorecovery.github.io/) | Built-in chat drafts |
| --- | --- | --- | --- | --- | --- | --- |
| Chat-thread-specific saved drafts | ✅ | - | - | partial | partial | partial |
| Generic form/text-area autosave | partial | ✅ | ✅ | ✅ | ✅ | - |
| Restore/search/edit form history | partial | ✅ | ✅ | ✅ | ✅ | - |
| Messenger/Discord/WhatsApp-focused adapters | ✅ | - | - | - | - | partial |
| Image/media draft support | partial | - | - | - | - | partial |
| Cross-device/backend sync | ✅ | partial | - | - | - | platform-dependent |
| Android/WebView or LSPosed overlay path | ✅ | - | - | - | - | platform-dependent |
| Bring-your-own backend | ✅ | - | - | - | - | - |
| Local-only privacy by default | partial | ✅ | ✅ | ✅ | ✅ | platform-dependent |
| Open-source, self-modifiable stack | ✅ | partial | ✅ | partial | partial | - |

General form-recovery extensions are stronger at broad autosave, search, cleanup, export/import,
and one-click field injection. GlitchDraft is narrower but reaches a different problem: chat
drafts tied to conversations, plus Android/WebView-style surfaces where normal browser form
history tools do not reach.

The obvious backlog is a safer auth model, better generic form support, cleaner import/export,
stronger image draft handling, and a simpler production setup story.

## Setup

1. Go to console.firebase.google.com and create a new project
2. Click "Firestore Database" in the left menu, then "Create database"
3. Choose "Start in test mode" and click Next, then Enable
4. Go to Project Settings (gear icon) > General tab
5. Scroll down to "Your apps" section
6. Click the "</>" button (Web app icon)
7. Enter any app nickname and click "Register app"
8. Copy the firebaseConfig object shown
9. Load this extension in Chrome/Edge (chrome://extensions)
10. Click the extension icon and paste the config, then click Save

## Usage

Press Alt+M on Messenger to toggle the draft panel.

## Firestore Rules

Update rules in Firebase Console > Firestore Database > Rules tab:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /drafts/{document=**} {
      allow read, write: if true;
    }
    match /settings/{document=**} {
      allow read, write: if true;
    }
  }
}
```

**Important**: These rules allow anyone to read/write your data. For production, add proper authentication.

## Contributors

<a href="https://github.com/FahadBinHussain/glitchdraft/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=FahadBinHussain/glitchdraft" alt="Contributors" />
</a>
