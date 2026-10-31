#!/usr/bin/env bash
# apply-v1.3.3.sh - Street Dominoes v1.3.3
#   1. friends window: stop the presence render loop (flicker / freeze), keyboard resize, bounded panel height
#   2. persistent match invites: Durable Object alarm re-rings every 20 s for 3 min until accepted / declined / expired
#   3. FCM: data-only HIGH-priority invites rendered by StreetMessagingService (works when the app is killed), Join + Decline actions
# Run from the repo root (~/street-dominoes). Exact-match anchors (abort unless exactly one match), syntax checks,
# automatic restore, idempotent. Set SD_NO_GIT=1 to skip commit / push / tag.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
T="${TMPDIR:-$HOME/tmp}"; mkdir -p "$T"
W="$(mktemp -d "$T/sd133.XXXXXX")"; BK="$W/bak"; mkdir -p "$BK"
export W
HTML=app/src/main/assets/www/index.html
WORKER=server/src/worker.js
KT=app/src/main/java/com/iline/streetdominoes
MANIFEST=app/src/main/AndroidManifest.xml
TEST=server/test/invites.test.mjs
FILES=("$HTML" "$WORKER" "$KT/MainActivity.kt" "$KT/Push.kt" "$KT/StreetMessagingService.kt" "$MANIFEST")
for f in "${FILES[@]}"; do [ -f "$f" ] || { echo "missing $f - run this from the repo root"; exit 1; }; done
if grep -q 'id="sd133"' "$HTML" && grep -q 'const RING' "$WORKER"; then echo "v1.3.3 is already applied"; exit 0; fi
for f in "${FILES[@]}" STATE.md ROADMAP.md CHANGELOG.md pages/index.html; do
  [ -f "$f" ] && { mkdir -p "$BK/$(dirname "$f")"; cp "$f" "$BK/$f"; }
done
restore() {
  for f in "${FILES[@]}" STATE.md ROADMAP.md CHANGELOG.md pages/index.html; do [ -f "$BK/$f" ] && cp "$BK/$f" "$f"; done
  rm -f "$KT/InviteActionReceiver.kt" "$TEST"
}
trap 'echo "FAILED - original files restored (backup in $BK)"; restore' ERR

# ---------------------------------------------------------------- payloads (written verbatim, no escaping needed)
cat > "$W/sd133.css" <<'EOF'
<style id="sd133">/* v1.3.3: friends window + invite banner */
#frm .lbp{box-sizing:border-box;max-height:calc(100vh - 24px);max-height:calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 24px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
#frm .lbp,#frm .lbp *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#frm .lbr{contain:layout style}
#inb.ring{animation:sdring .9s ease-out 1}
@keyframes sdring{0%{box-shadow:0 0 0 0 rgba(220,40,40,.65)}100%{box-shadow:0 0 0 16px rgba(220,40,40,0)}}
</style>
EOF

cat > "$W/invites.js" <<'EOF'
const INVS={};   // v1.3.3: invites that are still ringing: iid -> {room,rep,m,t}
function invReply(iid,ok){if(!iid)return;try{postJ('/api/invite-response',{iid,pid,ok:ok?1:0}).catch(()=>{})}catch(e){}}
function hideInvite(iid){const e=document.getElementById('inb');
if(iid&&INVS[iid]){clearTimeout(INVS[iid].t);delete INVS[iid]}
if(e&&(!iid||e.dataset.iid===iid)){e.hidden=true;e.dataset.iid='';clearTimeout(e._t)}
const nx=Object.keys(INVS)[0];if(nx&&e&&e.hidden)showInvite(INVS[nx].m)}
function invResult(m){const p=frPeople().find(z=>z.id===m.id),n=p?p.n:String(m.id||'');toast((m.ok?'\u2705 ':m.why==='exp'?'\u231B ':'\u274C ')+n)}
function showInvite(m){const x=t();let e=document.getElementById('inb');if(!e){e=document.createElement('div');e.id='inb';document.body.appendChild(e);
e.addEventListener('click',ev=>{const tg=ev.target,j=tg.closest&&tg.closest('[data-ijoin]');
if(j){const iid=j.dataset.iid;e.hidden=true;if(iid){invReply(iid,true);hideInvite(iid)}joinInvite(j.dataset.ijoin);return}
const d=tg.closest&&tg.closest('[data-idec]');if(d){const iid=d.dataset.idec;invReply(iid,false);hideInvite(iid);return}
if(tg.id==='inx')e.hidden=true})}
const nm=esc(m.name||'Player'),iid=/^[\w-]{12}$/.test(String(m.iid||''))?String(m.iid):'';
if(m.kind==='ping'){if(Object.keys(INVS).length){toast((m.ping||'\uD83D\uDC4B')+' '+(m.name||''));return}
e.innerHTML=`<div>${esc(m.ping||'\uD83D\uDC4B')} <b>${nm}</b> ${x.pingFrom}</div><button class="sm" id="inx">\u2715</button>`;
e.dataset.iid='';e.hidden=false;clearTimeout(e._t);e._t=setTimeout(()=>{e.hidden=true},6000);try{snd.win()}catch(er){}return}
const lab=({h2h:x.invH2H,partner:x.invPartner,tvt:x.invTvT})[m.type]||m.gm||'';
const prev=iid&&INVS[iid],fresh=!iid||!prev||(m.rep|0)>(prev.rep|0);
if(iid){if(prev)clearTimeout(prev.t);INVS[iid]={room:m.room,rep:m.rep|0,m,t:setTimeout(()=>hideInvite(iid),Math.max(2000,(m.ttl|0)||120000))}}
e.innerHTML=`<div>\uD83C\uDFB2 <b>${nm}</b> ${x.invFrom}<br><small>${esc(lab)}${m.stake?' \u00B7 \uD83E\uDE99 '+(m.stake|0):''}${m.turn?' \u00B7 \u23F1 '+(m.turn|0)+'s':''}</small></div><button class="big" data-ijoin="${esc(m.room)}" data-iid="${iid}">${x.invJoin}</button>${iid?`<button class="sm" data-idec="${iid}">${x.invDecline||'Decline'}</button>`:'<button class="sm" id="inx">\u2715</button>'}`;
e.dataset.iid=iid;e.hidden=false;
if(!iid){clearTimeout(e._t);e._t=setTimeout(()=>{e.hidden=true},25000)}
if(fresh){e.classList.remove('ring');void e.offsetWidth;e.classList.add('ring');try{snd.win()}catch(er){}}}
EOF

