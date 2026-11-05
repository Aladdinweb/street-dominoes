#!/bin/sh
# Street Dominoes v1.7.0 - 7-day login streak (server + app) and first-win guided onboarding
# Run from ~/street-dominoes.  Idempotent.  Every edit uses an exact anchor (aborts unless it matches exactly once),
# all server tests run before the commit, and on any failure the edited files are restored.
set -e
VER="1.7.0"
WWW="app/src/main/assets/www"
T="${TMPDIR:-$HOME/tmp}"
mkdir -p "$T"
[ -f "$WWW/index.html" ] && [ -f "$WWW/sd-ref.js" ] && [ -f server/src/worker.js ] || { echo "run this from ~/street-dominoes"; exit 1; }

# ---------------------------------------------------------------- sd-onboard.js
cat > "$WWW/sd-onboard.js" <<'SDOB_EOF'
/* sd-onboard.js - Street Dominoes v1.7.0: first-match guided tips (loaded after sd-ref.js).
   Brand-new players only, each tip shows once, nothing here blocks input. Reads the game's own globals
   (inGame, inMenu, seat, chain, sel, dealing, over, cur, stats ...). Completion: first round win, or 3 rounds, or "Skip tips". */
(function () {
  'use strict';
  if (window.SDOb) return;
  var KEY = 'dm_ob';
  function L(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var T = {
    en: { menu: 'Start here: play a solo game against a bot.', open: 'You start! Tap a glowing stone to place it, or drag it onto the table.',
      move: 'Tap a glowing stone to play it, or drag it onto a green outlined end. The numbers must match.', ends: 'These numbers show what each end of the chain needs.',
      side: 'This stone fits both ends. Choose Left or Right.', draw: 'No stone fits. Tap a face-down stone to draw.', pass: 'Nothing to play and nothing to draw: tap Pass.',
      ok: 'Got it', skip: 'Skip tips', win: '\uD83C\uDFC6 First win! Well played.', replay: 'Replay tutorial', again: 'Tips are back on.' },
    fr: { menu: 'Commencez ici : une partie solo contre un bot.', open: 'À vous de commencer ! Touchez un domino lumineux pour le poser, ou glissez-le sur la table.',
      move: 'Touchez un domino lumineux pour le jouer, ou glissez-le sur une extrémité verte. Les chiffres doivent correspondre.', ends: 'Ces chiffres indiquent ce que chaque bout de la chaîne attend.',
      side: 'Ce domino va aux deux bouts. Choisissez Gauche ou Droite.', draw: 'Aucun domino ne convient. Touchez un domino face cachée pour piocher.', pass: 'Rien à jouer ni à piocher : touchez Passer.',
      ok: 'Compris', skip: 'Ignorer les astuces', win: '\uD83C\uDFC6 Première victoire ! Bien joué.', replay: 'Revoir le tutoriel', again: 'Les astuces sont réactivées.' },
    ar: { menu: 'ابدأ من هنا: العب لعبة فردية ضد الروبوت.', open: 'أنت تبدأ! المس قطعة مضيئة لوضعها أو اسحبها إلى الطاولة.',
      move: 'المس قطعة مضيئة للعبها أو اسحبها إلى طرف أخضر محدد. يجب أن تتطابق الأرقام.', ends: 'هذه الأرقام تبيّن ما يحتاجه كل طرف من السلسلة.',
      side: 'هذه القطعة تناسب الطرفين. اختر يسار أو يمين.', draw: 'لا توجد قطعة مناسبة. المس قطعة مقلوبة للسحب.', pass: 'لا شيء للعب أو للسحب: المس تخطَّ.',
      ok: 'فهمت', skip: 'تخطي النصائح', win: '\uD83C\uDFC6 أول فوز! أحسنت.', replay: 'إعادة الشرح', again: 'عادت النصائح.' }
  };
  function lang() { var l = L('dm_lang', 'en'); return T[l] ? l : 'en'; }
  function t(k) { return T[lang()][k] || T.en[k] || k; }

  /* ---------- game snapshot (null while the game script is not ready) ---------- */
  function snap() {
    try {
      return { ig: inGame, im: inMenu, dl: dealing, ov: over, cu: cur, st: seat, sh: shown, ch: chain.length, sl: sel, gm: gm, hu: humans(),
        mp: stats.mp | 0, rp: stats.rp | 0, rw: stats.rw | 0 };
    } catch (e) { return null; }
  }

  /* ---------- persistent state: dm_ob = {d: done, r: replay mode, b: baseline stats, s: seen tips, mvl} ---------- */
  var ob = null;
  try { ob = JSON.parse(L(KEY, 'null')); } catch (e) {}
  function save() { S(KEY, JSON.stringify(ob)); }
  (function init() {
    if (ob && typeof ob === 'object') { if (!ob.s) ob.s = {}; if (!ob.b) ob.b = { rp: 0, rw: 0 }; return; }
    var s0 = snap(), old = !!(s0 && (s0.mp > 0 || s0.rp > 0));   // players who already played are never put through the tutorial
    ob = { d: old ? 1 : 0, r: 0, b: { rp: 0, rw: 0 }, s: {} };
    save();
  })();

  /* ---------- styles + elements ---------- */
  var css = document.createElement('style');
  css.id = 'sdob-css';
  css.textContent =
    '#sdob{position:fixed;inset:0;z-index:99980;pointer-events:none}#sdob[hidden]{display:none}' +
    '#sdobr{position:absolute;border:3px solid #e11d2e;border-radius:12px;box-shadow:0 0 14px #e11d2e;animation:sdobp .9s ease-in-out infinite alternate}' +
    '#sdobb{position:absolute;background:#14161a;color:#fff;border:1px solid #e11d2e;border-radius:14px;padding:10px 12px;font-size:14px;line-height:1.4;box-shadow:0 8px 24px #000a}' +
    '#sdobb .bt{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}' +
    '#sdobb button{pointer-events:auto;border:0;border-radius:10px;padding:6px 12px;font-weight:700;font-size:13px;background:#e11d2e;color:#fff}#sdobb button.g{background:#262a31;color:#ccc}' +
    '#sdobb .ar{position:absolute;width:12px;height:12px;background:#14161a;border:1px solid #e11d2e}' +
    '#sdobb .ar.dn{bottom:-7px;border-top:0;border-left:0;transform:rotate(45deg)}#sdobb .ar.up{top:-7px;border-bottom:0;border-right:0;transform:rotate(45deg)}' +
    '#sdobw{position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:99980;background:#14161a;color:#fff;border:1px solid #e11d2e;border-radius:16px;padding:10px 18px;font-weight:800;font-size:16px;box-shadow:0 0 24px #e11d2e88;pointer-events:none;animation:sdobi .35s ease-out}' +
    '@keyframes sdobp{to{box-shadow:0 0 4px #e11d2e;opacity:.7}}@keyframes sdobi{from{opacity:0;transform:translateX(-50%) scale(.8)}}';
  document.head.appendChild(css);

  var root = null, ring = null, bub = null, arrow = null, txEl = null, okB = null, skB = null;
  function ensure() {
    if (root) return;
    root = document.createElement('div'); root.id = 'sdob'; root.hidden = true;
    root.innerHTML = '<div id="sdobr"></div><div id="sdobb"><div class="tx"></div><div class="bt"><button class="g" id="sdobsk"></button><button id="sdobok"></button></div><i class="ar"></i></div>';
    document.body.appendChild(root);
    ring = root.querySelector('#sdobr'); bub = root.querySelector('#sdobb'); arrow = root.querySelector('.ar'); txEl = root.querySelector('.tx');
    okB = root.querySelector('#sdobok'); skB = root.querySelector('#sdobsk');
    okB.onclick = function () { if (tip) markSeen(tip.id, snap()); hideTip(); tip = null; };
    skB.onclick = function () { finish(false); };
  }

  /* ---------- what to show ---------- */
  var OVL = ['splash', 'up', 'set', 'res', 'pm', 'ov', 'lbm', 'frm', 'mbx', 'sdref', 'sdstk'];
  function overlayOpen() {
    for (var i = 0; i < OVL.length; i++) { var e = document.getElementById(OVL[i]); if (e && !e.hidden && getComputedStyle(e).display !== 'none') return true; }
    return false;
  }
  function menuVisible() { var m = document.getElementById('menu'); return !!(m && !m.hidden); }

  function cands(s) {
    var c = [];
    if (!s.ig) {
      if (s.im && menuVisible() && s.rp - ob.b.rp === 0) c.push({ id: 'menu', sel: '#menu [data-m="solo"]' });
      return c;
    }
    if (s.dl || s.ov >= 0 || s.hu !== 1 || s.st[s.cu] !== 1 || !s.sh) return c;
    var pl = [], yd = 0;
    try { pl = playable(s.cu); } catch (e) {}
    try { yd = yardLeft(); } catch (e) {}
    if (s.sl >= 0) c.push({ id: 'side', sel: '#ctl' });
    else if (pl.length) {
      if (!s.ch) c.push({ id: 'open', sel: '#hand .pl' });
      else { c.push({ id: 'move', sel: '#hand .pl' }); if (ob.s.move && s.ch > (ob.mvl || 0)) c.push({ id: 'ends', sel: '#ends' }); }
    }
    else if (yd > 0 && s.gm === '1v1') c.push({ id: 'draw', sel: '#sR .yard' });
    else if (!yd) c.push({ id: 'pass', sel: '#ctl [data-pass]' });
    return c;
  }
  function complete(s) { return (s.rw - ob.b.rw) >= 1 || (s.rp - ob.b.rp) >= 3; }
  function markSeen(id, s) { if (!id) return; ob.s[id] = 1; if (id === 'move') ob.mvl = s ? s.ch : 0; save(); }

  /* ---------- show / hide / place ---------- */
  var tip = null, tipSince = 0, vis = false, shownAt = 0, selq = '', raf = 0, pending = false;
  function showTip(w) {
    ensure(); selq = w.sel;
    txEl.textContent = t(w.id); okB.textContent = t('ok'); skB.textContent = t('skip');
    bub.dir = lang() === 'ar' ? 'rtl' : 'ltr';
    vis = true; shownAt = Date.now(); root.hidden = false; loop();
  }
  function hideTip() { vis = false; if (root) root.hidden = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function loop() {
    if (!vis) return;
    var el = document.querySelector(selq);
    if (!el) { hideTip(); return; }
    place(el);
    raf = requestAnimationFrame(loop);
  }
  function place(el) {
    var r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    ring.style.left = (r.left - 4) + 'px'; ring.style.top = (r.top - 4) + 'px'; ring.style.width = (r.width + 8) + 'px'; ring.style.height = (r.height + 8) + 'px';
    var bw = Math.min(300, W - 24); bub.style.width = bw + 'px';
    var bh = bub.offsetHeight, above = r.top - bh - 14 >= 8, top = above ? r.top - bh - 14 : r.bottom + 14;
    top = Math.max(8, Math.min(H - bh - 8, top));
    var left = Math.max(12, Math.min(W - bw - 12, r.left + r.width / 2 - bw / 2));
    bub.style.left = left + 'px'; bub.style.top = top + 'px';
    arrow.className = 'ar ' + (above ? 'dn' : 'up');
    arrow.style.left = Math.max(14, Math.min(bw - 26, r.left + r.width / 2 - left - 6)) + 'px';
  }

  function celebrate() {
    var e = document.createElement('div'); e.id = 'sdobw'; e.textContent = t('win'); document.body.appendChild(e);
    setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 4500);
  }
  function finish(won) {
    ob.d = 1; ob.r = 0; save(); hideTip(); tip = null; pending = true;
    if (won) celebrate();
  }

  function tick() {
    if (ob.d) {
      hideTip();
      if (pending && menuVisible() && !overlayOpen()) {          // tutorial just ended: let the (held) welcome bonus through
        pending = false;
        if (window.SDRef && SDRef.check) setTimeout(function () { SDRef.check(); }, 400);
      }
      return;
    }
    var s = snap();
    if (!s) { hideTip(); return; }
    if (complete(s)) { finish((s.rw - ob.b.rw) >= 1); return; }
    var w = null;
    if (!overlayOpen()) { var c = cands(s); for (var i = 0; i < c.length; i++) if (!ob.s[c[i].id]) { w = c[i]; break; } }
    if (!w) { if (tip && vis) markSeen(tip.id, s); hideTip(); tip = null; return; }
    if (!tip || tip.id !== w.id) { if (tip && vis) markSeen(tip.id, s); hideTip(); tip = w; tipSince = Date.now(); return; }
    if (!vis && Date.now() - tipSince >= 700) showTip(w);
    else if (vis && Date.now() - shownAt > 22000) { markSeen(w.id, s); hideTip(); tip = null; }
  }

  function replay() {
    var s = snap();
    ob = { d: 0, r: 1, b: { rp: s ? s.rp : 0, rw: s ? s.rw : 0 }, s: {} };
    save(); tip = null; hideTip();
    try { if (typeof toast === 'function') toast(t('again')); } catch (e) {}
  }

  /* ---------- hooks ---------- */
  try {
    if (typeof render === 'function') { var _r = render; render = function () { var r = _r.apply(this, arguments); try { tick(); } catch (e) {} return r; }; }
    if (typeof setPanel === 'function') {
      var _sp = setPanel;
      setPanel = function () {
        var r = _sp.apply(this, arguments);
        try {
          var sx = document.getElementById('sx');
          if (sx && !document.getElementById('sdobrp')) sx.insertAdjacentHTML('beforebegin', '<button class="big alt" id="sdobrp">\uD83C\uDF93 ' + esc(t('replay')) + '</button>');
        } catch (e) {}
        return r;
      };
      var spEl = document.getElementById('sp');
      if (spEl) spEl.addEventListener('click', function (ev) {
        if (ev.target && ev.target.id === 'sdobrp') { var st = document.getElementById('set'); if (st) st.hidden = true; replay(); }
      });
    }
  } catch (e) {}
  setInterval(function () { try { tick(); } catch (e) {} }, 350);

  window.SDOb = {
    done: function () { return !!ob.d; },
    holdWelcome: function () { return !ob.d && !ob.r; },   // sd-ref keeps the Welcome Bonus in the inbox until the first-win moment
    tick: tick, replay: replay, skip: function () { finish(false); }
  };
})();
SDOB_EOF

# ---------------------------------------------------------------- sd-streak.js
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
      first: 'Come back every day for bigger rewards.', ready: 'Claim now!', loading: 'Loading...', e_net: 'No connection, try again', e_auth: 'Account not ready, try again', e_err: 'Could not claim, try again' },
    fr: { title: 'Série quotidienne', day: 'Jour', claim: 'Récupérer le jour {n}', come: 'Prochaine récompense dans', streak: '\uD83D\uDD25 Série : {n} jours', reset: 'Série remise à zéro. Reprenez au jour 1 !',
      first: 'Revenez chaque jour pour de plus grosses récompenses.', ready: 'À récupérer !', loading: 'Chargement...', e_net: 'Pas de connexion, réessayez', e_auth: 'Compte pas prêt, réessayez', e_err: 'Impossible de récupérer, réessayez' },
    ar: { title: 'سلسلة الدخول اليومي', day: 'اليوم', claim: 'استلم اليوم {n}', come: 'المكافأة التالية بعد', streak: '\uD83D\uDD25 السلسلة: {n} أيام', reset: 'انقطعت السلسلة. ابدأ من اليوم 1!',
      first: 'عد كل يوم لمكافآت أكبر.', ready: 'استلم الآن!', loading: '...', e_net: 'لا يوجد اتصال، حاول مجددا', e_auth: 'الحساب غير جاهز، حاول مجددا', e_err: 'تعذر الاستلام، حاول مجددا' }
  };
  function lang() { var l = L('dm_lang', 'en'); return T[l] ? l : 'en'; }
  function t(k) { return T[lang()][k] || T.en[k] || k; }

  var DEF = [{ coins: 1000 }, { coins: 2000 }, { coins: 3000, shield: 1 }, { coins: 4000 }, { coins: 5000, xpMin: 30 }, { coins: 7500 }, { coins: 10000, spins: 1 }];
  var st = null, stAt = 0, busyF = false, lastTry = 0, claiming = false, tmr = 0, pop = null;

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
    if (!pid() || !token() || busyF) return Promise.resolve(st);
    if (!force) { if (fresh()) return Promise.resolve(st); if (Date.now() - lastTry < 15000) return Promise.resolve(st); }
    lastTry = Date.now(); busyF = true;
    return api('/api/streak?playerId=' + encodeURIComponent(pid())).then(function (r) {
      busyF = false;
      if (r.ok && r.j && r.j.ok) { st = r.j; stAt = Date.now(); paintBtn(); }
      return st;
    });
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
      fetchStatus(true).then(function (s) { if (s) openPop(); else toastMsg(t('e_net')); });
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
    open: function () { fetchStatus(true).then(function (s) { if (s) openPop(); }); },
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

