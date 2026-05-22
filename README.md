# GlitchDraft

Save and sync drafts with Firestore.

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