cat > "$W/pres_paint.js" <<'EOF'
if(frOpen())Pres.paint()},
paint(){if(Pres.pr)return;Pres.pr=requestAnimationFrame(()=>{Pres.pr=0;const x=t();document.querySelectorAll('#frm [data-fid]').forEach(r=>{const s=r.querySelector('.pst');if(!s)return;const st=Pres.st[r.dataset.fid]|0,v=['\uD83D\uDD18','\uD83D\uDFE2','\uD83D\uDFE1'][st]+' '+[x.frOff,x.frOn,x.frGame][st];if(s.textContent!==v)s.textContent=v})})}};
EOF

cat > "$W/worker_push.js" <<'EOF'
// v1.3.3: DATA-ONLY high-priority messages. With a `notification` block Android shows the message itself when the app is in the
// background and never calls onMessageReceived, so it could not be repeated, cancelled or given a Decline button.
// StreetMessagingService builds the notification on the device. `collapse_key` keeps only the newest ring (or the cancel) queued for a phone that is offline.
function pushMsg(inv) {
  const d = { kind: inv.kind, sid: inv.from, name: inv.name };
  if (inv.kind === 'ping') { d.ping = inv.ping; return { data: d, android: { priority: 'HIGH', ttl: '3600s' } }; }
  Object.assign(d, { iid: inv.iid || '', rid: inv.rid || '', room: inv.room, gm: inv.gm, type: inv.type || '', stake: String(inv.stake | 0), turn: String(inv.turn | 0),
    ttl: String(inv.ttl > 0 ? Math.floor(inv.ttl) : RING.TTL), rep: String(inv.rep | 0) });
  return { data: d, android: { priority: 'HIGH', ttl: '60s', ...(inv.iid ? { collapse_key: 'inv_' + inv.iid } : {}) } };
}
const cancelMsg = iid => ({ data: { kind: 'cancel', iid }, android: { priority: 'HIGH', ttl: '60s', collapse_key: 'inv_' + iid } });
const rid12 = () => b64u(crypto.getRandomValues(new Uint8Array(9)));
// one FCM message to every registered device of a player; dead tokens are pruned; true when at least one device accepted it
async function pushTo(env, id, msg) {
  const rec = env.PLAYER_STATS ? await env.PLAYER_STATS.get('push:' + id, 'json') : null, tokens = (rec && rec.tokens) || [];
  let okAny = false; const keep = [];
  for (const t of tokens) {
    const r = await fcmSend(env, t, msg);
    if (r === 'ok') okAny = true;
    if (r !== 'gone') keep.push(t);
  }
  if (keep.length !== tokens.length && env.PLAYER_STATS) { if (keep.length) await env.PLAYER_STATS.put('push:' + id, JSON.stringify({ tokens: keep, at: Date.now() }), { expirationTtl: 60 * 864e2 }); else await env.PLAYER_STATS.delete('push:' + id); }
  return okAny;
}
EOF

