// draftImport.js — Import / Export helpers for GlitchDraft
// Loaded as a separate content script before content.js.
// Functions here are top-level (no IIFE) so content.js can call them directly.

'use strict';

/**
 * Parse an import JSON file chosen by the user and show the chat-selection dialog.
 * @param {Event}    event           - The file <input> change event.
 * @param {object}   ui              - { container, body } refs from content.js
 * @param {boolean}  isContainerVisible
 * @param {function} toggleContainer
 * @param {function} loadSavedMessages
 */
function gdImportSavedMessages(event, ui, isContainerVisible, toggleContainer, loadSavedMessages) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = ''; // reset so same file can be picked again

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (typeof data !== 'object' || data === null) throw new Error('Invalid data format');

            // Collect chat entries: support both new format { drafts: {...} } and old flat format
            const chatEntries = []; // [ { chatId, label, messages, contactName } ]

            if (data.drafts && typeof data.drafts === 'object') {
                // New Firestore export format
                for (const [chatId, d] of Object.entries(data.drafts)) {
                    chatEntries.push({
                        chatId,
                        label: d.contactName || chatId,
                        messages: d.messages || [],
                        contactName: d.contactName || null
                    });
                }
            } else {
                // Legacy Chrome storage flat format
                for (const key of Object.keys(data)) {
                    if (key === 'config' || key.startsWith('uiPositions_') || key === 'containerPosition' || key === 'togglePosition') continue;
                    if (Array.isArray(data[key])) {
                        chatEntries.push({ chatId: key, label: key, messages: data[key], contactName: null });
                    }
                }
            }

            if (chatEntries.length === 0) {
                alert('No chat drafts found in this file.');
                return;
            }

            gdShowImportSelectionDialog(chatEntries, ui, isContainerVisible, toggleContainer, loadSavedMessages);

        } catch (error) {
            alert('Error reading import file: ' + error.message);
        }
    };
    reader.readAsText(file);
}

/**
 * Show a modal-like panel inside the GlitchDraft UI for picking which chats to import.
 * @param {Array}    chatEntries     - [{ chatId, label, messages, contactName }]
 * @param {object}   ui              - { container, body } refs from content.js
 * @param {boolean}  isContainerVisible
 * @param {function} toggleContainer
 * @param {function} loadSavedMessages
 */
