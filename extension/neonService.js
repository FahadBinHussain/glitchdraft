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
            return { messages: data.messages || [], contactName: data.contactName || null, lastModified: Number(data.lastModified) || 0, exists: true };
        }
        if (this.isCrossPlatformThreadId(threadId)) {
            // Cross-platform name match: web/android numeric spaces never overlap,
            // so the only shared key is the display-name slug. Rank candidates by
            // contactName > web row > newest lastModified (mirrors Android's picker).
            const slugMatch = threadId.match(/^(?:messenger|instagram|telegram)_(?:web|android)_-?\d+_(.+)$/);
            if (slugMatch) {
                const picked = await this.findDocByNameSlug(slugMatch[1], threadId);
                if (picked) {
                    const found = await this.request(`/api/drafts/${encodeURIComponent(picked)}`, { method: "GET" });
                    if (found.exists) {
                        console.log("[GlitchDraft] name-slug match", threadId, "->", picked);
                        return {
                            messages: found.messages || [],
                            contactName: found.contactName || null,
                            lastModified: Number(found.lastModified) || 0,
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
                    lastModified: Number(found.lastModified) || 0,
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

    // Rank rows whose id ends with this chat's name slug (messenger + instagram):
    //   1. contactName slug == requested slug (same person on both platforms)
    //   2. web row (web reads its exact id; the other platform must follow it)
    //   3. newest lastModified
    // No needsRename on purpose: reading a foreign row must never move/delete it.
    async findDocByNameSlug(nameSlug, excludeId = null) {
        const allDrafts = await this.getAllDrafts(true);
        const esc = String(nameSlug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const anchor = new RegExp("^(messenger|instagram|telegram)_(web|android)_-?\\d+_" + esc + "$");
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
            const aWeb = a.includes("_web_") ? 1 : 0;
            const bWeb = b.includes("_web_") ? 1 : 0;
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

    // meta = true asks the backend to leave `messages` out. Only the slug-pickers
    // use it: they rank rows by id / contactName / lastModified and never read a
    // message, but `messages` carries every base64-embedded photo - shipping the
    // whole table for a name match is what burned the Neon egress quota
    // (free plan: 5 GB/project/month) and 402'd every query on 2026-10-27.
    async getAllDrafts(meta = false) {
        const data = await this.request(meta ? "/api/drafts?meta=1" : "/api/drafts", { method: "GET" });
        return data.drafts || {};
    }

    // Person grouping (one human, many platform threads). Neon-only: the
    // people/person_links tables live in the same database as the drafts.
    async getPerson(threadId, name) {
        const query = new URLSearchParams({ threadId });
        if (name) query.set("name", name);
        return this.request(`/api/people?${query.toString()}`, { method: "GET" });
    }

    async createPerson(threadId, displayName) {
        return this.request("/api/people", {
            method: "POST",
            body: JSON.stringify({ threadId, displayName })
        });
    }

    async linkThread(personId, threadId) {
        return this.request("/api/people/links", {
            method: "POST",
            body: JSON.stringify({ personId, threadId })
        });
    }

    async unlinkThread(threadId) {
        return this.request(`/api/people/links?threadId=${encodeURIComponent(threadId)}`, {
            method: "DELETE"
        });
    }

    async findDocByNumericId(numericId) {
        try {
            return await this.findDocByMessengerNumericId(numericId);
        } catch (_) {
            return null;
        }
    }

    isCrossPlatformThreadId(threadId) {
        return /^(?:messenger|instagram|telegram)_(?:web|android)_-?\d+(?:_.+)?$/.test(threadId || "");
    }

    getMessengerNumericId(threadId) {
        const match = String(threadId || "").match(/^messenger_(?:web|android)_(\d+)/);
        return match ? match[1] : null;
    }

    async findDocByMessengerNumericId(numericId, excludeId = null) {
        if (!numericId) return null;
        const allDrafts = await this.getAllDrafts(true);
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
