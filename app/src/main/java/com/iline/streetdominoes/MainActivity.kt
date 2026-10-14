package com.iline.streetdominoes

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
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

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(Bridge(), "Native")
        setContentView(web)
        web.loadUrl("file:///android_asset/www/index.html")
    }

    override fun onDestroy() {
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