cat > "$W/worker_resp.js" <<'EOF'
// POST /api/invite-response {iid, pid, ok}: the invited player accepted (ok:1) or declined (ok:0); the iid is an unguessable 72-bit id and must belong to pid.
// Used by the app (banner / notification tap) and by the notification's Decline button (InviteActionReceiver).
async function inviteRespApi(req, env) {
  const raw = await req.text();
  if (raw.length > 512) return json({ error: 'too_large' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ error: 'bad_json' }, 400); }
  if (!b || !validId(b.pid) || !/^[\w-]{12}$/.test(String(b.iid || ''))) return json({ error: 'bad_request' }, 400);
  if (!env.MATCH) return json({ error: 'not_configured' }, 503);
  const r = await env.MATCH.get(env.MATCH.idFromName('pr')).fetch('https://pr.internal/_pr/respond', { method: 'POST', body: JSON.stringify({ iid: b.iid, pid: b.pid, ok: b.ok ? 1 : 0 }) });
  return json(await r.json(), r.ok ? 200 : 502);
}
EOF

cat > "$W/mm_respond_guard.js" <<'EOF'
    if (u.pathname === '/_pr/respond' && req.method === 'POST') {
      let q; try { q = await req.json(); } catch (e) { return J({ error: 'bad_json' }, 400); }
      const rec = await this.respond(String((q && q.iid) || ''), q && q.pid, !!(q && q.ok));
      return J({ ok: !!rec });
    }
EOF

cat > "$W/mm_deliver.js" <<'EOF'
      let rec = null;
      if (inv.kind === 'invite') {                    // v1.3.3: an invite keeps ringing until it is answered or expires
        rec = { iid: rid12(), to: id, exp: now + RING.TTL, n: 0, next: now + RING.EVERY };
        rec.inv = { ...inv, iid: rec.iid };
        await this.state.storage.put('inv:' + rec.iid, rec);
        out.iids[id] = rec.iid;
      }
      const msg = rec ? { t: 'inv', ...rec.inv, rid: id, ttl: RING.TTL, rep: 0 } : { t: 'inv', ...inv };
      if (socks.length) { socks.forEach(s => send(s, msg)); out.delivered.push(id); } else out.offline.push(id);
EOF

cat > "$W/mm_methods.js" <<'EOF'
  // ---- v1.3.3: persistent invites. Pending invites live in this instance's storage ('inv:<iid>'); a Durable Object alarm re-rings them.
  toPlayer(id, o) { for (const s of this.state.getWebSockets()) { const a = s.deserializeAttachment(); if (a && a.id === id) send(s, o); } }
  async respond(iid, pid, ok) {
    const rec = await this.state.storage.get('inv:' + iid);
    if (!rec || rec.to !== pid) return null;
    await this.state.storage.delete('inv:' + iid);
    this.toPlayer(rec.to, { t: 'invx', iid, ok: ok ? 1 : 0 });                       // stop the banner on the player's other open sockets
    this.toPlayer(rec.inv.from, { t: 'invr', iid, id: rec.to, ok: ok ? 1 : 0 });    // tell the sender
    await pushTo(this.env, rec.to, cancelMsg(iid));                                   // dismiss the notification on the player's devices
    await this.armAlarm();
    return rec;
  }
  async armAlarm() {
    const st = this.state.storage;
    if (typeof st.list !== 'function' || typeof st.setAlarm !== 'function') return;
    let t = 0;
    for (const [, r] of await st.list({ prefix: 'inv:' })) { const n = Math.min(r.next, r.exp); if (!t || n < t) t = n; }
    if (t) await st.setAlarm(Math.max(t, Date.now() + 1000));
  }
  async alarm() {
    const now = Date.now(), all = await this.state.storage.list({ prefix: 'inv:' });
    for (const [k, r] of all) {
      if (now >= r.exp) {                                                             // nobody answered: stop ringing everywhere
        await this.state.storage.delete(k);
        this.toPlayer(r.to, { t: 'invx', iid: r.iid, ok: 0, why: 'exp' });
        this.toPlayer(r.inv.from, { t: 'invr', iid: r.iid, id: r.to, ok: 0, why: 'exp' });
        await pushTo(this.env, r.to, cancelMsg(r.iid));
        continue;
      }
      if (now < r.next) continue;
      r.n++; r.next = now + RING.EVERY; await this.state.storage.put(k, r);
      const msg = { ...r.inv, rid: r.to, rep: r.n, ttl: r.exp - now };
      if (this.state.getWebSockets().some(s => (s.deserializeAttachment() || {}).id === r.to)) this.toPlayer(r.to, { t: 'inv', ...msg });   // app open: in-app banner
      else await pushTo(this.env, r.to, pushMsg(msg));                                                                                      // app closed: push
    }
    await this.armAlarm();
  }
  async resend(ws, id) {                                                              // a player (re)connects: show the invites that are still ringing
    const now = Date.now();
    for (const [, r] of await this.state.storage.list({ prefix: 'inv:' })) if (r.to === id && r.exp > now) send(ws, { t: 'inv', ...r.inv, rid: id, ttl: r.exp - now, rep: r.n });
  }
