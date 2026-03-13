package com.fahad.glitchdraft.lsposed.hook

import android.app.Activity
import android.content.res.AssetManager
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.TextView
import com.fahad.glitchdraft.lsposed.overlay.OverlayController
import de.robv.android.xposed.IXposedHookLoadPackage
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import de.robv.android.xposed.callbacks.XC_LoadPackage
import java.io.InputStream

/**
 * GlitchDraftHook
 *
 * LSPosed / Xposed module entry point.
 *
 * Strategy
 * --------
 * GlitchDraft's browser extension injects content.js + styles.css into web pages
 * through the Chrome/Firefox extension APIs.  On Android there is no extension
 * API, so we hook WebView's page-lifecycle methods instead:
 *
 *   - WebViewClient.onPageFinished()   → inject CSS then JS after every navigation
 *   - WebView.loadUrl()                → detect when a supported URL is being loaded
 *
 * The injected JavaScript is the exact same content.js that the browser extension
 * uses (bundled inside assets/), adapted via a tiny shim (glitchdraft_shim.js)
 * that polyfills the chrome.* APIs using Android-to-WebView message bridges.
 *
 * Supported packages (scope set in LSPosed Manager):
 *   com.facebook.orca          – Messenger
 *   com.facebook.katana        – Facebook (web view)
 *   com.discord                – Discord
 *   com.whatsapp               – WhatsApp
 *   com.android.chrome         – Chrome (general WebView hook)
 *   org.mozilla.firefox        – Firefox for Android
 *   com.microsoft.emmx         – Microsoft Edge
 *   com.opera.browser          – Opera
 *   com.brave.browser          – Brave
 */
class GlitchDraftHook : IXposedHookLoadPackage {

    companion object {
        private const val TAG = "GlitchDraft-LSPosed"

        /** Packages whose WebViews we want to target */
        private val TARGET_PACKAGES = setOf(
            "com.facebook.orca",
            "com.facebook.katana",
            "com.discord",
            "com.whatsapp",
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "org.mozilla.firefox",
            "org.mozilla.fenix",
            "com.microsoft.emmx",
            "com.opera.browser",
            "com.opera.mini.native",
            "com.brave.browser",
            "com.kiwibrowser.browser"
        )

        /** URL substrings that trigger injection (mirrors manifest.json host_permissions) */
        private val TARGET_URLS = listOf(
            "messenger.com",
            "facebook.com/messages",
            "discord.com/channels",
            "web.whatsapp.com",
            "hostseba.com/register.php"
        )
    }

    // -------------------------------------------------------------------------
    // IXposedHookLoadPackage
    // -------------------------------------------------------------------------

    override fun handleLoadPackage(lpparam: XC_LoadPackage.LoadPackageParam) {
        if (lpparam.packageName !in TARGET_PACKAGES) return

        XposedBridge.log("$TAG: Hooking package ${lpparam.packageName}")

        hookWebViewClient(lpparam)
        hookWebViewLoadUrl(lpparam)
        hookActivityForOverlay(lpparam)
        hookMessengerThreadNavigation(lpparam)
    }

    // -------------------------------------------------------------------------
    // Hook Activity.onResume → attach in-process overlay (native UI coverage)
    // -------------------------------------------------------------------------

    private fun hookActivityForOverlay(lpparam: XC_LoadPackage.LoadPackageParam) {
        // Load the extension icon once for use as the toggle button icon
        val iconBitmap = try {
            getModuleAssetManager(lpparam)
                ?.open("glitchdraft/icon128.png")
                ?.use { BitmapFactory.decodeStream(it) }
        } catch (_: Throwable) { null }

        try {
            val activityClass = XposedHelpers.findClass("android.app.Activity", lpparam.classLoader)

            XposedHelpers.findAndHookMethod(
                activityClass,
                "onResume",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val activity = param.thisObject as? Activity ?: return
                        val activityName = activity.javaClass.simpleName

                        Handler(Looper.getMainLooper()).post {
                            try {
                                if (!OverlayController.isAttached()) {
                                    XposedBridge.log("$TAG: Attaching overlay for $activityName in ${lpparam.packageName}")
                                    if (iconBitmap != null) OverlayController.setIcon(iconBitmap)
                                    OverlayController.attach(activity, lpparam.packageName)
                                }
                                // Show the overlay toggle (was hidden on pause)
                                OverlayController.show()
                                // Try to extract a chat ID from the Activity's intent
                                // each time it resumes (covers navigation between conversations)
                                val chatId = extractChatIdFromActivity(activity, lpparam.packageName)
                                XposedBridge.log("$TAG: onResume [$activityName] intent=${activity.intent?.data} extras=${activity.intent?.extras?.keySet()} → chatId=$chatId")
                                if (chatId != null) {
                                    OverlayController.setChatId(chatId)
                                }
                                // Extract conversation name from the view hierarchy
                                val chatName = extractChatNameFromActivity(activity, lpparam.packageName)
                                OverlayController.setChatName(chatName)
                            } catch (e: Throwable) {
                                XposedBridge.log("$TAG: OverlayController.attach failed: $e")
                            }
                        }
                    }
                }
            )

