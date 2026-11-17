// runtimeHealth.js — shared service-worker disconnect handling for GlitchDraft.
// Plain script, top-level globals (same pattern as draftSync.js / draftImport.js).
// Loaded before content.js (manifest content_scripts) and before popup.js
// (popup.html script tag). No DOM and no chrome calls at load time, so node
// can require it for tests (see extension/tests/).
//
// Two failure modes, two different fixes — never conflate them:
//   worker-down: the message never reached a listener (service worker not
//     registered, or failed to wake after idle). Fix: reload the EXTENSION.
//   orphaned: this script's own extension context is gone (the extension
//     reloaded under an open tab). Fix: reload THIS TAB. No retry can
//     revive an orphaned context, so orphaned failures never retry.

'use strict';

const GD_DISCONNECT_WORKER_DOWN = 'worker-down';
const GD_DISCONNECT_ORPHANED = 'orphaned';
const GD_DISCONNECT_OTHER = 'other';

// In an orphaned content script chrome.runtime.id is undefined — the only
// reliable orphan signal (lastError text varies by call site).
function gdIsOrphaned() {
    try {
        return typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id;
    } catch (e) {
        return true;
    }
}

function gdClassifyDisconnect(err) {
    if (gdIsOrphaned()) return GD_DISCONNECT_ORPHANED;
    const msg = (err && err.message) || String(err || '');
    if (/Extension context invalidated/i.test(msg)) return GD_DISCONNECT_ORPHANED;
    if (/Could not establish connection|Receiving end does not exist/i.test(msg)) {
        return GD_DISCONNECT_WORKER_DOWN;
    }
    return GD_DISCONNECT_OTHER;
}

// Callback-style chrome.runtime.sendMessage -> Promise. lastError is only
// valid synchronously inside the callback, so it is read there.
function gdChromeSend(message) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message || 'chrome.runtime.sendMessage failed'));
                else resolve(response);
            });
        } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
        }
    });
}

// Send with bounded retry. Only worker-down failures retry (a transient
// wake failure after idle); orphaned and other failures fail fast.
// `send` defaults to gdChromeSend and `sleep` to setTimeout; tests inject
// both. The thrown error carries `.gdKind` ('worker-down' | 'orphaned' |
// 'other') so callers render the right fix.
function gdSendWithRetry(message, opts) {
    const o = opts || {};
    const retries = (o.retries === undefined) ? 2 : o.retries;
    const delays = o.delays || [500, 1500];
    const send = o.send || gdChromeSend;
    const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let attempt = 0;
    function attemptOnce() {
        return send(message).catch((err) => {
            const kind = gdClassifyDisconnect(err);
            if (kind !== GD_DISCONNECT_WORKER_DOWN || attempt >= retries) {
                const e = err instanceof Error ? err : new Error(String(err));
                e.gdKind = kind;
                throw e;
            }
            const delay = delays[Math.min(attempt, delays.length - 1)];
            attempt++;
            return sleep(delay).then(attemptOnce);
        });
    }
    return attemptOnce();
}

// --- sync-tick recovery state ---
// The tick marks the worker down on a disconnect failure and up on a
// success. gdMarkWorkerUp returns true exactly once per outage — the caller
// forces a re-render then, even when nothing changed, so a panel stuck on
// "Load failed" heals itself when the worker comes back instead of waiting
// for a message to change.
let _gdWorkerWasDown = false;

function gdMarkWorkerDown() { _gdWorkerWasDown = true; }
function gdMarkWorkerUp() {
    const wasDown = _gdWorkerWasDown;
    _gdWorkerWasDown = false;
    return wasDown;
}
function gdWasWorkerDown() { return _gdWorkerWasDown; }
function gdResetWorkerState() { _gdWorkerWasDown = false; }

// --- user-facing copy (panel + popup share it so they never disagree) ---
function gdDisconnectHints(kind) {
    if (kind === GD_DISCONNECT_ORPHANED) {
        return {
            title: 'Extension context lost for this tab',
            lines: [
                'Reload THIS TAB - the extension reloaded under it, so this tab is running orphaned code.',
                'Reloading the extension will not help this tab; the tab itself needs a refresh.'
            ]
        };
    }
    return {
        title: 'Extension runtime disconnected',
        lines: [
            'Reload GlitchDraft on edge://extensions - the background worker is not registered.',
            'Or run tools/reload-extension.ps1 - it now reloads the extension directly when the worker is dead.'
        ]
    };
}

// Node export shim for tests (extension contexts ignore it).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GD_DISCONNECT_WORKER_DOWN: GD_DISCONNECT_WORKER_DOWN,
        GD_DISCONNECT_ORPHANED: GD_DISCONNECT_ORPHANED,
        GD_DISCONNECT_OTHER: GD_DISCONNECT_OTHER,
        gdIsOrphaned: gdIsOrphaned,
        gdClassifyDisconnect: gdClassifyDisconnect,
        gdChromeSend: gdChromeSend,
        gdSendWithRetry: gdSendWithRetry,
        gdMarkWorkerDown: gdMarkWorkerDown,
        gdMarkWorkerUp: gdMarkWorkerUp,
        gdWasWorkerDown: gdWasWorkerDown,
        gdResetWorkerState: gdResetWorkerState,
        gdDisconnectHints: gdDisconnectHints
    };
}