# ---------------------------------------------------------------- server test
mkdir -p server/test
cat > server/test/streak.test.mjs <<'STKTEST_EOF'
// node server/test/streak.test.mjs  -  7-day login streak (v1.7.0): real Worker routes + real Matchmaker 'acct' code, fake storage, controlled clock
import assert from 'node:assert/strict';
import worker, { Matchmaker } from '../src/worker.js';

const mem = new Map();
const storage = {
  async get(k) { return mem.get(k); },
  async put(k, v) { if (v === undefined && k && typeof k === 'object') for (const [a, b] of Object.entries(k)) mem.set(a, b); else mem.set(k, v); },
  async delete(k) { for (const x of [].concat(k)) mem.delete(x); },
  async list(o = {}) { let e = [...mem].filter(([k]) => k.startsWith(o.prefix || '')).sort((a, b) => (a[0] < b[0] ? -1 : 1)); if (o.reverse) e.reverse(); if (o.limit) e = e.slice(0, o.limit); return new Map(e); },
  async setAlarm() {},
};
const mm = new Matchmaker({ storage, getWebSockets: () => [] }, {});
const env = { MATCH: { idFromName: n => n, get: () => ({ fetch: (u, init) => mm.fetch(new Request(u, init)) }) } };

let now = Date.UTC(2026, 10, 4, 12, 0, 0);        // 4 Nov 2026 12:00 UTC = 13:00 Algeria
Date.now = () => now;
const DAY = 864e5;
const call = async (path, method = 'GET', body, token = '') => {
  const r = await worker.fetch(new Request('https://w' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { s: r.status, j: await r.json() };
};
const ok = (c, m) => { assert.ok(c, m); console.log('PASS ' + m); };

async function newPlayer(pid) { const r = await call('/api/auth/init', 'POST', { playerId: pid }); assert.equal(r.s, 200); return r.j.token; }
const status = (pid, tok) => call('/api/streak?playerId=' + pid, 'GET', null, tok);
const claim = (pid, tok) => call('/api/streak/claim', 'POST', { playerId: pid }, tok);
const inbox = async (pid, tok) => (await call('/api/rewards/claim', 'POST', { playerId: pid }, tok)).j.items;

const P1 = 'usr_stk001';
const t1 = await newPlayer(P1);

let r = await status(P1, '');
ok(r.s === 401, 'status needs the account token');
r = await claim(P1, '');
ok(r.s === 401, 'claim needs the account token');

r = await status(P1, t1);
ok(r.s === 200 && r.j.can && r.j.day === 1 && r.j.run === 0 && !r.j.broken && r.j.days.length === 7, 'new player: Day 1 is ready');
ok(r.j.left > 0 && r.j.left <= DAY, 'status carries the time left in the Algeria day');

r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 1 && r.j.run === 1 && r.j.reward.coins === 1000, 'Day 1 claimed: 1,000 coins');
r = await claim(P1, t1);
ok(r.s === 409 && r.j.error === 'claimed', 'second claim on the same day is refused');
r = await status(P1, t1);
ok(!r.j.can && r.j.done && r.j.day === 1 && r.j.run === 1, 'status after the claim: done for today');

let items = await inbox(P1, t1);
ok(items.some(i => i.k === 'streak' && i.day === 1 && i.coins === 1000), 'the reward is in the inbox (kind streak, day 1)');
ok(items.some(i => i.k === 'welcome_basic'), 'the welcome bonus is untouched next to it');
ok((await inbox(P1, t1)).length === 0, 'the inbox gives each item once');

const EXP = [null, { coins: 2000 }, { coins: 3000, shield: 1 }, { coins: 4000 }, { coins: 5000, xpMin: 30 }, { coins: 7500 }, { coins: 10000, spins: 1 }];
for (let d = 2; d <= 7; d++) {
  now += DAY;
  r = await status(P1, t1);
  ok(r.j.can && r.j.day === d && r.j.run === d - 1 && !r.j.broken, 'next day: Day ' + d + ' is ready, streak continues');
  r = await claim(P1, t1);
  ok(r.s === 200 && r.j.day === d && r.j.run === d, 'Day ' + d + ' claimed');
  for (const k of Object.keys(EXP[d - 1])) assert.equal(r.j.reward[k], EXP[d - 1][k]);
  const it = (await inbox(P1, t1)).find(i => i.k === 'streak');
  ok(it && it.day === d && Object.keys(EXP[d - 1]).every(k => it[k] === EXP[d - 1][k]), 'Day ' + d + ' inbox item carries ' + JSON.stringify(EXP[d - 1]));
}

now += DAY;
r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 1 && r.j.run === 8, 'after Day 7 the cycle restarts at Day 1 and the run keeps counting');
await inbox(P1, t1);

