package com.iline.streetdominoes

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.FirebaseApp

/** Helpers for push notifications (Firebase Cloud Messaging). Push stays off when the build has no google-services.json. */
object Push {
    const val CHANNEL = "invites"
    const val ACTION_DECLINE = "com.iline.streetdominoes.DECLINE"
    const val API = "https://street-dominoes-server.alaacasanova31.workers.dev"
    private const val PREFS = "push"
    private val EXTRAS = arrayOf("kind", "sid", "name", "room", "gm", "type", "stake", "turn", "ping", "iid", "rid")

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

    fun notifId(key: String): Int = key.hashCode()

    fun cancel(ctx: Context, iid: String?) {
        if (iid.isNullOrEmpty()) return
        ctx.getSystemService(NotificationManager::class.java)?.cancel(notifId(iid))
    }

    /**
     * Builds the invite / ping notification from a data-only FCM message. The same notification id is reused for every repeat of
     * an invite, so a repeat updates (and re-alerts) the existing notification instead of stacking a new one.
     * Tapping it (or "Join") opens the app, which joins the room; "Decline" is handled by InviteActionReceiver without opening the app.
     */
    fun show(ctx: Context, d: Map<String, String>) {
        val kind = d["kind"] ?: return
        val invite = kind == "invite"
        if (!invite && kind != "ping") return
        ensureChannel(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val id = notifId(if (invite) (d["iid"] ?: ("invite-" + d["sid"])) else ("ping-" + d["sid"]))
        val name = d["name"] ?: "Street Dominoes"

        val open = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        for (k in EXTRAS) d[k]?.let { open.putExtra(k, it) }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val openPi = PendingIntent.getActivity(ctx, id, open, flags)

        val title: String
        var body: String
        if (invite) {
            title = "\uD83C\uDFB2 $name invited you"
            body = when (d["type"]) { "h2h" -> "Head-to-Head"; "partner" -> "Teammate"; "tvt" -> "Team vs Team"; else -> d["gm"] ?: "" }
            val stake = d["stake"]?.toIntOrNull() ?: 0
            val turn = d["turn"]?.toIntOrNull() ?: 0
            if (stake > 0) body += " \u00B7 \uD83E\uDE99 $stake"
            if (turn > 0) body += " \u00B7 \u23F1 ${turn}s"
        } else {
            title = (d["ping"] ?: "\uD83D\uDC4B") + " " + name
            body = "wants to play Street Dominoes"
        }

        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_domino)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
        if (invite) {
            val ttl = (d["ttl"]?.toLongOrNull() ?: 120000L).coerceIn(5000L, 180000L)
            b.setTimeoutAfter(ttl)
            val dec = Intent(ctx, InviteActionReceiver::class.java).setAction(ACTION_DECLINE)
                .putExtra("iid", d["iid"]).putExtra("rid", d["rid"]).putExtra("nid", id)
            b.addAction(0, "Join", openPi)
            b.addAction(0, "Decline", PendingIntent.getBroadcast(ctx, id, dec, flags))
        }
        nm.notify(id, b.build())
    }
}