EOF

cat > "$W/Push.kt" <<'EOF'
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
EOF

cat > "$W/StreetMessagingService.kt" <<'EOF'
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
EOF

cat > "$W/InviteActionReceiver.kt" <<'EOF'
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
EOF

cat > "$W/invites.test.mjs" <<'EOF'
// Persistent invites (v1.3.3): run with `node server/test/invites.test.mjs`. Mocks the Durable Object state, KV and FCM; no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdinv-'));
const mjs = path.join(tmp, 'worker.mjs');
fs.copyFileSync(path.join(here, '../src/worker.js'), mjs);
const { Matchmaker } = await import(pathToFileURL(mjs).href);

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const kv = new Map();
const PLAYER_STATS = { async get(k, t) { const v = kv.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); } };
const sent = [];
globalThis.fetch = async (url, o) => {
  if (String(url).includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
  if (String(url).includes('fcm.googleapis.com')) { sent.push(JSON.parse(o.body).message); return { ok: true, status: 200, text: async () => '' }; }
  throw new Error('unexpected fetch ' + url);
};
let now = 1_800_000_000_000;
Date.now = () => now;

const store = new Map(); let alarmAt = null; const socks = [];
const state = {
  storage: {
    async put(k, v) { store.set(k, structuredClone(v)); }, async get(k) { const v = store.get(k); return v === undefined ? undefined : structuredClone(v); },
    async delete(k) { return store.delete(k); }, async list({ prefix }) { const m = new Map(); for (const [k, v] of store) if (k.startsWith(prefix)) m.set(k, structuredClone(v)); return m; },
    async setAlarm(t) { alarmAt = t; }, async getAlarm() { return alarmAt; },
  },
  getWebSockets: () => socks, acceptWebSocket() {},
};
const mkSock = id => { const s = { id, got: [], att: { id, st: 1, w: [] }, send(x) { s.got.push(JSON.parse(x)); }, deserializeAttachment() { return s.att; }, serializeAttachment(a) { s.att = a; } }; return s; };
const mm = new Matchmaker(state, { PLAYER_STATS, FCM_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: privateKey, project_id: 'proj' }) });
const post = (p, o) => mm.prFetch(new Request('https://pr.internal' + p, { method: 'POST', body: JSON.stringify(o) }), new URL('https://pr.internal' + p)).then(r => r.json());

const A = 'usr_aaaa1', B = 'usr_bbbb1';
kv.set('push:' + B, JSON.stringify({ tokens: ['x'.repeat(30)] }));
const SA = mkSock(A); socks.push(SA);
const inv = { kind: 'invite', from: A, name: 'Ann', av: 1, room: 'ABC123', gm: '1v1', type: 'h2h', stake: 0, turn: 0 };

// 1. invite to an offline player creates a pending record and arms the alarm
let out = await post('/_pr/invite', { inv, to: [B] });
assert.deepEqual(out.offline, [B]);
const iid = out.iids[B];
assert.match(iid, /^[\w-]{12}$/);
assert.ok(store.has('inv:' + iid));
assert.ok(alarmAt >= now + 19000 && alarmAt <= now + 21000, 'alarm armed ~20 s ahead');

// 2. the alarm repeats it as a DATA-ONLY high-priority push
now += 20001; await mm.alarm();
assert.equal(sent.length, 1);
assert.equal(sent[0].notification, undefined, 'no notification block');
assert.equal(sent[0].data.kind, 'invite'); assert.equal(sent[0].data.iid, iid); assert.equal(sent[0].data.rid, B); assert.equal(sent[0].data.rep, '1');
assert.equal(sent[0].android.priority, 'HIGH');
assert.ok(Object.values(sent[0].data).every(v => typeof v === 'string'), 'FCM data values are strings');
assert.ok(alarmAt > now, 'alarm re-armed');

// 3. the invited player opens the app: the ringing invite is shown again, later repeats go in-app (no push)
const SB = mkSock(B); socks.push(SB);
await mm.webSocketMessage(SB, JSON.stringify({ t: 'watch', ids: [] }));
const shown = SB.got.find(m => m.t === 'inv');
assert.ok(shown && shown.iid === iid && shown.rep === 1 && shown.ttl > 0);
now += 20001; await mm.alarm();
assert.equal(sent.length, 1, 'no extra push while the app is open');
assert.equal(SB.got.filter(m => m.t === 'inv').pop().rep, 2);

// 4. only the invited player can answer; a decline stops everything and tells the sender
assert.equal((await post('/_pr/respond', { iid, pid: A, ok: 1 })).ok, false);
assert.ok(store.has('inv:' + iid));
assert.equal((await post('/_pr/respond', { iid, pid: B, ok: 0 })).ok, true);
assert.equal(store.size, 0);
assert.ok(SA.got.some(m => m.t === 'invr' && m.iid === iid && m.id === B && m.ok === 0));
assert.ok(SB.got.some(m => m.t === 'invx' && m.iid === iid));
assert.equal(sent.at(-1).data.kind, 'cancel'); assert.equal(sent.at(-1).data.iid, iid);
assert.equal((await post('/_pr/respond', { iid, pid: B, ok: 1 })).ok, false, 'second answer is ignored');