            // Hide overlay when the activity loses focus (user switches apps, goes to home, etc.)
            XposedHelpers.findAndHookMethod(
                activityClass,
                "onPause",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        OverlayController.hide()
                    }
                }
            )

        } catch (e: Throwable) {
            XposedBridge.log("$TAG: Failed to hook Activity.onResume: $e")
        }
    }

    /**
     * Extracts a stable chat identifier from the Activity's Intent.
     *
     * Messenger deep-links look like:
     *   fb://messaging/{thread_id}
     *   https://www.messenger.com/t/{thread_key}
     *
     * WhatsApp:
     *   intent with extras: jid, phone
     *
     * Discord:
     *   discord://discord.com/channels/{guild}/{channel}
     */
    private fun extractChatIdFromActivity(activity: Activity, pkg: String): String? {
        return try {
            val intent = activity.intent ?: run {
                XposedBridge.log("$TAG: extractChatId — no intent")
                return null
            }
            val data = intent.data
            XposedBridge.log("$TAG: extractChatId — pkg=$pkg data=$data action=${intent.action}")

            // Dump all intent extras for debug
            intent.extras?.keySet()?.forEach { key ->
                XposedBridge.log("$TAG: extractChatId — extra[$key]=${intent.extras?.get(key)}")
            }

            val result = when {
                pkg.contains("facebook") || pkg.contains("orca") -> {
                    data?.let { uri ->
                        val path = uri.path ?: ""
                        val segments = uri.pathSegments
                        XposedBridge.log("$TAG: extractChatId — FB uri=$uri path=$path segments=$segments")
                        when {
                            uri.scheme == "fb" && path.startsWith("/messaging/") -> {
                                val last = segments.lastOrNull() ?: return@let null
                                normalizeToFirestoreId(last, "messenger")
                            }
                            path.contains("/t/") -> {
                                val idx = segments.indexOf("t")
                                if (idx >= 0 && idx + 1 < segments.size) segments[idx + 1] else null
                            }
                            else -> null
                        }
                    } ?: run {
                        val threadKey = intent.getStringExtra("thread_key")
                            ?: intent.getLongExtra("thread_id", -1L).takeIf { it != -1L }?.toString()
                        XposedBridge.log("$TAG: extractChatId — FB extras fallback threadKey=$threadKey")
                        threadKey?.let { normalizeToFirestoreId(it, "messenger") }
                    }
                }
                pkg.contains("whatsapp") -> {
                    val jid = intent.getStringExtra("jid")
                        ?: intent.getStringExtra("phone_number")
                        ?: data?.getQueryParameter("phone")
                    XposedBridge.log("$TAG: extractChatId — WA jid=$jid")
                    jid?.let { normalizeToFirestoreId(it, "whatsapp") }
                }
                pkg.contains("discord") -> {
                    data?.let { uri ->
                        val segments = uri.pathSegments
                        val idx = segments.indexOf("channels")
                        val id = if (idx >= 0 && idx + 2 < segments.size) "discord_${segments[idx + 2]}" else null
                        XposedBridge.log("$TAG: extractChatId — Discord segments=$segments id=$id")
                        id
                    }
                }
                else -> null
            }
            XposedBridge.log("$TAG: extractChatId → result=$result")
            result
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: extractChatIdFromActivity failed: $e")
            null
        }
    }

    // -------------------------------------------------------------------------
    // Hook Messenger's Fragment navigation to detect thread changes
    // -------------------------------------------------------------------------

    /**
     * Messenger uses internal Fragments (not separate Activities) for each
     * conversation.  Their class names are obfuscated so we can't reference them
     * directly.  Instead we hook Fragment.onResume() and scan arguments /
     * fields for any value that looks like a thread ID (long number or string).
     *
     * The Fragment's arguments Bundle is checked for common key patterns.
     * We also scan the Fragment's own fields for anything named like *thread*,
     * *conversation*, *chat*, *key*.
     *
     * For WhatsApp: hook Fragment.onResume and look for "jid" or "contact_jid".
     */
    private fun hookMessengerThreadNavigation(lpparam: XC_LoadPackage.LoadPackageParam) {
        val pkg = lpparam.packageName
        if (!pkg.contains("facebook") && !pkg.contains("orca") &&
            !pkg.contains("whatsapp") && !pkg.contains("discord")) return

        try {
            val fragmentClass = try {
                // AndroidX Fragment
                XposedHelpers.findClass("androidx.fragment.app.Fragment", lpparam.classLoader)
            } catch (_: Throwable) {
                // Support Fragment fallback
                XposedHelpers.findClass("android.support.v4.app.Fragment", lpparam.classLoader)
            }

            XposedHelpers.findAndHookMethod(
                fragmentClass,
                "onResume",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val fragment = param.thisObject ?: return
                        val fragName = fragment.javaClass.simpleName

                        // Only process fragments whose class name hints at conversations
                        val isConvoFragment = fragName.contains("Conversation", ignoreCase = true)
                            || fragName.contains("Thread", ignoreCase = true)
                            || fragName.contains("Chat", ignoreCase = true)
                            || fragName.contains("Message", ignoreCase = true)
                            || fragName.contains("Inbox", ignoreCase = true)

                        // Try to get args Bundle via getArguments()
                        val args = try {
                            val m = fragment.javaClass.getMethod("getArguments")
                            m.invoke(fragment) as? android.os.Bundle
                        } catch (_: Throwable) { null }

                        // Dump all args for debug (only for interesting fragments)
                        if (args != null) {
                            args.keySet()?.forEach { key ->
                                XposedBridge.log("$TAG: Fragment[$fragName] arg[$key]=${args.get(key)}")
                            }
                        }

                        // Dump args_surface_options fields for debug (name may be there)
                        val surfaceOptions = args?.get("args_surface_options")
                        if (surfaceOptions != null) {
                            try {
                                var cls: Class<*>? = surfaceOptions.javaClass
                                while (cls != null && cls != Any::class.java) {
                                    for (f in cls.declaredFields) {
                                        f.isAccessible = true
                                        val v = try { f.get(surfaceOptions) } catch (_: Throwable) { null }
                                        val vStr = v?.toString() ?: continue
                                        if (vStr.length in 1..100) {
                                            XposedBridge.log("$TAG: SurfaceOptions field[${f.name}:${f.type.simpleName}]='$vStr'")
                                        }
                                    }
                                    cls = cls.superclass
                                }
                            } catch (e: Throwable) {
                                XposedBridge.log("$TAG: SurfaceOptions dump failed: $e")
                            }
                        }

                        // Scan fields of the fragment for thread/conversation IDs
                        val chatId = extractFromFragmentArgs(args, pkg, fragName)
                            ?: scanFragmentFields(fragment, fragName, pkg)

                        if (chatId != null) {
                            XposedBridge.log("$TAG: Fragment[$fragName] → chatId=$chatId")
                            Handler(Looper.getMainLooper()).post {
                                OverlayController.setChatId(chatId)
                                // Delay name extraction so the UI is fully rendered
                                Handler(Looper.getMainLooper()).postDelayed({
                                    val activity = try {
                                        val m = fragment.javaClass.getMethod("getActivity")
                                        m.invoke(fragment) as? Activity
                                    } catch (_: Throwable) { null }

                                    val fragmentView = try {
                                        val m = fragment.javaClass.getMethod("getView")
                                        m.invoke(fragment) as? View
                                    } catch (_: Throwable) { null }

                                    XposedBridge.log("$TAG: Fragment[$fragName] delayed: fragmentView=$fragmentView activity=$activity")

                                    val chatName = when {
                                        fragmentView != null -> extractNameFromFragmentView(fragmentView, activity)
                                        activity != null -> dumpAndExtractNameFromActivity(activity, pkg)
                                        else -> null
                                    }
                                    XposedBridge.log("$TAG: Fragment[$fragName] chatName=$chatName (delayed)")

                                    // If we got a name, rebuild the chatId to include the name slug
                                    // e.g. "messenger_android_410625006" + "Cat Fren" → "messenger_android_410625006_cat_fren"
                                    if (chatName != null && chatId.startsWith("messenger_android_")) {
                                        val numericPart = chatId.removePrefix("messenger_android_")
                                        val slug = sanitizeNameSlug(chatName)
                                        if (slug.isNotBlank()) {
                                            val fullId = "messenger_android_${numericPart}_${slug}"
                                            XposedBridge.log("$TAG: Fragment[$fragName] updated chatId=$fullId")
                                            OverlayController.setChatId(fullId)
                                        }
                                    }
                                    OverlayController.setChatName(chatName)
                                }, 800)
                            }
                        }
                    }
                }
            )
            XposedBridge.log("$TAG: Hooked Fragment.onResume for $pkg")
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: hookMessengerThreadNavigation failed: $e")
        }
    }

    private fun extractFromFragmentArgs(args: android.os.Bundle?, pkg: String, fragName: String): String? {
        if (args == null || args.isEmpty) return null
        val prefix = when {
            pkg.contains("whatsapp") -> "whatsapp"
            pkg.contains("discord") -> "discord"
            else -> "messenger"
        }

        // Key patterns to try
        val patterns = listOf(
            "thread_id", "thread_key", "threadId", "threadKey",
            "conversation_id", "conversationId",
            "jid", "contact_jid", "target_jid",
            "channel_id", "channelId",
            "chat_id", "chatId"
        )
        for (key in patterns) {
            val v = args.get(key)
            if (v != null && v.toString().isNotBlank()) {
                XposedBridge.log("$TAG: Fragment[$fragName] found key=$key value=$v")
                return normalizeToFirestoreId(v.toString(), prefix)
            }
        }
        // Also try any key that contains "thread", "chat", "conversation", "jid"
        args.keySet()?.forEach { key ->
            val lower = key.lowercase()
            if (lower.contains("thread") || lower.contains("chat") ||
                lower.contains("conversation") || lower.contains("jid") ||
                lower.contains("channel")) {
                val v = args.get(key)
                if (v != null && v.toString().isNotBlank()) {
                    XposedBridge.log("$TAG: Fragment[$fragName] heuristic key=$key value=$v")
                    return normalizeToFirestoreId(v.toString(), prefix)
                }
            }
        }
        return null
    }

    /**
     * Converts a raw thread key to a Firestore document ID that matches
     * what the browser extension uses.
     *
     * Messenger: "ADVANCED_CRYPTO_ONE_TO_ONE:410625012" → "messenger_410625012"
     *            (extension reads /t/(\d+) from URL → "messenger_" + the number)
     * WhatsApp:  "1234567890@s.whatsapp.net" → "whatsapp_1234567890"
     *            (extension uses jid without domain)
     * Discord:   "1234567" → "discord_GUILD_1234567"
     *            (extension uses discord_{guild}_{channel})
     */
    private fun normalizeToFirestoreId(raw: String, prefix: String, name: String? = null): String {
        return when (prefix) {
            "messenger" -> {
                // "TYPE:numeric_id" → "messenger_android_numeric_id[_nameslug]"
                val colonIdx = raw.lastIndexOf(':')
                val numericId = if (colonIdx >= 0) raw.substring(colonIdx + 1) else raw
                val slug = name?.let { sanitizeNameSlug(it) }?.takeIf { it.isNotBlank() }
                if (slug != null) "messenger_android_${numericId}_${slug}" else "messenger_android_$numericId"
            }
            "whatsapp" -> {
                // "1234567890@s.whatsapp.net" → "1234567890"
                raw.substringBefore("@")
            }
            else -> "${prefix}_$raw"
        }
    }

    /** Converts a display name to a safe slug for Firestore doc IDs.
     *  e.g. "Cat Fren" → "cat_fren", "فلان الفلاني" → arabic chars kept but spaces → "_"
     */
    private fun sanitizeNameSlug(name: String): String {
        return name.trim()
            .lowercase()
            .replace(Regex("[^\\p{L}\\p{N}]"), "_")  // non-letter/digit → _
            .replace(Regex("_+"), "_")                 // collapse multiple _
            .trim('_')
            .take(50)
    }

    private fun scanFragmentFields(fragment: Any, fragName: String, pkg: String): String? {
        val prefix = when {
            pkg.contains("whatsapp") -> "whatsapp"
            pkg.contains("discord") -> "discord"
            else -> "messenger"
        }
        return try {
            var cls: Class<*>? = fragment.javaClass
            while (cls != null && cls.name != "java.lang.Object") {
                for (field in cls.declaredFields) {
                    val name = field.name.lowercase()
                    if (name.contains("thread") || name.contains("chat") ||
                        name.contains("conversation") || name.contains("jid") ||
                        name.contains("channel")) {
                        field.isAccessible = true
                        val v = field.get(fragment)
                        if (v != null && v.toString().isNotBlank() &&
                            v.toString() != "null") {
                            XposedBridge.log("$TAG: Fragment[$fragName] field[${field.name}]=$v")
                            return normalizeToFirestoreId(v.toString(), prefix)
                        }
                    }
                }
                cls = cls.superclass
            }
            null
        } catch (_: Throwable) { null }
    }

    // -------------------------------------------------------------------------
    // Hook WebViewClient.onPageFinished
    // -------------------------------------------------------------------------

    private fun hookWebViewClient(lpparam: XC_LoadPackage.LoadPackageParam) {
        try {
            val webViewClientClass = XposedHelpers.findClass(
                "android.webkit.WebViewClient",
                lpparam.classLoader
            )

            XposedHelpers.findAndHookMethod(
                webViewClientClass,
                "onPageFinished",
                WebView::class.java,
                String::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val webView = param.args[0] as? WebView ?: return
                        val url = param.args[1] as? String ?: return

                        if (!isTargetUrl(url)) return

                        // Keep the overlay panel's chat-ID in sync
                        extractChatId(url)?.let { OverlayController.setChatId(it) }

                        XposedBridge.log("$TAG: onPageFinished triggered for $url")
                        OverlayController.setWebView(webView)
                        injectGlitchDraft(webView, lpparam)
                    }
                }
            )
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: Failed to hook WebViewClient.onPageFinished: $e")
        }
    }

    // -------------------------------------------------------------------------
    // Hook WebView.loadUrl (catches SPA navigations that don't fire onPageFinished)
    // -------------------------------------------------------------------------

    private fun hookWebViewLoadUrl(lpparam: XC_LoadPackage.LoadPackageParam) {
        try {
            val webViewClass = XposedHelpers.findClass(
                "android.webkit.WebView",
                lpparam.classLoader
            )

            // loadUrl(String)
            XposedHelpers.findAndHookMethod(
                webViewClass,
                "loadUrl",
                String::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val webView = param.thisObject as? WebView ?: return
                        val url = param.args[0] as? String ?: return

                        if (!isTargetUrl(url)) return

                        // Keep the overlay panel's chat-ID in sync
                        extractChatId(url)?.let { OverlayController.setChatId(it) }

                        // Delay slightly so the page has a chance to start loading
                        Handler(Looper.getMainLooper()).postDelayed({
                            injectGlitchDraft(webView, lpparam)
                        }, 1500)
                    }
                }
            )
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: Failed to hook WebView.loadUrl: $e")
        }
    }

    // -------------------------------------------------------------------------
    // Injection logic
    // -------------------------------------------------------------------------

    private fun injectGlitchDraft(webView: WebView, lpparam: XC_LoadPackage.LoadPackageParam) {
        // Must run on the main thread
        Handler(Looper.getMainLooper()).post {
            try {
                // Enable JavaScript (required for injection)
                webView.settings.javaScriptEnabled = true

                // Load assets from module APK (not from the hooked app)
                val assetManager = getModuleAssetManager(lpparam) ?: run {
                    XposedBridge.log("$TAG: Could not obtain module AssetManager")
                    return@post
                }

                val css = readAsset(assetManager, "glitchdraft/styles.css")
                val shim = readAsset(assetManager, "glitchdraft/glitchdraft_shim.js")
                val draftImportJs = readAsset(assetManager, "glitchdraft/draftImport.js")
                val draftSyncJs = readAsset(assetManager, "glitchdraft/draftSync.js")
                val contentJs = readAsset(assetManager, "glitchdraft/content.js")

                if (css == null || shim == null || draftImportJs == null || draftSyncJs == null || contentJs == null) {
                    XposedBridge.log("$TAG: One or more assets could not be read, aborting injection")
                    return@post
                }

                // 1. Inject CSS
                val escapedCss = css
                    .replace("\\", "\\\\")
                    .replace("`", "\\`")
                val cssInjection = """
                    (function() {
                        if (document.getElementById('__glitchdraft_css__')) return;
                        const style = document.createElement('style');
                        style.id = '__glitchdraft_css__';
                        style.textContent = `$escapedCss`;
                        document.head.appendChild(style);
                    })();
                """.trimIndent()

                webView.evaluateJavascript(cssInjection, null)

                // 2. Inject shim (must come before content.js)
                val guardedShim = """
                    (function() {
                        if (window.__glitchdraft_shim_loaded__) return;
                        window.__glitchdraft_shim_loaded__ = true;
                        $shim
                    })();
                """.trimIndent()

                webView.evaluateJavascript(guardedShim) {
                    // 3. Inject module files (must come after shim, before content.js)
                    val guardedImport = """
                        (function() {
                            if (window.__glitchdraft_import_loaded__) return;
                            window.__glitchdraft_import_loaded__ = true;
                            $draftImportJs
                        })();
                    """.trimIndent()
                    val guardedSync = """
                        (function() {
                            if (window.__glitchdraft_sync_loaded__) return;
                            window.__glitchdraft_sync_loaded__ = true;
                            $draftSyncJs
                        })();
                    """.trimIndent()

                    webView.evaluateJavascript(guardedImport) {
                        webView.evaluateJavascript(guardedSync) {
                            // 4. Inject content.js only after modules are ready
                            val guardedContent = """
                                (function() {
                                    if (window.__glitchdraft_loaded__) return;
                                    window.__glitchdraft_loaded__ = true;
                                    $contentJs
                                })();
                            """.trimIndent()

                            webView.evaluateJavascript(guardedContent) { result ->
                                XposedBridge.log("$TAG: Injection complete, result=$result")
                            }
                        }
                    }
                }

            } catch (e: Throwable) {
                XposedBridge.log("$TAG: Injection error: $e")
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private fun isTargetUrl(url: String): Boolean =
        TARGET_URLS.any { url.contains(it, ignoreCase = true) }

    /**
     * Extract a stable chat ID from the URL so the overlay panel can scope
     * drafts to the current conversation.
     * e.g. "https://www.messenger.com/t/123456" → "messenger_123456"
     */
    private fun extractChatId(url: String): String? {
        return try {
            val uri = android.net.Uri.parse(url)
            when {
                url.contains("messenger.com/t/") -> {
                    val segments = uri.pathSegments
                    val idx = segments.indexOf("t")
                    if (idx >= 0 && idx + 1 < segments.size) "messenger_${segments[idx + 1]}" else null
                }
                url.contains("discord.com/channels/") -> {
                    val segments = uri.pathSegments
                    // /channels/{guild}/{channel}
                    val idx = segments.indexOf("channels")
                    if (idx >= 0 && idx + 2 < segments.size) "discord_${segments[idx + 2]}" else null
                }
                url.contains("web.whatsapp.com") -> null  // WhatsApp uses in-page JS for chat ID
                else -> null
            }
        } catch (_: Throwable) { null }
    }

    /**
     * Obtain the AssetManager of the **module** APK (not the hooked app).
     * We use the module's own Resources object, which LSPosed attaches to the
     * LoadPackageParam via the module path.
     */
    private fun getModuleAssetManager(lpparam: XC_LoadPackage.LoadPackageParam): AssetManager? {
        return try {
            val modulePath = XposedBridge::class.java
                .getMethod("getXposedVersion")
                .let { lpparam.classLoader }
                .let { _ ->
                    // Retrieve module APK path from XposedBridge context
                    XposedHelpers.getObjectField(
                        XposedBridge::class.java.getDeclaredField("moduleContext").also {
                            it.isAccessible = true
                        }.get(null),
                        "assets"
                    ) as? AssetManager
                }
            modulePath
        } catch (_: Throwable) {
            // Fallback: attempt to open the module APK directly via ActivityThread
            try {
                val activityThreadClass = XposedHelpers.findClass(
                    "android.app.ActivityThread",
                    lpparam.classLoader
                )
                val currentApp = XposedHelpers.callStaticMethod(
                    activityThreadClass, "currentApplication"
                ) as? android.app.Application

                // Walk the loaded apk list to find ours
                val packageManager = currentApp?.packageManager ?: return null
                val moduleApkPath = packageManager
                    .getApplicationInfo("com.fahad.glitchdraft.lsposed", 0)
                    .sourceDir

                val assetManager = AssetManager::class.java.newInstance()
                XposedHelpers.callMethod(assetManager, "addAssetPath", moduleApkPath)
                assetManager
            } catch (e2: Throwable) {
                XposedBridge.log("$TAG: getModuleAssetManager fallback failed: $e2")
                null
            }
        }
    }

    /**
     * Scans the Activity's window DecorView for a candidate conversation name.
     *
     * Strategy (in priority order):
     *  1. Activity.title — on some Messenger builds the ActionBar title is the name
     *  2. Walk the DecorView for a Toolbar and read its title TextView (via reflection)
     *  3. Walk TextViews in the top 25% of screen — name is always in the header bar
     */
    private fun extractChatNameFromActivity(activity: Activity, pkg: String): String? {
        if (!pkg.contains("facebook") && !pkg.contains("orca")) return null
        return try {
            // Strategy 1: ActionBar / window title
            val winTitle = activity.title?.toString()?.trim()
            if (!winTitle.isNullOrBlank() && isValidName(winTitle)) {
                XposedBridge.log("$TAG: chatName from title='$winTitle'")
                return winTitle
            }

            // Strategy 2+3: walk DecorView
            val decorView = activity.window?.decorView ?: return null
            extractNameFromViewTree(decorView, activity)
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: extractChatNameFromActivity failed: $e")
            null
        }
    }

    private fun extractNameFromViewTree(root: View, activity: Activity): String? {
        val screenHeight = try { activity.window.decorView.height.takeIf { it > 0 } ?: 2400 } catch (_: Throwable) { 2400 }
        val headerZone = screenHeight / 4  // top 25% of screen

        val queue = ArrayDeque<View>()
        queue.add(root)
        val candidates = mutableListOf<Pair<Int, String>>() // <y-position, text>

        while (queue.isNotEmpty()) {
            val v = queue.removeFirst()

            // Strategy 2: try to read Toolbar title via reflection
            if (v.javaClass.name.contains("Toolbar", ignoreCase = true)) {
                for (fieldName in listOf("mTitleTextView", "titleTextView", "mTitle")) {
                    val toolbarTitle = try {
                        val f = findFieldInHierarchy(v.javaClass, fieldName) ?: continue
                        f.isAccessible = true
                        val value = f.get(v)
                        if (value is TextView) value.text?.toString()?.trim()
                        else value?.toString()?.trim()
                    } catch (_: Throwable) { null }
                    if (toolbarTitle != null && isValidName(toolbarTitle)) {
                        XposedBridge.log("$TAG: chatName from Toolbar.$fieldName='$toolbarTitle'")
                        return toolbarTitle
                    }
                }
            }

            if (v is ViewGroup) {
                for (i in 0 until v.childCount) queue.add(v.getChildAt(i))
            }

            // Strategy 3: TextViews in the header zone only
            if (v is TextView) {
                val text = v.text?.toString()?.trim() ?: continue
                if (!isValidName(text)) continue
                val loc = IntArray(2)
                v.getLocationOnScreen(loc)
                val y = loc[1]
                if (y in 0..headerZone) {
                    candidates.add(y to text)
                }
            }
        }

        if (candidates.isEmpty()) return null
        val best = candidates.minByOrNull { it.first }?.second
        XposedBridge.log("$TAG: chatName from view tree='$best'")
        return best
    }

    /**
     * Scans the Activity's DecorView for the conversation name using
     * content descriptions and accessibility nodes (works with Litho).
     */
    private fun dumpAndExtractNameFromActivity(activity: Activity, pkg: String): String? {
        if (!pkg.contains("facebook") && !pkg.contains("orca")) return null
        return try {
            val decorView = activity.window?.decorView ?: run {
                XposedBridge.log("$TAG: dumpAndExtract — no decorView")
                return null
            }
            val screenHeight = try { decorView.height.takeIf { it > 0 } ?: 2400 } catch (_: Throwable) { 2400 }
            val headerZone = screenHeight / 3  // top 33% of screen

            val queue = ArrayDeque<View>()
            queue.add(decorView)
            val candidates = mutableListOf<Triple<Int, Int, String>>() // y, x, text

            while (queue.isNotEmpty()) {
                val v = queue.removeFirst()
                if (v is ViewGroup) {
                    for (i in 0 until v.childCount) queue.add(v.getChildAt(i))
                }
                val loc = IntArray(2)
                v.getLocationOnScreen(loc)
                val y = loc[1]
                if (y > headerZone) continue

                // contentDescription
                val cd = v.contentDescription?.toString()?.trim()
                if (cd != null && isValidName(cd)) {
                    XposedBridge.log("$TAG: DecorCD y=$y cls=${v.javaClass.simpleName} cd='$cd'")
                    candidates.add(Triple(y, loc[0], cd))
                }

                // getText()
                val text = try {
                    val m = v.javaClass.getMethod("getText")
                    (m.invoke(v) as? CharSequence)?.toString()?.trim()
                } catch (_: Throwable) { null }
                if (text != null && isValidName(text)) {
                    XposedBridge.log("$TAG: DecorText y=$y cls=${v.javaClass.simpleName} text='$text'")
                    candidates.add(Triple(y, loc[0], text))
                }

                // accessibility node
                try {
                    val node = v.createAccessibilityNodeInfo()
                    if (node != null) {
                        val nodeText = node.text?.toString()?.trim()
                        if (nodeText != null && isValidName(nodeText)) {
                            XposedBridge.log("$TAG: DecorA11y y=$y cls=${v.javaClass.simpleName} text='$nodeText'")
                            candidates.add(Triple(y, loc[0], nodeText))
                        }
                        node.recycle()
                    }
                } catch (_: Throwable) {}
            }

            val best = candidates.minByOrNull { it.first }?.third
            XposedBridge.log("$TAG: dumpAndExtract → best='$best' from ${candidates.size} candidates")
            best
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: dumpAndExtractNameFromActivity failed: $e")
            null
        }
    }

    private fun findFieldInHierarchy(cls: Class<*>, name: String): java.lang.reflect.Field? {
        var c: Class<*>? = cls
        while (c != null && c != Any::class.java) {
            try { return c.getDeclaredField(name) } catch (_: NoSuchFieldException) {}
            c = c.superclass
        }
        return null
    }

    /**
     * Scans a fragment's view subtree for the conversation name.
     * Uses content descriptions and accessibility nodes (works with Litho).
     * Messenger sets contentDescription="Name, Thread details" on the header row.
     */
    private fun extractNameFromFragmentView(fragmentView: View, activity: Activity?): String? {
        val screenHeight = try { activity?.window?.decorView?.height?.takeIf { it > 0 } ?: 2400 } catch (_: Throwable) { 2400 }
        val headerZone = screenHeight / 3  // top 33% of screen

        val queue = ArrayDeque<View>()
        queue.add(fragmentView)

        while (queue.isNotEmpty()) {
            val v = queue.removeFirst()
            if (v is ViewGroup) {
                for (i in 0 until v.childCount) queue.add(v.getChildAt(i))
            }

            val loc = IntArray(2)
            v.getLocationOnScreen(loc)
            if (loc[1] > headerZone) continue  // only look in header area

            // Strategy 1: contentDescription — look for "Name, Thread details" pattern
            val cd = v.contentDescription?.toString()?.trim()
            if (cd != null) {
                val nameFromCd = extractNameFromThreadDetails(cd)
                if (nameFromCd != null) {
                    XposedBridge.log("$TAG: chatName from contentDesc='$nameFromCd' (original='$cd')")
                    return nameFromCd
                }
            }

            // Strategy 2: accessibility node text
            try {
                val node = v.createAccessibilityNodeInfo()
                if (node != null) {
                    val nodeText = node.text?.toString()?.trim()
                    if (nodeText != null) {
                        val nameFromNode = extractNameFromThreadDetails(nodeText)
                        if (nameFromNode != null) {
                            XposedBridge.log("$TAG: chatName from a11y='$nameFromNode'")
                            node.recycle()
                            return nameFromNode
                        }
                    }
                    node.recycle()
                }
            } catch (_: Throwable) {}
        }

        // Fallback: any valid name-like content description in header zone
        val fallbackQueue = ArrayDeque<View>()
        fallbackQueue.add(fragmentView)
        val fallbackCandidates = mutableListOf<Pair<Int, String>>()
        while (fallbackQueue.isNotEmpty()) {
            val v = fallbackQueue.removeFirst()
            if (v is ViewGroup) {
                for (i in 0 until v.childCount) fallbackQueue.add(v.getChildAt(i))
            }
            val loc = IntArray(2)
            v.getLocationOnScreen(loc)
            if (loc[1] > headerZone) continue
            val cd = v.contentDescription?.toString()?.trim()
            if (cd != null && isValidName(cd) && cd.lowercase() != "back") {
                fallbackCandidates.add(loc[1] to cd)
            }
        }
        return fallbackCandidates.minByOrNull { it.first }?.second
    }

    /**
     * Extracts the contact name from Messenger's "Name, Thread details" pattern.
     * Returns null if the string doesn't match this pattern.
     */
    private fun extractNameFromThreadDetails(text: String): String? {
        // Pattern: "Cat Fren, Thread details" → "Cat Fren"
        val suffixes = listOf(", Thread details", ", Conversation details", ", Chat details", ", Group details")
        for (suffix in suffixes) {
            if (text.endsWith(suffix, ignoreCase = true)) {
                val name = text.removeSuffix(suffix).trim()
                if (name.isNotBlank() && name.length <= 60) return name
            }
        }
        return null
    }

    private val NOISE_WORDS = setOf(
        "messenger", "chats", "message", "messages", "search", "people",
        "calls", "stories", "add story", "new message", "active",
        "active now", "send", "ok", "cancel", "done", "settings",
        "no messages in this conversation.", "type a message…", "type a message...",
        "react", "reply", "more", "home"
    )

    private fun isValidName(text: String): Boolean {
        if (text.isBlank()) return false
        if (text.length > 60) return false  // names are short
        if (text.all { it.isDigit() || it == '_' || it == '-' }) return false  // purely numeric/symbols
        val lower = text.lowercase()
        if (lower in NOISE_WORDS) return false
        // Reject sentence-like text: contains a period followed by a letter, or ends with punctuation
        if (text.contains(". ") || text.endsWith(".") || text.endsWith("!") || text.endsWith("?")) return false
        // Reject if word count > 5 (a name shouldn't be a long phrase)
        if (text.split(" ").size > 5) return false
        return true
    }

    private fun readAsset(assetManager: AssetManager, path: String): String? {
        return try {
            val inputStream: InputStream = assetManager.open(path)
            inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Throwable) {
            XposedBridge.log("$TAG: Could not read asset $path: $e")
            null
        }
    }
}
