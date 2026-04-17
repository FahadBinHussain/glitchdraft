package com.fahad.glitchdraft.lsposed.ui

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.fahad.glitchdraft.lsposed.R
import org.json.JSONException
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val PREFS_NAME = "glitchdraft_module_prefs"
        private const val KEY_PROJECT_ID = "firebase_project_id"
        private const val KEY_API_KEY = "firebase_api_key"
        private const val KEY_NEON_API_BASE_URL = "neon_api_base_url"
        private const val KEY_NEON_API_KEY = "neon_api_key"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        val tvStatus = findViewById<TextView>(R.id.tv_status)
        val etConfig = findViewById<EditText>(R.id.et_firebase_config)
        val btnSave = findViewById<Button>(R.id.btn_save)
        val etNeonConfig = findViewById<EditText>(R.id.et_neon_config)
        val btnSaveNeon = findViewById<Button>(R.id.btn_save_neon)

        val savedProject = prefs.getString(KEY_PROJECT_ID, null)
        val savedNeonApiBaseUrl = prefs.getString(KEY_NEON_API_BASE_URL, null)
        updateStatus(tvStatus, savedProject, savedNeonApiBaseUrl)

        btnSave.setOnClickListener {
            val raw = etConfig.text?.toString()?.trim() ?: ""
            if (raw.isEmpty()) {
                Toast.makeText(this, "Paste Firebase config JSON first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            try {
                val json = JSONObject(raw)
                val projectId = json.getString("projectId")
                val apiKey = json.getString("apiKey")

                prefs.edit()
                    .putString(KEY_PROJECT_ID, projectId)
                    .putString(KEY_API_KEY, apiKey)
                    .commit()

                updateStatus(tvStatus, projectId, prefs.getString(KEY_NEON_API_BASE_URL, null))
                etConfig.setText("")
                Toast.makeText(this, "Firebase saved! Force-stop target apps to apply.", Toast.LENGTH_LONG).show()
            } catch (e: JSONException) {
                Toast.makeText(this, "Invalid Firebase JSON: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        btnSaveNeon.setOnClickListener {
            val raw = etNeonConfig.text?.toString()?.trim() ?: ""
            if (raw.isEmpty()) {
                Toast.makeText(this, "Paste Neon backend JSON first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            try {
                val json = JSONObject(raw)
                val apiBaseUrl = json.getString("apiBaseUrl").trim().trimEnd('/')
                val apiKey = json.getString("apiKey").trim()

                if (apiBaseUrl.startsWith("postgresql://", ignoreCase = true)) {
                    Toast.makeText(this, "Use backend URL, not postgresql:// connection string", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }

                if (apiBaseUrl.isBlank() || apiKey.isBlank()) {
                    Toast.makeText(this, "apiBaseUrl and apiKey are required", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }

                prefs.edit()
                    .putString(KEY_NEON_API_BASE_URL, apiBaseUrl)
                    .putString(KEY_NEON_API_KEY, apiKey)
                    .commit()

                updateStatus(tvStatus, prefs.getString(KEY_PROJECT_ID, null), apiBaseUrl)
                etNeonConfig.setText("")
                Toast.makeText(this, "Neon saved! Force-stop target apps to apply.", Toast.LENGTH_LONG).show()
            } catch (e: JSONException) {
                Toast.makeText(this, "Invalid Neon JSON: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun updateStatus(tv: TextView?, projectId: String?, neonApiBaseUrl: String?) {
        tv ?: return
        if (!neonApiBaseUrl.isNullOrBlank()) {
            tv.text = "Configured - Using Neon backend: $neonApiBaseUrl"
            tv.setTextColor(0xFF2E7D32.toInt())
        } else if (!projectId.isNullOrBlank()) {
            tv.text = "Configured - Using Firebase project: $projectId"
            tv.setTextColor(0xFF2E7D32.toInt())
        } else {
            tv.text = "Not configured - paste Firebase JSON or Neon backend JSON below"
            tv.setTextColor(0xFFE65100.toInt())
        }
    }
}