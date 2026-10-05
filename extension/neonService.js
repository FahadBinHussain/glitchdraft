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
        if (data.exists) {
            return { messages: data.messages || [], contactName: data.contactName || null, exists: true };
        }
        if (this.isMessengerThreadId(threadId)) {
            // Cross-platform name match: web/android numeric spaces never overlap,
            // so the only shared key is the display-name slug. Rank candidates by
            // contactName > web row > newest lastModified (mirrors Android's picker).
            const slugMatch = threadId.match(/^messenger_(?:web|android)_\d+_(.+)$/);
            if (slugMatch) {
                const picked = await this.findDocByNameSlug(slugMatch[1], threadId);
                if (picked) {
                    const found = await this.request(`/api/drafts/${encodeURIComponent(picked)}`, { method: "GET" });
                    if (found.exists) {
                        console.log("[GlitchDraft] name-slug match", threadId, "->", picked);
                        return {
                            messages: found.messages || [],
                            contactName: found.contactName || null,
                            exists: true,
                            foundDocId: picked
                        };
                    }
                }
            }
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

    // Rank rows whose id ends with this chat's name slug:
    //   1. contactName slug == requested slug (same person on both platforms)
    //   2. web row (web reads its exact id; the other platform must follow it)
    //   3. newest lastModified
    // No needsRename on purpose: reading a foreign row must never move/delete it.
    async findDocByNameSlug(nameSlug, excludeId = null) {
        const allDrafts = await this.getAllDrafts();
        const esc = String(nameSlug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const anchor = new RegExp("^messenger_(web|android)_\\d+_" + esc + "$");
        const slugify = (s) => String(s || "").trim().toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
            .substring(0, 50);
        const ids = Object.keys(allDrafts).filter((id) => id !== excludeId && anchor.test(id));
        if (ids.length === 0) return null;
        ids.sort((a, b) => {
            const aName = slugify(allDrafts[a]?.contactName) === nameSlug ? 1 : 0;
            const bName = slugify(allDrafts[b]?.contactName) === nameSlug ? 1 : 0;
            if (bName !== aName) return bName - aName;
            const aWeb = a.startsWith("messenger_web_") ? 1 : 0;
            const bWeb = b.startsWith("messenger_web_") ? 1 : 0;
            if (bWeb !== aWeb) return bWeb - aWeb;
            return (allDrafts[b]?.lastModified || 0) - (allDrafts[a]?.lastModified || 0);
        });
        return ids[0];
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
