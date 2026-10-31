package com.iline.streetdominoes

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessaging
import org.java_websocket.WebSocket
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.handshake.ServerHandshake
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.io.File
import java.net.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var server: WebSocketServer? = null
    private var client: WebSocketClient? = null
    private val ids = ConcurrentHashMap<WebSocket, Int>()
    private val socks = ConcurrentHashMap<Int, WebSocket>()
    private val counter = AtomicInteger(0)
    private var pendingMic: PermissionRequest? = null
    private var fileCb: ValueCallback<Array<Uri>>? = null   // pending <input type=file> request from the WebView
    private var pageReady = false                 // the WebView finished loading (JS handlers exist)
    private var pendingPush: String? = null           // invite / ping the user tapped in a notification, waiting for the page
    @Volatile var isForeground = false

    companion object {
        @Volatile var current: MainActivity? = null   // used by StreetMessagingService to reach the page
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)   // v1.3.3: the keyboard shrinks the page instead of covering / panning it
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                pageReady = true
                deliverPush()
            }
        }
        web.settings.mediaPlaybackRequiresUserGesture = false   // remote voice must play without a tap
        web.webChromeClient = object : WebChromeClient() {
            // profile photo: let <input type="file" accept="image/*"> open the system picker (gallery / files, no storage permission needed)
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null)
                fileCb = cb
                return try {
                    val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "image/*"
                    }
                    @Suppress("DEPRECATION")
                    startActivityForResult(Intent.createChooser(pick, null), 78)
                    true
                } catch (e: Exception) {
                    fileCb = null
                    cb.onReceiveValue(null)
                    true
                }
            }
            override fun onPermissionRequest(req: PermissionRequest) {
                runOnUiThread {
                    if (!req.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { req.deny(); return@runOnUiThread }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingMic = req
                        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 77)
                    }
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "Native")
        setContentView(web)
        web.loadUrl("file:///android_asset/www/index.html")
        // push notifications: channel, tap handling, device token
        current = this
        Push.ensureChannel(this)
        handleIntent(intent)
        fetchToken()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() { super.onResume(); isForeground = true }
    override fun onPause() { isForeground = false; super.onPause() }

    // ---- push notifications (Firebase Cloud Messaging; stays inactive when the build has no google-services.json) ----
    private fun jsCall(fn: String, arg: String) = runOnUiThread { web.evaluateJavascript("window.$fn&&window.$fn($arg)", null) }
    fun pushToJs(fn: String, json: String) = jsCall(fn, JSONObject.quote(json))
    fun pushTokenChanged() = jsCall("onPushToken", "")

    // a notification was tapped: its data arrives as intent extras
    private fun handleIntent(i: Intent?) {
        val e = i?.extras ?: return
        val kind = e.getString("kind") ?: return
        if (kind != "invite" && kind != "ping") return
        val o = JSONObject()
        for (k in arrayOf("kind", "sid", "name", "room", "gm", "type", "stake", "turn", "ping", "iid", "rid")) e.getString(k)?.let { o.put(k, it) }
        pendingPush = o.toString()
        setIntent(Intent(Intent.ACTION_MAIN))        // do not handle the same extras twice
        if (pageReady) deliverPush()
    }

    private fun deliverPush() {
        val p = pendingPush ?: return
        pendingPush = null
        pushToJs("onPushOpen", p)
    }

    private fun fetchToken() {
        try {
            if (!Push.ready(this)) return
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful) {                  // reading task.result on a failed task would throw
                    val t = task.result
                    if (!t.isNullOrEmpty()) { Push.saveToken(this, t); pushTokenChanged() }
                }
            }
        } catch (_: Throwable) {}
    }

    private fun notificationsAllowed(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        return NotificationManagerCompat.from(this).areNotificationsEnabled()
    }

    private fun askNotifPermission() {
        if (!Push.ready(this)) { jsCall("onPushPerm", "false"); return }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 79)
            return
        }
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) {      // blocked in the phone settings: open them
            try { startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) } catch (_: Exception) {}
            jsCall("onPushPerm", "false")
            return
        }
        fetchToken()
        jsCall("onPushPerm", "true")
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.onBackPress?window.onBackPress():false)") { r ->
            if (r != "true") finish()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 79) {                      // notifications permission (Android 13+)
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (granted) fetchToken()
            jsCall("onPushPerm", if (granted) "true" else "false")
            return
        }
        if (requestCode == 77) {
            val r = pendingMic; pendingMic = null
            if (r != null) {
                if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) r.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else r.deny()
            }
        }
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == 78) {
            val uri = data?.data
            val result: Array<Uri>? = if (resultCode == RESULT_OK && uri != null) arrayOf(uri) else null
            fileCb?.onReceiveValue(result)
            fileCb = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        if (current === this) current = null
        try { server?.stop(100) } catch (_: Exception) {}
        try { client?.close() } catch (_: Exception) {}
        super.onDestroy()
    }

    private fun emit(ev: String, data: String) = runOnUiThread {
        web.evaluateJavascript("window.onNet&&window.onNet(${JSONObject.quote(ev)},${JSONObject.quote(data)})", null)
    }

    private fun localIp(): String {
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) for (a in ni.inetAddresses)
                if (!a.isLoopbackAddress && a is Inet4Address && a.isSiteLocalAddress) return a.hostAddress ?: ""
        } catch (_: Exception) {}
        return ""
    }

    private fun newer(a: String, b: String): Boolean {
        val x = a.split(".").map { it.takeWhile { c -> c.isDigit() }.toIntOrNull() ?: 0 }
        val y = b.split(".").map { it.takeWhile { c -> c.isDigit() }.toIntOrNull() ?: 0 }
        for (i in 0 until 3) { val p = x.getOrElse(i) { 0 }; val q = y.getOrElse(i) { 0 }; if (p != q) return p > q }
        return false
    }

    inner class Bridge {
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun supportsFilePicker(): Boolean = true
        @JavascriptInterface fun pushSupported(): Boolean = Push.ready(applicationContext)
        @JavascriptInterface fun getPushToken(): String = Push.token(applicationContext)
        @JavascriptInterface fun pushPermission(): Boolean = notificationsAllowed()
        @JavascriptInterface fun requestPushPermission() { runOnUiThread { askNotifPermission() } }

        // ---- LAN host ----
        @JavascriptInterface fun hostStart(port: Int): String {
            hostStop()
            val s = object : WebSocketServer(InetSocketAddress(port)) {
                override fun onOpen(c: WebSocket, h: ClientHandshake) {
                    val id = counter.incrementAndGet(); ids[c] = id; socks[id] = c
                    emit("hostJoin", JSONObject().put("id", id).toString())
                }
                override fun onClose(c: WebSocket, code: Int, r: String?, remote: Boolean) {
                    ids.remove(c)?.let { socks.remove(it); emit("hostLeave", JSONObject().put("id", it).toString()) }
                }
                override fun onMessage(c: WebSocket, m: String) {
                    ids[c]?.let { emit("hostMsg", JSONObject().put("id", it).put("text", m).toString()) }
                }
                override fun onError(c: WebSocket?, e: Exception) {}
                override fun onStart() { connectionLostTimeout = 20 }
            }
            s.isReuseAddr = true
            s.start(); server = s
            return localIp()
        }
        @JavascriptInterface fun hostSend(id: Int, text: String) { socks[id]?.let { if (it.isOpen) it.send(text) } }
        @JavascriptInterface fun hostStop() {
            try { server?.stop(200) } catch (_: Exception) {}
            server = null; ids.clear(); socks.clear()
        }

        // ---- LAN client ----
        @JavascriptInterface fun connect(url: String) {
            disconnect()
            val c = object : WebSocketClient(URI(url)) {
                override fun onOpen(h: ServerHandshake?) { emit("cOpen", "{}") }
                override fun onMessage(m: String?) { emit("cMsg", JSONObject().put("text", m ?: "").toString()) }
                override fun onClose(code: Int, r: String?, remote: Boolean) { emit("cClose", "{}") }
                override fun onError(e: Exception?) { emit("cErr", JSONObject().put("msg", e?.message ?: "").toString()) }
            }
            c.connectionLostTimeout = 20
            client = c; c.connect()
        }
        @JavascriptInterface fun send(text: String) { try { client?.send(text) } catch (_: Exception) {} }
        @JavascriptInterface fun disconnect() { try { client?.close() } catch (_: Exception) {}; client = null }

        // ---- In-app updates (GitHub Releases) ----
        @JavascriptInterface fun checkUpdate(mode: String) {
            Thread {
                try {
                    val c = URL("https://api.github.com/repos/${BuildConfig.REPO}/releases/latest").openConnection() as HttpURLConnection
                    c.setRequestProperty("Accept", "application/vnd.github+json")
                    c.connectTimeout = 8000; c.readTimeout = 8000
                    val j = JSONObject(c.inputStream.bufferedReader().readText())
                    val tag = j.getString("tag_name").removePrefix("v")
                    var url = ""
                    val a = j.getJSONArray("assets")
                    for (i in 0 until a.length()) {
                        val o = a.getJSONObject(i)
                        if (o.getString("name").endsWith(".apk")) { url = o.getString("browser_download_url"); break }
                    }
                    emit("upd", JSONObject().put("mode", mode).put("cur", BuildConfig.VERSION_NAME).put("latest", tag)
                        .put("newer", url.isNotEmpty() && newer(tag, BuildConfig.VERSION_NAME)).put("url", url)
                        .put("notes", j.optString("body")).toString())
                } catch (e: Exception) {
                    emit("upd", JSONObject().put("mode", mode).put("err", e.message ?: "error").toString())
                }
            }.start()
        }

        @JavascriptInterface fun installUpdate(url: String) {
            Thread {
                try {
                    if (!packageManager.canRequestPackageInstalls()) {
                        runOnUiThread { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) }
                        emit("updErr", "perm"); return@Thread
                    }
                    val dir = File(cacheDir, "updates").apply { mkdirs() }
                    val f = File(dir, "update.apk")
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.connectTimeout = 10000; c.instanceFollowRedirects = true
                    val len = c.contentLengthLong
                    c.inputStream.use { inp ->
                        f.outputStream().use { out ->
                            val buf = ByteArray(32768); var n: Int; var tot = 0L; var last = -1
                            while (inp.read(buf).also { n = it } > 0) {
                                out.write(buf, 0, n); tot += n
                                if (len > 0) { val p = (tot * 100 / len).toInt(); if (p != last) { last = p; emit("updProg", "$p") } }
                            }
                        }
                    }
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fp", f)
                    runOnUiThread {
                        startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                } catch (e: Exception) { emit("updErr", e.message ?: "error") }
            }.start()
        }
    }
}
