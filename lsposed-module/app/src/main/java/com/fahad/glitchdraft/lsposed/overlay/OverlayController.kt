package com.fahad.glitchdraft.lsposed.overlay

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.fahad.glitchdraft.lsposed.data.DraftRepository
import de.robv.android.xposed.XposedBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * OverlayController
 *
 * Draws the GlitchDraft floating icon + panel entirely in-process inside the
 * hooked app (e.g. Messenger) using the app's own WindowManager.
 *
 * All views are built programmatically so we never touch the host app's
 * Resources or the module's R class from within the hooked process.
 *
 * Usage:
 *   OverlayController.attach(activity, packageName)   — called from hook
 *   OverlayController.detach()                        — called on service stop
 */
@SuppressLint("ClickableViewAccessibility")
object OverlayController {

    private const val TAG = "GlitchDraft-Overlay"

    // Accent colour that matches the extension
    private const val ACCENT  = 0xFF0084FF.toInt()
    private const val WHITE   = Color.WHITE
    private const val GREY_TXT = 0xFF65676B.toInt()

    private var windowManager: WindowManager? = null
    private var toggleView: View? = null
    private var panelView: View? = null
    private var draftList: LinearLayout? = null
    private var draftInput: EditText? = null
    private var chatIdLabel: TextView? = null   // debug label in panel header

    /** Icon bitmap loaded from module assets — set via setIcon() before attach(). */
    private var iconBitmap: Bitmap? = null

    fun setIcon(bitmap: Bitmap) { iconBitmap = bitmap }

    private var isPanelVisible = false
    private var isAttached = false

    private var scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var repo: DraftRepository? = null
    private var currentPackage: String = ""

    // ----- drag state --------------------------------------------------------
    private var togInitX = 0; private var togInitY = 0
    private var togTouchX = 0f; private var togTouchY = 0f
    private var panInitX = 0; private var panInitY = 0
    private var panTouchX = 0f; private var panTouchY = 0f

    // ----- stored window params for position persistence -------------------
    private var toggleParams: WindowManager.LayoutParams? = null
    private var panelParams: WindowManager.LayoutParams? = null

    // Debounce handler for position saves
    private val savePositionHandler = Handler(Looper.getMainLooper())
    private val savePositionRunnable = Runnable { persistPositions() }

    // -------------------------------------------------------------------------

    fun isAttached() = isAttached

    /**
     * Attach overlay to the given Activity.  Safe to call on every onResume —
     * will no-op if already attached.
     */
    fun attach(activity: Activity, packageName: String) {
        if (isAttached) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            !Settings.canDrawOverlays(activity)
        ) {
            XposedBridge.log("$TAG: overlay permission not granted — skipping attach")
            return
        }

