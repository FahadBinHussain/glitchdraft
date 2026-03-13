package com.fahad.glitchdraft.lsposed.overlay

import android.annotation.SuppressLint
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.BitmapDrawable
import android.util.Base64
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.fahad.glitchdraft.lsposed.R
import com.fahad.glitchdraft.lsposed.data.DraftRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * FloatingOverlayService
 *
 * Draws a persistent system-window overlay (SYSTEM_ALERT_WINDOW) on top of
 * any app in scope.  It renders two views:
 *
 *  1. A small floating toggle button (mimics the extension's saved-messages-toggle)
 *  2. A draggable GlitchDraft panel (mimics the extension's saved-messages-container)
 *
 * Lifecycle:
 *  - Started by GlitchDraftHook when the hooked app's first Activity is created.
 *  - Stopped when the hooked app's process dies or the module is disabled.
 *
 * The panel talks to Firestore through DraftRepository (a Kotlin port of
 * firestoreService.js + background.js) so drafts are synced identically to
 * the browser extension.
 */
class FloatingOverlayService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var toggleBtn: View
    private lateinit var panel: View

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // Drag state
    private var toggleInitX = 0; private var toggleInitY = 0
    private var toggleTouchX = 0f; private var toggleTouchY = 0f
    private var panelInitX = 0; private var panelInitY = 0
    private var panelTouchX = 0f; private var panelTouchY = 0f

    private var isPanelVisible = false
    private val repo by lazy { DraftRepository(applicationContext) }

    companion object {
        const val EXTRA_CHAT_ID = "chat_id"
        const val EXTRA_PACKAGE = "package_name"
    }

    // -------------------------------------------------------------------------
    // Service lifecycle
    // -------------------------------------------------------------------------

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        buildToggleButton()
        buildPanel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Re-show if killed and restarted
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        runCatching { windowManager.removeView(toggleBtn) }
        runCatching { windowManager.removeView(panel) }
    }

    // -------------------------------------------------------------------------
    // Build toggle button (floating FAB)
    // -------------------------------------------------------------------------

    @SuppressLint("ClickableViewAccessibility")
    private fun buildToggleButton() {
        toggleBtn = LayoutInflater.from(this).inflate(R.layout.overlay_toggle, null)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.END
            x = 24; y = 24
        }

        windowManager.addView(toggleBtn, params)

        toggleBtn.setOnTouchListener(object : View.OnTouchListener {
            var moved = false
            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        moved = false
                        toggleInitX = params.x; toggleInitY = params.y
                        toggleTouchX = event.rawX; toggleTouchY = event.rawY
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (toggleTouchX - event.rawX).toInt()
                        val dy = (event.rawY - toggleTouchY).toInt()
                        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true
                        params.x = toggleInitX + dx
                        params.y = toggleInitY + dy
                        windowManager.updateViewLayout(toggleBtn, params)
                    }
                    MotionEvent.ACTION_UP -> {
                        if (!moved) togglePanelVisibility()
                    }
                }
                return true
            }
        })
    }

    // -------------------------------------------------------------------------
    // Build GlitchDraft panel
    // -------------------------------------------------------------------------

    @SuppressLint("ClickableViewAccessibility")
    private fun buildPanel() {
        panel = LayoutInflater.from(this).inflate(R.layout.overlay_panel, null)

        val params = WindowManager.LayoutParams(
            dpToPx(320),
            dpToPx(480),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.END
            x = 24; y = 80
        }

        panel.visibility = View.GONE
        windowManager.addView(panel, params)

        // Close button
        panel.findViewById<View>(R.id.btn_close)?.setOnClickListener {
            togglePanelVisibility()
        }

        // Drag handle (header)
        val header = panel.findViewById<View>(R.id.panel_header)
        header?.setOnTouchListener(object : View.OnTouchListener {
            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        panelInitX = params.x; panelInitY = params.y
                        panelTouchX = event.rawX; panelTouchY = event.rawY
                    }
                    MotionEvent.ACTION_MOVE -> {
                        params.x = panelInitX + (panelTouchX - event.rawX).toInt()
                        params.y = panelInitY + (event.rawY - panelTouchY).toInt()
                        windowManager.updateViewLayout(panel, params)
                    }
                }
                return true
            }
        })

        // Save button
        panel.findViewById<View>(R.id.btn_save_draft)?.setOnClickListener {
            saveDraftFromPanel()
        }
    }

    // -------------------------------------------------------------------------
    // Panel toggle
    // -------------------------------------------------------------------------

    private fun togglePanelVisibility() {
        isPanelVisible = !isPanelVisible
        panel.visibility = if (isPanelVisible) View.VISIBLE else View.GONE

        if (isPanelVisible) {
            loadDraftsIntoPanel()
        }
    }

    // -------------------------------------------------------------------------
    // Draft operations (delegated to DraftRepository)
    // -------------------------------------------------------------------------

    private fun loadDraftsIntoPanel() {
        val chatId = currentChatId() ?: return
        val listContainer = panel.findViewById<LinearLayout>(R.id.draft_list) ?: return
        listContainer.removeAllViews()

        serviceScope.launch {
                val drafts = repo.getDraft(chatId)
                listContainer.removeAllViews()
                if (drafts.isEmpty()) {
                    val empty = TextView(this@FloatingOverlayService).apply {
                        text = "No saved drafts for this chat"
                        setTextColor(Color.parseColor("#65676B"))
                        textSize = 13f
                        setPadding(8, 8, 8, 8)
                    }
                    listContainer.addView(empty)
                } else {
                    drafts.forEach { draft -> addDraftItemView(listContainer, draft, chatId) }
                }
            }
    }
    private fun addDraftItemView(
        container: LinearLayout,
        draft: DraftRepository.Draft,
        chatId: String
    ) {
        val item = LayoutInflater.from(this).inflate(R.layout.overlay_draft_item, container, false)
        val plainText = htmlToPlainText(draft.html)

        item.findViewById<TextView>(R.id.tv_draft_content)?.text =
            htmlToDisplaySpanned(draft.html)

        val displayGroup = item.findViewById<View>(R.id.group_display)
        val editGroup    = item.findViewById<View>(R.id.group_edit)
        val editInput    = item.findViewById<EditText>(R.id.et_edit_draft)

        // USE: copy to clipboard (service runs in module process, cannot access target app views)
        item.findViewById<View>(R.id.btn_use_draft)?.setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("draft", plainText))
            Toast.makeText(this, "Copied – paste in your message", Toast.LENGTH_SHORT).show()
        }

        // COPY: copy plain text to clipboard
        item.findViewById<View>(R.id.btn_copy_draft)?.setOnClickListener {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("draft", plainText))
            Toast.makeText(this, "Draft copied to clipboard", Toast.LENGTH_SHORT).show()
        }

        // EDIT: show edit group, hide display group
        item.findViewById<View>(R.id.btn_edit_draft)?.setOnClickListener {
            editInput?.setText(plainText)
            displayGroup?.visibility = View.GONE
            editGroup?.visibility = View.VISIBLE
            editInput?.requestFocus()
        }

        // DELETE: remove only this draft by timestamp
        item.findViewById<View>(R.id.btn_delete_draft)?.setOnClickListener {
            serviceScope.launch {
                repo.deleteDraftByTimestamp(chatId, draft.timestamp)
                loadDraftsIntoPanel()
            }
        }

        // SAVE EDIT: write updated html back to Firestore
        item.findViewById<View>(R.id.btn_save_edit)?.setOnClickListener {
            val newText = editInput?.text?.toString()?.trim() ?: return@setOnClickListener
            if (newText.isEmpty()) return@setOnClickListener
            val newHtml = newText.replace("\n", "<br>")
            serviceScope.launch {
                repo.editDraftByTimestamp(chatId, draft.timestamp, newHtml)
                loadDraftsIntoPanel()
            }
        }

        // CANCEL EDIT: revert to display mode
        item.findViewById<View>(R.id.btn_cancel_edit)?.setOnClickListener {
            editGroup?.visibility = View.GONE
            displayGroup?.visibility = View.VISIBLE
        }

        container.addView(item)
    }

    private fun saveDraftFromPanel() {
        val chatId = currentChatId() ?: return
        val input = panel.findViewById<EditText>(R.id.et_draft_input) ?: return
        val text = input.text.toString().trim()
        if (text.isEmpty()) return

        serviceScope.launch {
            val existing = repo.getDraft(chatId).toMutableList()
            existing.add(DraftRepository.Draft(html = text, timestamp = System.currentTimeMillis()))
            repo.saveDraft(chatId, existing)
            input.text.clear()
            loadDraftsIntoPanel()
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Converts [html] to a [android.text.Spanned] for display in a [TextView].
     * Every `<img>` is rendered as a small grey placeholder rectangle so images
     * never appear as invisible zero-size boxes.
     */
    private fun htmlToDisplaySpanned(html: String): android.text.Spanned {
        val imageGetter = android.text.Html.ImageGetter { source ->
            if (source != null && source.startsWith("data:")) {
                try {
                    // data:[<mime>][;base64],<data>
                    val commaIdx = source.indexOf(',')
                    if (commaIdx >= 0) {
                        val base64Data = source.substring(commaIdx + 1)
                        val bytes = Base64.decode(base64Data, Base64.DEFAULT)
                        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        if (bitmap != null) {
                            // Scale down to at most 240px wide so it fits inside the panel
                            val maxPx = (240 * resources.displayMetrics.density).toInt()
                            val origW = bitmap.width
                            val origH = bitmap.height
                            val (dw, dh) = if (origW > maxPx) {
                                maxPx to (origH.toLong() * maxPx / origW).toInt()
                            } else {
                                origW to origH
                            }
                            return@ImageGetter BitmapDrawable(resources, bitmap).also {
                                it.setBounds(0, 0, dw, dh)
                            }
                        }
                    }
                } catch (_: Throwable) { /* fall through to placeholder */ }
            }
            // Fallback: grey placeholder rectangle
            android.graphics.drawable.ColorDrawable(0xFFCCCCCC.toInt()).also {
                it.setBounds(0, 0, 48, 48)
            }
        }
        return android.text.Html.fromHtml(
            html,
            android.text.Html.FROM_HTML_MODE_COMPACT,
            imageGetter,
            null
        )
    }

    /**
     * Strips [html] to plain text. Every `<img>` tag is replaced with a 🖼
     * placeholder so images are acknowledged and the \uFFFC object-replacement
     * character (which shows as "obj" or an empty box) is never produced.
     */
    private fun htmlToPlainText(html: String): String {
        val withoutImages = html.replace(
            Regex("<img[^>]*>", setOf(RegexOption.IGNORE_CASE)), ""
        )
        return android.text.Html.fromHtml(
            withoutImages,
            android.text.Html.FROM_HTML_MODE_COMPACT
        ).toString().trim()
    }

    /** Returns the current chat ID stored in SharedPreferences by the hook */
    private fun currentChatId(): String? =
        getSharedPreferences("glitchdraft_hook_state", MODE_PRIVATE)
            .getString("current_chat_id", null)

    private fun dpToPx(dp: Int): Int =
        (dp * resources.displayMetrics.density).toInt()
}