function gdShowImportSelectionDialog(chatEntries, ui, isContainerVisible, toggleContainer, loadSavedMessages) {
    // Build the overlay
    const overlay = document.createElement('div');
    overlay.dataset.savedMessageUiElement = 'true';
    overlay.style.cssText = `
        position:absolute; inset:0; background:rgba(0,0,0,0.55);
        z-index:10; display:flex; flex-direction:column;
        align-items:stretch; border-radius:12px; overflow:hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.dataset.savedMessageUiElement = 'true';
    header.style.cssText = 'background:var(--accent);color:#fff;padding:8px 12px;font-size:13px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;';
    header.innerHTML = `<span>📥 Select chats to import</span>`;

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.dataset.savedMessageUiElement = 'true';
    closeBtn.style.cssText = 'cursor:pointer;font-size:16px;line-height:1;';
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    // Select all / none bar
    const selBar = document.createElement('div');
    selBar.dataset.savedMessageUiElement = 'true';
    selBar.style.cssText = 'background:var(--bg-secondary);padding:4px 10px;display:flex;gap:8px;font-size:11px;align-items:center;border-bottom:1px solid var(--border);';
    const selectAllA = document.createElement('a');
    selectAllA.textContent = 'Select all';
    selectAllA.dataset.savedMessageUiElement = 'true';
    selectAllA.style.cssText = 'cursor:pointer;color:var(--accent);text-decoration:underline;';
    const selectNoneA = document.createElement('a');
    selectNoneA.textContent = 'None';
    selectNoneA.dataset.savedMessageUiElement = 'true';
    selectNoneA.style.cssText = 'cursor:pointer;color:var(--accent);text-decoration:underline;';
    const countSpan = document.createElement('span');
    countSpan.dataset.savedMessageUiElement = 'true';
    countSpan.style.cssText = 'margin-left:auto;color:var(--text-secondary);font-size:11px;';
    selBar.appendChild(selectAllA);
    selBar.appendChild(document.createTextNode(' / '));
    selBar.appendChild(selectNoneA);
    selBar.appendChild(countSpan);

    // List
    const list = document.createElement('div');
    list.dataset.savedMessageUiElement = 'true';
    list.style.cssText = 'flex:1;overflow-y:auto;background:var(--bg-primary);padding:4px;';

    chatEntries.forEach(({ chatId, label, messages }) => {
        const row = document.createElement('div');
        row.dataset.savedMessageUiElement = 'true';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:3px;font-size:12px;cursor:pointer;';
        row.onmouseover  = () => { row.style.background = 'var(--bg-secondary)'; };
        row.onmouseout   = () => { row.style.background = ''; };

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.dataset.chatId = chatId;
        cb.dataset.savedMessageUiElement = 'true';
        cb.style.cssText = 'flex-shrink:0;cursor:pointer;';
        cb.addEventListener('change', updateCount);
        row.addEventListener('click', (ev) => { if (ev.target !== cb) { cb.checked = !cb.checked; updateCount(); } });

        const lbl = document.createElement('span');
        lbl.dataset.savedMessageUiElement = 'true';
        lbl.style.cssText = 'flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--text-primary);';
        lbl.title = chatId;
        lbl.textContent = label;

        const cnt = document.createElement('span');
        cnt.dataset.savedMessageUiElement = 'true';
        cnt.style.cssText = 'flex-shrink:0;color:var(--text-secondary);font-size:11px;';
        cnt.textContent = messages.length + ' msg' + (messages.length !== 1 ? 's' : '');

        row.appendChild(cb);
        row.appendChild(lbl);
        row.appendChild(cnt);
        list.appendChild(row);
    });

    // Footer with import button
    const footer = document.createElement('div');
    footer.dataset.savedMessageUiElement = 'true';
    footer.style.cssText = 'background:var(--bg-secondary);padding:8px 10px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:center;';

    const importBtn = document.createElement('button');
    importBtn.textContent = '⬆ Import Selected';
    importBtn.dataset.savedMessageUiElement = 'true';
    importBtn.style.cssText = 'background:#43a047;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;';
    importBtn.onmouseover = () => { importBtn.style.background = '#2e7d32'; };
    importBtn.onmouseout  = () => { importBtn.style.background = '#43a047'; };

    const statusSpan = document.createElement('span');
    statusSpan.dataset.savedMessageUiElement = 'true';
    statusSpan.style.cssText = 'font-size:11px;color:var(--text-secondary);flex:1;';

    footer.appendChild(importBtn);
    footer.appendChild(statusSpan);

    function getChecked() {
        return Array.from(list.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.dataset.chatId);
    }

    function updateCount() {
        const checked = getChecked().length;
        countSpan.textContent = checked + ' / ' + chatEntries.length + ' selected';
        importBtn.disabled = checked === 0;
    }

    selectAllA.onclick  = () => { list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);  updateCount(); };
    selectNoneA.onclick = () => { list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false); updateCount(); };

    importBtn.onclick = async () => {
        const selectedIds = getChecked();
        if (selectedIds.length === 0) return;
        importBtn.disabled = true;
        statusSpan.textContent = 'Importing…';

        const toImport = chatEntries.filter(e => selectedIds.includes(e.chatId));
        let imported = 0;
        const errors = [];

        for (const entry of toImport) {
            const { chatId, messages, contactName } = entry;
            if (!chatId) { errors.push('missing chatId'); continue; }
            const msgs = Array.isArray(messages) ? messages : [];

            statusSpan.textContent = `Importing ${chatId.slice(0, 30)}…`;

            try {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
                    chrome.runtime.sendMessage(
                        { action: 'saveDraft', chatId, messages: msgs, contactName: contactName || null },
                        (resp) => {
                            clearTimeout(timeout);
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else if (resp && resp.success) {
                                imported++;
                                resolve();
                            } else {
                                reject(new Error(resp?.message || 'Save returned failure'));
                            }
                        }
                    );
                });
            } catch (err) {
                errors.push(chatId.slice(0, 20) + ': ' + err.message);
            }
        }

        if (errors.length > 0) {
            statusSpan.textContent = `✅ ${imported} imported, ❌ ${errors.length} failed: ${errors[0]}`;
        } else {
            statusSpan.textContent = `✅ Imported ${imported} chat(s)!`;
        }
        importBtn.textContent = 'Done';
        setTimeout(() => { overlay.remove(); loadSavedMessages(); }, 3000);
    };

    updateCount();

    // Assemble and add to container
    overlay.appendChild(header);
    overlay.appendChild(selBar);
    overlay.appendChild(list);
    overlay.appendChild(footer);

    // Position relative to the container
    ui.container.style.position = 'relative';
    ui.container.appendChild(overlay);

    // Make sure the panel is open
    if (!isContainerVisible) {
        toggleContainer();
    }
}

/**
 * Export all saved messages to a JSON file.
 */
function gdExportSavedMessages() {
    const draftsPromise = new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getAllDrafts' }, resolve);
    });
    const settingsPromise = new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getSettings' }, resolve);
    });

    Promise.all([draftsPromise, settingsPromise]).then(([draftsResponse, settingsResponse]) => {
        if (!draftsResponse || !draftsResponse.success) {
            alert('Export failed: ' + (draftsResponse?.message || 'Could not reach Firestore'));
            return;
        }

        const firestoreDrafts = draftsResponse.drafts || {};
        const firestoreSettings = (settingsResponse && settingsResponse.success) ? settingsResponse.settings : {};

        const exportData = {
            exportedAt: new Date().toISOString(),
            draftCount: Object.keys(firestoreDrafts).length,
            drafts: firestoreDrafts,
            settings: {
                appConfig: firestoreSettings.appConfig || {},
                uiPositions: firestoreSettings.uiPositions || {}
            }
        };

        gdDownloadJSON(exportData, 'glitchdraft_export_' + Date.now() + '.json');
    });
}

/**
 * Helper: trigger a JSON file download.
 */
function gdDownloadJSON(data, filename) {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
}