// 5. an unanswered invite expires after 3 minutes everywhere
socks.splice(socks.indexOf(SB), 1);
now += 21000; out = await post('/_pr/invite', { inv, to: [B] });
const iid2 = out.iids[B];
sent.length = 0; SA.got.length = 0;
for (let i = 0; i < 12; i++) { now += 20001; await mm.alarm(); }
assert.equal(store.size, 0, 'expired invite removed');
assert.ok(sent.filter(m => m.data.kind === 'invite').length >= 6, 'it rang repeatedly');
assert.ok(SA.got.some(m => m.t === 'invr' && m.iid === iid2 && m.why === 'exp'));
assert.equal(sent.at(-1).data.kind, 'cancel');

// 6. pings stay one-off
now += 61000; out = await post('/_pr/invite', { inv: { kind: 'ping', from: A, name: 'Ann', av: 1, ping: '\u{1F44B}' }, to: [B] });
assert.equal(Object.keys(out.iids).length, 0); assert.equal(store.size, 0);

console.log('invites.test.mjs: all checks passed');
EOF

cat > "$W/state_add.md" <<'EOF'

<!-- sd133 -->
## 17. v1.3.3: friends window fix, persistent invites, data-only push
- Flicker root cause (client): `openFr()` ended with `Pres.sync(true)`; the server answers a `watch` with `{t:'pres',all}`; `Pres.changed()` called `openFr()` again -> an endless render loop through the network. Now `Pres.sync` only sends `watch` when the id list changed (`Pres.wk`, reset in `onopen`), `Pres.changed()` only repaints the status text of `[data-fid]` rows (`Pres.paint`, one rAF), and the profile fetches re-render through `frQueue()` (200 ms debounce, skipped while typing). `openFr()` keeps the panel's scroll position.
- CSS block `<style id="sd133">` after `ux-layer.css`: `#frm .lbp` max-height in `dvh` minus the safe-area insets and scrolls inside, no `backdrop-filter` inside the panel, `#inb.ring` pulse. Kotlin: `SOFT_INPUT_ADJUST_RESIZE` so the keyboard shrinks the page instead of covering it. The window is NOT edge-to-edge (WebView reports no system-bar insets through `env()`).
- Persistent invites (Worker, `Matchmaker` instance `pr`): each invite (not pings) is a record `inv:<iid>` `{iid,to,inv,exp,n,next}` (`RING = {TTL:180000, EVERY:20000}`); `alarm()` re-delivers every 20 s (in-app `inv` with `rep`/`ttl` if the player has a presence socket, else FCM), deletes it at `exp` (sender gets `invr` with `why:'exp'`, device gets a cancel push). `POST /api/invite-response {iid,pid,ok}` -> `/_pr/respond`: record deleted, recipient sockets get `invx`, sender gets `invr`, devices get a `cancel` push. A reconnecting player gets the still-ringing invites again (`resend`, on `watch`). `POST /api/invite` returns nothing new; the FCM loop now uses `pushTo()` with the `iid` from `/_pr/invite`.
- FCM is data-only, HIGH priority, `collapse_key: inv_<iid>`: `kind` invite | ping | cancel (+ `iid`, `rid`, `sid`, `name`, `room`, `gm`, `type`, `stake`, `turn`, `ttl`, `rep`). `StreetMessagingService`: app in foreground -> `onPushMsg` banner; otherwise `Push.show()` builds the notification (channel `invites`, same notification id per `iid` so repeats update it, Join + Decline actions, `setTimeoutAfter(ttl)`). `InviteActionReceiver` (manifest) posts the decline to `Push.API`. No full-screen intent (Play policy limits it to calling / alarm apps).
- Client: `INVS` (ringing invites), `invReply`, `hideInvite`, `invResult`; banner has Join / Decline and stays until answered or `ttl`; `joinInvite` and `onPushOpen` answer "accepted". New string `invDecline` (EN / FR / AR).
- Tests: `node server/test/invites.test.mjs` (mock storage / KV / FCM) and `node server/test/worker.test.mjs`.
EOF

cat > "$W/roadmap_add.md" <<'EOF'
## Update v1.3.3 - Friends window fix, persistent invites, data-only push

