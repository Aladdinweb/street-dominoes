package com.iline.streetdominoes

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class StreetMessagingService : FirebaseMessagingService() {
    // a new device token: remember it and tell the page (which registers it with the server)
    override fun onNewToken(token: String) {
        Push.saveToken(applicationContext, token)
        MainActivity.current?.pushTokenChanged()
    }

    // v1.3.3: the server sends DATA-ONLY, high-priority messages, so this runs in every app state (foreground, background, killed).
    // kind = invite | ping | cancel. App open: the page shows its own banner. Otherwise a system notification is built here.
    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        if (d.isEmpty()) return
        val kind = d["kind"] ?: return
        val act = MainActivity.current
        if (act != null && act.isForeground) {
            val o = JSONObject()
            for ((k, v) in d) o.put(k, v)
            act.pushToJs("onPushMsg", o.toString())
            if (kind == "cancel") Push.cancel(applicationContext, d["iid"])
            return
        }
        when (kind) {
            "cancel" -> Push.cancel(applicationContext, d["iid"])
            "invite", "ping" -> Push.show(applicationContext, d)
        }
    }
}
