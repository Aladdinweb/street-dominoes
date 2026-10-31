package com.iline.streetdominoes

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** "Decline" button of an invite notification: dismisses it and tells the server, without opening the app. */
class InviteActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        if (i.action != Push.ACTION_DECLINE) return
        val iid = i.getStringExtra("iid") ?: return
        val rid = i.getStringExtra("rid") ?: return
        ctx.getSystemService(NotificationManager::class.java)?.cancel(i.getIntExtra("nid", Push.notifId(iid)))
        val pending = goAsync()
        Thread {
            try {
                val c = URL(Push.API + "/api/invite-response").openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.doOutput = true
                c.connectTimeout = 8000
                c.readTimeout = 8000
                c.setRequestProperty("content-type", "application/json")
                c.outputStream.use { it.write(JSONObject().put("iid", iid).put("pid", rid).put("ok", 0).toString().toByteArray()) }
                c.responseCode
                c.disconnect()
            } catch (_: Exception) {
            } finally {
                pending.finish()
            }
        }.start()
    }
}
