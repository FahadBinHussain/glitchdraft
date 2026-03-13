package com.fahad.glitchdraft.lsposed.data

import android.content.Context
import android.net.Uri
import com.fahad.glitchdraft.lsposed.provider.ConfigProvider
import de.robv.android.xposed.XposedBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * DraftRepository
 *
 * Kotlin port of firestoreService.js + background.js.
 * Used by OverlayController to read/write Firestore drafts from the
 * native overlay panel.
 *
 * Firebase credentials are fetched via ConfigProvider — a ContentProvider
 * in the module APK that serves the config cross-process.
 */
class DraftRepository(private val context: Context) {

    data class Draft(val html: String, val timestamp: Long)

    companion object {
        private const val FS_BASE = "https://firestore.googleapis.com/v1/projects"
    }

    /**
     * Fetches Firebase credentials from the module's ContentProvider.
     * Works cross-process (e.g. when called from inside Messenger's process).
     */
    private data class FirebaseConfig(val projectId: String, val apiKey: String)

    private fun readConfig(): FirebaseConfig? {
        return try {
            val cursor = context.contentResolver.query(
                ConfigProvider.CONTENT_URI, null, null, null, null
            ) ?: return null

            cursor.use {
                if (!it.moveToFirst()) return null
                val pid = it.getString(it.getColumnIndexOrThrow(ConfigProvider.COL_PROJECT_ID))
                val key = it.getString(it.getColumnIndexOrThrow(ConfigProvider.COL_API_KEY))
                if (pid.isNullOrBlank() || key.isNullOrBlank()) null
                else FirebaseConfig(pid, key)
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun docUrl(path: String): String {
        val cfg = readConfig() ?: throw IllegalStateException("Firebase config not set — open GlitchDraft app and paste your Firebase JSON")
        return "$FS_BASE/${cfg.projectId}/databases/(default)/documents/$path?key=${cfg.apiKey}"
    }

    // -------------------------------------------------------------------------
    // GET draft
    // -------------------------------------------------------------------------

    suspend fun getDraft(chatId: String): List<Draft> = withContext(Dispatchers.IO) {
        // ── For messenger threads: match by name slug across platforms ──
        // Web:     "messenger_web_7990669924323622_cat_fren"
        // Android: "messenger_android_410625006_cat_fren"
        // → extract name slug, list all docs, find any messenger_* doc with same slug
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId)
        if (nameSlugMatch != null) {
            val nameSlug = nameSlugMatch.groupValues[1]
            val allDocs = listAllDraftIds()
            // Find any messenger doc (web or android) whose ID ends with "_nameSlug"
            val matchedId = allDocs.firstOrNull { docId ->
                docId.matches(Regex("^messenger_(web|android)_.*")) && docId.endsWith("_$nameSlug")
            }
            if (matchedId != null) {
                XposedBridge.log("[DraftRepo] Name-slug match: $chatId → $matchedId")
                val result = fetchDraftDoc(matchedId)
                if (result != null) return@withContext result
            }
            return@withContext emptyList()
        }

        // ── Non-messenger or no-slug messenger: exact match ──
        fetchDraftDoc(chatId) ?: emptyList()
    }

    /** Fetches a single draft doc by ID, returns null on 404 or error. */
    private fun fetchDraftDoc(chatId: String): List<Draft>? {
        return try {
            val url = URL(docUrl("drafts/$chatId"))
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000

            if (conn.responseCode == 404) return null
            if (conn.responseCode != 200) return null

            val body = conn.inputStream.bufferedReader().readText()
            parseDraftMessages(JSONObject(body))
        } catch (_: Throwable) { null }
    }

    /** Lists all document IDs in the drafts collection. */
    private fun listAllDraftIds(): List<String> {
        return try {
            val cfg = readConfig() ?: return emptyList()
            val listUrl = URL("$FS_BASE/${cfg.projectId}/databases/(default)/documents/drafts?key=${cfg.apiKey}")
            val conn = listUrl.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000

            if (conn.responseCode != 200) return emptyList()
            val body = conn.inputStream.bufferedReader().readText()
            val data = JSONObject(body)
            val docs = data.optJSONArray("documents") ?: return emptyList()
            val ids = mutableListOf<String>()
            for (i in 0 until docs.length()) {
                val name = docs.getJSONObject(i).optString("name", "")
                if (name.isNotBlank()) ids.add(name.substringAfterLast('/'))
            }
            ids
        } catch (_: Throwable) { emptyList() }
    }

    /** Parses draft messages from a Firestore document JSON. */
    private fun parseDraftMessages(doc: JSONObject): List<Draft> {
        val values = doc.optJSONObject("fields")
            ?.optJSONObject("messages")
            ?.optJSONObject("arrayValue")
            ?.optJSONArray("values") ?: return emptyList()

        val list = mutableListOf<Draft>()
        for (i in 0 until values.length()) {
            val fields = values.getJSONObject(i)
                .optJSONObject("mapValue")?.optJSONObject("fields") ?: continue
            val html = fields.optJSONObject("html")?.optString("stringValue", "") ?: ""
            val ts = fields.optJSONObject("timestamp")?.optString("integerValue", "0")?.toLongOrNull() ?: 0L
            list.add(Draft(html = html, timestamp = ts))
        }
        return list
    }

    // -------------------------------------------------------------------------
    // SAVE draft
    // -------------------------------------------------------------------------

    suspend fun saveDraft(chatId: String, messages: List<Draft>) = withContext(Dispatchers.IO) {
        // For messenger: resolve to the canonical doc ID (may be web or android platform)
        val resolvedId = resolveMessengerId(chatId) ?: chatId
        writeDraftDoc(resolvedId, messages)
    }

    /** For messenger thread IDs with a name slug, finds the existing doc (any platform) to write to.
     *  Returns null for non-messenger IDs or when no existing doc found (will create new). */
    private fun resolveMessengerId(chatId: String): String? {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId) ?: return null
        val nameSlug = nameSlugMatch.groupValues[1]
        val allDocs = listAllDraftIds()
        return allDocs.firstOrNull { docId ->
            docId.matches(Regex("^messenger_(web|android)_.*")) && docId.endsWith("_$nameSlug")
        }
    }

    private fun writeDraftDoc(chatId: String, messages: List<Draft>) {
        val url = URL(docUrl("drafts/$chatId"))
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "PATCH"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        conn.connectTimeout = 8000
        conn.readTimeout = 8000

        val msgsArray = JSONArray()
        messages.forEach { m ->
            msgsArray.put(JSONObject().apply {
                put("mapValue", JSONObject().apply {
                    put("fields", JSONObject().apply {
                        put("html", JSONObject().put("stringValue", m.html))
                        put("timestamp", JSONObject().put("integerValue", m.timestamp.toString()))
                    })
                })
            })
        }

        val body = JSONObject().apply {
            put("fields", JSONObject().apply {
                put("messages", JSONObject().apply {
                    put("arrayValue", JSONObject().apply {
                        put("values", msgsArray)
                    })
                })
                put("lastModified", JSONObject().put("integerValue", System.currentTimeMillis().toString()))
            })
        }

        OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
        conn.responseCode // trigger the request
    }

    // -------------------------------------------------------------------------
    // DELETE draft
    // -------------------------------------------------------------------------

    /**
     * Deletes the entire Firestore document for the given chat (removes ALL drafts).
     * Prefer [deleteDraftByTimestamp] when only a single draft entry should be removed.
     */
    suspend fun deleteDraft(chatId: String) = withContext(Dispatchers.IO) {
        val resolvedId = resolveMessengerId(chatId) ?: chatId
        val url = URL(docUrl("drafts/$resolvedId"))
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "DELETE"
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.responseCode
    }

    /**
     * Removes only the single draft entry identified by [timestamp] from the
     * messages array, then writes the updated list back to Firestore.
     *
     * If no drafts remain after the removal the whole document is deleted so
     * the chat no longer appears in the drafts collection.
     *
     * This is the correct function to call from a per-row delete button —
     * [deleteDraft] deletes the *entire document* (all drafts for the chat)
     * and must NOT be used for single-entry deletion.
     */
    suspend fun deleteDraftByTimestamp(chatId: String, timestamp: Long) = withContext(Dispatchers.IO) {
        val resolvedId = resolveMessengerId(chatId) ?: chatId
        val existing = fetchDraftDoc(resolvedId) ?: emptyList()
        val updated = existing.filter { it.timestamp != timestamp }
        if (updated.isEmpty()) {
            // No drafts left — remove the whole document to keep Firestore tidy
            val url = URL(docUrl("drafts/$resolvedId"))
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "DELETE"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.responseCode
        } else {
            writeDraftDoc(resolvedId, updated)
        }
    }

    // -------------------------------------------------------------------------
    // GET / SAVE settings (UI positions)
    // -------------------------------------------------------------------------

    suspend fun getSettings(): JSONObject = withContext(Dispatchers.IO) {
        val url = URL(docUrl("settings/user"))
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 8000
        conn.readTimeout = 8000

        if (conn.responseCode == 404) return@withContext JSONObject()
        if (conn.responseCode != 200) return@withContext JSONObject()

        val body = conn.inputStream.bufferedReader().readText()
        val doc = JSONObject(body)
        val raw = doc.optJSONObject("fields")
            ?.optJSONObject("uiPositions")
            ?.optString("stringValue", "{}") ?: "{}"
        JSONObject(raw)
    }

    suspend fun saveSettings(uiPositions: JSONObject) = withContext(Dispatchers.IO) {
        val url = URL(docUrl("settings/user"))
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "PATCH"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        conn.connectTimeout = 8000
        conn.readTimeout = 8000

        val body = JSONObject().apply {
            put("fields", JSONObject().apply {
                put("uiPositions", JSONObject().put("stringValue", uiPositions.toString()))
            })
        }
        OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
        conn.responseCode
    }
}
