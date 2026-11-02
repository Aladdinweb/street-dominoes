#!/usr/bin/env bash
# apply-security-v1.5.0.sh - accounts + recovery key + optional email link, report & block (server and page), code-obfuscation tooling.
# Needs apply-v1.3.3.sh and apply-v1.4.0.sh applied. Run from ~/street-dominoes. Exact-match anchors, automatic restore, idempotent.
# SD_NO_GIT=1 skips commit / push; SD_TAG=1 also tags v1.5.0.
set -euo pipefail
cd "${SD_REPO:-$HOME/street-dominoes}"
HTML=app/src/main/assets/www/index.html; WWW=app/src/main/assets/www; WORKER=server/src/worker.js; WF=.github/workflows/deploy-pages.yml; LAND=landing/index.html
for f in "$HTML" "$WORKER" "$WWW/sd-ads.js"; do [ -f "$f" ] || { echo "missing $f (apply the earlier patches first; run from the repo root)"; exit 1; }; done
grep -q 'class Matchmaker' "$WORKER" && grep -q 'const RING' "$WORKER" || { echo "worker.js is not the v1.3.3+ file"; exit 1; }
T="${TMPDIR:-$HOME/tmp}"; mkdir -p "$T"; W="$(mktemp -d "$T/sd150.XXXXXX")"; BK="$W/bak"; export W
FILES=("$HTML" "$WORKER" "$WF" "$LAND" "$WWW/sd-sec.js" tools/obfuscate-html.mjs server/test/security.test.mjs STATE.md ROADMAP.md CHANGELOG.md)
for f in "${FILES[@]}"; do [ -f "$f" ] && { mkdir -p "$BK/$(dirname "$f")"; cp "$f" "$BK/$f"; }; done
trap 'echo "FAILED - restoring"; for f in "${FILES[@]}"; do if [ -f "$BK/$f" ]; then cp "$BK/$f" "$f"; else rm -f "$f"; fi; done' ERR
cat > "$W/worker_sec.js" <<'PAYLOAD_EOF'
// ---------- v1.5.0: accounts, recovery, report / block ----------
// Account data lives in the Durable Object storage of the Matchmaker instance 'acct' (KV's free tier allows only 1000 writes a day).
// A player proves who they are with a device token (random, only its SHA-256 is stored). First claim of a player id wins: until the Phase 4 login exists, an id nobody has claimed yet can be claimed by anyone who knows it.
const SEC = { ALPHA: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', KEYS: ['dm_set', 'dm_eco', 'dm_sdx', 'dm_prof2', 'dm_me', 'dm_friends'], SNAP_MAX: 8192, BLOCK_MAX: 200, REASONS: ['chat', 'name', 'cheat', 'spam', 'other'] };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
// the players this player has blocked (internal call to the 'acct' instance; [] when unavailable so a hiccup never blocks play)
async function blocksOf(env, id) {
  if (!env.MATCH || !validId(id)) return [];
  try { const r = await env.MATCH.get(env.MATCH.idFromName('acct')).fetch('https://acct.internal/_acct/blocks-of', { method: 'POST', body: JSON.stringify({ pid: id }) }); const j = await r.json(); return Array.isArray(j.list) ? j.list : []; } catch (e) { return []; }
}
const blk2 = (a, b) => (a.blk || []).includes(b.pid) || (b.blk || []).includes(a.pid);
// pick up to n queued players where nobody has blocked anybody else; strict: null unless the group is full
function pickGroup(l, n, strict = true) { const g = []; for (const e of l) if (g.length < n && !g.some(x => blk2(x, e))) g.push(e); return strict && g.length < n ? null : g; }
const SEC_ROUTES = { '/api/auth/init': 'init', '/api/auth/recovery-key': 'rk', '/api/auth/recover': 'recover', '/api/auth/save': 'save', '/api/auth/load': 'load', '/api/auth/email': 'email', '/api/auth/email-recover': 'email-recover', '/api/auth/verify': 'verify', '/api/report': 'report', '/api/block': 'block' };
async function secApi(req, env, url) {
  const p = url.pathname;
  if (p === '/api/auth/config' && req.method === 'GET') return json({ mail: !!(env.RESEND_API_KEY && env.MAIL_FROM) });
  let op = '', payload = {};
  if (req.method === 'POST') {
    const raw = await req.text();
    if (raw.length > 12288) return json({ error: 'too_large' }, 413);
    try { payload = raw ? JSON.parse(raw) : {}; } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'bad_request' }, 400);
    op = SEC_ROUTES[p] || '';
    if (payload.playerId !== undefined) payload.pid = payload.playerId;
  } else if (req.method === 'GET') {
    if (p === '/api/blocks') { op = 'blocks'; payload = { pid: url.searchParams.get('playerId') }; }
    else if (p === '/api/admin/reports') { op = 'admin'; payload = { limit: url.searchParams.get('limit') }; }
  }
  if (!op) return json({ error: 'not_found' }, 404);
  if (!env.MATCH) return json({ error: 'not_configured' }, 503);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const r = await env.MATCH.get(env.MATCH.idFromName('acct')).fetch('https://acct.internal/_acct/op', { method: 'POST', body: JSON.stringify({ ...payload, op, token: bearer, admin: bearer, ip: req.headers.get('cf-connecting-ip') || '0' }) });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
}

