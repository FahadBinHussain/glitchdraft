class FirestoreService {
    constructor() {
        this.config = null;
    }
    async getConfig() {
        if (!this.config) {
            const data = await chrome.storage.local.get(["firebaseConfig"]);
            if (!data.firebaseConfig) throw new Error("Config not set");
            this.config = data.firebaseConfig;
        }
        return this.config;
    }
    async saveDraft(threadId, messages, contactName) {
        const config = await this.getConfig();
        const url = "https://firestore.googleapis.com/v1/projects/" + config.projectId + "/databases/(default)/documents/drafts/" + threadId + "?key=" + config.apiKey;
        const msgsArray = messages.map(m => ({
            mapValue: { fields: { html: { stringValue: m.html || "" }, timestamp: { integerValue: String(m.timestamp || Date.now()) } } }
        }));
        const docFields = {
            messages: { arrayValue: { values: msgsArray } },
            lastModified: { integerValue: String(Date.now()) }
        };
        if (contactName) {
            docFields.contactName = { stringValue: contactName };
        }
        const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: docFields }) });
        if (!response.ok) throw new Error("Save failed: " + response.status);
        return await response.json();
    }
    async getDraft(threadId) {
        const config = await this.getConfig();
        const baseUrl = "https://firestore.googleapis.com/v1/projects/" + config.projectId + "/databases/(default)/documents/drafts";
        const key = "?key=" + config.apiKey;

        // ── For messenger threads: match by name slug across platforms ──
        // Web:     "messenger_web_7990669924323622_cat_fren"
        // Android: "messenger_android_410625006_cat_fren"
        // → extract the name slug (everything after the 3rd underscore segment),
        //   list all docs, find any messenger_* doc with the same name slug.
        const messengerMatch = threadId.match(/^messenger_(?:web|android)_(\d+)_(.+)$/);
        if (messengerMatch) {
            const numericId = messengerMatch[1];
            const nameSlug = messengerMatch[2];
            const listRes = await fetch(baseUrl + key);
            if (listRes.ok) {
                const data = await listRes.json();
                const docs = data.documents || [];
                // 1) Find any messenger doc (web or android) whose ID ends with the same
                //    name slug, ranked: contactName slug match > web row > newest
                //    lastModified (same ranking as Android's DraftRepository).
                const esc = nameSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const anchor = new RegExp("^messenger_(web|android)_\\d+_" + esc + "$");
                const slugify = (s) => String(s || "").trim().toLowerCase()
                    .replace(/[^\p{L}\p{N}]/gu, "_").replace(/_+/g, "_")
                    .replace(/^_|_$/g, "").substring(0, 50);
                const match = docs
                    .filter(d => anchor.test(d.name.split('/').pop()))
                    .sort((a, b) => {
                        const aId = a.name.split('/').pop(), bId = b.name.split('/').pop();
                        const aName = slugify(a.fields?.contactName?.stringValue) === nameSlug ? 1 : 0;
                        const bName = slugify(b.fields?.contactName?.stringValue) === nameSlug ? 1 : 0;
                        if (bName !== aName) return bName - aName;
                        const aWeb = aId.startsWith("messenger_web_") ? 1 : 0;
                        const bWeb = bId.startsWith("messenger_web_") ? 1 : 0;
                        if (bWeb !== aWeb) return bWeb - aWeb;
                        const aLm = parseInt(a.fields?.lastModified?.integerValue || "0");
                        const bLm = parseInt(b.fields?.lastModified?.integerValue || "0");
                        return bLm - aLm;
                    })[0];
                if (match) {
                    const messages = (match.fields?.messages?.arrayValue?.values || []).map(v => ({ html: v.mapValue?.fields?.html?.stringValue || "", timestamp: parseInt(v.mapValue?.fields?.timestamp?.integerValue || "0") }));
                    const contactName = match.fields?.contactName?.stringValue || null;
                    return { messages, contactName, exists: true, foundDocId: match.name.split('/').pop() };
                }
                // 2) Fallback: look for a no-slug doc with the same numeric ID (e.g. imported from old format)
                const noSlugId = 'messenger_web_' + numericId;
                const noSlugIdAndroid = 'messenger_android_' + numericId;
                const noSlugMatch = docs.find(d => {
                    const docId = d.name.split('/').pop();
                    return docId === noSlugId || docId === noSlugIdAndroid;
                });
                if (noSlugMatch) {
                    const messages = (noSlugMatch.fields?.messages?.arrayValue?.values || []).map(v => ({ html: v.mapValue?.fields?.html?.stringValue || "", timestamp: parseInt(v.mapValue?.fields?.timestamp?.integerValue || "0") }));
                    const contactName = noSlugMatch.fields?.contactName?.stringValue || null;
                    const foundDocId = noSlugMatch.name.split('/').pop();
                    // Signal that this was found under a legacy no-slug ID so caller can rename it
                    return { messages, contactName, exists: true, foundDocId, needsRename: true, renameFrom: foundDocId, renameTo: threadId };
                }
                // 3) Also check bare numeric (truly old format, no messenger_ prefix)
                const bareMatch = docs.find(d => d.name.split('/').pop() === numericId);
                if (bareMatch) {
                    const messages = (bareMatch.fields?.messages?.arrayValue?.values || []).map(v => ({ html: v.mapValue?.fields?.html?.stringValue || "", timestamp: parseInt(v.mapValue?.fields?.timestamp?.integerValue || "0") }));
                    const contactName = bareMatch.fields?.contactName?.stringValue || null;
                    return { messages, contactName, exists: true, foundDocId: numericId, needsRename: true, renameFrom: numericId, renameTo: threadId };
                }
            }
            return { messages: [], contactName: null, exists: false };
        }

        // ── No name slug yet (e.g. "messenger_web_123" without slug): exact match ──
        const messengerNoSlug = threadId.match(/^messenger_(?:web|android)_\d+$/);
        if (messengerNoSlug) {
            // Can't match by name — fall through to exact match attempt
        }

        // ── Non-messenger or no-slug messenger: exact match ──
        const exactRes = await fetch(baseUrl + "/" + encodeURIComponent(threadId) + key);
        if (exactRes.ok) {
            const doc = await exactRes.json();
            const messages = (doc.fields?.messages?.arrayValue?.values || []).map(v => ({ html: v.mapValue?.fields?.html?.stringValue || "", timestamp: parseInt(v.mapValue?.fields?.timestamp?.integerValue || "0") }));
            const contactName = doc.fields?.contactName?.stringValue || null;
            return { messages, contactName, exists: true };
        }
        if (exactRes.status === 404) return { messages: [], contactName: null, exists: false };
        throw new Error("Get failed: " + exactRes.status);
    }
    // Rename a draft: copy data to new ID, delete old ID.
    async renameDraft(fromId, toId, messages, contactName) {
        try {
            await this.saveDraft(toId, messages, contactName);
            await this.deleteDraft(fromId);
            console.log('[FirestoreService] Renamed draft', fromId, '→', toId);
        } catch (e) {
            console.error('[FirestoreService] renameDraft failed:', e);
        }
    }
    async deleteDraft(threadId) {
        const config = await this.getConfig();
        const url = "https://firestore.googleapis.com/v1/projects/" + config.projectId + "/databases/(default)/documents/drafts/" + threadId + "?key=" + config.apiKey;
        const response = await fetch(url, { method: "DELETE" });
        if (!response.ok) throw new Error("Delete failed: " + response.status);
    }
    async saveSettings(settings) {
        const config = await this.getConfig();
        const url = "https://firestore.googleapis.com/v1/projects/" + config.projectId + "/databases/(default)/documents/settings/user?key=" + config.apiKey;
        const fields = {
            uiPositions: { stringValue: JSON.stringify(settings.uiPositions || {}) },
            appConfig: { stringValue: JSON.stringify(settings.appConfig || {}) }
        };
        const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
        if (!response.ok) throw new Error("Save settings failed: " + response.status);
        return await response.json();
    }
    async getAllDrafts() {
        const config = await this.getConfig();
        // List all documents in the drafts collection
        const url = "https://firestore.googleapis.com/v1/projects/" + config.projectId + "/databases/(default)/documents/drafts?key=" + config.apiKey;
        const response = await fetch(url);
        if (response.status === 404) return {};
        if (!response.ok) throw new Error("List drafts failed: " + response.status);
        const data = await response.json();
        const docs = data.documents || [];
        const result = {};
        for (const doc of docs) {
            // Extract chat ID from document name (last path segment)
            const chatId = doc.name.split('/').pop();
            const messages = (doc.fields?.messages?.arrayValue?.values || []).map(v => ({
                html: v.mapValue?.fields?.html?.stringValue || "",
                timestamp: parseInt(v.mapValue?.fields?.timestamp?.integerValue || "0")
            }));
            const contactName = doc.fields?.contactName?.stringValue || null;
            const lastModified = parseInt(doc.fields?.lastModified?.integerValue || "0");
            result[chatId] = { messages, contactName, lastModified };
        }
        return result;
    }
    async getSettings() {
        const config = await this.getConfig();
        const url = "https://firestore.googleapis.com/v1/projects/" + config.projectId + "/databases/(default)/documents/settings/user?key=" + config.apiKey;
        const response = await fetch(url);
        if (response.status === 404) return { uiPositions: {}, appConfig: {} };
        if (!response.ok) throw new Error("Get settings failed: " + response.status);
        const doc = await response.json();
        const uiPositions = JSON.parse(doc.fields?.uiPositions?.stringValue || "{}");
        const appConfig = JSON.parse(doc.fields?.appConfig?.stringValue || "{}");
        return { uiPositions, appConfig };
    }
    // Given a bare numeric Messenger thread ID, scan all drafts and return the full
    // document ID (e.g. "messenger_web_123_john_doe") that matches, or null if not found.
    async findDocByNumericId(numericId) {
        try {
            const allDrafts = await this.getAllDrafts();
            const prefix = 'messenger_web_' + numericId;
            const prefixAndroid = 'messenger_android_' + numericId;
            const match = Object.keys(allDrafts).find(id =>
                id.startsWith(prefix + '_') || id === prefix ||
                id.startsWith(prefixAndroid + '_') || id === prefixAndroid
            );
            return match || null;
        } catch (e) {
            console.error('[FirestoreService] findDocByNumericId error:', e);
            return null;
        }
    }
}