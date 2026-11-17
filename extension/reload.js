// reload.js - dev-loop helper behind reload.html (opened by
// tools/reload-extension.ps1 after editing extension files, INCLUDING
// manifest.json). Extensions Reloader can NOT pick up manifest changes - it
// only flips chrome.management.setEnabled off/on, which never re-reads the
// manifest from disk. chrome.runtime.reload() called from INSIDE the
// extension re-loads from disk, like the edge://extensions reload button.
//
// reload.html is an extension page, so chrome.runtime.reload() works here
// WITHOUT a live service worker — it is a browser-level call, not a message
// to the worker. When the worker is dead, selfReload messaging fails and
// this page reloads the extension directly instead of stranding the user on
// a manual edge://extensions click. (Before 1.7.3 this page could only print
// "reload failed" in that state — the ps1 flow was dead exactly when it was
// needed most.)
function gdDirectReload(el) {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.reload !== 'function') {
      throw new Error('chrome.runtime.reload is not available on this page');
    }
    if (el) el.textContent = 'background worker is dead — reloading the extension directly…';
    chrome.runtime.reload();
    return true;
  } catch (e) {
    if (el) el.textContent = 'reload failed: ' + String(e && e.message ? e.message : e) + ' — hit reload on edge://extensions once, then this page works.';
    return false;
  }
}

try {
  chrome.runtime.sendMessage({ type: "selfReload" }, (resp) => {
    const el = document.getElementById("status");
    if (chrome.runtime.lastError) {
      // The worker never answered — message it again is pointless. Reload
      // directly from this extension page; it does not need the worker.
      gdDirectReload(el);
    } else if (!resp || resp.ok !== true) {
      if (el) el.textContent = "running version has no self-reload yet - hit reload on edge://extensions once, then this page works.";
    } else if (el) {
      el.textContent = "reloading… this tab goes to about:blank - check edge://extensions for the new version.";
    }
  });
} catch (e) {
  // sendMessage itself threw (e.g. this page's own context is gone) — the
  // direct reload is still worth one attempt before giving up loudly.
  gdDirectReload(document.getElementById("status"));
}
