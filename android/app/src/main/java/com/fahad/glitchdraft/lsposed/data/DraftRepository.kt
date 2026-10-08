package com.fahad.glitchdraft.lsposed.data

import android.content.Context
import com.fahad.glitchdraft.lsposed.provider.ConfigProvider
import de.robv.android.xposed.XposedBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class DraftRepository(private val context: Context) {

    // lastModified = row-level epoch ms from the GET response (bumped on every
    // PUT), same value for every message in the row — 0 when absent/older backend
    data class Draft(val html: String, val timestamp: Long, val lastModified: Long = 0L)

    private data class DraftRowMeta(
        val id: String,
        val contactName: String?,
        val lastModified: Long
    )

    companion object {
        private const val FS_BASE = "https://firestore.googleapis.com/v1/projects"
        private const val TAG = "[DraftRepo]"
    }

    private sealed class StorageConfig {
        data class Firebase(val projectId: String, val apiKey: String) : StorageConfig()
        data class Neon(val apiBaseUrl: String, val apiKey: String) : StorageConfig()
    }

    private fun readConfig(): StorageConfig? {
        return try {
            val cursor = context.contentResolver.query(
                ConfigProvider.CONTENT_URI, null, null, null, null
            ) ?: return null

            cursor.use {
                if (!it.moveToFirst()) return null

                val neonBaseUrl = runCatching {
                    val idx = it.getColumnIndexOrThrow(ConfigProvider.COL_NEON_API_BASE_URL)
                    it.getString(idx)
                }.getOrDefault("").orEmpty().trim().trimEnd('/')

                val neonApiKey = runCatching {
                    val idx = it.getColumnIndexOrThrow(ConfigProvider.COL_NEON_API_KEY)
                    it.getString(idx)
                }.getOrDefault("").orEmpty().trim()

                if (neonBaseUrl.isNotBlank() && neonApiKey.isNotBlank()) {
                    return StorageConfig.Neon(neonBaseUrl, neonApiKey)
                }

                val pid = it.getString(it.getColumnIndexOrThrow(ConfigProvider.COL_PROJECT_ID))
                val key = it.getString(it.getColumnIndexOrThrow(ConfigProvider.COL_API_KEY))
                if (pid.isNullOrBlank() || key.isNullOrBlank()) null
                else StorageConfig.Firebase(pid, key)
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun docUrl(firebase: StorageConfig.Firebase, path: String): String {
        return "$FS_BASE/${firebase.projectId}/databases/(default)/documents/$path?key=${firebase.apiKey}"
    }

    private fun neonUrl(neon: StorageConfig.Neon, path: String): String {
        return "${neon.apiBaseUrl}$path"
    }

    private fun openNeonConnection(neon: StorageConfig.Neon, path: String, method: String): HttpURLConnection {
        val conn = URL(neonUrl(neon, path)).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("x-api-key", neon.apiKey)
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        return conn
    }

    private fun encodeThreadId(threadId: String): String {
        return URLEncoder.encode(threadId, "UTF-8").replace("+", "%20")
    }

    // Mirror of content.js sanitizeNameSlug: trim, lowercase, non-letter/digit -> _,
    // collapse _, trim _, max 50. Used to compare a row's contactName with the
    // chat's current display-name slug so web/android rows for the SAME person match.
    private fun slugifyName(name: String?): String? {
        if (name.isNullOrBlank()) return null
        return name.trim()
            .lowercase()
            .replace(Regex("[^\\p{L}\\p{N}]"), "_")
            .replace(Regex("_+"), "_")
            .trim('_')
            .take(50)
            .takeIf { it.isNotEmpty() }
    }

    // Rank rows that carry this chat's name slug:
    //   1. contactName slug == requested name slug  (same person on both platforms)
    //   2. web row over android row  (web reads its exact id, android must follow it)
    //   3. newest lastModified
    // Never plain firstOrNull: a stale slug on someone else's thread (Fatima row
    // ending _cat_fren, Fahmida row ending _fatima_afroz) would win arbitrarily.
    private fun pickBestRow(rows: List<DraftRowMeta>, nameSlug: String): DraftRowMeta? {
        val anchor = Regex("^messenger_(web|android)_\\d+_" + Regex.escape(nameSlug) + "$")
        return rows
            .filter { anchor.matches(it.id) }
            .sortedWith(
                compareByDescending<DraftRowMeta> { slugifyName(it.contactName) == nameSlug }
                    .thenByDescending { if (it.id.startsWith("messenger_web_")) 1 else 0 }
                    .thenByDescending { it.lastModified }
            )
            .firstOrNull()
    }

    suspend fun getDraft(chatId: String): List<Draft> = withContext(Dispatchers.IO) {
        when (val cfg = readConfig()) {
            is StorageConfig.Neon -> getDraftFromNeon(cfg, chatId)
            is StorageConfig.Firebase -> getDraftFromFirebase(cfg, chatId)
            null -> emptyList()
        }
    }

    private fun getDraftFromFirebase(cfg: StorageConfig.Firebase, chatId: String): List<Draft> {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId)
        if (nameSlugMatch != null) {
            val nameSlug = nameSlugMatch.groupValues[1]
            val best = pickBestRow(listDraftRowsFirebase(cfg), nameSlug)
            if (best != null) {
                XposedBridge.log("$TAG slug '$nameSlug' pick=${best.id} name='${best.contactName}' lm=${best.lastModified} (req=$chatId)")
                val result = fetchDraftDocFirebase(cfg, best.id)
                if (result != null) return result
            }
            return fetchDraftDocFirebase(cfg, chatId) ?: emptyList()
        }

        return fetchDraftDocFirebase(cfg, chatId) ?: emptyList()
    }

    private fun getDraftFromNeon(cfg: StorageConfig.Neon, chatId: String): List<Draft> {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId)
        if (nameSlugMatch != null) {
            val nameSlug = nameSlugMatch.groupValues[1]
            val best = pickBestRow(listDraftRowsNeon(cfg), nameSlug)
            if (best != null) {
                XposedBridge.log("$TAG slug '$nameSlug' pick=${best.id} name='${best.contactName}' lm=${best.lastModified} (req=$chatId)")
                val result = fetchDraftDocNeon(cfg, best.id)
                if (result != null) return result
            }
            return fetchDraftDocNeon(cfg, chatId) ?: emptyList()
        }

        return fetchDraftDocNeon(cfg, chatId) ?: emptyList()
    }

    private fun fetchDraftDocFirebase(cfg: StorageConfig.Firebase, chatId: String): List<Draft>? {
        return try {
            val url = URL(docUrl(cfg, "drafts/$chatId"))
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000

            if (conn.responseCode == 404) return null
            if (conn.responseCode != 200) return null

            val body = conn.inputStream.bufferedReader().readText()
            parseDraftMessagesFromFirestore(JSONObject(body))
        } catch (_: Throwable) {
            null
        }
    }

    private fun fetchDraftDocNeon(cfg: StorageConfig.Neon, chatId: String): List<Draft>? {
        return try {
            val conn = openNeonConnection(cfg, "/api/drafts/${encodeThreadId(chatId)}", "GET")
            if (conn.responseCode == 404) return null
            if (conn.responseCode != 200) return null
            val body = JSONObject(conn.inputStream.bufferedReader().readText())
            if (!body.optBoolean("success", false)) return null
            parseDraftMessagesFromNeon(body)
        } catch (_: Throwable) {
            null
        }
    }

    private fun listDraftRowsFirebase(cfg: StorageConfig.Firebase): List<DraftRowMeta> {
        return try {
            val listUrl = URL("$FS_BASE/${cfg.projectId}/databases/(default)/documents/drafts?key=${cfg.apiKey}")
            val conn = listUrl.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 8000
            conn.readTimeout = 8000

            if (conn.responseCode != 200) return emptyList()
            val body = conn.inputStream.bufferedReader().readText()
            val data = JSONObject(body)
            val docs = data.optJSONArray("documents") ?: return emptyList()
            val rows = mutableListOf<DraftRowMeta>()
            for (i in 0 until docs.length()) {
                val doc = docs.getJSONObject(i)
                val name = doc.optString("name", "")
                if (name.isBlank()) continue
                val fields = doc.optJSONObject("fields")
                val contactName = fields?.optJSONObject("contactName")?.optString("stringValue", "")
                    ?.trim()?.takeIf { it.isNotEmpty() && it != "null" }
                val lastModified = fields?.optJSONObject("lastModified")
                    ?.optString("integerValue", "0")?.toLongOrNull() ?: 0L
                rows.add(DraftRowMeta(id = name.substringAfterLast('/'), contactName = contactName, lastModified = lastModified))
            }
            rows
        } catch (_: Throwable) {
            emptyList()
        }
    }

    private fun listDraftRowsNeon(cfg: StorageConfig.Neon): List<DraftRowMeta> {
        return try {
            val conn = openNeonConnection(cfg, "/api/drafts", "GET")
            if (conn.responseCode != 200) return emptyList()
            val body = JSONObject(conn.inputStream.bufferedReader().readText())
            if (!body.optBoolean("success", false)) return emptyList()
            val draftsObj = body.optJSONObject("drafts") ?: return emptyList()
            val rows = mutableListOf<DraftRowMeta>()
            for (id in draftsObj.keys()) {
                val row = draftsObj.optJSONObject(id) ?: continue
                val contactName = row.optString("contactName", "")
                    .trim().takeIf { it.isNotEmpty() && it != "null" }
                rows.add(DraftRowMeta(id = id, contactName = contactName, lastModified = row.optLong("lastModified", 0L)))
            }
            rows
        } catch (_: Throwable) {
            emptyList()
        }
    }

    private fun parseDraftMessagesFromFirestore(doc: JSONObject): List<Draft> {
        val fields = doc.optJSONObject("fields")
        val values = fields
            ?.optJSONObject("messages")
            ?.optJSONObject("arrayValue")
            ?.optJSONArray("values") ?: return emptyList()
        val lastModified = fields?.optJSONObject("lastModified")
            ?.optString("integerValue", "0")?.toLongOrNull() ?: 0L

        val list = mutableListOf<Draft>()
        for (i in 0 until values.length()) {
            val item = values.getJSONObject(i)
                .optJSONObject("mapValue")?.optJSONObject("fields") ?: continue
            val html = item.optJSONObject("html")?.optString("stringValue", "") ?: ""
            val ts = item.optJSONObject("timestamp")?.optString("integerValue", "0")?.toLongOrNull() ?: 0L
            list.add(Draft(html = html, timestamp = ts, lastModified = lastModified))
        }
        return list
    }

    private fun parseDraftMessagesFromNeon(doc: JSONObject): List<Draft> {
        val values = doc.optJSONArray("messages") ?: return emptyList()
        val lastModified = doc.optLong("lastModified", 0L)
        val list = mutableListOf<Draft>()
        for (i in 0 until values.length()) {
            val item = values.optJSONObject(i) ?: continue
            val html = item.optString("html", "")
            val ts = item.optLong("timestamp", 0L)
            list.add(Draft(html = html, timestamp = ts, lastModified = lastModified))
        }
        return list
    }

    suspend fun saveDraft(chatId: String, messages: List<Draft>, contactName: String? = null) = withContext(Dispatchers.IO) {
        when (val cfg = readConfig()) {
            is StorageConfig.Neon -> {
                val row = resolveMessengerRowNeon(cfg, chatId)
                val targetId = row?.id ?: chatId
                // never null out an existing row's contactName: name-based matching
                // depends on it. Caller's live display name wins, else keep stored.
                val effectiveName = contactName?.trim()?.takeIf { it.isNotEmpty() } ?: row?.contactName
                XposedBridge.log("$TAG save target=$targetId name='$effectiveName' (req=$chatId)")
                writeDraftDocNeon(cfg, targetId, messages, effectiveName)
            }
            is StorageConfig.Firebase -> {
                val row = resolveMessengerRowFirebase(cfg, chatId)
                writeDraftDocFirebase(cfg, row?.id ?: chatId, messages)
            }
            null -> Unit
        }
    }

    private fun resolveMessengerRowFirebase(cfg: StorageConfig.Firebase, chatId: String): DraftRowMeta? {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId) ?: return null
        val nameSlug = nameSlugMatch.groupValues[1]
        return pickBestRow(listDraftRowsFirebase(cfg), nameSlug)
    }

    private fun resolveMessengerRowNeon(cfg: StorageConfig.Neon, chatId: String): DraftRowMeta? {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId) ?: return null
        val nameSlug = nameSlugMatch.groupValues[1]
        return pickBestRow(listDraftRowsNeon(cfg), nameSlug)
    }

    private fun writeDraftDocFirebase(cfg: StorageConfig.Firebase, chatId: String, messages: List<Draft>) {
        val url = URL(docUrl(cfg, "drafts/$chatId"))
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
        conn.responseCode
    }

    private fun writeDraftDocNeon(cfg: StorageConfig.Neon, chatId: String, messages: List<Draft>, contactName: String?) {
        val conn = openNeonConnection(cfg, "/api/drafts/${encodeThreadId(chatId)}", "PUT")
        conn.doOutput = true

        val msgsArray = JSONArray()
        messages.forEach { m ->
            msgsArray.put(JSONObject().apply {
                put("html", m.html)
                put("timestamp", m.timestamp)
            })
        }

        val body = JSONObject().apply {
            put("messages", msgsArray)
            put("contactName", contactName ?: JSONObject.NULL)
        }

        OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
        conn.responseCode
    }

    suspend fun deleteDraft(chatId: String) = withContext(Dispatchers.IO) {
        when (val cfg = readConfig()) {
            is StorageConfig.Neon -> {
                val targetId = resolveMessengerRowNeon(cfg, chatId)?.id ?: chatId
                val conn = openNeonConnection(cfg, "/api/drafts/${encodeThreadId(targetId)}", "DELETE")
                conn.responseCode
            }
            is StorageConfig.Firebase -> {
                val targetId = resolveMessengerRowFirebase(cfg, chatId)?.id ?: chatId
                val url = URL(docUrl(cfg, "drafts/$targetId"))
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "DELETE"
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.responseCode
            }
            null -> Unit
        }
    }

    suspend fun editDraftByTimestamp(chatId: String, timestamp: Long, newHtml: String) = withContext(Dispatchers.IO) {
        val existing = getDraft(chatId)
        val updated = existing.map { draft ->
            if (draft.timestamp == timestamp) draft.copy(html = newHtml) else draft
        }
        saveDraft(chatId, updated)
    }

    suspend fun deleteDraftByTimestamp(chatId: String, timestamp: Long) = withContext(Dispatchers.IO) {
        val existing = getDraft(chatId)
        val updated = existing.filter { it.timestamp != timestamp }
        if (updated.isEmpty()) {
            deleteDraft(chatId)
        } else {
            saveDraft(chatId, updated)
        }
    }

    suspend fun getSettings(): JSONObject = withContext(Dispatchers.IO) {
        when (val cfg = readConfig()) {
            is StorageConfig.Neon -> {
                try {
                    val conn = openNeonConnection(cfg, "/api/settings", "GET")
                    if (conn.responseCode != 200) return@withContext JSONObject()
                    val body = JSONObject(conn.inputStream.bufferedReader().readText())
                    val settings = body.optJSONObject("settings") ?: return@withContext JSONObject()
                    val uiPositions = settings.optJSONObject("uiPositions") ?: JSONObject()
                    return@withContext uiPositions
                } catch (_: Throwable) {
                    return@withContext JSONObject()
                }
            }
            is StorageConfig.Firebase -> {
                try {
                    val url = URL(docUrl(cfg, "settings/user"))
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
                    return@withContext JSONObject(raw)
                } catch (_: Throwable) {
                    return@withContext JSONObject()
                }
            }
            null -> JSONObject()
        }
    }

    suspend fun saveSettings(uiPositions: JSONObject) = withContext(Dispatchers.IO) {
        when (val cfg = readConfig()) {
            is StorageConfig.Neon -> {
                val conn = openNeonConnection(cfg, "/api/settings", "PUT")
                conn.doOutput = true
                val body = JSONObject().apply {
                    put("uiPositions", uiPositions)
                }
                OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
                conn.responseCode
            }
            is StorageConfig.Firebase -> {
                val url = URL(docUrl(cfg, "settings/user"))
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
            null -> Unit
        }
    }
}