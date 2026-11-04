/* sd-ref.js - Street Dominoes v1.6.1: referral loop, app side. Loaded after sd-sec.js.
   Server contract: STATE.md section 21. Rewards are never created here: they come from
   POST /api/rewards/claim only. */
(function () {
  'use strict';
  if (window.SDRef) return;
  var API = 'https://street-dominoes-server.alaacasanova31.workers.dev';
  var SITE = 'https://street-dominoes.pages.dev';
  var WALLET = { coinKey: 'coins' };          // field of dm_set that holds the coin balance

  /* ---------- storage helpers ---------- */
  function L(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function S(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function J(k, d) { try { var v = JSON.parse(L(k, 'null')); return v == null ? d : v; } catch (e) { return d; } }
  function SJ(k, o) { S(k, JSON.stringify(o)); }
  function pid() { return L('dm_pid', ''); }
  function token() { var a = J('dm_acc', {}); return (a && a.token) || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function myCode() { var p = pid(); return p ? p.replace(/^usr_/, '').toUpperCase() : ''; }
  function link() { return SITE + '/?ref=' + pid(); }

  /* ---------- i18n ---------- */
  var T = {
    en: { invite: 'Invite & Earn', hub: 'Invite', board: 'Classement', code: 'Your invite code', copy: 'Copy link', copied: 'Link copied', share: 'Share',
      today: 'Qualified today', total: 'Total referrals', ladder: 'Daily reward ladder',
      l1: '1st friend: 10,000 coins + Loss Shield', l2: '2nd friend: 15,000 coins + XP x2 (1 h)', l3: '3rd friend: 25,000 coins + 2 spins', l4: '4th and later: leaderboard only',
      how: 'A friend qualifies after finishing a rated online match with a real player.',
      enter: 'Enter Invite Code', hint: 'Paste a friend\'s code or link', apply: 'Apply', skip: 'Skip', haveCode: 'Have an invite code?',
      by: 'Invited by', pending: 'Pending: play an online match', done: 'Bonus unlocked',
      ok: 'Code applied! Play an online match to unlock your bonus.', e_invalid: 'Code not found', e_self: 'You cannot use your own code', e_old: 'Codes work only in your first 3 days',
      e_already: 'You already used an invite code', e_limit: 'Too many tries, try later', e_net: 'No connection', e_auth: 'Account not ready, try again', e_err: 'Could not apply the code',
      empty: 'No referrals yet', loading: 'Loading...', you: 'You', refs: 'referrals',
      welcome: 'Welcome Bonus', friend: 'Friend qualified!', reward: 'Reward', collect: 'Collect', coins: 'coins', shield: 'Loss Shield', xp: 'XP x2', spins: 'spins', tier: 'Daily tier' },
    fr: { invite: 'Inviter & Gagner', hub: 'Inviter', board: 'Classement', code: 'Votre code d\'invitation', copy: 'Copier le lien', copied: 'Lien copie', share: 'Partager',
      today: 'Qualifies aujourd\'hui', total: 'Total parrainages', ladder: 'Recompenses du jour',
      l1: '1er ami : 10 000 pieces + Bouclier', l2: '2e ami : 15 000 pieces + XP x2 (1 h)', l3: '3e ami : 25 000 pieces + 2 tours', l4: '4e et suivants : classement seulement',
      how: 'Un ami est qualifie apres un match en ligne classe avec un vrai joueur.',
      enter: 'Entrer un code', hint: 'Collez le code ou le lien d\'un ami', apply: 'Valider', skip: 'Passer', haveCode: 'Un code d\'invitation ?',
      by: 'Invite par', pending: 'En attente : jouez un match en ligne', done: 'Bonus debloque',
      ok: 'Code valide ! Jouez un match en ligne pour debloquer votre bonus.', e_invalid: 'Code introuvable', e_self: 'Vous ne pouvez pas utiliser votre code', e_old: 'Les codes marchent pendant les 3 premiers jours',
      e_already: 'Vous avez deja utilise un code', e_limit: 'Trop d\'essais, reessayez plus tard', e_net: 'Pas de connexion', e_auth: 'Compte pas pret, reessayez', e_err: 'Code non applique',
      empty: 'Aucun parrainage', loading: 'Chargement...', you: 'Vous', refs: 'parrainages',
      welcome: 'Bonus de bienvenue', friend: 'Ami qualifie !', reward: 'Recompense', collect: 'Recuperer', coins: 'pieces', shield: 'Bouclier', xp: 'XP x2', spins: 'tours', tier: 'Palier du jour' },
    ar: { invite: 'ادع واربح', hub: 'دعوة', board: 'Classement', code: 'رمز الدعوة الخاص بك', copy: 'نسخ الرابط', copied: 'تم النسخ', share: 'مشاركة',
      today: 'المؤهلون اليوم', total: 'إجمالي الدعوات', ladder: 'مكافآت اليوم',
      l1: 'الصديق 1: 10,000 عملة + درع الخسارة', l2: 'الصديق 2: 15,000 عملة + XP x2 (ساعة)', l3: 'الصديق 3: 25,000 عملة + دورتان', l4: 'الرابع وما بعده: للترتيب فقط',
      how: 'يتأهل الصديق بعد مباراة أونلاين مصنفة مع لاعب حقيقي.',
      enter: 'أدخل رمز الدعوة', hint: 'الصق رمز أو رابط صديق', apply: 'تطبيق', skip: 'تخطي', haveCode: 'لديك رمز دعوة؟',
      by: 'دعاك', pending: 'قيد الانتظار: العب مباراة أونلاين', done: 'تم فتح المكافأة',
      ok: 'تم قبول الرمز! العب مباراة أونلاين لفتح مكافأتك.', e_invalid: 'الرمز غير موجود', e_self: 'لا يمكنك استخدام رمزك', e_old: 'الرموز تعمل خلال أول 3 أيام',
      e_already: 'استخدمت رمز دعوة من قبل', e_limit: 'محاولات كثيرة، حاول لاحقا', e_net: 'لا يوجد اتصال', e_auth: 'الحساب غير جاهز، حاول مجددا', e_err: 'تعذر تطبيق الرمز',
      empty: 'لا توجد دعوات بعد', loading: '...', you: 'أنت', refs: 'دعوات',
      welcome: 'مكافأة الترحيب', friend: 'صديق تأهل!', reward: 'مكافأة', collect: 'استلام', coins: 'عملة', shield: 'درع الخسارة', xp: 'XP x2', spins: 'دورات', tier: 'مستوى اليوم' }
  };
  function lang() { var l = L('dm_lang', 'en'); return T[l] ? l : 'en'; }
  function t(k) { return T[lang()][k] || T.en[k] || k; }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ---------- network ---------- */
  function api(path, method, body) {
    var h = { 'Content-Type': 'application/json' };
    var tk = token(); if (tk) h.Authorization = 'Bearer ' + tk;
    return fetch(API + path, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j || {} }; }); })
      .catch(function () { return { ok: false, status: 0, j: {} }; });
  }
  function inGame() {
    try {
      if (window.inGame === true) return true;
      var g = document.getElementById('game');
      return !!(g && g.offsetParent !== null);
    } catch (e) { return false; }
  }

  /* ---------- ?ref= capture ---------- */
  function normRef(r) { r = String(r || '').trim(); var m = r.match(/ref=([A-Za-z0-9_]{4,32})/); if (m) r = m[1]; return /^[A-Za-z0-9_]{4,32}$/.test(r) ? r : ''; }
  (function captureRef() {
    try {
      var r = normRef(new URLSearchParams(location.search).get('ref'));
      if (r && !L('dm_refdone', '')) S('dm_ref', r);
    } catch (e) {}
  })();

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.id = 'sdref-css';
  css.textContent =
    '#sdref{position:fixed;inset:0;z-index:99990;background:rgba(6,6,8,.88);display:flex;align-items:center;justify-content:center;padding:14px;font-family:inherit;color:#fff}' +
    '#sdref .c{width:100%;max-width:400px;max-height:calc(100dvh - 28px);overflow:auto;background:#14161a;border:1px solid #2c2f36;border-radius:18px;padding:16px;box-shadow:0 0 40px rgba(225,29,46,.25);animation:sdrIn .25s ease-out}' +
    '#sdref h2{margin:0 0 10px;font-size:19px;text-align:center}#sdref .x{float:right;background:none;border:0;color:#aaa;font-size:22px;line-height:1}' +
    '#sdref .tabs{display:flex;gap:6px;margin:8px 0 12px}#sdref .tabs button{flex:1;padding:9px;border-radius:10px;border:1px solid #2c2f36;background:#1b1e23;color:#ccc;font-weight:600}' +
    '#sdref .tabs button.on{background:#e11d2e;border-color:#e11d2e;color:#fff}' +
    '#sdref .code{font-size:26px;letter-spacing:3px;text-align:center;font-weight:800;padding:10px;border:1px dashed #e11d2e;border-radius:12px;margin:6px 0 10px;user-select:all}' +
    '#sdref .row{display:flex;gap:8px;margin:8px 0}#sdref .btn{flex:1;padding:11px;border-radius:12px;border:0;background:#e11d2e;color:#fff;font-weight:700;font-size:15px}' +
    '#sdref .btn.g{background:#262a31;color:#ddd}#sdref input{flex:1;min-width:0;padding:11px;border-radius:12px;border:1px solid #2c2f36;background:#0e1013;color:#fff;font-size:15px}' +
    '#sdref .pips{display:flex;gap:8px;justify-content:center;margin:6px 0}#sdref .pip{width:34px;height:10px;border-radius:6px;background:#2c2f36}#sdref .pip.on{background:#e11d2e;box-shadow:0 0 10px #e11d2e}' +
    '#sdref .sm{font-size:12.5px;color:#b5b8bf;margin:4px 0}#sdref .lad div{font-size:13.5px;padding:5px 0;border-bottom:1px solid #22252b}' +
    '#sdref .msg{min-height:18px;font-size:13px;text-align:center;margin:4px 0}#sdref .msg.e{color:#ff6b78}#sdref .msg.s{color:#7be08f}' +
    '#sdref .lb{display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid #22252b;font-size:14px}' +
    '#sdref .lb b{width:26px;text-align:center;color:#e11d2e}#sdref .lb span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#sdref .lb i{font-style:normal;color:#ccc}' +
    '#sdref .lb.me{background:rgba(225,29,46,.14);border-radius:8px}' +
    '#sdwb{text-align:center}#sdwb .big{font-size:44px;font-weight:900;color:#fff;text-shadow:0 0 22px #e11d2e;margin:6px 0;animation:sdrPulse 1.4s ease-in-out infinite}' +
    '#sdwb .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:10px 0}#sdwb .chip{padding:7px 12px;border-radius:20px;background:#262a31;border:1px solid #e11d2e;font-weight:700;font-size:14px;animation:sdrIn .4s ease-out both}' +
    '#sdref .cf{position:absolute;top:-10px;width:8px;height:14px;background:#e11d2e;opacity:.9;animation:sdrFall 2.4s linear infinite}' +
    '#sdref .cf:nth-child(3n){background:#fff}#sdref .cf:nth-child(3n+1){background:#7a0f19}' +
    '@keyframes sdrIn{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}' +
    '@keyframes sdrPulse{50%{transform:scale(1.06)}}@keyframes sdrFall{to{transform:translateY(105vh) rotate(540deg)}}';
  document.head.appendChild(css);

  /* ---------- modal helper ---------- */
  var cur = null;
  function closeM() { if (cur && cur.parentNode) cur.parentNode.removeChild(cur); cur = null; }
  function openM(id, html) {
    closeM();
    var o = document.createElement('div');
    o.id = 'sdref';
    o.innerHTML = '<div class="c" dir="' + (lang() === 'ar' ? 'rtl' : 'ltr') + '">' + html + '</div>';
    document.body.appendChild(o);
    cur = o;
    return o;
  }

  /* ---------- rewards: claim + apply ---------- */
  function applyItems(items) {
    var done = J('dm_rwdone', []);
    var tot = { coins: 0, shield: 0, xp: 0, spins: 0 }, fresh = [];
    items.forEach(function (it) {
      if (!it || !it.id || done.indexOf(it.id) > -1) return;
      done.push(it.id); fresh.push(it);
      tot.coins += +it.coins || 0; tot.shield += +it.shield || 0; tot.xp += +it.xpMin || 0; tot.spins += +it.spins || 0;
    });
    if (!fresh.length) return null;
    var st = J('dm_set', {});
    st[WALLET.coinKey] = (+st[WALLET.coinKey] || 0) + tot.coins; SJ('dm_set', st);
    var x = J('dm_sdx', {}), now = Date.now();
    x.sh = Math.min(3, (+x.sh || 0) + tot.shield);
    if (tot.xp > 0) x.xb = Math.min(now + 120 * 60000, Math.max(now, +x.xb || 0) + tot.xp * 60000);
    x.tk = Math.min(9, (+x.tk || 0) + tot.spins);
    SJ('dm_sdx', x);
    SJ('dm_rwdone', done.slice(-200));
    return { tot: tot, kinds: fresh.map(function (i) { return i.k; }), tier: (fresh.filter(function (i) { return i.tier; })[0] || {}).tier || 0 };
  }
  var busy = false;
  function checkRewards() {
    if (busy || !pid() || !token() || inGame() || cur) return Promise.resolve();
    busy = true;
    return api('/api/rewards/claim', 'POST', { playerId: pid() }).then(function (r) {
      busy = false;
      if (!r.ok) return;
      var items = r.j.items || r.j.claimed || r.j.rewards || [];
      if (!items.length) return;
      var res = applyItems(items);
      if (!res) return;
      try { sessionStorage.setItem('sd_rwpop', JSON.stringify(res)); } catch (e) {}
      location.reload();   // fresh page reads the updated wallet (no in-memory overwrite)
    });
  }

  function showPopup(res) {
    var wel = res.kinds.some(function (k) { return /^welcome/.test(k); });
    var title = wel ? t('welcome') : t('friend') + (res.tier ? ' (' + t('tier') + ' ' + res.tier + ')' : '');
    var chips = '';
    if (res.tot.shield) chips += '<div class="chip">+' + res.tot.shield + ' ' + t('shield') + '</div>';
    if (res.tot.xp) chips += '<div class="chip">' + t('xp') + ' (' + res.tot.xp + ' min)</div>';
    if (res.tot.spins) chips += '<div class="chip">+' + res.tot.spins + ' ' + t('spins') + '</div>';
    var cf = ''; for (var i = 0; i < 22; i++) cf += '<span class="cf" style="left:' + Math.round(Math.random() * 100) + '%;animation-delay:' + (Math.random() * 2).toFixed(2) + 's;animation-duration:' + (1.8 + Math.random() * 1.6).toFixed(2) + 's"></span>';
    var o = openM('sdref', '<div id="sdwb" style="position:relative"><h2>' + esc(title) + '</h2><div class="big"><span id="sdwn">0</span></div><div class="sm" style="text-align:center">' + t('coins') + '</div><div class="chips">' + chips + '</div><button class="btn" id="sdwc" style="width:100%">' + t('collect') + '</button></div>');
    o.insertAdjacentHTML('afterbegin', '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">' + cf + '</div>');
    var el = document.getElementById('sdwn'), target = res.tot.coins, t0 = performance.now();
    (function step(n) { var p = Math.min(1, (n - t0) / 1400); if (el) el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(t0);
    document.getElementById('sdwc').onclick = function () {
      closeM();
      if (wel && !L('dm_refask', '')) { S('dm_refask', '1'); status().then(function (s) { if (!s.referrer && !L('dm_ref', '')) openEnter(true); }); }
    };
  }

  /* ---------- referral claim (code) ---------- */
  function errKey(r) {
    var m = String((r.j && (r.j.error || r.j.err || r.j.message)) || '').toLowerCase();
    if (r.status === 0) return 'e_net';
    if (/self|own/.test(m)) return 'e_self';
    if (/old|young|72|new account|expired/.test(m)) return 'e_old';
    if (/already|one referrer|claimed|has_ref/.test(m) || r.status === 409) return 'e_already';
    if (r.status === 429 || /limit|too many/.test(m)) return 'e_limit';
    if (r.status === 401 || r.status === 403) return 'e_auth';
    if (r.status === 404 || /exist|invalid|not found|unknown/.test(m)) return 'e_invalid';
    return 'e_err';
  }
  function claimCode(raw) {
    var code = normRef(raw);
    if (!code) return Promise.resolve({ ok: false, key: 'e_invalid' });
    if (!pid() || !token()) return Promise.resolve({ ok: false, key: 'e_auth' });
    return api('/api/ref/claim', 'POST', { playerId: pid(), code: code }).then(function (r) {
      if (r.ok) { S('dm_refdone', '1'); try { localStorage.removeItem('dm_ref'); } catch (e) {} return { ok: true }; }
      var k = errKey(r);
      if (k !== 'e_net' && k !== 'e_limit' && k !== 'e_auth' && k !== 'e_err') { try { localStorage.removeItem('dm_ref'); } catch (e) {} }
      return { ok: false, key: k };
    });
  }
  function status() {
    if (!pid()) return Promise.resolve({});
    return api('/api/ref/status?playerId=' + encodeURIComponent(pid())).then(function (r) { return r.ok ? r.j : {}; });
  }

  /* ---------- UI: enter code sheet ---------- */
  function openEnter(first) {
    var o = openM('sdref', '<button class="x" id="sdrx">&times;</button><h2>' + t(first ? 'haveCode' : 'enter') + '</h2>' +
      '<div class="row"><input id="sdri" placeholder="' + esc(t('hint')) + '" autocapitalize="characters" autocomplete="off"></div>' +
      '<div class="msg" id="sdrm"></div><div class="row"><button class="btn g" id="sdrs">' + t('skip') + '</button><button class="btn" id="sdra">' + t('apply') + '</button></div>');
    var pre = L('dm_ref', ''); if (pre) document.getElementById('sdri').value = pre;
    document.getElementById('sdrx').onclick = document.getElementById('sdrs').onclick = closeM;
    document.getElementById('sdra').onclick = function () {
      var m = document.getElementById('sdrm'); m.className = 'msg'; m.textContent = t('loading');
      claimCode(document.getElementById('sdri').value).then(function (r) {
        m.className = 'msg ' + (r.ok ? 's' : 'e'); m.textContent = r.ok ? t('ok') : t(r.key);
        if (r.ok) setTimeout(closeM, 1800);
      });
    };
  }

  /* ---------- UI: hub + Classement ---------- */
  function openHub(tab) {
    tab = tab || 'hub';
    var o = openM('sdref', '<button class="x" id="sdrx">&times;</button><h2>' + t('invite') + '</h2>' +
      '<div class="tabs"><button data-t="hub" class="' + (tab === 'hub' ? 'on' : '') + '">' + t('hub') + '</button><button data-t="board" class="' + (tab === 'board' ? 'on' : '') + '">' + t('board') + '</button></div>' +
      '<div id="sdrb" class="sm" style="text-align:center">' + t('loading') + '</div>');
    document.getElementById('sdrx').onclick = closeM;
    [].forEach.call(o.querySelectorAll('.tabs button'), function (b) { b.onclick = function () { openHub(b.getAttribute('data-t')); }; });
    if (tab === 'hub') renderHub(); else renderBoard();
  }
  function renderHub() {
    status().then(function (s) {
      var b = document.getElementById('sdrb'); if (!b) return;
      var cap = +s.cap || 3, today = Math.min(cap, +s.today || 0), pips = '';
      for (var i = 0; i < cap; i++) pips += '<div class="pip' + (i < today ? ' on' : '') + '"></div>';
      var ref = '';
      if (s.referrer) ref = '<div class="sm">' + t('by') + ': <b>' + esc(s.referrerName || s.referrer) + '</b> - ' + (s.state === 'pending' ? t('pending') : t('done')) + '</div>';
      else ref = '<div class="row"><input id="sdri" placeholder="' + esc(t('hint')) + '" autocomplete="off"><button class="btn" id="sdra" style="flex:0 0 auto">' + t('apply') + '</button></div><div class="msg" id="sdrm"></div>';
      b.className = ''; b.style.textAlign = '';
      b.innerHTML = '<div class="sm" style="text-align:center">' + t('code') + '</div><div class="code">' + esc(s.code || myCode()) + '</div>' +
        '<div class="row"><button class="btn g" id="sdrc">' + t('copy') + '</button><button class="btn" id="sdrh">' + t('share') + '</button></div>' +
        '<div class="msg" id="sdrcm"></div>' +
        '<div class="sm" style="text-align:center">' + t('today') + ': <b>' + today + ' / ' + cap + '</b></div><div class="pips">' + pips + '</div>' +
        '<div class="sm" style="text-align:center">' + t('total') + ': ' + (+s.total || 0) + '</div>' +
        '<div class="lad" style="margin-top:8px"><div class="sm"><b>' + t('ladder') + '</b></div><div>' + t('l1') + '</div><div>' + t('l2') + '</div><div>' + t('l3') + '</div><div>' + t('l4') + '</div></div>' +
        '<div class="sm">' + t('how') + '</div>' + ref;
      document.getElementById('sdrc').onclick = function () {
        var done = function () { var m = document.getElementById('sdrcm'); if (m) { m.className = 'msg s'; m.textContent = t('copied'); } };
        try { navigator.clipboard.writeText(link()).then(done, done); } catch (e) { done(); }
      };
      document.getElementById('sdrh').onclick = function () {
        try { if (navigator.share) { navigator.share({ title: 'Street Dominoes', text: 'Street Dominoes', url: link() }); return; } } catch (e) {}
        document.getElementById('sdrc').onclick();
      };
      var a = document.getElementById('sdra');
      if (a) a.onclick = function () {
        var m = document.getElementById('sdrm'); m.className = 'msg'; m.textContent = t('loading');
        claimCode(document.getElementById('sdri').value).then(function (r) {
          m.className = 'msg ' + (r.ok ? 's' : 'e'); m.textContent = r.ok ? t('ok') : t(r.key);
          if (r.ok) setTimeout(function () { if (cur) renderHub(); }, 1600);
        });
      };
    });
  }
  function renderBoard() {
    api('/api/referral/leaderboard?limit=50').then(function (r) {
      var b = document.getElementById('sdrb'); if (!b) return;
      var arr = r.j.top || r.j.list || r.j.rows || r.j.items || (Array.isArray(r.j) ? r.j : []);
      b.className = ''; b.style.textAlign = '';
      if (!arr.length) { b.className = 'sm'; b.style.textAlign = 'center'; b.textContent = t('empty'); return; }
      b.innerHTML = arr.map(function (e, i) {
        var id = e.pid || e.playerId || e.id || '', n = e.n != null ? e.n : e.count != null ? e.count : e.total != null ? e.total : e.score != null ? e.score : e.qualified || 0;
        var me = id && id === pid();
        return '<div class="lb' + (me ? ' me' : '') + '"><b>' + (i + 1) + '</b><span>' + esc(e.av || '') + ' ' + esc(me ? t('you') + ' (' + (e.name || '') + ')' : (e.name || 'Player')) + '</span><i>' + (+n || 0) + ' ' + t('refs') + '</i></div>';
      }).join('');
    });
  }

  /* ---------- menu entry (clones the Spin Wheel button) ---------- */
  function addMenuBtn() {
    var sp = document.querySelector('[data-m="spin"]');
    if (!sp || document.querySelector('[data-m="ref"]')) return;
    var b = sp.cloneNode(true);
    b.setAttribute('data-m', 'ref');
    b.textContent = '\uD83E\uDD1D ' + t('invite');
    b.addEventListener('click', function (ev) { ev.stopPropagation(); ev.preventDefault(); openHub('hub'); }, true);
    sp.parentNode.insertBefore(b, sp.nextSibling);
  }
  var raf = 0;
  new MutationObserver(function () { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; addMenuBtn(); }); })
    .observe(document.body, { childList: true, subtree: true });
  addMenuBtn();

  /* ---------- boot ---------- */
  function boot() {
    var pop = null;
    try { pop = JSON.parse(sessionStorage.getItem('sd_rwpop') || 'null'); sessionStorage.removeItem('sd_rwpop'); } catch (e) {}
    if (pop) showPopup(pop);
    var tries = 0;
    (function wait() {            // account token appears after /api/auth/init
      if (token() && pid()) {
        var pend = L('dm_ref', '');
        (pend ? claimCode(pend) : Promise.resolve()).then(checkRewards);
        return;
      }
      if (++tries < 40) setTimeout(wait, 3000);
    })();
    setInterval(checkRewards, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkRewards(); });
  }

  window.SDRef = { open: openHub, enter: function () { openEnter(false); }, check: checkRewards, claimCode: claimCode, wallet: WALLET };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