PAYLOAD_EOF
cat > "$W/mm_acct.js" <<'PAYLOAD_EOF'
  // ---- v1.5.0 accounts / recovery / report & block (instance 'acct') ----
  rlOk(key, max, ms) { this.rls = this.rls || new Map(); const now = Date.now(), a = (this.rls.get(key) || []).filter(t => now - t < ms); if (a.length >= max) { this.rls.set(key, a); return false; } a.push(now); this.rls.set(key, a); if (this.rls.size > 5000) this.rls.clear(); return true; }
  async authed(pid, token) { if (!validId(pid) || typeof token !== 'string' || token.length < 20 || token.length > 80) return null; const a = await this.state.storage.get('a:' + pid); return a && a.th.includes(await sha(token)) ? a : null; }
  async issue(pid, a) { const tok = b64u(crypto.getRandomValues(new Uint8Array(24))); a.th = [...a.th.slice(-2), await sha(tok)]; await this.state.storage.put('a:' + pid, a); return tok; }   // up to 3 devices
  async magic(pid, purpose, email, R) {
    const env = this.env;
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) return R({ error: 'mail_not_configured' }, 503);
    const t = b64u(crypto.getRandomValues(new Uint8Array(24)));
    await this.state.storage.put('ml:' + await sha(t), { pid, purpose, email, exp: Date.now() + 9e5 });
    const link = (env.APP_URL || 'https://street-dominoes.pages.dev') + '/?link=' + t, bind = purpose === 'bind';
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: bind ? 'Confirm your Street Dominoes email' : 'Restore your Street Dominoes account',
          html: '<p>' + (bind ? 'Tap to link this email to your Street Dominoes account:' : 'Tap to restore your Street Dominoes account on this device:') + '</p><p><a href="' + link + '">' + link + '</a></p><p>The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>' }) });
      return R(r.ok ? { ok: true } : { error: 'mail_failed' }, r.ok ? 200 : 502);
    } catch (e) { return R({ error: 'mail_failed' }, 502); }
  }
  async acctFetch(req, u) {
    const S = this.state.storage, R = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    let q; try { q = await req.json(); } catch (e) { return R({ error: 'bad_json' }, 400); }
    if (u.pathname === '/_acct/blocks-of') { const l = await S.get('bl:' + q.pid); return R({ list: Array.isArray(l) ? l : [] }); }
    const ip = String(q.ip || '0'), pid = q.pid;
    switch (q.op) {
      case 'init': {
        if (!validId(pid)) return R({ error: 'bad_id' }, 400);
        if (!this.rlOk('init:' + ip, 20, 36e5)) return R({ error: 'rate' }, 429);
        if (await S.get('a:' + pid)) return R({ error: 'claimed' }, 409);
        return R({ ok: true, token: await this.issue(pid, { th: [], c: Date.now() }) });
      }
      case 'rk': {
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        if (!this.rlOk('rk:' + pid, 5, 36e5)) return R({ error: 'rate' }, 429);
        const r = crypto.getRandomValues(new Uint8Array(8)), c = i => SEC.ALPHA[r[i] % 32], key = 'SD-' + [0, 1, 2, 3].map(c).join('') + '-' + [4, 5, 6, 7].map(c).join('');
        if (a.rkh) await S.delete('rk:' + a.rkh);
        a.rkh = await sha(key); await S.put('rk:' + a.rkh, pid); await S.put('a:' + pid, a);
        return R({ ok: true, key });
      }
      case 'recover': {
        const k = String(q.key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!/^SD[A-Z2-9]{8}$/.test(k)) return R({ error: 'bad_key' }, 400);
        if (!this.rlOk('rec:' + ip, 8, 36e5) || !this.rlOk('rec:all', 300, 36e5)) return R({ error: 'rate' }, 429);
        const id = await S.get('rk:' + await sha('SD-' + k.slice(2, 6) + '-' + k.slice(6))), a = id && await S.get('a:' + id);
        if (!a) return R({ error: 'not_found' }, 404);
        return R({ ok: true, playerId: id, token: await this.issue(id, a), snap: (await S.get('sn:' + id)) || null });
      }
      case 'save': {
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        const d = q.data; if (!d || typeof d !== 'object') return R({ error: 'bad_data' }, 400);
        const out = {}; let n = 0;
        for (const k of SEC.KEYS) if (typeof d[k] === 'string') { if (d[k].length > 4096) return R({ error: 'too_large' }, 413); out[k] = d[k]; n += d[k].length; }
        if (n > SEC.SNAP_MAX) return R({ error: 'too_large' }, 413);
        if (!this.rlOk('save:' + pid, 1, 6e4)) return R({ error: 'rate' }, 429);
        await S.put('sn:' + pid, { d: out, at: Date.now() }); return R({ ok: true });
      }
      case 'load': { const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401); return R({ ok: true, snap: (await S.get('sn:' + pid)) || null }); }
      case 'email': {
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        const em = String(q.email || '').trim().toLowerCase();
        if (em.length > 120 || !/^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/.test(em)) return R({ error: 'bad_email' }, 400);
        if (!this.rlOk('em:' + pid, 3, 36e5) || !this.rlOk('em:' + ip, 10, 36e5)) return R({ error: 'rate' }, 429);
        return this.magic(pid, 'bind', em, R);
      }
      case 'email-recover': {
        const em = String(q.email || '').trim().toLowerCase();
        if (!this.rlOk('emr:' + ip, 5, 36e5)) return R({ error: 'rate' }, 429);
        const id = em.length <= 120 && await S.get('em:' + await sha(em));
        if (id) await this.magic(id, 'recover', em, R);
        return R({ ok: true });      // same answer whether or not the email is known
      }
      case 'verify': {
        const t = String(q.link || ''); if (!/^[\w-]{20,60}$/.test(t)) return R({ error: 'bad_link' }, 400);
        if (!this.rlOk('ver:' + ip, 20, 36e5)) return R({ error: 'rate' }, 429);
        const k = 'ml:' + await sha(t), m = await S.get(k);
        if (!m || m.exp < Date.now()) return R({ error: 'expired' }, 410);
        await S.delete(k);
        const a = await S.get('a:' + m.pid); if (!a) return R({ error: 'not_found' }, 404);
        if (m.purpose === 'bind') {
          const eh = await sha(m.email), ex = await S.get('em:' + eh);
          if (ex && ex !== m.pid) return R({ error: 'email_taken' }, 409);
          if (a.eh && a.eh !== eh) await S.delete('em:' + a.eh);
          a.em = m.email; a.eh = eh; await S.put('em:' + eh, m.pid); await S.put('a:' + m.pid, a);
          return R({ ok: true, purpose: 'bind', email: m.email.replace(/^(.).*(@.*)$/, '$1***$2') });
        }
        return R({ ok: true, purpose: 'recover', playerId: m.pid, token: await this.issue(m.pid, a), snap: (await S.get('sn:' + m.pid)) || null });
      }
      case 'report': {
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        const t = q.target; if (!validId(t) || t === pid || !SEC.REASONS.includes(q.reason)) return R({ error: 'bad_request' }, 400);
        if (!this.rlOk('rep:' + pid, 6, 36e5) || !this.rlOk('rep:' + pid + t, 1, 36e5)) return R({ error: 'rate' }, 429);
        const chat = (Array.isArray(q.chat) ? q.chat : []).slice(-8).map(x => cleanChat(x)).filter(Boolean);
        await S.put('rp:' + String(Date.now()).padStart(15, '0') + '-' + b64u(crypto.getRandomValues(new Uint8Array(3))), { from: pid, target: t, reason: q.reason, name: clean(q.name, 12), chat, at: Date.now() });
        const n = ((await S.get('rpc')) || 0) + 1; await S.put('rpc', n);
        if (n > 2000) { const old = await S.list({ prefix: 'rp:', limit: 100 }); await S.delete([...old.keys()]); await S.put('rpc', n - old.size); }
        return R({ ok: true });
      }
      case 'block': {
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        if (!validId(q.target) || q.target === pid) return R({ error: 'bad_request' }, 400);
        if (!this.rlOk('blk:' + pid, 60, 36e5)) return R({ error: 'rate' }, 429);
        let l = ((await S.get('bl:' + pid)) || []).filter(x => x !== q.target); if (q.on) l.push(q.target); l = l.slice(-SEC.BLOCK_MAX);
        await S.put('bl:' + pid, l); return R({ ok: true, list: l });
      }
      case 'blocks': { const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401); return R({ ok: true, list: (await S.get('bl:' + pid)) || [] }); }
      case 'admin': {      // GET /api/admin/reports with "Authorization: Bearer <Worker secret ADMIN_TOKEN>"
        if (!this.env.ADMIN_TOKEN || q.admin !== this.env.ADMIN_TOKEN) return R({ error: 'forbidden' }, 403);
        const l = await S.list({ prefix: 'rp:', reverse: true, limit: Math.min(200, +q.limit || 50) });
        return R({ reports: [...l.values()] });
      }
      default: return R({ error: 'not_found' }, 404);
    }
  }