now += 2 * DAY;                                   // one whole day missed
r = await status(P1, t1);
ok(r.j.can && r.j.broken && r.j.day === 1 && r.j.run === 0, 'a missed day: streak is broken, Day 1 again');
r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 1 && r.j.run === 1, 'claim after a miss restarts the run at 1');
now += DAY;
r = await claim(P1, t1);
ok(r.s === 200 && r.j.day === 2 && r.j.run === 2, 'and it continues the next day');
await inbox(P1, t1);

// Algeria midnight (UTC+1): 22:59 UTC is still the same Algeria day as 22:00 UTC, 23:00 UTC is already the next one
const P2 = 'usr_stk002';
const t2 = await newPlayer(P2);
now = Date.UTC(2026, 11, 10, 22, 0, 0);
r = await claim(P2, t2);
ok(r.s === 200 && r.j.day === 1, 'player 2 claims Day 1 at 23:00 Algeria time');
now = Date.UTC(2026, 11, 10, 22, 59, 30);
r = await claim(P2, t2);
ok(r.s === 409, '23:59:30 Algeria time: still the same day, refused');
r = await status(P2, t2);
ok(r.j.left > 0 && r.j.left <= 31000, 'about 30 seconds left in the Algeria day');
now = Date.UTC(2026, 11, 10, 23, 0, 5);
r = await claim(P2, t2);
ok(r.s === 200 && r.j.day === 2 && r.j.run === 2, '00:00:05 Algeria time: new day, Day 2 claimed');

