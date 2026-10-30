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

    // Runs while the app is in the foreground. In the background the system shows the notification itself and
    // delivers the data as intent extras when it is tapped (see MainActivity.handleIntent).
    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        if (d.isEmpty()) return
        val o = JSONObject()
        for ((k, v) in d) o.put(k, v)
        MainActivity.current?.pushToJs("onPushMsg", o.toString())
    }
}