PAYLOAD_EOF
cat > "$W/sd-sec.js" <<'PAYLOAD_EOF'
/* sd-sec.js v1.5.0 - account security (guest token, recovery key, email link, cloud snapshot) + report / block tools. Page side of /api/auth/*, /api/report, /api/block. */
(function(){
'use strict';
var KA='dm_acc',KB='dm_blk',SK=['dm_set','dm_eco','dm_sdx','dm_prof2','dm_me','dm_friends'],ID=/^usr_[a-z0-9]{4,20}$/;
var A={tok:'',rk:'',em:''},B=[],mail=false,claimed=false,lastH='',chatLog=[],muted={},REASONS=['chat','name','cheat','spam','other'];
function ld(){try{var o=JSON.parse(localStorage.getItem(KA)||'{}');A.tok=String(o.tok||'');A.rk=String(o.rk||'');A.em=String(o.em||'')}catch(e){}
try{var b=JSON.parse(localStorage.getItem(KB)||'[]');B=Array.isArray(b)?b.filter(function(x){return ID.test(x)}).slice(0,200):[]}catch(e){}}
function sv(){try{localStorage.setItem(KA,JSON.stringify(A))}catch(e){}}
function svb(){try{localStorage.setItem(KB,JSON.stringify(B))}catch(e){}}
var ST={
en:{t:'Account Security',on:'Your account is protected on this device.',off:'Not protected yet (needs a connection).',claimed:'This player id is already protected by another device. Use your recovery key below to restore it here.',
rkT:'Recovery key',rkMake:'Create recovery key',rkNew:'New key',cp:'Copy',cpd:'Copied',rkN:'Write it down. It restores your coins, XP and rank on a new phone. Anyone who has it can restore your account.',
reT:'Restore on this device',reB:'Restore',reC:'This replaces the progress on this device. Continue?',reOk:'Restored',reBad:'Wrong or unknown key',
emT:'Email',emPh:'you@example.com',emL:'Link email',emR:'Email me a restore link',emS:'Check your inbox (the link works once, 15 min)',emOk:'Email linked',noMail:'Email linking is not available yet.',
bT:'Blocked players',none:'None',ub:'Unblock',cl:'Close',rpT:'Report or block',rp:'Report',bl:'Block',mu:'Mute for this game',cn:'Cancel',sent:'Report sent. Thank you.',bd:'Player blocked',md:'Muted',err:'Could not reach the server',rate:'Too many tries, wait a bit',
r_chat:'Abusive chat',r_name:'Offensive name',r_cheat:'Cheating',r_spam:'Spam',r_other:'Other',pick:'Who?',link:'Report / Block a player'},
fr:{t:'S\u00E9curit\u00E9 du compte',on:'Votre compte est prot\u00E9g\u00E9 sur cet appareil.',off:'Pas encore prot\u00E9g\u00E9 (connexion requise).',claimed:'Cet identifiant est d\u00E9j\u00E0 prot\u00E9g\u00E9 par un autre appareil. Utilisez votre cl\u00E9 de r\u00E9cup\u00E9ration ci-dessous.',
rkT:'Cl\u00E9 de r\u00E9cup\u00E9ration',rkMake:'Cr\u00E9er la cl\u00E9',rkNew:'Nouvelle cl\u00E9',cp:'Copier',cpd:'Copi\u00E9',rkN:'Notez-la. Elle restaure vos pi\u00E8ces, XP et rang sur un nouveau t\u00E9l\u00E9phone. Quiconque l\u2019a peut restaurer votre compte.',
reT:'Restaurer sur cet appareil',reB:'Restaurer',reC:'Cela remplace la progression de cet appareil. Continuer ?',reOk:'Restaur\u00E9',reBad:'Cl\u00E9 incorrecte ou inconnue',
emT:'E-mail',emPh:'vous@exemple.com',emL:'Lier l\u2019e-mail',emR:'M\u2019envoyer un lien de restauration',emS:'V\u00E9rifiez votre bo\u00EEte (lien \u00E0 usage unique, 15 min)',emOk:'E-mail li\u00E9',noMail:'La liaison par e-mail n\u2019est pas encore disponible.',
bT:'Joueurs bloqu\u00E9s',none:'Aucun',ub:'D\u00E9bloquer',cl:'Fermer',rpT:'Signaler ou bloquer',rp:'Signaler',bl:'Bloquer',mu:'Muet pour cette partie',cn:'Annuler',sent:'Signalement envoy\u00E9. Merci.',bd:'Joueur bloqu\u00E9',md:'Muet',err:'Serveur injoignable',rate:'Trop d\u2019essais, patientez',
r_chat:'Chat abusif',r_name:'Pseudo offensant',r_cheat:'Triche',r_spam:'Spam',r_other:'Autre',pick:'Qui ?',link:'Signaler / bloquer un joueur'},
ar:{t:'\u0623\u0645\u0627\u0646 \u0627\u0644\u062D\u0633\u0627\u0628',on:'\u062D\u0633\u0627\u0628\u0643 \u0645\u062D\u0645\u064A \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.',off:'\u063A\u064A\u0631 \u0645\u062D\u0645\u064A \u0628\u0639\u062F (\u064A\u062D\u062A\u0627\u062C \u0625\u0646\u062A\u0631\u0646\u062A).',claimed:'\u0647\u0630\u0627 \u0627\u0644\u0645\u0639\u0631\u0651\u0641 \u0645\u062D\u0645\u064A \u0628\u062C\u0647\u0627\u0632 \u0622\u062E\u0631. \u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0623\u062F\u0646\u0627\u0647.',
rkT:'\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629',rkMake:'\u0625\u0646\u0634\u0627\u0621 \u0645\u0641\u062A\u0627\u062D',rkNew:'\u0645\u0641\u062A\u0627\u062D \u062C\u062F\u064A\u062F',cp:'\u0646\u0633\u062E',cpd:'\u062A\u0645 \u0627\u0644\u0646\u0633\u062E',rkN:'\u0627\u0643\u062A\u0628\u0647. \u064A\u0639\u064A\u062F \u0639\u0645\u0644\u0627\u062A\u0643 \u0648\u062E\u0628\u0631\u062A\u0643 \u0648\u062A\u0631\u062A\u064A\u0628\u0643 \u0639\u0644\u0649 \u0647\u0627\u062A\u0641 \u062C\u062F\u064A\u062F. \u0645\u0646 \u064A\u0645\u0644\u0643\u0647 \u064A\u0633\u062A\u0637\u064A\u0639 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u062D\u0633\u0627\u0628\u0643.',
reT:'\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632',reB:'\u0627\u0633\u062A\u0639\u0627\u062F\u0629',reC:'\u0633\u064A\u062A\u0645 \u0627\u0633\u062A\u0628\u062F\u0627\u0644 \u062A\u0642\u062F\u0645 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632. \u0645\u062A\u0627\u0628\u0639\u0629\u061F',reOk:'\u062A\u0645\u062A \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629',reBad:'\u0645\u0641\u062A\u0627\u062D \u062E\u0627\u0637\u0626 \u0623\u0648 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641',
emT:'\u0627\u0644\u0628\u0631\u064A\u062F',emPh:'you@example.com',emL:'\u0631\u0628\u0637 \u0627\u0644\u0628\u0631\u064A\u062F',emR:'\u0623\u0631\u0633\u0644 \u0644\u064A \u0631\u0627\u0628\u0637 \u0627\u0633\u062A\u0639\u0627\u062F\u0629',emS:'\u062A\u062D\u0642\u0642 \u0645\u0646 \u0628\u0631\u064A\u062F\u0643 (\u0627\u0644\u0631\u0627\u0628\u0637 \u0644\u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629\u060C 15 \u062F\u0642\u064A\u0642\u0629)',emOk:'\u062A\u0645 \u0631\u0628\u0637 \u0627\u0644\u0628\u0631\u064A\u062F',noMail:'\u0627\u0644\u0631\u0628\u0637 \u0628\u0627\u0644\u0628\u0631\u064A\u062F \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0628\u0639\u062F.',
bT:'\u0627\u0644\u0644\u0627\u0639\u0628\u0648\u0646 \u0627\u0644\u0645\u062D\u0638\u0648\u0631\u0648\u0646',none:'\u0644\u0627 \u0623\u062D\u062F',ub:'\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062D\u0638\u0631',cl:'\u0625\u063A\u0644\u0627\u0642',rpT:'\u0625\u0628\u0644\u0627\u063A \u0623\u0648 \u062D\u0638\u0631',rp:'\u0625\u0628\u0644\u0627\u063A',bl:'\u062D\u0638\u0631',mu:'\u0643\u062A\u0645 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0644\u0639\u0628\u0629',cn:'\u0625\u0644\u063A\u0627\u0621',sent:'\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0628\u0644\u0627\u063A. \u0634\u0643\u0631\u064B\u0627.',bd:'\u062A\u0645 \u062D\u0638\u0631 \u0627\u0644\u0644\u0627\u0639\u0628',md:'\u062A\u0645 \u0627\u0644\u0643\u062A\u0645',err:'\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u062E\u0627\u062F\u0645',rate:'\u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0643\u062B\u064A\u0631\u0629\u060C \u0627\u0646\u062A\u0638\u0631',
r_chat:'\u062F\u0631\u062F\u0634\u0629 \u0645\u0633\u064A\u0626\u0629',r_name:'\u0627\u0633\u0645 \u0645\u0633\u064A\u0621',r_cheat:'\u063A\u0634',r_spam:'\u0631\u0633\u0627\u0626\u0644 \u0645\u0632\u0639\u062C\u0629',r_other:'\u0623\u062E\u0631\u0649',pick:'\u0645\u0646\u061F',link:'\u0625\u0628\u0644\u0627\u063A / \u062D\u0638\u0631 \u0644\u0627\u0639\u0628'}};
function L(){var l=localStorage.getItem('dm_lang')||'en';return ST[l]||ST.en}
function s(k){return L()[k]||ST.en[k]||k}
function tip(m){try{toast(m)}catch(e){}}
function E(x){return String(x).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function call(path,body,method){var h={'content-type':'application/json'};if(A.tok)h.authorization='Bearer '+A.tok;
return fetch(API_URL+path,{method:method||'POST',headers:h,body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,status:r.status,j:j}})})}
function css(){if(document.getElementById('sdsec-css'))return;var c=document.createElement('style');c.id='sdsec-css';c.textContent=
'.sxm{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.74)}.sxm[hidden]{display:none}'+
'.sxp{width:min(94vw,360px);max-height:92dvh;overflow:auto;background:#1a1a1a;border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:18px;color:#fff;box-shadow:0 14px 50px rgba(0,0,0,.6)}.sxp h3{margin:0 0 8px;text-align:center}'+
'.sxp .big{width:100%;margin-top:8px}.sxp small{display:block;color:#b9b9b9;margin-top:6px;line-height:1.4}.sxb{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}'+
'.sxk{font:700 22px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-align:center;padding:10px;border-radius:12px;background:rgba(255,255,255,.06);margin:6px 0;user-select:all}'+
'.sxp input,.sxp select{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#101010;color:#fff;font:inherit;margin-top:6px}'+
'.sxr{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0}.sxr button{padding:6px 10px}'+
'.rpb{width:26px;height:26px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.35);color:#fff;font-size:15px;line-height:1;margin-inline-start:4px;opacity:.7}';
document.head.appendChild(c)}
function modal(h){css();var e=document.getElementById('sxm');if(!e){e=document.createElement('div');e.id='sxm';e.className='sxm';e.hidden=true;document.body.appendChild(e);e.addEventListener('click',onClick)}
e.innerHTML='<div class="sxp">'+h+'</div>';e.hidden=false;return e}
function close(){var e=document.getElementById('sxm');if(e)e.hidden=true}
function peerName(id){try{var p=frPeople().find(function(z){return z.id===id});if(p)return p.n}catch(e){}return id}
// ---------- account
function init(){ld();if(A.tok)return Promise.resolve();
return call('/api/auth/init',{playerId:pid}).then(function(r){if(r.ok&&r.j.token){A.tok=r.j.token;sv();push(true);pull()}else if(r.status===409)claimed=true}).catch(function(){})}
function cfg(){call('/api/auth/config',null,'GET').then(function(r){mail=!!(r.j&&r.j.mail)}).catch(function(){})}
function snap(){var d={};SK.forEach(function(k){var v=localStorage.getItem(k);if(typeof v==='string'&&v.length<=4096)d[k]=v});return d}
function push(force){if(!A.tok)return;var d=snap(),h=JSON.stringify(d);if(!force&&h===lastH)return;lastH=h;call('/api/auth/save',{playerId:pid,data:d}).catch(function(){lastH=''})}
function pull(){if(!A.tok)return;call('/api/blocks?playerId='+encodeURIComponent(pid),null,'GET').then(function(r){if(r.ok&&Array.isArray(r.j.list)){B=r.j.list.filter(function(x){return ID.test(x)}).slice(0,200);svb()}}).catch(function(){})}
function adopt(j){try{localStorage.setItem('dm_pid',j.playerId);A={tok:j.token,rk:A.rk,em:A.em};sv();if(j.snap&&j.snap.d)SK.forEach(function(k){if(typeof j.snap.d[k]==='string')localStorage.setItem(k,j.snap.d[k])})}catch(e){}tip('\u2705 '+s('reOk'));setTimeout(function(){location.reload()},700)}
function openSec(){ld();var h='<h3>\uD83D\uDD10 '+E(s('t'))+'</h3><small>'+E(claimed&&!A.tok?s('claimed'):A.tok?s('on'):s('off'))+'</small>'+
'<div class="sxb"><b>'+E(s('rkT'))+'</b><div class="sxk" id="sxk">'+(A.rk?E(A.rk):'\u2014')+'</div>'+(A.rk?'<button class="big alt" data-x="cp">'+E(s('cp'))+'</button>':'')+'<button class="big" data-x="rk">'+E(A.rk?s('rkNew'):s('rkMake'))+'</button><small>'+E(s('rkN'))+'</small></div>'+
'<div class="sxb"><b>'+E(s('reT'))+'</b><input id="sxi" placeholder="SD-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><button class="big alt" data-x="rec">'+E(s('reB'))+'</button></div>'+
'<div class="sxb"><b>'+E(s('emT'))+'</b>'+(mail?'<input id="sxe" type="email" placeholder="'+E(s('emPh'))+'"><button class="big alt" data-x="em">'+E(s('emL'))+'</button><button class="big alt" data-x="emr">'+E(s('emR'))+'</button>':'<small>'+E(s('noMail'))+'</small>')+'</div>'+
'<div class="sxb"><b>'+E(s('bT'))+'</b>'+(B.length?B.map(function(id){return'<div class="sxr"><span>'+E(peerName(id))+'</span><button class="big alt" data-x="ub" data-id="'+E(id)+'">'+E(s('ub'))+'</button></div>'}).join(''):'<small>'+E(s('none'))+'</small>')+'</div>'+
'<button class="big alt" data-x="cl">'+E(s('cl'))+'</button>';modal(h)}
// ---------- report / block
function seatId(p){try{var id=net.pids&&net.pids[p];return ID.test(id||'')?id:''}catch(e){return''}}
function sheet(p){var id=seatId(p);if(!id)return;var nm='';try{nm=names[p]||''}catch(e){}
modal('<h3>\uD83D\uDEA9 '+E(s('rpT'))+'</h3><p style="text-align:center;margin:0 0 6px"><b>'+E(nm||id)+'</b></p><select id="sxr">'+REASONS.map(function(r){return'<option value="'+r+'">'+E(s('r_'+r))+'</option>'}).join('')+'</select>'+
'<button class="big" data-x="rp" data-p="'+p+'">'+E(s('rp'))+'</button><button class="big alt" data-x="bl" data-p="'+p+'">'+E(s('bl'))+'</button><button class="big alt" data-x="mu" data-p="'+p+'">'+E(s('mu'))+'</button><button class="big alt" data-x="cl">'+E(s('cn'))+'</button>')}
function picker(){var h='<h3>\uD83D\uDEA9 '+E(s('rpT'))+'</h3><small>'+E(s('pick'))+'</small>',n=0;
for(var p=0;p<4;p++){if(p===net.own||!seatId(p))continue;var nm='';try{nm=names[p]||''}catch(e){}h+='<button class="big alt" data-rp="'+p+'">'+E(nm||seatId(p))+'</button>';n++}
if(!n)return;h+='<button class="big alt" data-x="cl">'+E(s('cn'))+'</button>';modal(h)}
function report(p){var id=seatId(p),r=document.getElementById('sxr');if(!id)return;var nm='';try{nm=names[p]||''}catch(e){}
var chat=chatLog.filter(function(c){return c.p===p}).slice(-5).map(function(c){return c.x});
call('/api/report',{playerId:pid,target:id,reason:r?r.value:'other',name:nm,chat:chat}).then(function(x){tip(x.ok?'\u2705 '+s('sent'):x.status===429?s('rate'):s('err'));if(x.ok)close()}).catch(function(){tip(s('err'))})}
function mute(p){muted[p]=1;try{Voice.rmute.add(p)}catch(e){}tip('\uD83D\uDD07 '+s('md'));close()}
function block(p){var id=seatId(p);if(!id)return;if(B.indexOf(id)<0)B.push(id);svb();mute(p);tip('\u26D4 '+s('bd'));call('/api/block',{playerId:pid,target:id,on:1}).catch(function(){})}
function unblock(id){B=B.filter(function(x){return x!==id});svb();call('/api/block',{playerId:pid,target:id,on:0}).catch(function(){});openSec()}
// ---------- click handling (capture: runs before the game's own handlers)
function onClick(ev){var t=ev.target,x=t.closest&&t.closest('[data-x]');if(!x)return;var a=x.dataset.x,p=+x.dataset.p;
if(a==='cl')close();
else if(a==='rk'){call('/api/auth/recovery-key',{playerId:pid}).then(function(r){if(r.ok&&r.j.key){A.rk=r.j.key;sv();openSec()}else tip(r.status===429?s('rate'):s('err'))}).catch(function(){tip(s('err'))})}
else if(a==='cp'){try{navigator.clipboard.writeText(A.rk);tip(s('cpd'))}catch(e){var k=document.getElementById('sxk');if(k){var g=document.createRange();g.selectNodeContents(k);var q=getSelection();q.removeAllRanges();q.addRange(g)}}}
else if(a==='rec'){var v=(document.getElementById('sxi')||{}).value||'';if(!confirm(s('reC')))return;call('/api/auth/recover',{key:v}).then(function(r){if(r.ok&&r.j.token){A.rk=v.trim().toUpperCase();adopt(r.j)}else tip(r.status===429?s('rate'):s('reBad'))}).catch(function(){tip(s('err'))})}
else if(a==='em'||a==='emr'){var m=((document.getElementById('sxe')||{}).value||'').trim();if(!m)return;call(a==='em'?'/api/auth/email':'/api/auth/email-recover',a==='em'?{playerId:pid,email:m}:{email:m}).then(function(r){tip(r.ok?'\u2709 '+s('emS'):r.status===429?s('rate'):s('err'))}).catch(function(){tip(s('err'))})}
else if(a==='ub')unblock(x.dataset.id);
else if(a==='rp')report(p);else if(a==='bl'){block(p)}else if(a==='mu')mute(p)}
document.addEventListener('click',function(ev){var t=ev.target,b=t.closest&&t.closest('[data-rp],[data-sec],[data-rpl]');if(!b)return;ev.preventDefault();ev.stopPropagation();
if(b.dataset.sec){try{document.getElementById('set').hidden=true}catch(e){}openSec()}else if(b.dataset.rpl!==undefined){try{document.getElementById('up').hidden=true}catch(e){}picker()}else sheet(+b.dataset.rp)},true);
// hide chat bubbles from blocked / muted players and remember recent chat lines for reports
var sb=window.showTextBubble;if(typeof sb==='function')window.showTextBubble=function(p,x){try{chatLog.push({p:p,x:x});if(chatLog.length>40)chatLog.shift();var id=seatId(p);if(muted[p]||(id&&B.indexOf(id)>=0))return}catch(e){}return sb.apply(this,arguments)};
// magic link: /?link=TOKEN (forwarded by the landing page)
function link(){var m=/[?&]link=([\w-]{20,60})/.exec(location.search);if(!m)return;try{history.replaceState(null,'',location.pathname)}catch(e){}
call('/api/auth/verify',{link:m[1]}).then(function(r){if(!r.ok)return tip(s('reBad'));if(r.j.purpose==='bind')tip('\u2705 '+s('emOk')+' '+(r.j.email||''));else adopt(r.j)}).catch(function(){tip(s('err'))})}
window.SDSec={btn:function(){return'<button class="big alt" data-sec="1">\uD83D\uDD10 '+E(s('t'))+'</button>'},
rp:function(p){try{if(net.online&&p!==net.own&&seat[p]!==2&&seatId(p))return'<button class="rpb" data-rp="'+p+'" aria-label="'+E(s('rpT'))+'">\u22EF</button>'}catch(e){}return''},
rpLink:function(){try{if(net.online)return'<button class="big alt" data-rpl="1">\uD83D\uDEA9 '+E(s('link'))+'</button>'}catch(e){}return''}};
ld();cfg();setTimeout(function(){init().then(link)},1500);
setInterval(function(){push(false)},120000);document.addEventListener('visibilitychange',function(){if(document.hidden)push(false)});
setInterval(function(){try{if(net.online)for(var p=0;p<4;p++){var id=seatId(p);if(id&&B.indexOf(id)>=0)Voice.rmute.add(p)}}catch(e){}},3000);
})();
PAYLOAD_EOF
cat > "$W/obfuscate-html.mjs" <<'PAYLOAD_EOF'
// CI-only: obfuscates the inline <script> blocks of HTML files and the given .js files (usage: node tools/obfuscate-html.mjs dist/play.html dist/sd-ads.js ...).
// Run `npm install --no-save javascript-obfuscator@4` first. Safe by design: globals are NOT renamed (the page, its inline handlers and sd-*.js share globals),
// object keys are kept (localStorage / JSON), and a file whose output does not compile is left exactly as it was. Obfuscation only slows copying; the real protection is server-side.
import fs from 'node:fs';
import vm from 'node:vm';
let JO;
try { JO = (await import('javascript-obfuscator')).default; } catch (e) { console.log('javascript-obfuscator is not installed: files left as they are'); process.exit(0); }
const OPT = { compact: true, renameGlobals: false, identifierNamesGenerator: 'hexadecimal', stringArray: true, stringArrayThreshold: 0.75, stringArrayEncoding: [], transformObjectKeys: false,
  controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, debugProtection: false, disableConsoleOutput: false, unicodeEscapeSequence: false, target: 'browser' };
