class NeonService {
    constructor() {
        this.config = null;
    }

    async getConfig() {
        if (!this.config) {
            const data = await chrome.storage.local.get(["neonConfig"]);
            if (!data.neonConfig || !data.neonConfig.apiBaseUrl) {
                throw new Error("Neon config not set");
            }
            this.config = data.neonConfig;
        }
        return this.config;
    }

    async request(path, options = {}) {
        const cfg = await this.getConfig();
        const base = cfg.apiBaseUrl.replace(/\/+$/, "");
        const url = base + path;
        const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
        if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

        let response;
        try {
            response = await fetch(url, { ...options, headers });
        } catch (err) {
            const reason = err?.message || "Unknown network error";
            throw new Error(
                `Neon request failed before response. URL=${url}. Reason=${reason}. ` +
                `Check backend is running, API URL is correct, and extension host permissions allow this URL.`
            );
        }

        if (!response.ok) {
            let bodyText = "";
            try {
                bodyText = await response.text();
            } catch (_) {
                bodyText = "";
            }
            throw new Error(
                `Neon API failed: HTTP ${response.status} at ${url}` +
                (bodyText ? ` | ${bodyText.slice(0, 300)}` : "")
            );
        }
        return response.status === 204 ? null : response.json();
    }

    async saveDraft(threadId, messages, contactName) {
        await this.request(`/api/drafts/${encodeURIComponent(threadId)}`, {
            method: "PUT",
            body: JSON.stringify({ messages, contactName: contactName || null })
        });
        return { success: true };
    }

    async getDraft(threadId) {
        const data = await this.request(`/api/drafts/${encodeURIComponent(threadId)}`, { method: "GET" });
        if (!data.exists && this.isMessengerThreadId(threadId)) {
            const existingId = await this.findDocByMessengerNumericId(this.getMessengerNumericId(threadId), threadId);
            if (existingId && existingId !== threadId) {
                const found = await this.request(`/api/drafts/${encodeURIComponent(existingId)}`, { method: "GET" });
                return {
                    messages: found.messages || [],
                    contactName: found.contactName || null,
                    exists: !!found.exists,
                    foundDocId: existingId,
                    needsRename: !!found.exists,
                    renameFrom: existingId,
                    renameTo: threadId
                };
            }
        }
        return {
            messages: data.messages || [],
            contactName: data.contactName || null,
            exists: !!data.exists
        };
    }

    async renameDraft(fromId, toId, messages, contactName) {
        await this.saveDraft(toId, messages, contactName);
        await this.deleteDraft(fromId);
    }

    async deleteDraft(threadId) {
        await this.request(`/api/drafts/${encodeURIComponent(threadId)}`, { method: "DELETE" });
    }

    async saveSettings(settings) {
        const payload = {};
        if (settings && Object.prototype.hasOwnProperty.call(settings, "uiPositions")) {
            payload.uiPositions = settings.uiPositions;
        }
        if (settings && Object.prototype.hasOwnProperty.call(settings, "appConfig")) {
            payload.appConfig = settings.appConfig;
        }

        await this.request("/api/settings", {
            method: "PUT",
            body: JSON.stringify(payload)
        });
        return { success: true };
    }

    async getSettings() {
        const data = await this.request("/api/settings", { method: "GET" });
        return data.settings || { uiPositions: {}, appConfig: {} };
    }

    async getAllDrafts() {
        const data = await this.request("/api/drafts", { method: "GET" });
        return data.drafts || {};
    }

    async findDocByNumericId(numericId) {
        try {
            return await this.findDocByMessengerNumericId(numericId);
        } catch (_) {
            return null;
        }
    }

    isMessengerThreadId(threadId) {
        return /^messenger_(?:web|android)_\d+(?:_.+)?$/.test(threadId || "");
    }

    getMessengerNumericId(threadId) {
        const match = String(threadId || "").match(/^messenger_(?:web|android)_(\d+)/);
        return match ? match[1] : null;
    }

    async findDocByMessengerNumericId(numericId, excludeId = null) {
        if (!numericId) return null;
        const allDrafts = await this.getAllDrafts();
        const prefix = "messenger_web_" + numericId;
        const prefixAndroid = "messenger_android_" + numericId;
        const ids = Object.keys(allDrafts).filter((id) =>
            id !== excludeId &&
            (id.startsWith(prefix + "_") || id === prefix ||
             id.startsWith(prefixAndroid + "_") || id === prefixAndroid)
        );

        if (ids.length === 0) return null;
        ids.sort((a, b) => {
            const aMessages = allDrafts[a]?.messages?.length || 0;
            const bMessages = allDrafts[b]?.messages?.length || 0;
            if (bMessages !== aMessages) return bMessages - aMessages;
            return (allDrafts[b]?.lastModified || 0) - (allDrafts[a]?.lastModified || 0);
        });
        return ids[0];
    }
}