// a token never works for another player
r = await claim(P1, t2);
ok(r.s === 401, "another player's token is rejected");
console.log('streak tests: all passed');
STKTEST_EOF

node --check "$WWW/sd-onboard.js" || { echo "sd-onboard.js syntax error"; exit 1; }
node --check "$WWW/sd-streak.js" || { echo "sd-streak.js syntax error"; exit 1; }
node --check server/test/streak.test.mjs || { echo "streak.test.mjs syntax error"; exit 1; }
if [ -f pages/sd-sec.js ]; then cp "$WWW/sd-onboard.js" "$WWW/sd-streak.js" pages/; fi

# ---------------------------------------------------------------- patch worker.js, sd-ref.js, index.html, docs; run the tests
VER="$VER" WWW="$WWW" T="$T" node - <<'PATCH_EOF'
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { VER, WWW, T } = process.env;
const baks = [];
function bak(f) { const b = T + '/' + f.replace(/[\/.]/g, '_') + '.bak'; fs.copyFileSync(f, b); baks.push([f, b]); }
function restore() { baks.forEach(([f, b]) => fs.copyFileSync(b, f)); }
function edit(f, anchor, repl, marker) {
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes(marker)) { console.log('skip (already done): ' + f + '  [' + marker + ']'); return; }
  const n = s.split(anchor).length - 1;
  if (n !== 1) throw new Error(f + ': anchor found ' + n + ' times (need exactly 1): ' + anchor.slice(0, 80));
  bak(f);
  fs.writeFileSync(f, s.replace(anchor, () => repl));
  console.log('patched: ' + f + '  [' + marker + ']');
}
function soft(f, fn) {
  if (!fs.existsSync(f)) { console.log('missing (skipped): ' + f); return; }
  const o = fs.readFileSync(f, 'utf8'), n = fn(o);
  if (n !== o) { bak(f); fs.writeFileSync(f, n); console.log('updated: ' + f); }
}

