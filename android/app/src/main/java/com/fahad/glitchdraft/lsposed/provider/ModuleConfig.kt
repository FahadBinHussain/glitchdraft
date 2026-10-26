package com.fahad.glitchdraft.lsposed.provider

import android.content.Context
import de.robv.android.xposed.XposedBridge
import org.json.JSONObject
import java.io.File

/**
 * Config bridge — the SECOND config method.
 *
 * The module normally serves its config to hooked apps through
 * [ConfigProvider] (`content://com.fahad.glitchdraft.lsposed.config/firebase`).
 * That needs the target app to be able to *see* the module package: Android 11
 * package visibility filters content-provider resolution, so an app whose
 * manifest has no `<queries>` entry for us cannot resolve the authority at all.
 * Nagram is exactly that case — every query logs
 * `Failed to find provider info for com.fahad.glitchdraft.lsposed.config`
 * and the panel silently couldn't save (readConfig() returned null).
 *
 * Cross-app channels that do NOT work on this device (tried, do not retry):
 *  - XSharedPreferences: the module's prefs file is behind a 0700 data dir and
 *    Vector's framework has no `getPrefsPath` prefs mirror, so `keys=[]`.
 *  - `IXposedHookZygoteInit`: Vector never calls it for legacy modules.
 *
 * Working channel: each scoped app's OWN filesDir carries
 * `glitchdraft_config.json` (base url + key + pushed_at), written by root via
 * `tools/android-config.ps1`. Reading a file from your own filesDir can never
 * be blocked by visibility or SELinux, so this is deterministic.
 *
 * This is NOT a silent fallback: [markActive] logs the switch, and the panel
 * header carries a ` [file]` marker while it is in use (OverlayController
 * chatIdDebugText). If the file is missing, saving fails loudly instead of
 * no-opping — and the log names the exact path plus the helper to run.
 */
object ModuleConfig {

    const val MODULE_PACKAGE = "com.fahad.glitchdraft.lsposed"
    const val FILE_NAME = "glitchdraft_config.json"
    private const val KEY_NEON_BASE = "neon_api_base_url"
    private const val KEY_NEON_KEY = "neon_api_key"
    private const val TAG = "GlitchDraft-LSPosed"

    @Volatile private var loaded = false

    @Volatile var neonBaseUrl: String? = null
        private set
    @Volatile var neonApiKey: String? = null
        private set

    /** true once the file bridge actually served config to a caller */
    @Volatile var active = false
        private set

    /** true when config was obtainable without the provider */
    @Volatile var available = false
        private set

    fun load(context: Context): Boolean {
        if (loaded) return available
        loaded = true
        val file = File(context.filesDir, FILE_NAME)
        if (!file.isFile) {
            XposedBridge.log(
                "$TAG: config file missing: ${file.absolutePath} — run tools/android-config.ps1"
            )
            return false
        }
        return try {
            val json = JSONObject(file.readText())
            val base = json.optString(KEY_NEON_BASE).trim().trimEnd('/')
            val key = json.optString(KEY_NEON_KEY).trim()
            neonBaseUrl = base.takeIf { it.isNotEmpty() }
            neonApiKey = key.takeIf { it.isNotEmpty() }
            available = neonBaseUrl != null && neonApiKey != null
            XposedBridge.log(
                "$TAG: config file ${file.absolutePath} loaded=$available " +
                    "base=${neonBaseUrl ?: "-"} pushed=${json.optString("pushed_at", "-")}"
            )
            available
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: config file read failed (${file.absolutePath}): $e")
            available = false
            false
        }
    }

    /** mark + log the first time the bridge is used instead of the provider */
    fun markActive(why: String) {
        if (active) return
        active = true
        XposedBridge.log(
            "$TAG: config source = injected file (2nd method) — provider unavailable: $why"
        )
    }
}
