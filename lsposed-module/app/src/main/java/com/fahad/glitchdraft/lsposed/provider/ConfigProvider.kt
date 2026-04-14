package com.fahad.glitchdraft.lsposed.provider

import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri

/**
 * ConfigProvider
 *
 * A ContentProvider that exposes the module's Firebase configuration
 * (projectId and apiKey) to other processes (e.g. the hooked Messenger process).
 *
 * This is the standard Android IPC mechanism used to share data between
 * different APK processes securely.
 *
 * Query URI:
 *   content://com.fahad.glitchdraft.lsposed.config/firebase
 *
 * Returns a single row with columns:
 *   - "project_id"  → String
 *   - "api_key"     → String
 */
class ConfigProvider : ContentProvider() {

    companion object {
        const val AUTHORITY = "com.fahad.glitchdraft.lsposed.config"
        const val PATH_FIREBASE = "firebase"
        val CONTENT_URI: Uri = Uri.parse("content://$AUTHORITY/$PATH_FIREBASE")

        const val COL_PROJECT_ID = "project_id"
        const val COL_API_KEY = "api_key"
        const val COL_NEON_API_BASE_URL = "neon_api_base_url"
        const val COL_NEON_API_KEY = "neon_api_key"

        private const val PREFS_NAME = "glitchdraft_module_prefs"
        private const val KEY_PROJECT_ID = "firebase_project_id"
        private const val KEY_API_KEY = "firebase_api_key"
        private const val KEY_NEON_API_BASE_URL = "neon_api_base_url"
        private const val KEY_NEON_API_KEY = "neon_api_key"

        private val URI_MATCHER = UriMatcher(UriMatcher.NO_MATCH).also {
            it.addURI(AUTHORITY, PATH_FIREBASE, 1)
        }
    }

    override fun onCreate(): Boolean = true

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor? {
        if (URI_MATCHER.match(uri) != 1) return null

        val ctx = context ?: return null
        val prefs = ctx.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
        val projectId = prefs.getString(KEY_PROJECT_ID, null) ?: ""
        val apiKey = prefs.getString(KEY_API_KEY, null) ?: ""
        val neonApiBaseUrl = prefs.getString(KEY_NEON_API_BASE_URL, null) ?: ""
        val neonApiKey = prefs.getString(KEY_NEON_API_KEY, null) ?: ""

        val cursor = MatrixCursor(
            arrayOf(
                COL_PROJECT_ID,
                COL_API_KEY,
                COL_NEON_API_BASE_URL,
                COL_NEON_API_KEY
            )
        )
        cursor.addRow(arrayOf(projectId, apiKey, neonApiBaseUrl, neonApiKey))
        return cursor
    }

    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