        try {
            currentPackage = packageName
            windowManager = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager

            // DraftRepository reads from module's device-protected prefs.
            repo = DraftRepository(activity.applicationContext)

            // Load saved positions asynchronously, then build UI
            scope.launch {
                val savedPositions = try { repo!!.getSettings() } catch (_: Throwable) { null }
                val togX = savedPositions?.optJSONObject("android_toggle")?.optInt("x", -1) ?: -1
                val togY = savedPositions?.optJSONObject("android_toggle")?.optInt("y", -1) ?: -1
                val panX = savedPositions?.optJSONObject("android_panel")?.optInt("x", -1) ?: -1
                val panY = savedPositions?.optJSONObject("android_panel")?.optInt("y", -1) ?: -1
                Handler(Looper.getMainLooper()).post {
                    buildToggle(activity, if (togX >= 0) togX else -1, if (togY >= 0) togY else -1)
                    buildPanel(activity, if (panX >= 0) panX else -1, if (panY >= 0) panY else -1)
                    isAttached = true
                    XposedBridge.log("$TAG: Overlay attached for $packageName (togPos=$togX,$togY panPos=$panX,$panY)")
                }
            }
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: attach failed: $e")
        }
    }

    fun detach() {
        scope.cancel()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        runCatching { windowManager?.removeView(toggleView) }
        runCatching { windowManager?.removeView(panelView) }
        windowManager = null
        toggleView = null
        panelView = null
        draftList = null
        draftInput = null
        chatIdLabel = null
        isAttached = false
    }

    /** Hide the toggle button (and panel) when the target app loses focus. */
    fun hide() {
        Handler(Looper.getMainLooper()).post {
            toggleView?.visibility = View.GONE
            if (isPanelVisible) {
                panelView?.visibility = View.GONE
            }
        }
    }

    /** Show the toggle button again when the target app regains focus. */
    fun show() {
        Handler(Looper.getMainLooper()).post {
            toggleView?.visibility = View.VISIBLE
            if (isPanelVisible) {
                panelView?.visibility = View.VISIBLE
            }
        }
    }

    // -------------------------------------------------------------------------
    // Build floating toggle button
    // -------------------------------------------------------------------------

    private fun buildToggle(ctx: Context, savedX: Int = -1, savedY: Int = -1) {
        val size = dp(ctx, 50)

        // Circle background
        val bg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(ACCENT)
        }

        val frame = FrameLayout(ctx).apply {
            layoutParams = ViewGroup.LayoutParams(size, size)
            background = bg
            elevation = 8f
        }

        val icon = iconBitmap
        if (icon != null) {
            // Use the extension PNG icon
            val iv = ImageView(ctx).apply {
                setImageBitmap(icon)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                val padding = dp(ctx, 8)
                setPadding(padding, padding, padding, padding)
            }
            frame.addView(iv, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ).also { it.gravity = Gravity.CENTER })
        } else {
            // Fallback: pencil emoji
            val label = TextView(ctx).apply {
                text = "📝"
                textSize = 22f
                gravity = Gravity.CENTER
            }
            frame.addView(label, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ).also { it.gravity = Gravity.CENTER })
        }

        val params = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (savedX >= 0) savedX else dp(ctx, 16)
            y = if (savedY >= 0) savedY else dp(ctx, 300)
        }
        toggleParams = params

        frame.setOnTouchListener(object : View.OnTouchListener {
            var hasMoved = false
            override fun onTouch(v: View, ev: MotionEvent): Boolean {
                when (ev.action) {
                    MotionEvent.ACTION_DOWN -> {
                        hasMoved = false
                        togInitX = params.x; togInitY = params.y
                        togTouchX = ev.rawX;  togTouchY = ev.rawY
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (ev.rawX - togTouchX).toInt()
                        val dy = (ev.rawY - togTouchY).toInt()
                        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) hasMoved = true
                        params.x = (togInitX + dx).coerceAtLeast(0)
                        params.y = (togInitY + dy).coerceAtLeast(0)
                        windowManager?.updateViewLayout(frame, params)
                    }
                    MotionEvent.ACTION_UP -> {
                        if (!hasMoved) togglePanel()
                        else scheduleSavePositions()  // save after drag ends
                    }
                }
                return true
            }
        })

        windowManager?.addView(frame, params)
        toggleView = frame
    }

    // -------------------------------------------------------------------------
    // Build GlitchDraft panel
    // -------------------------------------------------------------------------

    private fun buildPanel(ctx: Context, savedX: Int = -1, savedY: Int = -1) {
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(WHITE)
                cornerRadius = dp(ctx, 12).toFloat()
            }
            background = bg
            elevation = 12f
        }

        // --- Header (drag handle) ---
        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ACCENT)
            setPadding(dp(ctx, 10), dp(ctx, 8), dp(ctx, 10), dp(ctx, 6))
        }

        // Title row (title + close button)
        val titleRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val title = TextView(ctx).apply {
            text = "📝 GlitchDraft"
            setTextColor(WHITE)
            textSize = 15f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        titleRow.addView(title, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        val closeBtn = TextView(ctx).apply {
            text = "✕"
            setTextColor(WHITE)
            textSize = 18f
            setPadding(dp(ctx, 8), dp(ctx, 4), dp(ctx, 4), dp(ctx, 4))
        }
        titleRow.addView(closeBtn)
        header.addView(titleRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // Debug subtitle: current chat ID / scope key
        chatIdLabel = TextView(ctx).apply {
            text = chatIdDebugText()
            setTextColor(0xCCFFFFFF.toInt())
            textSize = 10f
            setPadding(0, 2, 0, 0)
        }
        header.addView(chatIdLabel, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        root.addView(header, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // --- Draft list ---
        val scroll = ScrollView(ctx)
        draftList = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 8), dp(ctx, 4), dp(ctx, 8), dp(ctx, 4))
        }
        scroll.addView(draftList, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        root.addView(scroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        // --- Input row ---
        val inputRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(ctx, 8), dp(ctx, 6), dp(ctx, 8), dp(ctx, 6))
            setBackgroundColor(0xFFF0F0F0.toInt())
        }

        draftInput = EditText(ctx).apply {
            hint = "Type a draft…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            maxLines = 3
            setTextColor(Color.BLACK)
            setHintTextColor(GREY_TXT)
            textSize = 13f
            setPadding(dp(ctx, 8), dp(ctx, 6), dp(ctx, 8), dp(ctx, 6))
            val etBg = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(WHITE)
                cornerRadius = dp(ctx, 6).toFloat()
            }
            background = etBg
        }
        inputRow.addView(draftInput!!, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        val saveBtn = TextView(ctx).apply {
            text = "💾"
            textSize = 20f
            gravity = Gravity.CENTER
            setPadding(dp(ctx, 10), 0, dp(ctx, 4), 0)
        }
        inputRow.addView(saveBtn)
        root.addView(inputRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // --- Window params ---
        val params = WindowManager.LayoutParams(
            dp(ctx, 320), dp(ctx, 460),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (savedX >= 0) savedX else dp(ctx, 20)
            y = if (savedY >= 0) savedY else dp(ctx, 200)
        }
        panelParams = params

        root.visibility = View.GONE
        windowManager?.addView(root, params)
        panelView = root

        // --- Listeners ---
        closeBtn.setOnClickListener { togglePanel() }

        header.setOnTouchListener(object : View.OnTouchListener {
            override fun onTouch(v: View, ev: MotionEvent): Boolean {
                when (ev.action) {
                    MotionEvent.ACTION_DOWN -> {
                        panInitX = params.x; panInitY = params.y
                        panTouchX = ev.rawX;  panTouchY = ev.rawY
                    }
                    MotionEvent.ACTION_MOVE -> {
                        params.x = (panInitX + (ev.rawX - panTouchX).toInt()).coerceAtLeast(0)
                        params.y = (panInitY + (ev.rawY - panTouchY).toInt()).coerceAtLeast(0)
                        windowManager?.updateViewLayout(root, params)
                    }
                    MotionEvent.ACTION_UP -> {
                        scheduleSavePositions()  // save after panel drag ends
                    }
                }
                return true
            }
        })

        saveBtn.setOnClickListener { saveDraft(ctx) }
    }

    // -------------------------------------------------------------------------
    // Toggle visibility
    // -------------------------------------------------------------------------

    private fun togglePanel() {
        isPanelVisible = !isPanelVisible
        panelView?.visibility = if (isPanelVisible) View.VISIBLE else View.GONE
        if (isPanelVisible) {
            chatIdLabel?.text = chatIdDebugText()
            loadDrafts()
        }
    }

    // -------------------------------------------------------------------------
    // Draft operations
    // -------------------------------------------------------------------------

    private fun scheduleSavePositions() {
        savePositionHandler.removeCallbacks(savePositionRunnable)
        savePositionHandler.postDelayed(savePositionRunnable, 500L)
    }

    private fun persistPositions() {
        val tp = toggleParams ?: return
        val pp = panelParams ?: return
        scope.launch {
            try {
                val current = repo?.getSettings() ?: JSONObject()
                current.put("android_toggle", JSONObject().apply { put("x", tp.x); put("y", tp.y) })
                current.put("android_panel", JSONObject().apply { put("x", pp.x); put("y", pp.y) })
                repo?.saveSettings(current)
                XposedBridge.log("$TAG: Positions saved toggle=(${tp.x},${tp.y}) panel=(${pp.x},${pp.y})")
            } catch (e: Throwable) {
                XposedBridge.log("$TAG: persistPositions failed: $e")
            }
        }
    }

    private fun loadDrafts() {
        val list = draftList ?: return
        list.removeAllViews()

        val r = repo ?: run {
            showEmptyText(list, "Firebase not configured — open GlitchDraft app to set it up")
            return
        }

        // Chat ID: use package name as fallback key when no chat-specific ID
        val chatId = currentChatId() ?: currentPackage

        scope.launch {
            try {
                val drafts = r.getDraft(chatId)
                Handler(Looper.getMainLooper()).post {
                    list.removeAllViews()
                    if (drafts.isEmpty()) {
                        showEmptyText(list, "No drafts saved yet")
                    } else {
                        drafts.forEach { draft -> addDraftRow(list, draft, chatId, r) }
                    }
                }
            } catch (e: Throwable) {
                Handler(Looper.getMainLooper()).post {
                    showEmptyText(list, "Error: ${e.message}")
                }
            }
        }
    }

    private fun addDraftRow(
        container: LinearLayout,
        draft: DraftRepository.Draft,
        chatId: String,
        r: DraftRepository
    ) {
        val ctx = container.context
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(ctx, 4), dp(ctx, 6), dp(ctx, 4), dp(ctx, 6))
            gravity = Gravity.CENTER_VERTICAL
        }

        val text = TextView(ctx).apply {
            this.text = android.text.Html.fromHtml(draft.html, android.text.Html.FROM_HTML_MODE_COMPACT)
            textSize = 13f
            setTextColor(Color.BLACK)
            maxLines = 3
        }
        row.addView(text, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        val delBtn = TextView(ctx).apply {
            this.text = "🗑"
            textSize = 16f
            setPadding(dp(ctx, 8), 0, dp(ctx, 4), 0)
        }
        row.addView(delBtn)

        delBtn.setOnClickListener {
            scope.launch {
                try { r.deleteDraftByTimestamp(chatId, draft.timestamp) } catch (_: Throwable) {}
                Handler(Looper.getMainLooper()).post { loadDrafts() }
            }
        }

        // Divider
        val divider = View(ctx).apply { setBackgroundColor(0xFFE4E6EB.toInt()) }
        container.addView(row, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        container.addView(divider, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 1
        ))
    }

    private fun saveDraft(ctx: Context) {
        val input = draftInput ?: return
        val text = input.text.toString().trim()
        if (text.isEmpty()) return

        val r = repo ?: run {
            Toast.makeText(ctx, "Firebase not configured", Toast.LENGTH_SHORT).show()
            return
        }

        val chatId = currentChatId() ?: currentPackage

        scope.launch {
            try {
                val existing = r.getDraft(chatId).toMutableList()
                existing.add(DraftRepository.Draft(html = text, timestamp = System.currentTimeMillis()))
                r.saveDraft(chatId, existing)
                Handler(Looper.getMainLooper()).post {
                    input.text.clear()
                    loadDrafts()
                }
            } catch (e: Throwable) {
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(ctx, "Save failed: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun showEmptyText(container: LinearLayout, msg: String) {
        val ctx = container.context
        val tv = TextView(ctx).apply {
            text = msg
            setTextColor(GREY_TXT)
            textSize = 12f
            setPadding(dp(ctx, 8), dp(ctx, 8), dp(ctx, 8), dp(ctx, 8))
        }
        container.addView(tv)
    }

    private var _currentChatId: String? = null
    private var _currentChatName: String? = null

    fun setChatId(id: String) {
        _currentChatId = id
        _currentChatName = null  // reset name; hook will re-populate it via setChatName
        // Update the debug label in the panel header if it's visible
        Handler(Looper.getMainLooper()).post {
            chatIdLabel?.text = chatIdDebugText()
            // If the panel is open and the new ID contains a name slug (final ID), reload drafts
            if (isPanelVisible && id.matches(Regex("^messenger_(web|android)_\\d+_.+"))) {
                loadDrafts()
            }
        }
    }

    fun setChatName(name: String?) {
        _currentChatName = name
        Handler(Looper.getMainLooper()).post {
            chatIdLabel?.text = chatIdDebugText()
        }
    }

    private fun currentChatId(): String? = _currentChatId

    private fun chatIdDebugText(): String {
        val id = _currentChatId
        val name = _currentChatName
        val pkg = currentPackage
        return when {
            id != null && name != null -> "$name ($id)"
            id != null  -> "scope: $id"
            pkg.isNotEmpty() -> "scope: $pkg (app-level)"
            else             -> "scope: unknown"
        }
    }

    private fun dp(ctx: Context, value: Int): Int =
        (value * ctx.resources.displayMetrics.density).toInt()
}