- [x] **Fix:** friends & invites window flicker / freeze: a presence render loop (`openFr` -> `Pres.sync` -> `pres` reply -> `openFr`) is gone; presence updates repaint the status dots in place; bounded panel height + no nested `backdrop-filter`; the keyboard resizes the page.
- [x] **Persistent invites:** an invite rings again every 20 s for up to 3 minutes (in-app banner or push) until the player joins or declines; declined / expired / accepted results are shown to the sender; a reconnecting player sees invites that are still ringing.
- [x] **Push:** invites and pings are data-only, high-priority FCM messages rendered by `StreetMessagingService` (works with the app killed), with Join and Decline actions and cancel messages.
- [ ] Not compiled in the chat sandbox: the GitHub Actions APK build is the compile check for the Kotlin changes. Real-phone test: kill the app, send an invite, let it ring twice, decline from the notification.
- Limits: a Force Stop from Settings blocks all FCM until the app is opened again; some phone brands (Xiaomi, Huawei, Oppo...) also restrict background apps, so the user may need to allow auto-start / disable battery optimisation; whether the screen turns on for a heads-up notification is up to Android and the brand.

EOF

# ---------------------------------------------------------------- patcher
node - <<'JS'
const fs = require('fs'), vm = require('vm'), path = require('path');
const W = process.env.W, BT = '`';
const P = n => fs.readFileSync(path.join(W, n), 'utf8').replace(/\n$/, '');
const die = m => { console.error('ABORT: ' + m); process.exit(1); };
const cnt = (s, f) => s.split(f).length - 1;
const exact = (s, tag, a, b) => { const n = cnt(s, a); if (n !== 1) die(tag + ': anchor found ' + n + ' times (need exactly 1): ' + a.slice(0, 80)); return s.replace(a, () => b); };
const span = (s, tag, from, to, b) => {
  if (cnt(s, from) !== 1 || cnt(s, to) !== 1) die(tag + ': span anchors must each match once');
  const x = s.indexOf(from), y = s.indexOf(to); if (y <= x) die(tag + ': span order'); return s.slice(0, x) + b + s.slice(y);
};
const rd = f => { const s = fs.readFileSync(f, 'utf8'); if (s.includes('\r\n')) die(f + ' uses CRLF line endings'); return s; };

// ---------- index.html
{
  const f = 'app/src/main/assets/www/index.html'; let s = rd(f);
  s = exact(s, 'css', '<link rel="stylesheet" href="ux-layer.css">', '<link rel="stylesheet" href="ux-layer.css">\n' + P('sd133.css'));
  s = exact(s, 'pres.onopen', 'w.onopen=()=>{Pres.bo=0;Pres.cs=0;Pres.sync(true);', "w.onopen=()=>{Pres.bo=0;Pres.cs=0;Pres.wk='';Pres.sync(true);");
  s = exact(s, 'pres.sync', "sync(force){const cs=inGame?2:1;if(force||cs!==Pres.cs){Pres.cs=cs;Pres.send({t:'st',s:cs})}if(force)Pres.send({t:'watch',ids:Pres.ids()})},",
    "sync(force){const cs=inGame?2:1;if(force||cs!==Pres.cs){Pres.cs=cs;Pres.send({t:'st',s:cs})}if(force){const ids=Pres.ids(),k=ids.join(',');if(k!==Pres.wk){Pres.wk=k;Pres.send({t:'watch',ids})}}},");
  s = exact(s, 'pres.onmessage', "else if(m.t==='inv')showInvite(m)}", "else if(m.t==='inv')showInvite(m);else if(m.t==='invx')hideInvite(m.iid);else if(m.t==='invr')invResult(m)}");
  s = exact(s, 'pres.changed', "if(frOpen()&&!(document.activeElement&&document.activeElement.id==='frin'))openFr()}};", P('pres_paint.js'));
  s = span(s, 'showInvite', 'function showInvite(m){', 'function joinInvite(code){', P('invites.js') + '\n');
  s = exact(s, 'joinInvite', "if(inGame){toast(t().invBusy);return}\ninMenu=false;setMode(3);net.lastc=c;",
    "if(inGame){toast(t().invBusy);return}\nfor(const k of Object.keys(INVS))if(INVS[k].room===c){invReply(k,true);hideInvite(k)}\ninMenu=false;setMode(3);net.lastc=c;");
  s = exact(s, 'frRow', 'function frRow(p,x){const st=Pres.st[p.id]|0;return' + BT + '<div class="lbr">', 'function frRow(p,x){const st=Pres.st[p.id]|0;return' + BT + '<div class="lbr" data-fid="${esc(p.id)}">');
  s = exact(s, 'openFr.head', 'function openFr(){const x=t(),e=frEl();e.hidden=false;', "function openFr(){const x=t(),e=frEl(),sc0=(e.querySelector('.lbp')||{}).scrollTop|0;e.hidden=false;");
  s = exact(s, 'openFr.scroll', 'for(const p of fr)if(!FRN[p.id]&&!frBusy.has(p.id)){frBusy.add(p.id);', "{const pn=e.querySelector('.lbp');if(pn)pn.scrollTop=sc0}\nfor(const p of fr)if(!FRN[p.id]&&!frBusy.has(p.id)){frBusy.add(p.id);");
  s = exact(s, 'openFr.queue', 'if(frOpen()&&!invSel)openFr()}).catch(()=>frBusy.delete(p.id))}', 'if(frOpen()&&!invSel)frQueue()}).catch(()=>frBusy.delete(p.id))}');
  s = exact(s, 'frQueue', 'Pres.sync(true)}\nasync function frClick(ev){', "Pres.sync(true)}\nlet _frT=0;function frQueue(){clearTimeout(_frT);_frT=setTimeout(()=>{if(frOpen()&&!invSel&&!pingFor&&!(document.activeElement&&document.activeElement.id==='frin'))openFr()},200)}\nasync function frClick(ev){");
  s = exact(s, 'onPushOpen', "if(d.kind==='invite'&&d.room)joinInvite(d.room);else if(d.kind==='ping')", "if(d.kind==='invite'&&d.room){if(d.iid&&!inGame){invReply(d.iid,true);hideInvite(d.iid)}joinInvite(d.room)}else if(d.kind==='ping')");
  s = exact(s, 'onPushMsg', "if(d&&(d.kind==='invite'||d.kind==='ping'))showInvite(d)}", "if(!d)return;if(d.kind==='cancel'){if(d.iid)hideInvite(d.iid);return}if(d.kind==='invite'||d.kind==='ping')showInvite(d)}");
  // "Decline" label in the three language tables (the three tables are the only ones with invJoin directly followed by invBusy)
  const re = /invJoin:'([^']*)',invBusy:/g, found = s.match(re) || [];
  if (found.length !== 3) die('i18n: expected 3 invJoin/invBusy pairs, found ' + found.length);
  const dec = ["'Decline'", "'Refuser'", "'\\u0631\\u0641\\u0636'"]; let i = 0;
  s = s.replace(re, (m, v) => "invJoin:'" + v + "',invDecline:" + dec[i++] + ',invBusy:');
  fs.writeFileSync(f, s);
}