const ob = code => { const out = JO.obfuscate(code, OPT).getObfuscatedCode(); new vm.Script(out); return out; };
for (const f of process.argv.slice(2)) {
  if (!fs.existsSync(f)) { console.log('skip (missing)', f); continue; }
  const src = fs.readFileSync(f, 'utf8');
  try {
    const out = f.endsWith('.html') ? src.replace(/(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/g, (m, a, b, c) => (b.trim() ? a + ob(b) + c : m)) : ob(src);
    fs.writeFileSync(f, out); console.log('obfuscated', f, src.length, '->', out.length);
  } catch (e) { console.log('SKIPPED', f, '-', e.message); }
}
PAYLOAD_EOF
cat > "$W/security.test.mjs" <<'PAYLOAD_EOF'
// Accounts, recovery, report / block (v1.5.0): run with `node server/test/security.test.mjs`. Mocks the Durable Object storage and the mail API; no network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdsec-')), mjs = path.join(tmp, 'worker.mjs');
fs.copyFileSync(path.join(here, '../src/worker.js'), mjs);
const { Matchmaker } = await import(pathToFileURL(mjs).href);
const store = new Map(); let mails = [];
globalThis.fetch = async (url, o) => { if (String(url).includes('api.resend.com')) { mails.push(JSON.parse(o.body)); return { ok: true, status: 200 }; } throw new Error('unexpected fetch ' + url); };
const state = { storage: { async put(k, v) { store.set(k, structuredClone(v)); }, async get(k) { const v = store.get(k); return v === undefined ? undefined : structuredClone(v); },
  async delete(k) { if (Array.isArray(k)) { k.forEach(x => store.delete(x)); return k.length; } return store.delete(k); },
  async list({ prefix, reverse, limit }) { let ks = [...store.keys()].filter(k => k.startsWith(prefix)).sort(); if (reverse) ks.reverse(); if (limit) ks = ks.slice(0, limit); return new Map(ks.map(k => [k, structuredClone(store.get(k))])); } }, getWebSockets: () => [] };
const mm = new Matchmaker(state, { RESEND_API_KEY: 'k', MAIL_FROM: 'Street <no-reply@example.com>', ADMIN_TOKEN: 'adm-secret' });
const op = async (o, ip = '1.1.1.1') => { const r = await mm.acctFetch(new Request('https://acct.internal/_acct/op', { method: 'POST', body: JSON.stringify({ ip, ...o }) }), new URL('https://acct.internal/_acct/op')); return { s: r.status, j: await r.json() }; };
const A = 'usr_aaaa11', B = 'usr_bbbb22';

// guest init: first claim wins, the token is stored hashed
let r = await op({ op: 'init', pid: A }); assert.equal(r.s, 200); const tokA = r.j.token; assert.ok(tokA.length >= 30);
assert.ok(![...store.values()].some(v => JSON.stringify(v).includes(tokA)), 'token is not stored in clear');
assert.equal((await op({ op: 'init', pid: A })).s, 409, 'second claim refused');
assert.equal((await op({ op: 'init', pid: 'bad id' })).s, 400);
const tokB = (await op({ op: 'init', pid: B })).j.token;

// auth is required
assert.equal((await op({ op: 'rk', pid: A, token: 'x'.repeat(30) })).s, 401);
assert.equal((await op({ op: 'rk', pid: A, token: tokB })).s, 401, 'another player token does not work');

// recovery key + snapshot + restore on a new device
r = await op({ op: 'rk', pid: A, token: tokA }); assert.match(r.j.key, /^SD-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/); const key1 = r.j.key;
assert.equal((await op({ op: 'save', pid: A, token: tokA, data: { dm_set: '{"c":2900}', dm_eco: '{"xp":135}', evil: 'x' } })).s, 200);
assert.equal((await op({ op: 'save', pid: A, token: tokA, data: { dm_set: '{}' } })).s, 429, 'saves are limited to one a minute');
assert.equal((await op({ op: 'save', pid: B, token: tokB, data: { dm_set: 'x'.repeat(5000) } })).s, 413);
r = await op({ op: 'recover', key: key1.toLowerCase().replace(/-/g, ' ') }); assert.equal(r.s, 200); assert.equal(r.j.playerId, A);
assert.equal(r.j.snap.d.dm_set, '{"c":2900}'); assert.equal(r.j.snap.d.evil, undefined, 'only whitelisted keys are kept');
const tokA2 = r.j.token; assert.equal((await op({ op: 'load', pid: A, token: tokA2 })).s, 200); assert.equal((await op({ op: 'load', pid: A, token: tokA })).s, 200, 'old device still works (up to 3 devices)');
r = await op({ op: 'rk', pid: A, token: tokA2 }); assert.notEqual(r.j.key, key1);
assert.equal((await op({ op: 'recover', key: key1 })).s, 404, 'a replaced key stops working');
assert.equal((await op({ op: 'recover', key: 'SD-ZZZZ-ZZZZ' })).s, 404); assert.equal((await op({ op: 'recover', key: 'nope' })).s, 400);
for (let i = 0; i < 8; i++) await op({ op: 'recover', key: 'SD-ZZZZ-ZZZZ' }, '9.9.9.9');
assert.equal((await op({ op: 'recover', key: 'SD-ZZZZ-ZZZZ' }, '9.9.9.9')).s, 429, 'guessing is rate limited per address');

// email magic link: bind, then restore, single use
assert.equal((await op({ op: 'email', pid: A, token: tokA2, email: 'not-an-email' })).s, 400);
assert.equal((await op({ op: 'email', pid: A, token: tokA2, email: 'Ann@Example.com' })).s, 200);
let link = /\?link=([\w-]+)/.exec(mails.at(-1).html)[1]; assert.ok(mails.at(-1).to[0] === 'ann@example.com');
r = await op({ op: 'verify', link }); assert.equal(r.j.purpose, 'bind'); assert.equal(r.j.email, 'a***@example.com');
assert.equal((await op({ op: 'verify', link })).s, 410, 'link works once');
mails = []; assert.deepEqual((await op({ op: 'email-recover', email: 'nobody@example.com' })).j, { ok: true }); assert.equal(mails.length, 0, 'unknown email sends nothing but answers the same');
assert.deepEqual((await op({ op: 'email-recover', email: 'ann@example.com' })).j, { ok: true }); link = /\?link=([\w-]+)/.exec(mails.at(-1).html)[1];
r = await op({ op: 'verify', link }); assert.equal(r.j.purpose, 'recover'); assert.equal(r.j.playerId, A); assert.ok(r.j.token);
assert.equal((await op({ op: 'email', pid: B, token: tokB, email: 'ann@example.com' })).s, 200); link = /\?link=([\w-]+)/.exec(mails.at(-1).html)[1];
assert.equal((await op({ op: 'verify', link })).s, 409, 'one email, one account');

// block list: stored per player, readable by the server for matching / invites / chat
assert.equal((await op({ op: 'block', pid: A, token: tokA2, target: B, on: 1 })).j.list.join(), B);
assert.equal((await op({ op: 'block', pid: A, token: tokA2, target: A, on: 1 })).s, 400, 'cannot block yourself');
const bo = await mm.acctFetch(new Request('https://acct.internal/_acct/blocks-of', { method: 'POST', body: JSON.stringify({ pid: A }) }), new URL('https://acct.internal/_acct/blocks-of'));
assert.deepEqual((await bo.json()).list, [B]);
assert.deepEqual((await op({ op: 'block', pid: A, token: tokA2, target: B, on: 0 })).j.list, []);

// reports: stored for moderation, limited, admin-only listing
assert.equal((await op({ op: 'report', pid: A, token: tokA2, target: B, reason: 'chat', name: 'Bad<b>', chat: ['hello', 'see http://x.y/z'] })).s, 200);
assert.equal((await op({ op: 'report', pid: A, token: tokA2, target: B, reason: 'chat' })).s, 429, 'same target only once an hour');
assert.equal((await op({ op: 'report', pid: A, token: tokA2, target: B, reason: 'bogus' })).s, 400);
assert.equal((await op({ op: 'admin', admin: 'wrong' })).s, 403); assert.equal((await op({ op: 'admin', admin: '' })).s, 403);
r = await op({ op: 'admin', admin: 'adm-secret' }); assert.equal(r.j.reports.length, 1); assert.equal(r.j.reports[0].target, B); assert.ok(!r.j.reports[0].chat.join().includes('http'));
console.log('security.test.mjs: all checks passed');
PAYLOAD_EOF
cat > "$W/docs_state.md" <<'PAYLOAD_EOF'

<!-- sd150 -->
## 20. v1.5.0: accounts, recovery, report / block, code protection
- Accounts (Worker): `POST /api/auth/init {playerId}` gives the device a random token (only its SHA-256 is stored; first claim of an id wins, 409 `claimed` afterwards; up to 3 devices per account). Data lives in Durable Object storage of the `Matchmaker` instance `acct` (reached only from inside the Worker via `/_acct/*`), NOT in KV (free KV = 1000 writes a day). Authenticated calls send `Authorization: Bearer <token>` (CORS now allows `authorization`).
- Recovery: `POST /api/auth/recovery-key` creates `SD-XXXX-XXXX` (alphabet without I/O/0/1, 40 bits; stored hashed, the page keeps a copy in `dm_acc.rk` to show it); `POST /api/auth/recover {key}` returns `{playerId, token, snap}` (8 tries / hour / address, 300 / hour overall). `POST /api/auth/save {data}` (1 per minute, whitelisted keys `dm_set dm_eco dm_sdx dm_prof2 dm_me dm_friends`, 4 KB each, 8 KB total) keeps the coins / XP snapshot; rank points were already server-side. Restore writes those keys, sets `dm_pid`, reloads.
- Email magic link (optional): needs Worker secrets `RESEND_API_KEY` and `MAIL_FROM` (optional `APP_URL`); `GET /api/auth/config -> {mail}` hides the UI otherwise. `POST /api/auth/email` (bind), `/email-recover` (always answers ok), `/verify {link}` (single use, 15 min). The link is `/?link=TOKEN` (the landing page forwards it to `/play`). The email address is stored in clear (needed to send the restore link): mention it in the privacy policy.
- Report / block: `POST /api/report {target, reason, name, chat[]}` (6 / hour, 1 per target per hour; stored as `rp:*`, oldest dropped past 2000), `GET /api/admin/reports` with `Authorization: Bearer <ADMIN_TOKEN secret>`; `POST /api/block {target, on}`, `GET /api/blocks?playerId=`. Enforcement: invites (either direction) are dropped silently, quick match never pairs two players where one blocked the other (`pickGroup`), room quick chat / emoji (`bcastRx`) skips blocked pairs; the page also hides their bubbles and mutes their voice (best effort). Friend rooms entered by code are not blocked.
- Page: `www/sd-sec.js` (loaded after `sd-ads.js`; EN / FR / AR): Settings button "Account Security" (`SDSec.btn`), a small `...` button after the mic on other players' HUD cards (`SDSec.rp`), "Report / Block a player" in the quick-chat panel (`SDSec.rpLink`), blocked list with Unblock. State: `dm_acc` (token, key, email), `dm_blk`.
- Code protection: `tools/obfuscate-html.mjs` (javascript-obfuscator, globals not renamed, falls back to the original file). `deploy-pages.yml` runs it for the web build only when the repository variable `OBFUSCATE` is `1` (off by default; test on a preview deploy first). For the APK add the same step before the Gradle build in `release.yml`: `npm install --no-save javascript-obfuscator@4 && node tools/obfuscate-html.mjs app/src/main/assets/www/index.html app/src/main/assets/www/sd-ads.js app/src/main/assets/www/sd-sec.js`. Obfuscation only slows copying; the economy still needs server-held balances (Phase 4).
- Tests: `node server/test/security.test.mjs`. Limits: `init` is first-come (an unclaimed id can be claimed by someone who knows it); the WebSocket / invite / match-result calls still trust the player id; coins in a snapshot are client-reported.
PAYLOAD_EOF
cat > "$W/docs_roadmap.md" <<'PAYLOAD_EOF'
## Update v1.5.0 - Accounts, recovery, report / block

- [x] Device token + recovery key (`SD-XXXX-XXXX`) + cloud snapshot (coins, XP, boosts, settings); optional email magic link (needs `RESEND_API_KEY` + `MAIL_FROM`).
- [x] Report and block (Google Play user-generated-content requirement): in the HUD, the quick-chat panel and Settings > Account Security; server enforcement for invites, quick match and room chat; reports stored for moderation (`/api/admin/reports`).
- [x] Obfuscation tool + optional CI step (`OBFUSCATE=1`), web build first.
- [ ] Worker secrets to set: `ADMIN_TOKEN` (read reports), optionally `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`. Add the obfuscation step to `release.yml` after testing on a preview deploy.
- [ ] Next (Phase 4): require the token on `/api/match-result`, WebSocket joins and invites; server-held coins; Google / Play Games sign-in when a Play Console account exists.

PAYLOAD_EOF
export HTML WORKER WF LAND WWW
node - <<'JS'
const fs = require('fs'), vm = require('vm'), path = require('path');
const W = process.env.W, P = n => fs.readFileSync(path.join(W, n), 'utf8').replace(/\n$/, '');
const die = m => { console.error('ABORT: ' + m); process.exit(1); };
const cnt = (s, f) => s.split(f).length - 1;
const exact = (s, tag, a, b) => { const n = cnt(s, a); if (n !== 1) die(tag + ': anchor found ' + n + ' times (need 1): ' + a.slice(0, 80)); return s.replace(a, () => b); };
const rd = f => { const s = fs.readFileSync(f, 'utf8'); if (s.includes('\r\n')) die(f + ' uses CRLF'); return s; };
// ---- worker.js
{
  const f = process.env.WORKER; let s = rd(f);
  if (!s.includes('const SEC =')) {
    s = exact(s, 'cors', "'access-control-allow-headers': 'content-type'", "'access-control-allow-headers': 'content-type, authorization'");
    s = exact(s, 'sec.fns', 'async function api(req, env, url) {', P('worker_sec.js') + '\nasync function api(req, env, url) {');
    s = exact(s, 'sec.route', "  if (url.pathname === '/api/turn' && req.method === 'GET') return turnApi(env);",
      "  if (url.pathname === '/api/turn' && req.method === 'GET') return turnApi(env);\n  if (url.pathname.startsWith('/api/auth/') || ['/api/report', '/api/block', '/api/blocks', '/api/admin/reports'].includes(url.pathname)) return secApi(req, env, url);");
    s = exact(s, 'invite.filter', "  const pr = await env.MATCH.get(env.MATCH.idFromName('pr')).fetch('https://pr.internal/_pr/invite', { method: 'POST', body: JSON.stringify({ inv, to }) });",
      "  const mineBl = await blocksOf(env, b.from), toOk = [];      // v1.5.0: nobody gets an invite from / sends one to a player they blocked\n  for (const id of to) if (!mineBl.includes(id) && !(await blocksOf(env, id)).includes(b.from)) toOk.push(id);\n  if (!toOk.length) return json({ ok: true, delivered: [], pushed: [], offline: [], limited: [] });\n  const pr = await env.MATCH.get(env.MATCH.idFromName('pr')).fetch('https://pr.internal/_pr/invite', { method: 'POST', body: JSON.stringify({ inv, to: toOk }) });");
    s = exact(s, 'mm.route', "if (lbu.pathname.startsWith('/_pr/')) return this.prFetch(req, lbu);", "if (lbu.pathname.startsWith('/_pr/')) return this.prFetch(req, lbu);\n    if (lbu.pathname.startsWith('/_acct/')) return this.acctFetch(req, lbu);       // accounts / recovery / report & block (instance 'acct')");
    s = exact(s, 'mm.methods', '  idle() { if (!this.q.length && this.iv)', P('mm_acct.js') + '\n  idle() { if (!this.q.length && this.iv)');
    s = exact(s, 'queue.entry', 'since: Date.now() };\n    this.q.push(e);',
      "since: Date.now(), pid: validId(q.get('pid')) ? q.get('pid') : '', blk: [], ready: true };\n    if (e.pid && this.env.MATCH) { e.ready = false; blocksOf(this.env, e.pid).then(l => { e.blk = l; }).catch(() => {}).finally(() => { e.ready = true; }); }   // v1.5.0: wait for the block list before pairing\n    this.q.push(e);");
    s = exact(s, 'tick.filter', 'l = this.q.filter(e => sk(e) === k);', 'l = this.q.filter(e => e.ready !== false && sk(e) === k);');
    s = exact(s, 'tick.group', "if (l.length >= need) this.match(l.slice(0, need), gm, false, stake, '', sp);", "const grp = pickGroup(l, need);      // never pair two players where one blocked the other\n      if (grp) this.match(grp, gm, false, stake, '', sp);");
    s = exact(s, 'tick.fill', "this.match(l, gm, true, stake, '', sp);", "this.match(pickGroup(l, need, false), gm, true, stake, '', sp);");
    s = exact(s, 'room.seat', 'this.seats[p] = { pid, name, dn: this.uniqueName(name), av, bot: false, ws, off: 0, rm: false };', 'this.seats[p] = { pid, name, dn: this.uniqueName(name), av, bot: false, ws, off: 0, rm: false };\n      this.loadBlocks(p);');
    s = exact(s, 'room.bcast', '  bcast(o) { this.seats.forEach(s => { if (s && s.ws) send(s.ws, o); }); }',
      "  bcast(o) { this.seats.forEach(s => { if (s && s.ws) send(s.ws, o); }); }\n  loadBlocks(p) { const s = this.seats[p]; if (s && validId(s.pid)) blocksOf(this.env, s.pid).then(l => { s.blk = l; }).catch(() => {}); }\n  // quick chat / emoji: not delivered between two players where one blocked the other\n  bcastRx(p, o) { const f = this.seats[p]; this.seats.forEach(s => { if (!s || !s.ws) return; if (f && f.pid && s !== f && ((s.blk || []).includes(f.pid) || (f.blk || []).includes(s.pid))) return; send(s.ws, o); }); }");
    s = exact(s, 'room.rx1', "this.bcast({ t: 'rx', p, k: m.k })", "this.bcastRx(p, { t: 'rx', p, k: m.k })");
    s = exact(s, 'room.rx2', "this.bcast({ t: 'rx', p, k: 'txt', x })", "this.bcastRx(p, { t: 'rx', p, k: 'txt', x })");
    fs.writeFileSync(f, s); console.log('worker.js patched');
  } else console.log('worker.js already patched');
}
// ---- page
{
  const f = process.env.HTML; let s = rd(f);
  if (!s.includes('sd-sec.js')) {
    s = exact(s, 'mic', 'data-mic="${p}" aria-label="mic">${ic}</button>', 'data-mic="${p}" aria-label="mic">${ic}</button>${window.SDSec?SDSec.rp(p):\'\'}');
    s = exact(s, 'settings', '${x.prof}</button><label>${x.lng}</label>', "${x.prof}</button>${window.SDSec?SDSec.btn():''}<label>${x.lng}</label>");
    s = exact(s, 'rxmenu', '${x.chatSend}</button></div><button class="big alt" id="upx">', "${x.chatSend}</button></div>${window.SDSec?SDSec.rpLink():''}<button class=\"big alt\" id=\"upx\">");
    s = exact(s, 'tag', '<script src="sd-ads.js"></script>', '<script src="sd-ads.js"></script>\n<script src="sd-sec.js"></script>');
    fs.writeFileSync(f, s); console.log('index.html patched');
  } else console.log('index.html already patched');
  fs.writeFileSync(process.env.WWW + '/sd-sec.js', fs.readFileSync(path.join(W, 'sd-sec.js'), 'utf8'));
  fs.mkdirSync('tools', { recursive: true }); fs.writeFileSync('tools/obfuscate-html.mjs', fs.readFileSync(path.join(W, 'obfuscate-html.mjs'), 'utf8'));
  fs.mkdirSync('server/test', { recursive: true }); fs.writeFileSync('server/test/security.test.mjs', fs.readFileSync(path.join(W, 'security.test.mjs'), 'utf8'));
}
// ---- landing: forward ?link=TOKEN (email magic link) to the game
if (fs.existsSync(process.env.LAND)) { let s = rd(process.env.LAND); if (s.includes('/[?&]room=/.test(q)')) { s = s.replace('/[?&]room=/.test(q)', () => '/[?&](room|link)=/.test(q)'); fs.writeFileSync(process.env.LAND, s); console.log('landing forwards ?link='); } }
// ---- CI: optional obfuscation step for the web build (off unless the repository variable OBFUSCATE is 1)
if (fs.existsSync(process.env.WF)) {
  let s = rd(process.env.WF);
  if (!s.includes('obfuscate-html')) {
    s = exact(s, 'wf.step', '      - name: Deploy\n', "      - name: Obfuscate scripts (web build, only when repository variable OBFUSCATE = 1)\n        if: ${{ vars.OBFUSCATE == '1' }}\n        continue-on-error: true\n        run: |\n          npm install --no-save javascript-obfuscator@4\n          node tools/obfuscate-html.mjs dist/play.html dist/sd-ads.js dist/sd-sec.js\n      - name: Deploy\n");
    s = exact(s, 'wf.paths', "      - 'pages/**'\n", "      - 'pages/**'\n      - 'tools/**'\n");
    fs.writeFileSync(process.env.WF, s); console.log('deploy-pages.yml: obfuscation step added (off by default)');
  }
}
// ---- docs
const add = (f, fn) => { if (fs.existsSync(f)) { const s = rd(f); if (!s.includes('v1.5.0')) fs.writeFileSync(f, fn(s)); } };
add('STATE.md', s => s.replace(/\s*$/, '\n') + P('docs_state.md') + '\n');
add('ROADMAP.md', s => s.includes('## Phase 3 - Security and anti-cheat') ? exact(s, 'roadmap', '## Phase 3 - Security and anti-cheat', P('docs_roadmap.md') + '\n\n## Phase 3 - Security and anti-cheat') : s + '\n' + P('docs_roadmap.md') + '\n');
add('CHANGELOG.md', s => s.replace(/\s*$/, '\n') + '\n## 1.5.0\n- Accounts: device token, recovery key (SD-XXXX-XXXX), cloud snapshot, optional email magic link.\n- Report and block (HUD, quick chat, Settings); server filters invites, quick match and chat.\n- Obfuscation tool + optional CI step.\n');
// ---- syntax checks
{
  let n = 0; const html = fs.readFileSync(process.env.HTML, 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) { n++; try { new vm.Script(m[1]); } catch (e) { die('index.html script #' + n + ': ' + e.message); } }
  try { new vm.Script(fs.readFileSync(process.env.WWW + '/sd-sec.js', 'utf8')); } catch (e) { die('sd-sec.js: ' + e.message); }
}
console.log('patched OK');
JS
cp "$WORKER" "$W/worker-check.mjs" && node --check "$W/worker-check.mjs"
node server/test/security.test.mjs
[ -f server/test/invites.test.mjs ] && node server/test/invites.test.mjs
[ -f server/test/worker.test.mjs ] && node server/test/worker.test.mjs
trap - ERR
if [ -z "${SD_NO_GIT:-}" ]; then
  git add -A
  git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
  git commit -m "v1.5.0: accounts + recovery key, report & block, obfuscation tooling"
  git push
  [ -n "${SD_TAG:-}" ] && { git tag v1.5.0; git push origin v1.5.0; }
fi
cat <<'MSG'
Done. Next steps:
 - Worker secrets: ADMIN_TOKEN (to read reports); optional RESEND_API_KEY + MAIL_FROM (+ APP_URL) for the email link. Without the mail secrets the email UI is hidden.
 - Obfuscation is OFF until you set the GitHub repository variable OBFUSCATE=1 (Settings > Secrets and variables > Actions > Variables). Test on a preview deploy first.
 - Your app is currently built with Google TEST ad units: run  bash apply-admob-mode.sh real  before a public release.
MSG
