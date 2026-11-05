#!/bin/sh
# Street Dominoes v1.7.1 - Daily Streak: honest error messages + no false "No connection" while a request is running
# Run from ~/street-dominoes.  Idempotent.
set -e
VER="1.7.1"
WWW="app/src/main/assets/www"
[ -f "$WWW/sd-streak.js" ] || { echo "run this from ~/street-dominoes (sd-streak.js missing: apply v1.7.0 first)"; exit 1; }

# Is the new route live on the Worker?  401 = deployed (needs the account token), 404 = the Worker has NOT been redeployed yet.
URL="https://street-dominoes-server.alaacasanova31.workers.dev/api/streak?playerId=usr_probe01"
CODE=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null) || true
CODE="${CODE:-000}"
case "$CODE" in
  401) echo "Worker check: /api/streak is LIVE (HTTP 401 without a token, as expected)." ;;
  404) echo "Worker check: /api/streak returns 404 -> the Worker was NOT redeployed with v1.7.0. Check GitHub > Actions > deploy-worker (or run: cd server && npx wrangler deploy)." ;;
  000|0) echo "Worker check: no answer (offline?)." ;;
  *)   echo "Worker check: unexpected HTTP $CODE from /api/streak." ;;
esac

cp "$WWW/sd-streak.js" "${TMPDIR:-$HOME/tmp}/sd-streak.js.bak" 2>/dev/null || true
cat > "$WWW/sd-streak.js" <<'SDSTK_EOF'
/* sd-streak.js - Street Dominoes v1.7.0: 7-day login streak (client). Loaded after sd-onboard.js.
   Server: GET /api/streak, POST /api/streak/claim (STATE.md section 23). The reward itself arrives through the normal reward inbox
   and is applied by sd-ref.js (coins, Loss Shield, XP boost, spins); this file never creates a reward. */
