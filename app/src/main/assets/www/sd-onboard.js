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
