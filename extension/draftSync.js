// draftSync.js — Real-time message sync helper for GlitchDraft
// Loaded as a separate content script before content.js.
// Functions here are top-level (no IIFE) so content.js can call them directly.

'use strict';

// ── Lazy rename ──────────────────────────────────────────────────────────────
/**
 * If getDraft returned a doc stored under an old/legacy ID (bare numeric or
 * messenger_web_{id} without slug), silently rename it to the correct chatId.
 * Fire-and-forget; does not block the caller.
 *
 * @param {object}   response       - The getDraft response object
 * @param {string}   currentChatId  - The ID that was requested (the "correct" one)
 * @param {function} [getChatName]  - Optional function to resolve current contact name
 */
function gdLazyRenameIfNeeded(response, currentChatId, getChatName) {
    if (!response || !response.needsRename) return;
    const { renameFrom, renameTo, messages, contactName } = response;
    if (!renameFrom || !renameTo || renameFrom === renameTo) return;
    console.log('[GlitchDraft] Lazy-renaming doc', renameFrom, '→', renameTo);
    chrome.runtime.sendMessage({
        action: 'renameDraft',
        fromId: renameFrom,
        toId: renameTo,
        messages: messages || [],
        contactName: contactName || (getChatName ? getChatName() : null)
    }, (resp) => {
        if (resp && resp.success) console.log('[GlitchDraft] Doc renamed OK');
        else console.warn('[GlitchDraft] Doc rename failed:', resp?.message);
    });
}

// ── Real-time message sync ───────────────────────────────────────────────────
// Polling stops entirely while the tab is backgrounded. A request every few
// seconds never lets the compute reach its scale-to-zero idle window, so an
// unfocused-but-hidden tab is the only state where the CU clock actually stops.
const GD_SYNC_POLL_MS = 10000;
let _syncInterval = null;
let _lastKnownMessagesHash = null;
let _lastSyncChatId = null;
let _syncCbs = null;
let _syncVisibilityHandler = null;

function gdSyncTick() {
    if (!_syncCbs || document.hidden) return;
    const { getCurrentChatId, loadSavedMessages, showNotification } = _syncCbs;

    const chatId = getCurrentChatId();
    if (!chatId) return;
    const chatChanged = chatId !== _lastSyncChatId;
    _lastSyncChatId = chatId;

    chrome.runtime.sendMessage({ action: 'getDraft', chatId }, (response) => {
        if (!response || !response.success) return;
        const messages = response.messages || [];
        const messagesHash = JSON.stringify(messages.map(m => ({ t: m.timestamp, h: m.html })));
        if (messagesHash === _lastKnownMessagesHash) return;

        // first sight of a chat (startup or switch) is a baseline, not a remote edit
        const isBaseline = chatChanged || _lastKnownMessagesHash === null;
        _lastKnownMessagesHash = messagesHash;
        if (!isBaseline) showNotification('Messages synced from another device', '', 'success');
        loadSavedMessages();
    });
}

function gdRestartSyncTimer() {
    if (_syncInterval) {
        clearInterval(_syncInterval);
        _syncInterval = null;
    }
    if (document.hidden || !_syncCbs) return;
    _syncInterval = setInterval(gdSyncTick, GD_SYNC_POLL_MS);
}

function gdBindSyncVisibility() {
    if (_syncVisibilityHandler) document.removeEventListener('visibilitychange', _syncVisibilityHandler);
    _syncVisibilityHandler = () => {
        if (document.hidden) {
            gdRestartSyncTimer();
            return;
        }
        gdSyncTick(); // catch up immediately on return instead of waiting out the interval
        gdRestartSyncTimer();
    };
    document.addEventListener('visibilitychange', _syncVisibilityHandler);
}

/**
 * Start a 10-second polling loop that reloads messages when they change on
 * another device. The loop is paused while the tab is hidden.
 *
 * @param {function} getCurrentChatId
 * @param {function} loadSavedMessages
 * @param {function} showNotification
 */
function gdStartRealtimeSync(getCurrentChatId, loadSavedMessages, showNotification) {
    _syncCbs = { getCurrentChatId, loadSavedMessages, showNotification };
    gdBindSyncVisibility();
    gdRestartSyncTimer();
}
