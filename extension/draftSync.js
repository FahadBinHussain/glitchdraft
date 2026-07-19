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
let _syncInterval = null;
let _lastKnownMessagesHash = '';

/**
 * Start a 2-second polling loop to reload messages when they change on another device.
 * Position UI is NOT synced here — it loads once on init and saves on user drag/resize.
 *
 * @param {function} getCurrentChatId
 * @param {function} loadSavedMessages
 * @param {function} showNotification
 */
function gdStartRealtimeSync(getCurrentChatId, loadSavedMessages, showNotification) {
    if (_syncInterval) clearInterval(_syncInterval);

    _syncInterval = setInterval(() => {
        const chatId = getCurrentChatId();
        if (!chatId) return;

        chrome.runtime.sendMessage({ action: 'getDraft', chatId }, (response) => {
            if (!response || !response.success) return;
            const messages = response.messages || [];
            const messagesHash = JSON.stringify(messages.map(m => ({ t: m.timestamp, h: m.html })));
            if (messagesHash !== _lastKnownMessagesHash) {
                _lastKnownMessagesHash = messagesHash;
                showNotification('Messages synced from another device', '', 'success');
                loadSavedMessages();
            }
        });
    }, 2000);
}
