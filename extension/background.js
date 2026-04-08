// Provider services loaded as globals in MV3 service worker context
self.importScripts("firestoreService.js");
self.importScripts("neonService.js");

const firestoreService = new FirestoreService();
const neonService = new NeonService();

async function getActiveProvider() {
    const data = await chrome.storage.local.get(["firebaseConfig", "neonConfig"]);
    if (data.neonConfig && data.neonConfig.apiBaseUrl) return "neon";
    if (data.firebaseConfig) return "firebase";
    return null;
}

async function getService() {
    const provider = await getActiveProvider();
    if (provider === "neon") return { provider, service: neonService };
    if (provider === "firebase") return { provider, service: firestoreService };
    throw new Error("No backend configured. Set Firebase config or Neon config in extension settings.");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sync") {
        handleSync().then(sendResponse);
        return true;
    }
    if (request.action === "saveDraft") {
        handleUpload(request.chatId, request.messages, request.contactName).then(sendResponse);
        return true;
    }
    if (request.action === "getDraft") {
        handleGet(request.chatId).then(sendResponse);
        return true;
    }
    if (request.action === "getAllDrafts") {
        handleGetAllDrafts().then(sendResponse);
        return true;
    }
    if (request.action === "deleteDraft") {
        handleDelete(request.chatId).then(sendResponse);
        return true;
    }
    if (request.action === "getSyncStatus") {
        handleGetStatus().then(sendResponse);
        return true;
    }
    if (request.action === "saveSettings") {
        handleSaveSettings(request.settings).then(sendResponse);
        return true;
    }
    if (request.action === "renameDraft") {
        handleRename(request.fromId, request.toId, request.messages, request.contactName).then(sendResponse);
        return true;
    }
    if (request.action === "getSettings") {
        handleGetSettings().then(sendResponse);
        return true;
    }
});

async function handleGetStatus() {
    try {
        const data = await chrome.storage.local.get(["firebaseConfig", "neonConfig", "lastSyncTime"]);
        const hasNeon = !!(data.neonConfig && data.neonConfig.apiBaseUrl);
        const hasFirebase = !!data.firebaseConfig;
        const provider = hasNeon ? "neon" : (hasFirebase ? "firebase" : null);

        return {
            success: true,
            authenticated: !!provider,
            provider,
            message: provider ? `Configured (${provider})` : "Not configured",
            lastSyncTime: data.lastSyncTime || null
        };
    } catch (error) {
        return { success: false, authenticated: false, message: error.message };
    }
}

async function handleSaveSettings(settings) {
    try {
        const { service } = await getService();
        await service.saveSettings(settings);
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function handleGetSettings() {
    try {
        const { service } = await getService();
        const settings = await service.getSettings();
        return { success: true, settings };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function handleSync() {
    return { success: true, message: "Using configured cloud backend" };
}

async function handleGet(chatId) {
    try {
        const { service } = await getService();
        const result = await service.getDraft(chatId);
        await chrome.storage.local.set({ lastSyncTime: Date.now() });
        return {
            success: true,
            messages: result.messages || [],
            contactName: result.contactName || null,
            exists: !!result.exists,
            needsRename: result.needsRename || false,
            renameFrom: result.renameFrom || null,
            renameTo: result.renameTo || null
        };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function handleUpload(chatId, messages, contactName) {
    try {
        const { service } = await getService();
        let resolvedId = chatId;
        if (/^\d+$/.test(chatId)) {
            const existing = await service.findDocByNumericId(chatId);
            resolvedId = existing || `messenger_web_${chatId}`;
        }
        await service.saveDraft(resolvedId, messages, contactName);
        await chrome.storage.local.set({ lastSyncTime: Date.now() });
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function handleGetAllDrafts() {
    try {
        const { service } = await getService();
        const drafts = await service.getAllDrafts();
        return { success: true, drafts };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function handleDelete(chatId) {
    try {
        const { service } = await getService();
        await service.deleteDraft(chatId);
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function handleRename(fromId, toId, messages, contactName) {
    try {
        const { service } = await getService();
        await service.renameDraft(fromId, toId, messages, contactName);
        return { success: true };
    } catch (error) {
        return { success: false, message: error.message };
    }
}