try {
  const W = 'server/src/worker.js', HTML = WWW + '/index.html', REFJS = WWW + '/sd-ref.js';
  for (const f of [W, HTML, REFJS]) if (!fs.existsSync(f)) throw new Error('missing ' + f + ' (run from ~/street-dominoes)');

  /* ---- server: streak routes + state + rewards into the existing inbox ---- */
  edit(W, "const refCode = pid => String(pid).slice(4).toUpperCase();",
`// ---------- v1.7.0: 7-day login streak ----------
// One claim per Algeria day (UTC+1, the same day as the referral tiers). Missing a whole day restarts at Day 1; after Day 7 the cycle starts again.
// The reward goes into the same inbox as the referral rewards ('ib:<pid>'), so the phone applies it through POST /api/rewards/claim.
const STREAK = { DAYS: [{ coins: 1000 }, { coins: 2000 }, { coins: 3000, shield: 1 }, { coins: 4000 }, { coins: 5000, xpMin: 30 }, { coins: 7500 }, { coins: 10000, spins: 1 }] };
const streakState = rec => {
  const d = refDay(), base = { today: d, left: REF.DAY_MS - ((Date.now() + REF.TZ) % REF.DAY_MS) };
  if (!rec) return { ...base, can: true, day: 1, run: 0, done: false, broken: false };
  if (rec.last >= d) return { ...base, can: false, day: rec.n, run: rec.c, done: true, broken: false };
  if (rec.last === d - 1) return { ...base, can: true, day: rec.n % 7 + 1, run: rec.c, done: false, broken: false };
  return { ...base, can: true, day: 1, run: 0, done: false, broken: true };
};
const refCode = pid => String(pid).slice(4).toUpperCase();`, 'const STREAK = {');

  edit(W, "'/api/rewards/claim': 'rw-claim' }", "'/api/rewards/claim': 'rw-claim', '/api/streak/claim': 'streak-claim' }", "'/api/streak/claim': 'streak-claim'");
  edit(W, "else if (p === '/api/rewards') { op = 'rw-list'; payload = { pid: url.searchParams.get('playerId') }; }",
          "else if (p === '/api/rewards') { op = 'rw-list'; payload = { pid: url.searchParams.get('playerId') }; }\n    else if (p === '/api/streak') { op = 'streak-status'; payload = { pid: url.searchParams.get('playerId') }; }", "p === '/api/streak'");
  edit(W, "'/api/referral/leaderboard'].includes(url.pathname)", "'/api/referral/leaderboard', '/api/streak', '/api/streak/claim'].includes(url.pathname)", "'/api/streak', '/api/streak/claim']");
  edit(W, "default: return R({ error: 'not_found' }, 404);",
`case 'streak-status': {
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        const rec = await S.get('st:' + pid);
        return R({ ok: true, ...streakState(rec), best: (rec && rec.best) || 0, total: (rec && rec.total) || 0, days: STREAK.DAYS });
      }
      case 'streak-claim': {   // v1.7.0: one claim per Algeria day; the read and the write below are storage calls only, so two taps cannot both succeed
        const a = await this.authed(pid, q.token); if (!a) return R({ error: 'auth' }, 401);
        if (!this.rlOk('stk:' + pid, 6, 6e4)) return R({ error: 'rate' }, 429);
        const rec = await S.get('st:' + pid), s = streakState(rec);
        if (!s.can) return R({ error: 'claimed', ...s }, 409);
        const run = !rec || s.broken ? 1 : rec.c + 1;
        await S.put('st:' + pid, { last: s.today, n: s.day, c: run, best: Math.max((rec && rec.best) || 0, run), total: ((rec && rec.total) || 0) + 1 });
        await this.give(pid, { k: 'streak', day: s.day, ...STREAK.DAYS[s.day - 1] });
        return R({ ok: true, day: s.day, run, reward: STREAK.DAYS[s.day - 1] });
      }
      default: return R({ error: 'not_found' }, 404);`, "case 'streak-status'");

  /* ---- sd-ref.js: streak title in the reward popup + hold the Welcome Bonus during the tutorial ---- */
  edit(REFJS, "var title = wel ? t('welcome') : t('friend')",
       "var title = wel ? t('welcome') : (res.kinds.indexOf('streak') > -1 ? (window.SDStreak ? SDStreak.title() : 'Daily Streak') : t('friend'))", 'SDStreak.title()');
  edit(REFJS, "return api('/api/rewards/claim', 'POST', { playerId: pid() }).then(function (r) {",
`var hold = window.SDOb && SDOb.holdWelcome && SDOb.holdWelcome();   // v1.7.0: the Welcome Bonus waits for the first-win moment
    var go = hold ? api('/api/rewards?playerId=' + encodeURIComponent(pid())).then(function (l) {
      var ids = ((l.j && l.j.items) || []).filter(function (i) { return !/^welcome/.test(i.k); }).map(function (i) { return i.id; });
      return ids.length ? api('/api/rewards/claim', 'POST', { playerId: pid(), ids: ids }) : { ok: false, status: 0, j: {} };
    }) : api('/api/rewards/claim', 'POST', { playerId: pid() });
    return go.then(function (r) {`, 'SDOb.holdWelcome');

  /* ---- game page: load the two new scripts after sd-ref.js ---- */
  edit(HTML, '<script src="sd-ref.js"></script>', '<script src="sd-ref.js"></script><script src="sd-onboard.js"></script><script src="sd-streak.js"></script>', 'sd-onboard.js');

  /* ---- docs ---- */
  const ECON = `### Phase 8b - Store & Economy Tuning (anti-inflation controls, decided)
Goal: keep the coin supply from inflating as the faucets grow (welcome bonus, referral tiers, Daily Box, login streak, ads).
- [ ] **Mandatory Entry Fees (Stakes):** every match mode (Standard, Rated, High Rollers) requires a coin entry fee, so a player can never generate coins without risk. This replaces today's free Casual / free solo option for coin-earning play; decide the minimum fee and a safety net for players who run out of coins (for example the Daily Box and the login streak keep a floor, or a free practice mode that pays nothing).
- [ ] **House Commission / Rake:** the server burns a small share (5-10%, final value to be tuned) of the total room pot on every match win, permanently removing coins from circulation.
- [ ] **Mini-Shop (Cosmetic Sinks):** high-tier coin sinks: custom table themes, premium domino stone skins, unique avatars / frames, quick-chat emojis (builds on the \`Skins\` engine and the Phase 6 Skins & Themes Shop).

> Design notes (added by Claude; delete if not wanted)
> - Fees and rake are only trustworthy once coins live on the server (see Backlog: server-held coins, XP and inventory). Until then the phones settle the pot, so a modified client could skip the fee or the rake.
> - Before tuning the percentages, log coins issued (reward inbox: welcome, referral, streak, box, ads) against coins burned (rake, shop) per day; the rake only works if burn >= issue over time.
> - Free modes disappear for coin-earning play, so keep at least one no-reward practice mode and the daily faucets, otherwise players with zero coins are locked out.

`;
  soft('ROADMAP.md', s => {
    let r = s
      .replace('- [ ] **First-Win Moment & Guided Onboarding:**', '- [x] **First-Win Moment & Guided Onboarding:**')
      .replace('- [ ] **Daily Login Streak (7-Day Rewards):**', '- [x] **Daily Login Streak (7-Day Rewards):**');
    if (!r.includes('Store & Economy Tuning')) {
      const mm = /\n---[ \t]*\r?\n+## [^\n]*Completed Features/.exec(r), at = mm ? mm.index : -1;   // goes before the separator above the Completed section
      r = at >= 0 ? r.slice(0, at) + '\n\n' + ECON.trimEnd() + '\n' + r.slice(at) : r.trimEnd() + '\n\n' + ECON;
    }
    return r;
  });

  /* ---- roadmap: economy controls (backlog, Phase 8) ---- */
  soft('ROADMAP.md', s => {
    if (s.includes('Mandatory Entry Fees')) return s;
    const block = [
      '### Phase 8b - Store & Economy Tuning (anti-inflation; backlog, not scheduled)',
      'Goal: coins must never be creatable without risk, and the circulating supply must shrink as well as grow.',
      '',
      '- [ ] **Mandatory Entry Fees (Stakes):** every match mode (Standard, Rated, High Rollers) costs coins to enter, so nobody can farm infinite coins risk-free. The free / casual tier and the free bot games stop paying out; if a free mode stays, it pays nothing.',
      '- [ ] **House Commission / Rake:** the server burns a small share (5-10%, constant in `worker.js`) of the total room pot on every match win, taken before the pot is split, to shrink the circulating supply. Burned coins are simply never credited to anyone.',
      '- [ ] **Mini-Shop (Cosmetic Sinks):** high-tier coin sinks: custom table themes, premium domino stone skins, unique avatars / frames, quick-chat emojis. Built on the `Skins` registry; purchases are recorded server-side per account.',
      '',
      '> Design notes (added by Claude; delete if not wanted)',
      '> - These three only work once balances live on the server (see the backlog item "Server-held coins, XP and inventory"). Today coins sit in `dm_set` on the phone, so a rake or a purchase can be skipped or forged by editing local storage.',
      '> - Faucets today: Welcome Bonus, referral tiers, Daily Box, 7-Day Streak, solo bot wins. Sinks today: entry fees only when a stake is chosen. Tune the rake and shop prices against the total faucet per active player per day, and re-check the referral and streak amounts when entry fees become mandatory.',
      '> - Mandatory fees change the current "Casual (free)" modes and the free bot tier, and every new player must keep enough coins for a first match (the welcome bonus does that).',
      '',
      ''].join('\n');
    const a = '---\n\n## \u2705 Completed Features';
    const i = s.indexOf(a);
    return i >= 0 ? s.slice(0, i) + block + s.slice(i) : s + '\n\n' + block;
  });
  soft('STATE.md', s => s.includes('<!-- sd170 -->') ? s : s + '\n\n<!-- sd170 -->\n## 23. v' + VER + ': daily login streak + first-win onboarding\n' +
    '- Server (`worker.js`, `Matchmaker` instance `acct`): `STREAK.DAYS` (Day 1 1,000 coins; 2: 2,000; 3: 3,000 + Loss Shield; 4: 4,000; 5: 5,000 + XP x2 30 min; 6: 7,500; 7: 10,000 + 1 spin) and `streakState(rec)`. Record `st:<pid>` = `{last (Algeria day number via refDay), n (cycle day 1-7), c (run), best, total}`. `GET /api/streak?playerId=` (Bearer token) -> `{ok, can, day, run, done, broken, today, left (ms to the next Algeria midnight), best, total, days}`; `POST /api/streak/claim {playerId}` -> `{ok, day, run, reward}` or 409 `claimed`. One claim per Algeria day (UTC+1); a whole missed day sets `broken` and restarts at Day 1; after Day 7 the cycle restarts at Day 1 and `run` keeps counting. A claim puts an item `{k:\'streak\', day, coins, shield?, xpMin?, spins?}` into the normal reward inbox (`ib:<pid>`); the phone applies it through `/api/rewards/claim` (sd-ref.js). Tests: `node server/test/streak.test.mjs` (real routes, fake storage, controlled clock incl. the 23:00 UTC midnight).\n' +
    '- `www/sd-streak.js` (`SDStreak`: `open`, `title`): popup with the 7-day ladder (today pulses, claimed days ticked, countdown when already claimed), shown once per Algeria day on the menu (`dm_stkday`) when nothing else is open and the tutorial is over, plus a "Daily Streak" menu button (`data-m="stk"`, inserted before Friends). After a claim it calls `SDRef.check()` (reload + reward popup titled by `SDStreak.title()`, day kept in `dm_stk`).\n' +
    '- `www/sd-onboard.js` (`SDOb`: `done`, `holdWelcome`, `tick`, `replay`, `skip`): tips for brand-new players only (state `dm_ob` = `{d, r, b, s, mvl}`; players with `stats.mp` or `stats.rp` > 0 are marked done at first load). Reads the game globals; wraps `render()` and `setPanel()`; ring + bubble overlay (`#sdob`, z-index 99980, never blocks input, each tip once: menu / open / move / ends / side / draw / pass). Ends at the first round win (shows a "First win" banner), after 3 rounds, or with "Skip tips". `Settings > Replay tutorial` restarts it (`r:1`, baseline stats, no welcome hold).\n' +
    '- Welcome Bonus hold: while the tutorial is active `SDOb.holdWelcome()` is true and sd-ref claims only non-welcome inbox items (`GET /api/rewards` then `POST /api/rewards/claim {ids}`); when the tutorial ends and the player is on the menu, `SDRef.check()` releases it, so the animated Welcome Bonus popup is the first-win moment.\n');
  soft('CHANGELOG.md', s => s.includes('## ' + VER) ? s : s + '\n## ' + VER + '\n- 7-day login streak (server + popup + menu button), first-win guided tips, Welcome Bonus shown after the first win, Settings: Replay tutorial.\n');

  /* ---- run every server test; any failure restores everything ---- */
  const tdir = 'server/test';
  const files = fs.readdirSync(tdir).filter(f => /\.test\.mjs$/.test(f)).sort();
  for (const f of files) {
    console.log('--- ' + f);
    cp.execFileSync('node', [path.join(tdir, f)], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log('    ok');
  }
} catch (e) {
  restore();
  console.error('ABORTED, files restored: ' + (e && e.message ? e.message : e));
  process.exit(1);
}
PATCH_EOF

git add -A
git commit -m "v$VER: 7-day login streak, first-win guided onboarding, economy roadmap notes"
git push
git tag "v$VER" && git push origin "v$VER"
echo "Done. The push redeploys the Worker (server/) and the web build; the APK builds from tag v$VER."