// ---------- worker.js
{
  const f = 'server/src/worker.js'; let s = rd(f);
  s = exact(s, 'RING', 'const STAKES = [0, 100, 500, 1000, 5000];', "const STAKES = [0, 100, 500, 1000, 5000];\nconst RING = { TTL: 180000, EVERY: 20000 };     // v1.3.3: a match invite rings again every 20 s for 3 minutes unless it is answered");
  s = span(s, 'pushMsg', 'function pushMsg(inv) {', "// POST /api/invite  {from,name,av,to:[ids],", P('worker_push.js') + '\n');
  s = span(s, 'inviteApi.loop', '  for (const id of res.offline || []) {', '  return json({ ok: true, delivered: res.delivered || [], pushed, offline: noPush,',
    "  for (const id of res.offline || []) {\n    const iid = (res.iids || {})[id];\n    const ok = await pushTo(env, id, pushMsg(iid ? { ...inv, iid, rid: id, ttl: RING.TTL } : inv));\n    (ok ? pushed : noPush).push(id);\n  }\n");
  s = exact(s, 'inviteResp.fn', '// POST /api/push-token {playerId, token, remove?}', P('worker_resp.js') + '\n// POST /api/push-token {playerId, token, remove?}');
  s = exact(s, 'inviteResp.route', "  if (url.pathname === '/api/push-token' && req.method === 'POST') return pushTokenApi(req, env);",
    "  if (url.pathname === '/api/push-token' && req.method === 'POST') return pushTokenApi(req, env);\n  if (url.pathname === '/api/invite-response' && req.method === 'POST') return inviteRespApi(req, env);");
  s = exact(s, 'mm.ctor', 'constructor(state, env) { this.state = state; this.q = []; this.iv = null; this.reqs = []; }', 'constructor(state, env) { this.state = state; this.env = env; this.q = []; this.iv = null; this.reqs = []; }');
  s = exact(s, 'pr.watch', "      send(ws, { t: 'pres', all });", "      send(ws, { t: 'pres', all });\n      await this.resend(ws, a.id);");
  s = exact(s, 'pr.guard', "    if (u.pathname !== '/_pr/invite' || req.method !== 'POST') return J({ error: 'not_found' }, 404);", P('mm_respond_guard.js') + "\n    if (u.pathname !== '/_pr/invite' || req.method !== 'POST') return J({ error: 'not_found' }, 404);");
  s = exact(s, 'pr.out', 'const out = { delivered: [], offline: [], limited: [] };', 'const out = { delivered: [], offline: [], limited: [], iids: {} };');
  s = exact(s, 'pr.deliver', "      if (socks.length) { socks.forEach(s => send(s, { t: 'inv', ...inv })); out.delivered.push(id); } else out.offline.push(id);", P('mm_deliver.js'));
  s = exact(s, 'pr.methods', '    return J(out);\n  }\n  idle() {', '    await this.armAlarm();\n    return J(out);\n  }\n' + P('mm_methods.js') + '\n  idle() {');
  fs.writeFileSync(f, s);
}

