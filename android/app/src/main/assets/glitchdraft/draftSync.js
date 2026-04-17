// draftSync.js — Real-time sync and position polling helpers for GlitchDraft
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

// ── Position listener ────────────────────────────────────────────────────────
let _positionPollInterval = null;
let _lastKnownPositionsHash = '';
let _positionApplyFn = null;  // set by gdStartPositionListener
let _isDraggingRef = null;    // { get: () => bool } set by gdStartPositionListener

/**
 * Start a 10-second polling loop that picks up remote position changes.
 * @param {function} applyPositionsToUI   - fn(positions) that moves the UI
 * @param {function} isDraggingFn         - fn() -> bool, true if user is currently dragging
 * @param {function} [localDirtyFn]       - fn() -> bool, true if a local save is pending
 */
function gdStartPositionListener(applyPositionsToUI, isDraggingFn, localDirtyFn) {
    _positionApplyFn = applyPositionsToUI;
    _isDraggingRef   = isDraggingFn;
    if (_positionPollInterval) clearInterval(_positionPollInterval);
    _positionPollInterval = setInterval(() => gdPollPositions(applyPositionsToUI, isDraggingFn, localDirtyFn), 10000);
}

function gdPollPositions(applyPositionsToUI, isDraggingFn, localDirtyFn) {
    // Skip if user is dragging or if we just saved locally (avoid snap-back)
    if ((localDirtyFn && localDirtyFn()) || (isDraggingFn && isDraggingFn())) return;

    const currentSite = window.location.hostname;
    const positionKey = `uiPositions_${currentSite}`;

    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (!response || !response.success) return;
        const sitePositions = response.settings?.uiPositions?.[positionKey];
        if (!sitePositions) return;

        const remoteHash = JSON.stringify(sitePositions);
        if (remoteHash === _lastKnownPositionsHash) return; // No change

        _lastKnownPositionsHash = remoteHash;

        // Cache locally for next page load
        const localCacheKey = `glitchdraft_pos_${currentSite}`;
        chrome.storage.local.set({ [localCacheKey]: sitePositions });

        // Apply to UI only if not dragging
        if (!(isDraggingFn && isDraggingFn())) {
            applyPositionsToUI(sitePositions);
        }
    });
}

// ── Real-time message sync ───────────────────────────────────────────────────
let _syncInterval = null;
let _lastKnownMessagesHash = '';
let _isFirstPositionLoad = true;

/**
 * Start a 2-second polling loop to reload messages when they change on another device.
 * @param {function} getCurrentChatId
 * @param {function} loadSavedMessages
 * @param {function} showNotification
 * @param {function} applyPositionsToUI
 * @param {function} localDirtyFn   - fn() -> bool
 */
function gdStartRealtimeSync(getCurrentChatId, loadSavedMessages, showNotification, applyPositionsToUI, localDirtyFn) {
    if (_syncInterval) clearInterval(_syncInterval);

    _syncInterval = setInterval(() => {
        const chatId = getCurrentChatId();
        if (!chatId) return;

        // Check for message changes
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

        // Check for position changes
        chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
            if (!response || !response.success) return;
            const settings = response.settings || {};
            const currentSite = window.location.hostname;
            const positionKey = `uiPositions_${currentSite}`;
            const sitePositions = settings.uiPositions?.[positionKey];

            const positionsHash = JSON.stringify(sitePositions || {});
            if (positionsHash !== _lastKnownPositionsHash && sitePositions) {
                const isRealChange = _lastKnownPositionsHash !== '' && !_isFirstPositionLoad;
                _lastKnownPositionsHash = positionsHash;
                _isFirstPositionLoad = false;

                if (localDirtyFn && localDirtyFn()) return;

                if (isRealChange) {
                    showNotification('UI position synced from another device', '', 'success');
                }

                const localCacheKey = `glitchdraft_pos_${currentSite}`;
                chrome.storage.local.set({ [localCacheKey]: sitePositions });
                applyPositionsToUI(sitePositions);
            }
        });
    }, 2000);
}
