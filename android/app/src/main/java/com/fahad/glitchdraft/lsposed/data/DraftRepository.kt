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

    data class Draft(val html: String, val timestamp: Long)

    companion object {
        private const val FS_BASE = "https://firestore.googleapis.com/v1/projects"
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
            val allDocs = listAllDraftIdsFirebase(cfg)
            val matchedId = allDocs.firstOrNull { docId ->
                docId.matches(Regex("^messenger_(web|android)_.*")) && docId.endsWith("_$nameSlug")
            }
            if (matchedId != null) {
                XposedBridge.log("[DraftRepo] Name-slug match: $chatId -> $matchedId")
                val result = fetchDraftDocFirebase(cfg, matchedId)
                if (result != null) return result
            }
            return emptyList()
        }

        return fetchDraftDocFirebase(cfg, chatId) ?: emptyList()
    }

    private fun getDraftFromNeon(cfg: StorageConfig.Neon, chatId: String): List<Draft> {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId)
        if (nameSlugMatch != null) {
            val nameSlug = nameSlugMatch.groupValues[1]
            val allIds = listAllDraftIdsNeon(cfg)
            val matchedId = allIds.firstOrNull { docId ->
                docId.matches(Regex("^messenger_(web|android)_.*")) && docId.endsWith("_$nameSlug")
            }
            if (matchedId != null) {
                val result = fetchDraftDocNeon(cfg, matchedId)
                if (result != null) return result
            }
            return emptyList()
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

    private fun listAllDraftIdsFirebase(cfg: StorageConfig.Firebase): List<String> {
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
            val ids = mutableListOf<String>()
            for (i in 0 until docs.length()) {
                val name = docs.getJSONObject(i).optString("name", "")
                if (name.isNotBlank()) ids.add(name.substringAfterLast('/'))
            }
            ids
        } catch (_: Throwable) {
            emptyList()
        }
    }

    private fun listAllDraftIdsNeon(cfg: StorageConfig.Neon): List<String> {
        return try {
            val conn = openNeonConnection(cfg, "/api/drafts", "GET")
            if (conn.responseCode != 200) return emptyList()
            val body = JSONObject(conn.inputStream.bufferedReader().readText())
            if (!body.optBoolean("success", false)) return emptyList()
            val draftsObj = body.optJSONObject("drafts") ?: return emptyList()
            draftsObj.keys().asSequence().toList()
        } catch (_: Throwable) {
            emptyList()
        }
    }

    private fun parseDraftMessagesFromFirestore(doc: JSONObject): List<Draft> {
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

    private fun parseDraftMessagesFromNeon(doc: JSONObject): List<Draft> {
        val values = doc.optJSONArray("messages") ?: return emptyList()
        val list = mutableListOf<Draft>()
        for (i in 0 until values.length()) {
            val item = values.optJSONObject(i) ?: continue
            val html = item.optString("html", "")
            val ts = item.optLong("timestamp", 0L)
            list.add(Draft(html = html, timestamp = ts))
        }
        return list
    }

    suspend fun saveDraft(chatId: String, messages: List<Draft>) = withContext(Dispatchers.IO) {
        when (val cfg = readConfig()) {
            is StorageConfig.Neon -> {
                val resolvedId = resolveMessengerIdNeon(cfg, chatId) ?: chatId
                writeDraftDocNeon(cfg, resolvedId, messages)
            }
            is StorageConfig.Firebase -> {
                val resolvedId = resolveMessengerIdFirebase(cfg, chatId) ?: chatId
                writeDraftDocFirebase(cfg, resolvedId, messages)
            }
            null -> Unit
        }
    }

    private fun resolveMessengerIdFirebase(cfg: StorageConfig.Firebase, chatId: String): String? {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId) ?: return null
        val nameSlug = nameSlugMatch.groupValues[1]
        val allDocs = listAllDraftIdsFirebase(cfg)
        return allDocs.firstOrNull { docId ->
            docId.matches(Regex("^messenger_(web|android)_.*")) && docId.endsWith("_$nameSlug")
        }
    }

    private fun resolveMessengerIdNeon(cfg: StorageConfig.Neon, chatId: String): String? {
        val nameSlugMatch = Regex("^messenger_(?:web|android)_\\d+_(.+)$").find(chatId) ?: return null
        val nameSlug = nameSlugMatch.groupValues[1]
        val allDocs = listAllDraftIdsNeon(cfg)
        return allDocs.firstOrNull { docId ->
            docId.matches(Regex("^messenger_(web|android)_.*")) && docId.endsWith("_$nameSlug")
        }
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

    private fun writeDraftDocNeon(cfg: StorageConfig.Neon, chatId: String, messages: List<Draft>) {
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
            put("contactName", JSONObject.NULL)
        }

        OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
        conn.responseCode
    }

    suspend fun deleteDraft(chatId: String) = withContext(Dispatchers.IO) {
        when (val cfg = readConfig()) {
            is StorageConfig.Neon -> {
                val resolvedId = resolveMessengerIdNeon(cfg, chatId) ?: chatId
                val conn = openNeonConnection(cfg, "/api/drafts/${encodeThreadId(resolvedId)}", "DELETE")
                conn.responseCode
            }
            is StorageConfig.Firebase -> {
                val resolvedId = resolveMessengerIdFirebase(cfg, chatId) ?: chatId
                val url = URL(docUrl(cfg, "drafts/$resolvedId"))
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