// ---------- MainActivity.kt
{
  const f = 'app/src/main/java/com/iline/streetdominoes/MainActivity.kt'; let s = rd(f);
  s = exact(s, 'kb', 'window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)',
    'window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)\n        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)   // v1.3.3: the keyboard shrinks the page instead of covering / panning it');
  s = exact(s, 'intent keys', 'arrayOf("kind", "sid", "name", "room", "gm", "type", "stake", "turn", "ping")', 'arrayOf("kind", "sid", "name", "room", "gm", "type", "stake", "turn", "ping", "iid", "rid")');
  fs.writeFileSync(f, s);
}

// ---------- Push.kt / StreetMessagingService.kt (whole files; refuse if they are not the v1.3.2 versions)
{
  const kt = 'app/src/main/java/com/iline/streetdominoes/';
  let p = rd(kt + 'Push.kt'), m = rd(kt + 'StreetMessagingService.kt');
  if (!p.includes('const val CHANNEL = "invites"') || !p.includes('fun saveToken')) die('Push.kt is not the v1.3.2 file');
  if (!m.includes('override fun onNewToken') || !m.includes('onPushMsg')) die('StreetMessagingService.kt is not the v1.3.2 file');
  fs.writeFileSync(kt + 'Push.kt', fs.readFileSync(path.join(W, 'Push.kt'), 'utf8'));
  fs.writeFileSync(kt + 'StreetMessagingService.kt', fs.readFileSync(path.join(W, 'StreetMessagingService.kt'), 'utf8'));
  fs.writeFileSync(kt + 'InviteActionReceiver.kt', fs.readFileSync(path.join(W, 'InviteActionReceiver.kt'), 'utf8'));
}

// ---------- AndroidManifest.xml
{
  const f = 'app/src/main/AndroidManifest.xml'; let s = rd(f);
  if (!s.includes('InviteActionReceiver')) s = exact(s, 'manifest', '</application>', '    <receiver android:name="com.iline.streetdominoes.InviteActionReceiver" android:exported="false" />\n    </application>');
  fs.writeFileSync(f, s);
}

// ---------- docs
const add = (f, fn) => { if (fs.existsSync(f)) { const s = rd(f); if (!s.includes('v1.3.3')) fs.writeFileSync(f, fn(s)); } };
add('STATE.md', s => exact(s, 'state.title', '# Street Dominoes - project state (v1.3.2)', '# Street Dominoes - project state (v1.3.3)').replace(/\s*$/, '\n') + P('state_add.md') + '\n');
add('ROADMAP.md', s => exact(s, 'roadmap', '## Phase 2 - Monetization (AdMob and economy)', P('roadmap_add.md') + '\n\n## Phase 2 - Monetization (AdMob and economy)'));
add('CHANGELOG.md', s => s.replace(/\s*$/, '\n') + '\n## 1.3.3\n- Fix: friends window flicker (presence render loop), keyboard resize, bounded panel height.\n- Match invites keep ringing every 20 s for 3 minutes until accepted / declined (new `POST /api/invite-response`); Join / Decline on the notification.\n- FCM invites and pings are data-only high-priority messages rendered by `StreetMessagingService`.\n');

// ---------- syntax checks
{
  const html = fs.readFileSync('app/src/main/assets/www/index.html', 'utf8'); let n = 0;
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) { n++; try { new vm.Script(m[1]); } catch (e) { die('index.html inline script #' + n + ': ' + e.message); } }
  if (!n) die('no inline script found in index.html');
}
console.log('patched: index.html, worker.js, MainActivity.kt, Push.kt, StreetMessagingService.kt, InviteActionReceiver.kt, AndroidManifest.xml, docs');
JS

# worker syntax (ES module) + tests
cp "$WORKER" "$W/worker-check.mjs" && node --check "$W/worker-check.mjs"
mkdir -p server/test && cp "$W/invites.test.mjs" "$TEST"
node "$TEST"
[ -f server/test/worker.test.mjs ] && node server/test/worker.test.mjs
[ -f pages/index.html ] && cp "$HTML" pages/index.html && echo "pages/index.html mirrored"

trap - ERR
echo "OK. Kotlin is only compiled by the GitHub Actions APK build."
if [ -z "${SD_NO_GIT:-}" ]; then
  git add -A
  git commit -m "v1.3.3: friends window fix, persistent match invites, data-only FCM"
  if git remote get-url origin >/dev/null 2>&1; then git push; git tag v1.3.3; git push origin v1.3.3; else echo "no git remote: skipped push / tag"; fi
fi
echo "Done. Worker secrets are unchanged. Deploy happens from the push under server/."
