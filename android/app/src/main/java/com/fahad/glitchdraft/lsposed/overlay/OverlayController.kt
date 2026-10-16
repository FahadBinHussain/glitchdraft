package com.fahad.glitchdraft.lsposed.overlay

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.PixelFormat
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.fahad.glitchdraft.lsposed.data.DraftRepository
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.lang.reflect.Method
import java.lang.ref.WeakReference
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
    // mirrors extension draftSync.js: 10s tick, only while the panel is visible
    private const val SYNC_TICK_MS = 10_000L
    // panel 📎: request code for the system image picker (must be unique within
    // the host activity) + longest side picked images are kept at.
    private const val REQ_PICK_IMAGE = 0x4744  // "GD"
    private const val MAX_IMAGE_DIM = 1024

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
    // In-window (decor) attach: used when the app can never hold
    // SYSTEM_ALERT_WINDOW (instagram doesn't declare it in its manifest, and
    // neither MIUI's popup toggle nor root appops can grant it — the window
    // manager rejects TYPE_APPLICATION_OVERLAY with BadTokenException 2038).
    // The panel header must label this second method visibly.
    private var inWindowMode = false
    private var decorHost: WeakReference<Activity>? = null

    /** Weak reference to the last WebView that loaded a target URL.
     *  Used by the Use button to call window.GlitchDraftUseMessage(html)
     *  via evaluateJavascript so the extension's own image+text paste logic runs. */
    private var currentWebView: WeakReference<WebView>? = null

    fun setWebView(wv: WebView) {
        currentWebView = WeakReference(wv)
    }

    // ----- panel 📎 staged images -------------------------------------------
    // Picked images wait here until the next save; they ride into the draft as
    // <img src="data:image/jpeg;base64,…"> tags — the exact shape the web panel
    // stores for a pasted image, so render + Use handle both identically.
    private data class StagedImage(val html: String, val bitmap: Bitmap)
    private val stagedImages = mutableListOf<StagedImage>()
    private var stagedRow: LinearLayout? = null
    private var awaitingImagePick = false
    private val pickResultHookedMembers = mutableSetOf<String>()

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

    // Panel-open sync tick: refetch while the panel is visible so edits and
    // deletes made on web show up without reopening the panel. re-render only
    // when content actually changed (no 10s flicker).
    private val syncHandler = Handler(Looper.getMainLooper())
    private var lastRenderedDrafts: List<DraftRepository.Draft> = emptyList()
    private val syncRunnable = object : Runnable {
        override fun run() {
            if (!isAttached || !isPanelVisible || panelView?.visibility != View.VISIBLE) {
                stopPanelSync()
                return
            }
            syncDrafts()
            syncHandler.postDelayed(this, SYNC_TICK_MS)
        }
    }

    private fun startPanelSync() {
        syncHandler.removeCallbacks(syncRunnable)
        syncHandler.postDelayed(syncRunnable, SYNC_TICK_MS)
    }

    private fun stopPanelSync() {
        syncHandler.removeCallbacks(syncRunnable)
    }

    // -------------------------------------------------------------------------

    fun isAttached() = isAttached

    /** in-window overlay is pinned to one activity's decor — true when this
     *  resume is a different activity, so the hook must let attach() migrate. */
    fun wantsRemount(activity: Activity) =
        isAttached && inWindowMode && decorHost?.get() !== activity

    /**
     * Attach overlay to the given Activity.  Safe to call on every onResume —
     * will no-op if already attached.
     */
    fun attach(activity: Activity, packageName: String) {
        if (isAttached) {
            // in-window mode hangs off ONE activity's decor — migrate on resume
            if (inWindowMode && decorHost?.get() !== activity) {
                XposedBridge.log("$TAG: decor host changed, re-attaching in-window overlay")
                detach()
            } else return
        }

        val canWmOverlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            Settings.canDrawOverlays(activity)
        inWindowMode = !canWmOverlay
        decorHost = if (inWindowMode) WeakReference(activity) else null
        if (inWindowMode) {
            XposedBridge.log("$TAG: no overlay window permission for $packageName — using in-window (decor) attach; panel header labels the mode")
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
                    try {
                        buildPanel(activity, if (panX >= 0) panX else -1, if (panY >= 0) panY else -1)
                        buildToggle(activity, if (togX >= 0) togX else -1, if (togY >= 0) togY else -1)
                        isAttached = true
                        XposedBridge.log("$TAG: Overlay attached for $packageName (togPos=$togX,$togY panPos=$panX,$panY)")
                    } catch (e: Throwable) {
                        // attach rejected: fail loudly and clean up the half-built
                        // views so the next onResume retries
                        XposedBridge.log("$TAG: overlay attach REJECTED for $packageName: $e")
                        detachView(panelView)
                        detachView(toggleView)
                        panelView = null
                        toggleView = null
                        draftList = null
                        draftInput = null
                        chatIdLabel = null
                        decorHost = null
                        inWindowMode = false
                        isAttached = false
                    }
                }
            }
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: attach failed: $e")
        }
    }

    fun detach() {
        stopPanelSync()
        scope.cancel()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        detachView(toggleView)
        detachView(panelView)
        inWindowMode = false
        decorHost = null
        windowManager = null
        toggleView = null
        panelView = null
        draftList = null
        draftInput = null
        chatIdLabel = null
        stagedRow = null
        awaitingImagePick = false
        isAttached = false
    }

    // -------------------------------------------------------------------------
    // View hosting: WM overlay (primary, needs SYSTEM_ALERT_WINDOW) vs
    // in-window decor child (second method, used when the app can never hold
    // the permission). Positions always live in toggleParams/panelParams x/y —
    // in-window mirrors them to translationX/Y.
    // -------------------------------------------------------------------------

    private fun attachView(view: View, params: WindowManager.LayoutParams) {
        if (inWindowMode) {
            val decor = decorHost?.get()?.window?.decorView as? ViewGroup
                ?: throw IllegalStateException("in-window attach: decor host gone")
            decor.addView(view, FrameLayout.LayoutParams(params.width, params.height))
            view.translationX = params.x.toFloat()
            view.translationY = params.y.toFloat()
        } else {
            windowManager?.addView(view, params)
        }
    }

    private fun detachView(view: View?) {
        if (view == null) return
        if (inWindowMode) {
            runCatching { (decorHost?.get()?.window?.decorView as? ViewGroup)?.removeView(view) }
        } else {
            runCatching { windowManager?.removeView(view) }
        }
    }

    private fun moveView(view: View, params: WindowManager.LayoutParams) {
        if (inWindowMode) {
            view.translationX = params.x.toFloat()
            view.translationY = params.y.toFloat()
        } else {
            windowManager?.updateViewLayout(view, params)
        }
    }

    /** Hide the toggle button (and panel) when the target app loses focus. */
    fun hide() {
        stopPanelSync()
        Handler(Looper.getMainLooper()).post {
            toggleView?.visibility = View.GONE
            setWindowTouchable(toggleView, toggleParams, false)
            if (isPanelVisible) panelView?.visibility = View.GONE
            setWindowTouchable(panelView, panelParams, false)
        }
    }

    /** Show the toggle button again when the target app regains focus. */
    fun show() {
        Handler(Looper.getMainLooper()).post {
            toggleView?.visibility = View.VISIBLE
            setWindowTouchable(toggleView, toggleParams, true)
            if (isPanelVisible) panelView?.visibility = View.VISIBLE
            setWindowTouchable(panelView, panelParams, isPanelVisible)
            if (isPanelVisible) startPanelSync()
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
                        moveView(frame, params)
                    }
                    MotionEvent.ACTION_UP -> {
                        if (!hasMoved) togglePanel()
                        else scheduleSavePositions()  // save after drag ends
                    }
                }
                return true
            }
        })

        attachView(frame, params)
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

        // second attach method in use — label it visibly, never pretend the
        // WM overlay is active
        if (inWindowMode) {
            header.addView(TextView(ctx).apply {
                text = "in-window mode — no overlay window permission"
                setTextColor(0xAAFFFFFF.toInt())
                textSize = 9f
                setPadding(0, 1, 0, 0)
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ))
        }
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

        // --- Staged image chips (only visible while an image is attached) ---
        stagedRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(ctx, 8), dp(ctx, 6), dp(ctx, 8), 0)
            visibility = View.GONE
        }
        root.addView(stagedRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
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

        val attachBtn = TextView(ctx).apply {
            text = "📎"
            textSize = 20f
            gravity = Gravity.CENTER
            setPadding(dp(ctx, 6), 0, dp(ctx, 2), 0)
        }
        inputRow.addView(attachBtn)

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
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (savedX >= 0) savedX else dp(ctx, 20)
            y = if (savedY >= 0) savedY else dp(ctx, 200)
        }
        panelParams = params

        root.visibility = View.GONE
        attachView(root, params)
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
                        moveView(root, params)
                    }
                    MotionEvent.ACTION_UP -> {
                        scheduleSavePositions()  // save after panel drag ends
                    }
                }
                return true
            }
        })

        saveBtn.setOnClickListener { saveDraft(ctx) }
        attachBtn.setOnClickListener { launchImagePicker(ctx) }
        // re-attach / decor migration rebuilds the panel — restore chips
        renderStagedRow()
    }

    // -------------------------------------------------------------------------
    // Toggle visibility
    // -------------------------------------------------------------------------

    private fun togglePanel() {
        isPanelVisible = !isPanelVisible
        panelView?.visibility = if (isPanelVisible) View.VISIBLE else View.GONE
        setWindowTouchable(panelView, panelParams, isPanelVisible)
        if (isPanelVisible) {
            chatIdLabel?.text = chatIdDebugText()
            loadDrafts()
            startPanelSync()
        } else {
            stopPanelSync()
        }
    }

    private fun setWindowTouchable(view: View?, params: WindowManager.LayoutParams?, touchable: Boolean) {
        // in-window children have no WM flags — visibility (set by the same
        // callers) already gates their touchability
        if (view == null || params == null || inWindowMode || windowManager == null) return
        val masked = params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        val hasFlag = masked != 0
        if (hasFlag == !touchable) return
        params.flags = if (touchable) {
            params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
        } else {
            params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        }
        try {
            windowManager?.updateViewLayout(view, params)
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: setWindowTouchable($touchable) failed: $e")
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
                Handler(Looper.getMainLooper()).post { renderDrafts(drafts, chatId, r) }
            } catch (e: Throwable) {
                Handler(Looper.getMainLooper()).post {
                    showEmptyText(list, "Error: ${e.message}")
                }
            }
        }
    }

    // sync-tick fetch: never clears first, re-renders only when server content
    // changed — a transient network error just skips the tick (next one retries).
    private fun syncDrafts() {
        val r = repo ?: return
        val chatId = currentChatId() ?: currentPackage
        scope.launch {
            val drafts = try { r.getDraft(chatId) } catch (_: Throwable) { return@launch }
            Handler(Looper.getMainLooper()).post {
                if (!isPanelVisible || panelView?.visibility != View.VISIBLE) return@post
                if (drafts == lastRenderedDrafts) return@post
                renderDrafts(drafts, chatId, r)
            }
        }
    }

    private fun renderDrafts(drafts: List<DraftRepository.Draft>, chatId: String, r: DraftRepository) {
        val list = draftList ?: return
        lastRenderedDrafts = drafts
        list.removeAllViews()
        if (drafts.isEmpty()) {
            showEmptyText(list, "No drafts saved yet")
        } else {
            drafts.forEach { draft -> addDraftRow(list, draft, chatId, r) }
        }
    }

    private fun addDraftRow(
        container: LinearLayout,
        draft: DraftRepository.Draft,
        chatId: String,
        r: DraftRepository
    ) {
        val ctx = container.context
        val plainText = htmlToPlainText(draft.html)
        // images survive an inline edit — saveEdit re-appends these exact tags
        // after the edited text (previously they were dropped silently)
        val keptImgTags = Regex("<img[^>]*>", RegexOption.IGNORE_CASE)
            .findAll(draft.html).map { it.value }.toList()

        // ── Card wrapping all content for this draft ──────────────────────────
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 6), dp(ctx, 8), dp(ctx, 6), dp(ctx, 6))
        }

        // ── Display group (view mode) ─────────────────────────────────────────
        val displayGroup = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        val textView = TextView(ctx).apply {
            text = htmlToDisplaySpanned(ctx, draft.html)
            textSize = 13f
            setTextColor(Color.BLACK)
            maxLines = 3
            setPadding(0, 0, 0, dp(ctx, 6))
        }
        displayGroup.addView(textView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // Timestamps mirror the extension card (.saved-messages-timestamp /
        // .saved-messages-modified): created always, "Modified:" only when the row
        // was re-saved >1min after the message — same rule as both content.js forks.
        val showModified = draft.lastModified > draft.timestamp + 60_000L

        val timestampView = TextView(ctx).apply {
            text = formatTimestamp(ctx, draft.timestamp)
            textSize = 10f
            setTextColor(GREY_TXT)
            setPadding(0, 0, 0, if (showModified) 0 else dp(ctx, 6))
        }
        displayGroup.addView(timestampView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        if (showModified) {
            val modifiedView = TextView(ctx).apply {
                text = "Modified: " + formatTimestamp(ctx, draft.lastModified)
                textSize = 10f
                setTextColor(GREY_TXT)
                alpha = 0.75f
                setPadding(0, 0, 0, dp(ctx, 6))
            }
            displayGroup.addView(modifiedView, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ))
        }

        // Action buttons row: Use | Copy | Edit | Delete
        val actionsRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
        }

        fun makeActionBtn(label: String, bgColor: Int): TextView = TextView(ctx).apply {
            text = label
            textSize = 11f
            setTextColor(WHITE)
            setPadding(dp(ctx, 7), dp(ctx, 4), dp(ctx, 7), dp(ctx, 4))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(bgColor)
                cornerRadius = dp(ctx, 4).toFloat()
            }
        }

        val useBtn  = makeActionBtn("Use",    ACCENT)
        val copyBtn = makeActionBtn("Copy",   0xFF4CAF50.toInt())
        val editBtn = makeActionBtn("Edit",   0xFF2196F3.toInt())
        val delBtn  = makeActionBtn("Delete", 0xFFE74C3C.toInt())

        fun btnLp() = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).also { it.marginEnd = dp(ctx, 5) }

        actionsRow.addView(useBtn,  btnLp())
        actionsRow.addView(copyBtn, btnLp())
        actionsRow.addView(editBtn, btnLp())
        actionsRow.addView(delBtn,  LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        displayGroup.addView(actionsRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // ── Edit group (edit mode, initially hidden) ──────────────────────────
        val editGroup = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }

        val editInput = EditText(ctx).apply {
            setText(plainText)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            maxLines = 6
            setTextColor(Color.BLACK)
            textSize = 13f
            setPadding(dp(ctx, 6), dp(ctx, 6), dp(ctx, 6), dp(ctx, 6))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(WHITE)
                cornerRadius = dp(ctx, 4).toFloat()
                setStroke(1, 0xFFCCCCCC.toInt())
            }
        }
        editGroup.addView(editInput, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        val editActionsRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(ctx, 6), 0, 0)
        }
        val saveEditBtn   = makeActionBtn("Save",   0xFF4CAF50.toInt())
        val cancelEditBtn = makeActionBtn("Cancel", 0xFF888888.toInt())
        editActionsRow.addView(saveEditBtn,   btnLp())
        editActionsRow.addView(cancelEditBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        editGroup.addView(editActionsRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        card.addView(displayGroup, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        card.addView(editGroup, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        val divider = View(ctx).apply { setBackgroundColor(0xFFE4E6EB.toInt()) }
        container.addView(card, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))
        container.addView(divider, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 1
        ))

        // ── Button listeners ──────────────────────────────────────────────────

        // USE: WebView path → call extension's useMessage() which handles text + images natively.
        //      Native app path → inject text into the compose EditText AND put images on the
        //      clipboard via MediaStore so the user can long-press→paste them.
        useBtn.setOnClickListener {
            val wv = currentWebView?.get()
            if (wv != null) {
                // ── WebView (Messenger/Discord web, WhatsApp Web) ─────────────
                val jsonHtml = org.json.JSONObject.quote(draft.html)
                wv.evaluateJavascript(
                    "window.GlitchDraftUseMessage && window.GlitchDraftUseMessage($jsonHtml)",
                    null
                )
                togglePanel()
            } else {
                // ── Native app (e.g. Messenger Android) ───────────────────────
                // Extract image src values from the HTML before stripping
                val imgSrcs = extractImgSrcs(draft.html)

                // 1. Inject text into the compose EditText (if any text exists)
                val activity = panelView?.context as? Activity
                val decorRoot = activity?.window?.decorView
                val msgInput = decorRoot?.let { findMessageInput(it) }
                if (plainText.isNotBlank() && msgInput != null) {
                    msgInput.setText(plainText)
                    msgInput.setSelection(msgInput.text.length)
                    msgInput.requestFocus()
                } else if (plainText.isNotBlank()) {
                    // EditText not found – fall back to clipboard for text
                    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    cm?.setPrimaryClip(ClipData.newPlainText("draft", plainText))
                    Toast.makeText(ctx, "Text copied – paste in your message", Toast.LENGTH_SHORT).show()
                }

                // 2. Handle images via MediaStore clipboard
                if (imgSrcs.isNotEmpty()) {
                    scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                        insertImagesViaMediaStore(ctx, imgSrcs)
                    }
                }

                togglePanel()
            }
        }

        // COPY: always copy plain text to clipboard
        copyBtn.setOnClickListener {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("draft", plainText))
            Toast.makeText(ctx, "Draft copied to clipboard", Toast.LENGTH_SHORT).show()
        }

        // EDIT: switch to inline edit mode
        editBtn.setOnClickListener {
            displayGroup.visibility = View.GONE
            editGroup.visibility = View.VISIBLE
            editInput.requestFocus()
        }

        // DELETE: remove only this draft entry by timestamp
        delBtn.setOnClickListener {
            scope.launch {
                try { r.deleteDraftByTimestamp(chatId, draft.timestamp) } catch (_: Throwable) {}
                Handler(Looper.getMainLooper()).post { loadDrafts() }
            }
        }

        // SAVE EDIT: write updated html back to Firestore
        saveEditBtn.setOnClickListener {
            val newText = editInput.text.toString().trim()
            if (newText.isEmpty() && keptImgTags.isEmpty()) return@setOnClickListener
            val newHtml = buildString {
                append(newText.replace("\n", "<br>"))
                keptImgTags.forEach {
                    if (isNotEmpty()) append("<br>")
                    append(it)
                }
            }
            scope.launch {
                try {
                    r.editDraftByTimestamp(chatId, draft.timestamp, newHtml)
                    Handler(Looper.getMainLooper()).post { loadDrafts() }
                } catch (e: Throwable) {
                    Handler(Looper.getMainLooper()).post {
                        Toast.makeText(ctx, "Edit failed: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        // CANCEL EDIT: revert back to display mode
        cancelEditBtn.setOnClickListener {
            editGroup.visibility = View.GONE
            displayGroup.visibility = View.VISIBLE
        }
    }

    /**
     * Walks [root] breadth-first and returns the first [View] that is visible,
     * enabled, focusable, and has a non-null [android.view.inputmethod.InputConnection]
     * (i.e. it accepts keyboard / rich input).  This finds Messenger's custom compose
     * bar even when it is not a plain [android.widget.EditText].
     */
    private fun findAnyInputView(root: View): View? {
        val queue = ArrayDeque<View>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val v = queue.removeFirst()
            if (v.isShown && v.isEnabled && v.isFocusable) {
                try {
                    val ic = v.onCreateInputConnection(android.view.inputmethod.EditorInfo())
                    if (ic != null) return v
                } catch (_: Throwable) {}
            }
            if (v is ViewGroup) {
                for (i in 0 until v.childCount) queue.add(v.getChildAt(i))
            }
        }
        return null
    }

    /**
     * Walks [root] breadth-first and returns the first [View] that declares
     * image MIME-type support via [View.getReceiveContentMimeTypes()] (API 31+).
     *
     * This is the view that has an [OnReceiveContentListener] registered —
     * the ONLY view where [View.performReceiveContent] and
     * [InputConnection.commitContent] will actually be consumed by Messenger.
     */
    private fun findImageReceivingView(root: View): View? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        val queue = ArrayDeque<View>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val v = queue.removeFirst()
            try {
                val mimeTypes = View::class.java
                    .getMethod("getReceiveContentMimeTypes")
                    .invoke(v)
                if (mimeTypes is Array<*> &&
                    mimeTypes.any { (it as? String)?.startsWith("image/") == true }) {
                    XposedBridge.log("$TAG findImageReceivingView: found ${v.javaClass.name} mimes=${mimeTypes.toList()}")
                    return v
                }
            } catch (_: Throwable) {}
            if (v is ViewGroup) {
                for (i in 0 until v.childCount) queue.add(v.getChildAt(i))
            }
        }
        return null
    }

    /**
     * Extracts all `src` attribute values from `<img>` tags in [html].
     */
    private fun extractImgSrcs(html: String): List<String> {
        val srcs = mutableListOf<String>()
        val pattern = Regex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
        pattern.findAll(html).forEach { srcs.add(it.groupValues[1]) }
        return srcs
    }

    /**
     * For each `data:image/...;base64,...` URI in [srcList]:
     *  1. Decodes the bytes.
     *  2. Writes a temp entry into [MediaStore.Images] so Android gives it a
     *     `content://` URI that any app can paste.
     *  3. Puts the URI on the system clipboard.
     *  4. Schedules automatic deletion after 2 minutes to keep the gallery clean.
     *
     * Only the FIRST image is put on the clipboard (Android clipboard holds one
     * item at a time).  A toast guides the user to long-press → paste.
     */
    private fun insertImagesViaMediaStore(ctx: Context, srcList: List<String>) {
        val dataUri = srcList.firstOrNull { it.startsWith("data:") } ?: run {
            Handler(Looper.getMainLooper()).post {
                Toast.makeText(ctx, "No embeddable image found in draft", Toast.LENGTH_SHORT).show()
            }
            return
        }

        try {
            val commaIdx = dataUri.indexOf(',')
            if (commaIdx < 0) return
            val header  = dataUri.substring(0, commaIdx)          // "data:image/png;base64"
            val b64Data = dataUri.substring(commaIdx + 1)
            val bytes   = Base64.decode(b64Data, Base64.DEFAULT)

            val mimeType = when {
                header.contains("gif",  ignoreCase = true) -> "image/gif"
                header.contains("jpeg", ignoreCase = true) ||
                header.contains("jpg",  ignoreCase = true) -> "image/jpeg"
                header.contains("webp", ignoreCase = true) -> "image/webp"
                else -> "image/png"
            }
            val ext = when (mimeType) {
                "image/gif"  -> "gif"
                "image/jpeg" -> "jpg"
                "image/webp" -> "webp"
                else         -> "png"
            }
            val fileName = "glitchdraft_${System.currentTimeMillis()}.$ext"

            val contentUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ – use MediaStore with IS_PENDING
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                    put(MediaStore.Images.Media.MIME_TYPE, mimeType)
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val uri = ctx.contentResolver.insert(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values
                ) ?: return
                ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                val done = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
                ctx.contentResolver.update(uri, done, null, null)
                uri
            } else {
                // Android < 10 – write to public Pictures directory
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_PICTURES
                )
                dir.mkdirs()
                val file = File(dir, fileName)
                FileOutputStream(file).use { it.write(bytes) }
                android.media.MediaScannerConnection.scanFile(
                    ctx, arrayOf(file.absolutePath), arrayOf(mimeType), null
                )
                Uri.fromFile(file)
            }

            contentUri?.let { uri ->
                Handler(Looper.getMainLooper()).post {
                    // 1. Set clipboard
                    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    cm?.setPrimaryClip(ClipData.newUri(ctx.contentResolver, "image", uri))

                    // 2. Auto-paste: close panel → re-focus compose bar → dispatch KEYCODE_PASTE
                    //    through the Activity (exactly what the keyboard's paste button does).
                    Handler(Looper.getMainLooper()).postDelayed({
                        val activity = panelView?.context as? Activity
                        val imm = ctx.getSystemService(Context.INPUT_METHOD_SERVICE)
                                as? android.view.inputmethod.InputMethodManager

                        // Find the compose view and re-focus it so the Activity window is active.
                        // Priority:
                        //  1. findImageReceivingView — the view with OnReceiveContentListener for images (API 31+)
                        //  2. currentFocus          — whatever is already focused
                        //  3. findAnyInputView      — first view with a valid InputConnection
                        //  4. findMessageInput      — plain EditText fallback
                        val decorRoot = activity?.window?.decorView
                        val imageView  = decorRoot?.let { findImageReceivingView(it) }
                        val composeView: View? = imageView
                            ?: activity?.currentFocus
                            ?: decorRoot?.let { findAnyInputView(it) }
                            ?: decorRoot?.let { findMessageInput(it) }
                        // For image delivery we always prefer the image-capable view, even if
                        // a different view currently has focus.
                        val imageTarget: View? = imageView ?: composeView

                        XposedBridge.log("[GlitchDraft] autoPaste: composeView=${composeView?.javaClass?.name}")

                        if (composeView != null) {
                            composeView.requestFocus()
                            // Ask the IME to (re-)attach to this view
                            imm?.showSoftInput(composeView, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
                        }

                        // Wait for IME to reconnect, then fire paste through the Activity —
                        // Activity.dispatchKeyEvent routes to the currently-focused view,
                        // which is exactly how the keyboard's paste button works.
                        Handler(Looper.getMainLooper()).postDelayed({
                            var pasted = false

                            // ── Method E: InputConnection.commitContent() ─────────────────────
                            // This is THE call GBoard makes when inserting an image from the
                            // keyboard.  It works on API 25+ (minSdk=26 so always available).
                            // We create a fresh InputConnection from imageTarget — the view that
                            // has OnReceiveContentListener registered — and call commitContent()
                            // with the MediaStore URI.  This completely bypasses the clipboard
                            // and source-filtering that blocks Methods A–D for images.
                            if (!pasted && imageTarget != null) {
                                try {
                                    imageTarget.requestFocus()
                                    val editorInfo = android.view.inputmethod.EditorInfo()
                                    val ic = imageTarget.onCreateInputConnection(editorInfo)
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_E ic=$ic contentMimes=${editorInfo.contentMimeTypes?.toList()}")
                                    if (ic != null) {
                                        val desc = android.content.ClipDescription(
                                            "image", arrayOf(mimeType))
                                        val ici  = android.view.inputmethod.InputContentInfo(
                                            uri, desc, null)
                                        // requestPermission() is a best-effort grant; may be a
                                        // no-op outside an IME process — that's fine, we own the
                                        // URI because we created it in Messenger's process.
                                        try { ici.requestPermission() } catch (_: Throwable) {}
                                        // flags = 1 = INPUT_CONTENT_GRANT_READ_URI_PERMISSION
                                        val r = ic.commitContent(ici, 1, null)
                                        XposedBridge.log("[GlitchDraft] autoPaste: METHOD_E commitContent result=$r")
                                        if (r) pasted = true
                                        try { ic.closeConnection() } catch (_: Throwable) {}
                                    }
                                } catch (e: Throwable) {
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_E error: $e")
                                }
                            }

                            // ── Method F: View.performReceiveContent() — API 31+ ─────────────
                            // Try SOURCE_INPUT_METHOD (=2) first — that is what GBoard signals
                            // and what most apps' OnReceiveContentListener checks for.
                            // SOURCE_CLIPBOARD (=1) is attempted second as a fallback.
                            // Always target imageTarget (the view with the registered listener).
                            if (!pasted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && imageTarget != null) {
                                for (source in listOf(2 /* SOURCE_INPUT_METHOD */, 1 /* SOURCE_CLIPBOARD */)) {
                                    if (pasted) break
                                    try {
                                        val clipData = (ctx.getSystemService(Context.CLIPBOARD_SERVICE)
                                                as? ClipboardManager)?.primaryClip ?: continue
                                        val builderClass    = Class.forName("android.view.ContentInfo\$Builder")
                                        val builderCtor     = builderClass.getDeclaredConstructor(
                                            ClipData::class.java, Int::class.java)
                                        val builder         = builderCtor.newInstance(clipData, source)
                                        val contentInfo     = builderClass.getMethod("build").invoke(builder)
                                        val contentInfoClass = Class.forName("android.view.ContentInfo")
                                        val performMethod   = View::class.java.getMethod(
                                            "performReceiveContent", contentInfoClass)
                                        val remaining = performMethod.invoke(imageTarget, contentInfo)
                                        XposedBridge.log("[GlitchDraft] autoPaste: METHOD_F source=$source remaining=$remaining")
                                        // null = fully consumed by the listener (success)
                                        if (remaining == null) pasted = true
                                    } catch (e: Throwable) {
                                        XposedBridge.log("[GlitchDraft] autoPaste: METHOD_F source=$source error: $e")
                                    }
                                }
                            }

                            // Method A: Activity.dispatchKeyEvent(KEYCODE_PASTE)
                            //   Works on API < 31 and as a fallback for text-only fields.
                            if (!pasted) {
                                try {
                                    val down = android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_PASTE)
                                    val up   = android.view.KeyEvent(android.view.KeyEvent.ACTION_UP,   android.view.KeyEvent.KEYCODE_PASTE)
                                    val r1 = activity?.dispatchKeyEvent(down) ?: false
                                    val r2 = activity?.dispatchKeyEvent(up)   ?: false
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_A activity dispatch down=$r1 up=$r2")
                                    if (r1 || r2) pasted = true
                                } catch (e: Throwable) {
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_A error: $e")
                                }
                            }

                            // Method B: AccessibilityNodeInfo ACTION_PASTE on the compose view
                            if (!pasted && composeView != null) {
                                try {
                                    val result = composeView.performAccessibilityAction(
                                        android.view.accessibility.AccessibilityNodeInfo.ACTION_PASTE, null
                                    )
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_B a11y result=$result")
                                    if (result) pasted = true
                                } catch (e: Throwable) {
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_B error: $e")
                                }
                            }

                            // Method C: onTextContextMenuItem(paste) for TextView / EditText
                            if (!pasted && composeView is android.widget.TextView) {
                                try {
                                    composeView.onTextContextMenuItem(android.R.id.paste)
                                    pasted = true
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_C TextView paste fired")
                                } catch (e: Throwable) {
                                    XposedBridge.log("[GlitchDraft] autoPaste: METHOD_C error: $e")
                                }
                            }

                            // Method D: IMM reflection — walk the entire InputMethodManager class
                            //   hierarchy and call performContextMenuAction(paste) on every field
                            //   that implements InputConnection.  This covers obfuscated field names
                            //   across AOSP forks and vendor ROMs.
                            if (!pasted && imm != null) {
                                try {
                                    var immCls: Class<*>? = android.view.inputmethod.InputMethodManager::class.java
                                    outer@ while (immCls != null && immCls != Any::class.java) {
                                        for (f in immCls.declaredFields) {
                                            if (!android.view.inputmethod.InputConnection::class.java
                                                    .isAssignableFrom(f.type)) continue
                                            try {
                                                f.isAccessible = true
                                                val ic = f.get(imm) as? android.view.inputmethod.InputConnection
                                                    ?: continue
                                                val r = ic.performContextMenuAction(android.R.id.paste)
                                                XposedBridge.log("[GlitchDraft] autoPaste: METHOD_D field=${f.name} result=$r")
                                                if (r) { pasted = true; break@outer }
                                            } catch (_: Throwable) {}
                                        }
                                        immCls = immCls.superclass
                                    }
                                } catch (_: Throwable) {}
                            }

                            XposedBridge.log("[GlitchDraft] autoPaste: final pasted=$pasted")

                            if (!pasted) {
                                val msg = if (srcList.size > 1)
                                    "Image 1/${srcList.size} in clipboard – long-press in message box to paste"
                                else
                                    "Image in clipboard – long-press in message box to paste"
                                Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
                            }
                        }, 400L) // wait for IME to re-attach after showSoftInput
                    }, 600L) // wait for panel to fully close and Activity window to regain focus
                }
                // Auto-delete after 2 minutes to keep gallery clean
                Handler(Looper.getMainLooper()).postDelayed({
                    try { ctx.contentResolver.delete(uri, null, null) } catch (_: Throwable) {}
                }, 120_000L)
            }
        } catch (e: Throwable) {
            XposedBridge.log("[GlitchDraft] insertImagesViaMediaStore failed: $e")
            Handler(Looper.getMainLooper()).post {
                Toast.makeText(ctx, "Could not prepare image for pasting", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * Walks the view hierarchy rooted at [root] and returns the first
     * [EditText] that looks like a message-compose input (visible, enabled,
     * focusable, not a password field).  Returns null if none is found.
     */
    // mirrors extension content.js formatTimestamp(): "Today at h:mm" /
    // "Yesterday at h:mm" / locale date + time, locale-aware 12h/24h
    private fun formatTimestamp(ctx: Context, epochMs: Long): String {
        if (epochMs <= 0L) return ""
        val date = java.util.Date(epochMs)
        val timeStr = android.text.format.DateFormat.getTimeFormat(ctx).format(date)
        val day = java.util.Calendar.getInstance().apply { time = date }
        val now = java.util.Calendar.getInstance()
        if (day.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR) &&
            day.get(java.util.Calendar.DAY_OF_YEAR) == now.get(java.util.Calendar.DAY_OF_YEAR)
        ) {
            return "Today at $timeStr"
        }
        val yesterday = (now.clone() as java.util.Calendar).apply {
            add(java.util.Calendar.DAY_OF_YEAR, -1)
        }
        if (day.get(java.util.Calendar.YEAR) == yesterday.get(java.util.Calendar.YEAR) &&
            day.get(java.util.Calendar.DAY_OF_YEAR) == yesterday.get(java.util.Calendar.DAY_OF_YEAR)
        ) {
            return "Yesterday at $timeStr"
        }
        return android.text.format.DateFormat.getDateFormat(ctx).format(date) + " " + timeStr
    }

    /**
     * Converts [html] to a [android.text.Spanned] for display in a [TextView].
     *
     * `data:image/...;base64,...` URIs are decoded directly to a [BitmapDrawable]
     * so images stored by the extension (which converts blob → data-URL before
     * saving to Firestore) are rendered as real images.
     *
     * Any `<img>` whose src is NOT a data-URI (e.g. an http URL) falls back to a
     * small grey placeholder rectangle so the layout never collapses.
     */
    private fun htmlToDisplaySpanned(ctx: Context, html: String): android.text.Spanned {
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
                            // Scale down to at most 240 dp wide so it fits inside the panel
                            val maxPx = dp(ctx, 240)
                            val origW = bitmap.width
                            val origH = bitmap.height
                            val (dw, dh) = if (origW > maxPx) {
                                maxPx to (origH.toLong() * maxPx / origW).toInt()
                            } else {
                                origW to origH
                            }
                            return@ImageGetter BitmapDrawable(ctx.resources, bitmap).also {
                                it.setBounds(0, 0, dw, dh)
                            }
                        }
                    }
                } catch (_: Throwable) { /* fall through to placeholder */ }
            }
            // Fallback: grey placeholder rectangle
            android.graphics.drawable.ColorDrawable(0xFFCCCCCC.toInt()).also {
                val px = dp(ctx, 24)
                it.setBounds(0, 0, px, px)
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
     * Strips [html] to plain text.  Every `<img>` tag is replaced with a 🖼
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

    private fun findMessageInput(root: View): EditText? {
        if (root is EditText) {
            val iType = root.inputType
            val isPassword = (iType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0 ||
                             (iType and InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) != 0
            if (!isPassword && root.isShown && root.isEnabled && root.isFocusable) return root
        }
        if (root is ViewGroup) {
            for (i in 0 until root.childCount) {
                val found = findMessageInput(root.getChildAt(i))
                if (found != null) return found
            }
        }
        return null
    }

    private fun saveDraft(ctx: Context) {
        val input = draftInput ?: return
        val text = input.text.toString().trim()
        val staged = stagedImages.toList()
        if (text.isEmpty() && staged.isEmpty()) return

        val r = repo ?: run {
            Toast.makeText(ctx, "Firebase not configured", Toast.LENGTH_SHORT).show()
            return
        }

        val chatId = currentChatId() ?: currentPackage

        // text + each staged image on its own line. <img src="data:…"> is the
        // exact shape the web panel saves for pasted images, so render + Use on
        // both sides handle it identically. newlines become <br> like the edit
        // path — raw \n inside html renders as a plain space.
        val html = buildString {
            append(text.replace("\n", "<br>"))
            staged.forEach {
                if (isNotEmpty()) append("<br>")
                append(it.html)
            }
        }

        scope.launch {
            try {
                val existing = r.getDraft(chatId).toMutableList()
                existing.add(DraftRepository.Draft(html = html, timestamp = System.currentTimeMillis()))
                r.saveDraft(chatId, existing, _currentChatName)
                Handler(Looper.getMainLooper()).post {
                    input.text.clear()
                    stagedImages.removeAll(staged.toSet())
                    renderStagedRow()
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
    // Image attach (panel 📎) — capture side of the web panel's paste-an-image
    // -------------------------------------------------------------------------

    /** 📎 handler: open the system image picker. The result comes back through a
     *  lazily installed onActivityResult hook (see installImagePickResultHook) —
     *  the overlay has no Activity of its own to override. */
    private fun launchImagePicker(ctx: Context) {
        val act = panelView?.context as? Activity
        if (act == null) {
            Toast.makeText(ctx, "Attach failed: no active screen for the picker", Toast.LENGTH_LONG).show()
            return
        }
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        try {
            installImagePickResultHook(act)
            awaitingImagePick = true
            act.startActivityForResult(intent, REQ_PICK_IMAGE)
        } catch (t: Throwable) {
            awaitingImagePick = false
            XposedBridge.log("$TAG: image picker launch failed: $t")
            Toast.makeText(ctx, "Image picker failed: ${t.message}", Toast.LENGTH_LONG).show()
        }
    }

    /** Hooks every declared activity-result entry point in [activity]'s class
     *  chain — platforms route results differently (onActivityResult vs
     *  dispatchActivityResult) and apps override at different levels; each fire
     *  is logged while a pick is awaited, and the first match is handed to
     *  [handleImagePickResult]. */
    private fun installImagePickResultHook(activity: Activity) {
        try {
            val intType = Int::class.javaPrimitiveType
                ?: throw IllegalStateException("int primitive class missing")
            val intentType = Intent::class.java
            val strType = String::class.java

            val chain = ArrayList<Class<*>>()
            var cls: Class<*>? = activity.javaClass
            while (cls != null && cls != Activity::class.java) {
                chain.add(cls)
                cls = cls.superclass
            }
            chain.add(Activity::class.java)
            XposedBridge.log("$TAG: pick hook walk from ${activity.javaClass.name} @${System.identityHashCode(activity)} (${chain.size} classes)")

            val sigs: List<Pair<String, Array<Class<*>>>> = listOf(
                "onActivityResult" to arrayOf(intType, intType, intentType),
                "dispatchActivityResult" to arrayOf(intType, intType, intentType),
                "dispatchActivityResult" to arrayOf(strType, intType, intType, intentType)
            )

            var hooked = 0
            for (c in chain) {
                for ((name, types) in sigs) {
                    val m = try {
                        c.getDeclaredMethod(name, *types)
                    } catch (_: NoSuchMethodException) {
                        null
                    } ?: continue
                    val key = "${c.name}#${m.name}#${m.parameterTypes.size}"
                    val isNew = synchronized(pickResultHookedMembers) { pickResultHookedMembers.add(key) }
                    if (!isNew) continue
                    XposedBridge.hookMethod(m, object : XC_MethodHook() {
                        override fun afterHookedMethod(param: XC_MethodHook.MethodHookParam) {
                            val threeArg = m.parameterTypes.size == 3
                            val rc = (if (threeArg) param.args[0] else param.args[1]) as? Int
                            val result = (if (threeArg) param.args[1] else param.args[2]) as? Int
                            val data = (if (threeArg) param.args[2] else param.args[3]) as? Intent
                            if (rc != null && (rc == REQ_PICK_IMAGE || awaitingImagePick)) {
                                XposedBridge.log("$TAG: activity-result path fired ${c.simpleName}.${m.name}/${m.parameterTypes.size} rc=$rc result=$result awaiting=$awaitingImagePick data=${data != null} uri=${data?.data} on@${System.identityHashCode(param.thisObject)}")
                            }
                            if (rc != null && result != null) {
                                handleImagePickResult(rc, result, data)
                            }
                        }
                    })
                    hooked++
                    XposedBridge.log("$TAG: pick hook → ${c.name}.${m.name}(${m.parameterTypes.size} args)")
                }
            }
            XposedBridge.log("$TAG: pick hooks installed: $hooked")
        } catch (t: Throwable) {
            XposedBridge.log("$TAG: multi-hook install failed: $t")
        }
    }

    /** Called from the hooked onActivityResult; one-shot via awaitingImagePick. */
    private fun handleImagePickResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_PICK_IMAGE || !awaitingImagePick) return
        awaitingImagePick = false
        XposedBridge.log("$TAG: image pick result result=$resultCode uri=${data?.data}")
        if (resultCode != Activity.RESULT_OK) return
        val uri: Uri = data?.data ?: return
        val appCtx = panelView?.context?.applicationContext ?: return
        scope.launch(Dispatchers.IO) {
            try {
                val staged = buildStagedImage(appCtx, uri)
                    ?: throw IllegalStateException("could not decode the picked image")
                Handler(Looper.getMainLooper()).post {
                    stagedImages.add(staged)
                    renderStagedRow()
                    Toast.makeText(appCtx, "Image attached — it saves with the draft", Toast.LENGTH_SHORT).show()
                }
            } catch (t: Throwable) {
                XposedBridge.log("$TAG: image attach failed: $t")
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(appCtx, "Image attach failed: ${t.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /** Decode → downscale (longest side ≤ [MAX_IMAGE_DIM]) → JPEG q80 → base64
     *  data-url <img> tag. EXIF rotation is applied because the re-encode drops it. */
    private fun buildStagedImage(ctx: Context, uri: Uri): StagedImage? {
        val cr = ctx.contentResolver

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        val maxSide = maxOf(bounds.outWidth, bounds.outHeight)
        while (maxSide / (sample * 2) >= MAX_IMAGE_DIM) sample *= 2

        val decoded = cr.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null

        var out: Bitmap = if (decoded.width > MAX_IMAGE_DIM || decoded.height > MAX_IMAGE_DIM) {
            val ratio = minOf(
                MAX_IMAGE_DIM.toFloat() / decoded.width,
                MAX_IMAGE_DIM.toFloat() / decoded.height
            )
            Bitmap.createScaledBitmap(
                decoded, (decoded.width * ratio).toInt(), (decoded.height * ratio).toInt(), true
            )
        } else {
            decoded
        }

        try {
            val orientation = cr.openInputStream(uri)?.use {
                ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            } ?: ExifInterface.ORIENTATION_NORMAL
            val matrix = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            }
            if (!matrix.isIdentity) {
                out = Bitmap.createBitmap(out, 0, 0, out.width, out.height, matrix, true)
            }
        } catch (t: Throwable) {
            // rotation is best-effort metadata; the image itself is intact
            XposedBridge.log("$TAG: exif orientation read failed (rotation skipped): $t")
        }

        val baos = ByteArrayOutputStream()
        out.compress(Bitmap.CompressFormat.JPEG, 80, baos)
        val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
        return StagedImage("<img src=\"data:image/jpeg;base64,$b64\">", out)
    }

    /** Rebuilds the chip row above the input: thumbnail + ✕ per staged image. */
    private fun renderStagedRow() {
        Handler(Looper.getMainLooper()).post {
            val row = stagedRow ?: return@post
            val ctx = row.context
            row.removeAllViews()
            row.visibility = if (stagedImages.isEmpty()) View.GONE else View.VISIBLE
            stagedImages.forEachIndexed { idx, img ->
                val chip = FrameLayout(ctx)
                val thumb = ImageView(ctx).apply {
                    setImageBitmap(img.bitmap)
                    scaleType = ImageView.ScaleType.CENTER_CROP
                }
                chip.addView(thumb, FrameLayout.LayoutParams(dp(ctx, 56), dp(ctx, 56)))
                val remove = TextView(ctx).apply {
                    text = "✕"
                    textSize = 11f
                    setTextColor(WHITE)
                    setBackgroundColor(0x99000000.toInt())
                    setPadding(dp(ctx, 4), dp(ctx, 1), dp(ctx, 4), dp(ctx, 1))
                }
                remove.setOnClickListener {
                    if (idx in stagedImages.indices) {
                        stagedImages.removeAt(idx)
                        renderStagedRow()
                        Toast.makeText(ctx, "Image removed", Toast.LENGTH_SHORT).show()
                    }
                }
                chip.addView(remove, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT
                ).apply { gravity = Gravity.TOP or Gravity.END })
                val cl = LinearLayout.LayoutParams(dp(ctx, 56), dp(ctx, 56))
                cl.rightMargin = dp(ctx, 6)
                row.addView(chip, cl)
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
            if (isPanelVisible && id.matches(Regex("^(messenger|instagram)_(web|android)_\\d+_.+"))) {
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
