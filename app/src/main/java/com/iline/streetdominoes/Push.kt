package com.iline.streetdominoes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.google.firebase.FirebaseApp

/** Small helpers for push notifications (Firebase Cloud Messaging). Push stays off when the build has no google-services.json. */
object Push {
    const val CHANNEL = "invites"
    private const val PREFS = "push"

    /** true when Firebase was configured at build time */
    fun ready(ctx: Context): Boolean = try { FirebaseApp.getApps(ctx).isNotEmpty() } catch (_: Throwable) { false }

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "Invites & pings", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Match invites and Street Pings from friends"
            nm.createNotificationChannel(ch)
        }
    }

    fun saveToken(ctx: Context, token: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("token", token).apply()
    }

    fun token(ctx: Context): String = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", "") ?: ""
}
