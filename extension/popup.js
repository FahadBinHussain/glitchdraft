document.addEventListener("DOMContentLoaded", async () => {
    const firebaseConfigInput = document.getElementById("firebaseConfigInput");
    const neonApiBaseUrl = document.getElementById("neonApiBaseUrl");
    const neonApiKey = document.getElementById("neonApiKey");
    const saveFirebaseBtn = document.getElementById("saveFirebaseBtn");
    const saveNeonBtn = document.getElementById("saveNeonBtn");
    const resetPositionBtn = document.getElementById("resetPositionBtn");
    const status = document.getElementById("status");

    loadSupportedSites();
    await loadSavedConfigs();
    await loadBackendStatus();

    saveFirebaseBtn.addEventListener("click", async () => {
        try {
            const config = parseFirebaseConfig(firebaseConfigInput.value);
            await chrome.storage.local.set({ firebaseConfig: config });
            showStatus("Firebase config saved.", "success");
        } catch (error) {
            showStatus("Firebase error: " + error.message, "error");
        }
    });

    saveNeonBtn.addEventListener("click", async () => {
        try {
            const base = (neonApiBaseUrl.value || "").trim().replace(/\/+$/, "");
            const key = (neonApiKey.value || "").trim();
            if (!base) throw new Error("Neon API base URL is required");
            if (!/^https?:\/\//i.test(base)) throw new Error("Neon API base URL must start with http:// or https://");
            await chrome.storage.local.set({ neonConfig: { apiBaseUrl: base, apiKey: key } });
            showStatus("Neon config saved. Neon mode is now active.", "success");
        } catch (error) {
            showStatus("Neon error: " + error.message, "error");
        }
    });

    resetPositionBtn.addEventListener("click", async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tab.id, { action: "resetPosition" });
            showStatus("UI position randomized.", "success");
        } catch (_) {
            showStatus("Reset failed: open a supported site first.", "error");
        }
    });

    function parseFirebaseConfig(text) {
        if (!text || !text.trim()) throw new Error("Firebase config is empty");
        let config = null;

        try {
            config = JSON.parse(text);
        } catch (_) {
            const apiKey = text.match(/apiKey[:\s]+"([^"]+)"|apiKey[:\s]+'([^']+)'/);
            const authDomain = text.match(/authDomain[:\s]+"([^"]+)"|authDomain[:\s]+'([^']+)'/);
            const projectId = text.match(/projectId[:\s]+"([^"]+)"|projectId[:\s]+'([^']+)'/);
            const storageBucket = text.match(/storageBucket[:\s]+"([^"]+)"|storageBucket[:\s]+'([^']+)'/);
            const messagingSenderId = text.match(/messagingSenderId[:\s]+"([^"]+)"|messagingSenderId[:\s]+'([^']+)'/);
            const appId = text.match(/appId[:\s]+"([^"]+)"|appId[:\s]+'([^']+)'/);

            if (!apiKey || !authDomain || !projectId) {
                throw new Error("Missing required Firebase fields");
            }

            config = {
                apiKey: apiKey[1] || apiKey[2],
                authDomain: authDomain[1] || authDomain[2],
                projectId: projectId[1] || projectId[2],
                storageBucket: storageBucket ? (storageBucket[1] || storageBucket[2]) : "",
                messagingSenderId: messagingSenderId ? (messagingSenderId[1] || messagingSenderId[2]) : "",
                appId: appId ? (appId[1] || appId[2]) : ""
            };
        }

        if (!config.apiKey || !config.authDomain || !config.projectId) {
            throw new Error("Missing required Firebase fields");
        }
        return config;
    }

    async function loadSavedConfigs() {
        const data = await chrome.storage.local.get([
            "firebaseConfig",
            "neonConfig",
            // legacy safety keys
            "configInput",
            "config"
        ]);

        const firebaseCfg = data.firebaseConfig || data.config || null;
        if (firebaseCfg) {
            firebaseConfigInput.value = JSON.stringify(firebaseCfg, null, 2);
        } else {
            firebaseConfigInput.value = "";
        }

        if (data.neonConfig) {
            neonApiBaseUrl.value = data.neonConfig.apiBaseUrl || "";
            neonApiKey.value = data.neonConfig.apiKey || "";
        } else {
            neonApiBaseUrl.value = "";
            neonApiKey.value = "";
        }
    }

    async function loadBackendStatus() {
        try {
            const resp = await chrome.runtime.sendMessage({ action: "getSyncStatus" });
            if (resp && resp.success) {
                if (resp.provider === "neon") {
                    showStatus("Active backend: Neon", "success");
                } else if (resp.provider === "firebase") {
                    showStatus("Active backend: Firebase", "success");
                } else {
                    showStatus("No backend configured yet.", "error");
                }
            }
        } catch (_) {
            // ignore status fetch errors in popup
        }
    }

    function showStatus(message, type) {
        status.textContent = message;
        status.className = "status " + type;
    }

    async function loadSupportedSites() {
        try {
            const manifestUrl = chrome.runtime.getURL("manifest.json");
            const response = await fetch(manifestUrl);
            const manifest = await response.json();
            const domains = new Set();
            manifest.content_scripts?.forEach((script) => {
                script.matches?.forEach((match) => {
                    const domainMatch = match.match(/\*:\/\/(?:\*\.)?([^\/]+)\//);
                    if (domainMatch) domains.add(domainMatch[1]);
                });
            });
            document.getElementById("supportedSites").textContent =
                Array.from(domains).sort().join(", ") || "None configured";
        } catch (_) {
            document.getElementById("supportedSites").textContent = "Error loading sites";
        }
    }
});