(function () {
  'use strict';
  if (window.SDStreak) return;
  var API = 'https://street-dominoes-server.alaacasanova31.workers.dev';
  function L(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function J(k, d) { try { var v = JSON.parse(L(k, 'null')); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pid() { return L('dm_pid', ''); }
  function token() { var a = J('dm_acc', {}); return (a && a.token) || ''; }

  var T = {
    en: { title: 'Daily Streak', day: 'Day', claim: 'Claim Day {n}', come: 'Next reward in', streak: '\uD83D\uDD25 Streak: {n} days', reset: 'Streak reset. Start again from Day 1!',
      first: 'Come back every day for bigger rewards.', ready: 'Claim now!', loading: 'Loading...', e_net: 'No connection, try again', e_auth: 'Account not ready, try again', e_err: 'Could not claim, try again', e_srv: 'Server not updated yet (HTTP {n}). Try again in a minute.', e_tok: 'No account token yet. Reopen the app and try again.' },
    fr: { title: 'Série quotidienne', day: 'Jour', claim: 'Récupérer le jour {n}', come: 'Prochaine récompense dans', streak: '\uD83D\uDD25 Série : {n} jours', reset: 'Série remise à zéro. Reprenez au jour 1 !',
      first: 'Revenez chaque jour pour de plus grosses récompenses.', ready: 'À récupérer !', loading: 'Chargement...', e_net: 'Pas de connexion, réessayez', e_auth: 'Compte pas prêt, réessayez', e_err: 'Impossible de récupérer, réessayez', e_srv: 'Serveur pas encore à jour (HTTP {n}). Réessayez dans une minute.', e_tok: 'Pas encore de jeton de compte. Rouvrez l’application et réessayez.' },
    ar: { title: 'سلسلة الدخول اليومي', day: 'اليوم', claim: 'استلم اليوم {n}', come: 'المكافأة التالية بعد', streak: '\uD83D\uDD25 السلسلة: {n} أيام', reset: 'انقطعت السلسلة. ابدأ من اليوم 1!',
      first: 'عد كل يوم لمكافآت أكبر.', ready: 'استلم الآن!', loading: '...', e_net: 'لا يوجد اتصال، حاول مجددا', e_auth: 'الحساب غير جاهز، حاول مجددا', e_err: 'تعذر الاستلام، حاول مجددا', e_srv: 'الخادم لم يُحدَّث بعد (HTTP {n}). حاول بعد دقيقة.', e_tok: 'لا يوجد رمز حساب بعد. أعد فتح التطبيق وحاول مجددا.' }
  };
  function lang() { var l = L('dm_lang', 'en'); return T[l] ? l : 'en'; }
  function t(k) { return T[lang()][k] || T.en[k] || k; }

  var DEF = [{ coins: 1000 }, { coins: 2000 }, { coins: 3000, shield: 1 }, { coins: 4000 }, { coins: 5000, xpMin: 30 }, { coins: 7500 }, { coins: 10000, spins: 1 }];
  var st = null, stAt = 0, busyF = false, busyP = null, lastErr = '', lastTry = 0, claiming = false, tmr = 0, pop = null;

  function api(path, method, body) {
    var h = { 'Content-Type': 'application/json' }, tk = token();
    if (tk) h.Authorization = 'Bearer ' + tk;
    return fetch(API + path, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j || {} }; }); })
      .catch(function () { return { ok: false, status: 0, j: {} }; });
  }
  function toastMsg(m) { try { if (typeof toast === 'function') toast(m); } catch (e) {} }

  /* ---------- status ---------- */
  function fresh() { return st && Date.now() < stAt + (st.left || 0); }     // still the same Algeria day (UTC+1) as when it was fetched
  function fetchStatus(force) {
    if (!pid() || !token()) { lastErr = 'no-token'; return Promise.resolve(st); }
    if (busyF) return busyP;                                        // a request is already running: wait for it instead of answering "nothing"
    if (!force) { if (fresh()) return Promise.resolve(st); if (Date.now() - lastTry < 15000) return Promise.resolve(st); }
    lastTry = Date.now(); busyF = true;
    busyP = api('/api/streak?playerId=' + encodeURIComponent(pid())).then(function (r) {
      busyF = false;
      if (r.ok && r.j && r.j.ok) { st = r.j; stAt = Date.now(); lastErr = ''; paintBtn(); }
      else lastErr = r.status ? 'http-' + r.status : 'net';
      return st;
    });
    return busyP;
  }
  /* what to tell the player when there is no status: the real reason, not always "no connection" */
  function errText() {
    var e = lastErr;
    if (e === 'no-token') return t('e_tok');
    if (e === 'http-401' || e === 'http-403') return t('e_auth');
    if (e === 'http-404' || e === 'http-405' || e === 'http-502' || e === 'http-503') return t('e_srv').replace('{n}', e.slice(5));
    if (e === 'net') return t('e_net');
    return e ? t('e_err') + ' (' + e.replace('http-', 'HTTP ') + ')' : t('e_net');
  }

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.id = 'sdstk-css';
  css.textContent =
    '#sdstk{position:fixed;inset:0;z-index:99985;background:rgba(6,6,8,.88);display:flex;align-items:center;justify-content:center;padding:14px;color:#fff;font-family:inherit}' +
    '#sdstk .c{width:100%;max-width:400px;max-height:calc(100dvh - 28px);overflow:auto;background:#14161a;border:1px solid #2c2f36;border-radius:18px;padding:16px;box-shadow:0 0 40px rgba(225,29,46,.25);animation:sdsIn .25s ease-out}' +
    '#sdstk h2{margin:0 0 4px;text-align:center;font-size:20px}#sdstk .x{float:right;background:none;border:0;color:#aaa;font-size:22px;line-height:1}' +
    '#sdstk .sb{text-align:center;color:#b5b8bf;font-size:13px;margin:2px 0 12px}' +
    '#sdstk .g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}' +
    '#sdstk .d{position:relative;background:#1b1e23;border:1px solid #2c2f36;border-radius:12px;padding:8px 4px;text-align:center;min-height:78px;display:flex;flex-direction:column;justify-content:center;gap:4px}' +
    '#sdstk .d em{font-style:normal;font-size:11px;color:#9aa0aa}#sdstk .d .r{display:flex;flex-direction:column;gap:2px;font-size:12px;font-weight:700}' +
    '#sdstk .d.last{grid-column:span 2;border-color:#7a0f19}' +
    '#sdstk .d.tk{opacity:.55}#sdstk .d .ck{position:absolute;top:3px;right:6px;color:#7be08f;font-style:normal;font-weight:900}' +
    '#sdstk .d.td{border-color:#e11d2e;box-shadow:0 0 14px #e11d2e;animation:sdsP 1.1s ease-in-out infinite alternate}' +
    '#sdstk .btn{width:100%;margin-top:14px;padding:13px;border:0;border-radius:12px;background:#e11d2e;color:#fff;font-weight:800;font-size:16px}#sdstk .btn:disabled{background:#262a31;color:#9aa0aa}' +
    '#sdstk .msg{min-height:18px;text-align:center;font-size:13px;margin-top:6px}#sdstk .msg.e{color:#ff6b78}' +
    '@keyframes sdsIn{from{transform:scale(.88);opacity:0}to{transform:scale(1);opacity:1}}@keyframes sdsP{to{box-shadow:0 0 4px #e11d2e}}';
  document.head.appendChild(css);

  /* ---------- popup ---------- */
  function kfmt(n) { return n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : String(n); }
  function rew(d) {
    var h = '';
    if (d.coins) h += '<span>\uD83E\uDE99 ' + kfmt(d.coins) + '</span>';
    if (d.shield) h += '<span>\uD83D\uDEE1 +' + d.shield + '</span>';
    if (d.xpMin) h += '<span>\u26A1 ' + d.xpMin + 'm</span>';
    if (d.spins) h += '<span>\uD83C\uDFA1 +' + d.spins + '</span>';
    return h;
  }
  function hms(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(function (v) { return (v < 10 ? '0' : '') + v; }).join(':'); }
  function closePop() { clearInterval(tmr); tmr = 0; if (pop && pop.parentNode) pop.parentNode.removeChild(pop); pop = null; }
  function msg(m, bad) { var e = document.getElementById('sdstkm'); if (e) { e.className = 'msg' + (bad ? ' e' : ''); e.textContent = m; } }

  function build() {
    var s = st; if (!s) return;
    clearInterval(tmr);
    var days = s.days && s.days.length === 7 ? s.days : DEF;
    var cards = days.map(function (d, i) {
      var n = i + 1, tk = s.done ? n <= s.day : (!s.broken && n < s.day), td = n === s.day;
      return '<div class="d' + (tk ? ' tk' : '') + (td && !s.done ? ' td' : '') + (n === 7 ? ' last' : '') + '"><em>' + esc(t('day')) + ' ' + n + '</em><div class="r">' + rew(d) + '</div>' + (tk ? '<i class="ck">\u2713</i>' : '') + '</div>';
    }).join('');
    var sub = s.broken ? t('reset') : s.run > 0 ? t('streak').replace('{n}', s.run) : t('first');
    if (!pop) { pop = document.createElement('div'); pop.id = 'sdstk'; document.body.appendChild(pop); }
    pop.innerHTML = '<div class="c" dir="' + (lang() === 'ar' ? 'rtl' : 'ltr') + '"><button class="x" id="sdstkx">&times;</button><h2>\uD83D\uDD25 ' + esc(t('title')) + '</h2><div class="sb">' + esc(sub) + '</div><div class="g">' + cards + '</div>' +
      '<button class="btn" id="sdstkgo"' + (s.can ? '' : ' disabled') + '>' + (s.can ? esc(t('claim').replace('{n}', s.day)) : '') + '</button><div class="msg" id="sdstkm"></div></div>';
    document.getElementById('sdstkx').onclick = closePop;
    var go = document.getElementById('sdstkgo');
    if (s.can) go.onclick = claim;
    else {
      var upd = function () {
        var left = stAt + (s.left || 0) - Date.now();
        if (left <= 0) { clearInterval(tmr); fetchStatus(true).then(function () { if (pop) build(); }); return; }
        go.textContent = t('come') + ' ' + hms(left);
      };
      upd(); tmr = setInterval(upd, 1000);
    }
  }
  function openPop() { if (!st) return; closePop(); build(); }

  function claim() {
    if (!st || !st.can || claiming) return;
    claiming = true;
    var go = document.getElementById('sdstkgo'); if (go) go.disabled = true;
    msg(t('loading'));
    api('/api/streak/claim', 'POST', { playerId: pid() }).then(function (r) {
      claiming = false;
      if (r.ok && r.j && r.j.ok) {
        try { localStorage.setItem('dm_stk', JSON.stringify({ day: r.j.day })); } catch (e) {}
        st.can = false; st.done = true; st.day = r.j.day; st.run = r.j.run; st.broken = false; stAt = Date.now();
        closePop(); paintBtn(); applyNow();
        return;
      }
      if (r.status === 409) { fetchStatus(true).then(function () { if (pop) build(); }); return; }
      if (go) go.disabled = false;
      msg(r.status === 0 ? t('e_net') : (r.status === 401 || r.status === 403) ? t('e_auth') : t('e_err'), true);
    });
  }
  /* the reward is in the inbox now: let sd-ref claim + apply it (it reloads the page and shows the reward popup) */
  function applyNow() {
    if (!(window.SDRef && SDRef.check)) { location.reload(); return; }
    var tries = 0;
    (function go() { Promise.resolve(SDRef.check()).then(function () { if (++tries < 3) setTimeout(go, 1500); }); })();
  }

  /* ---------- menu button ---------- */
  function paintBtn() {
    var c = document.getElementById('stkc'); if (!c) return;
    c.textContent = !st ? '' : st.can ? t('ready') : '\u2713 ' + t('day') + ' ' + st.day;
  }
  function addMenuBtn() {
    var fr = document.querySelector('#menu [data-m="fr"]');
    if (!fr || document.querySelector('#menu [data-m="stk"]')) return;
    var b = document.createElement('button');
    b.className = 'big alt'; b.setAttribute('data-m', 'stk');
    b.innerHTML = '\uD83D\uDD25 ' + esc(t('title')) + '<span class="sub" id="stkc"></span>';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation(); ev.preventDefault();
      fetchStatus(true).then(function (s) { if (s) openPop(); else toastMsg(errText()); });
    }, true);
    fr.parentNode.insertBefore(b, fr);
    paintBtn();
  }
  var raf = 0;
  new MutationObserver(function () { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; addMenuBtn(); }); })
    .observe(document.body, { childList: true, subtree: true });
  addMenuBtn();

  /* ---------- auto popup: once per Algeria day, only on the menu, only when nothing else is open and the tutorial is over ---------- */
  var IDS = ['splash', 'up', 'set', 'res', 'pm', 'ov', 'lbm', 'frm', 'mbx', 'sdref', 'sdstk', 'sdob'];
  function blocked() {
    var m = document.getElementById('menu');
    if (!m || m.hidden) return true;
    for (var i = 0; i < IDS.length; i++) { var e = document.getElementById(IDS[i]); if (e && !e.hidden && getComputedStyle(e).display !== 'none') return true; }
    return false;
  }
  function maybeShow() {
    if (window.SDOb && !SDOb.done()) return;
    if (blocked()) return;
    fetchStatus(false).then(function (s) {
      if (!s || !s.can) return;
      if (L('dm_stkday', '') === String(s.today)) return;
      if (blocked()) return;
      S('dm_stkday', String(s.today));
      openPop();
    });
  }

  window.SDStreak = {
    open: function () { fetchStatus(true).then(function (s) { if (s) openPop(); else toastMsg(errText()); }); },
    lastError: function () { return lastErr; }, errText: errText,
    title: function () { var d = J('dm_stk', {}).day; return t('title') + (d ? ' \u00B7 ' + t('day') + ' ' + d : ''); }
  };
  function boot() {
    fetchStatus(false);
    setInterval(maybeShow, 2500);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) fetchStatus(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
SDSTK_EOF
node --check "$WWW/sd-streak.js" || { echo "syntax error, restoring"; cp "${TMPDIR:-$HOME/tmp}/sd-streak.js.bak" "$WWW/sd-streak.js"; exit 1; }
if [ -f pages/sd-sec.js ]; then cp "$WWW/sd-streak.js" pages/; fi

VER="$VER" node - <<'DOC_EOF'
const fs = require('fs');
const V = process.env.VER;
const add = (f, mark, text) => { if (!fs.existsSync(f)) return; const s = fs.readFileSync(f, 'utf8'); if (!s.includes(mark)) fs.writeFileSync(f, s.trimEnd() + '\n' + text); };
add('CHANGELOG.md', '## ' + V, '\n## ' + V + '\n- Daily Streak: the real reason is shown when the status cannot load (no account token, server not updated, offline); a tap during a running request waits for it instead of reporting "no connection".\n');
add('STATE.md', 'sd171', '\n<!-- sd171 -->\n- v' + V + ': `sd-streak.js` `fetchStatus` keeps one in-flight promise (`busyP`) and records `lastErr` (`no-token`, `http-<status>`, `net`); `SDStreak.errText()` maps it to a message (401 account not ready, 404/502/503 server not updated, no token, offline).\n');
DOC_EOF

git add -A
git commit -m "v$VER: Daily Streak shows the real error and waits for a running request"
git push
git tag "v$VER" && git push origin "v$VER"
echo "Done."
