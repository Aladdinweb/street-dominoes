/* sd-voice.js - Street Dominoes 1.3.1. Voice compatibility shim; the game's own voice code is unchanged.
   1) Every RTCPeerConnection gets STUN servers AND, when the server has them, TURN relay servers (GET /api/turn, Cloudflare Realtime TURN).
      Without a relay, phones on mobile networks (CGNAT / symmetric NAT) often cannot reach each other and the mic icon looks "on" but no sound arrives.
   2) Remote audio: play() is called explicitly on every remote audio track; if the browser blocks autoplay, playback is retried on the next tap.
   3) SDVoice.status() reports how each peer connected (direct / relay / failed) for troubleshooting. */
(function () {
  'use strict';
  if (window.__sdVoice) return;
  window.__sdVoice = 1;

  var STUN = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];
  var turn = [], turnAt = 0, turnP = null, played = new Set(), pending = new Set(), pcs = new Set();

  function loadTurn() {
    if (typeof API_URL === 'undefined' || typeof fetch !== 'function') return Promise.resolve(false);
    turnP = Promise.race([
      fetch(API_URL + '/api/turn', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (j && Array.isArray(j.iceServers) && j.iceServers.length) { turn = j.iceServers; turnAt = Date.now(); return true; }
        return false;
      }),
      new Promise(function (res) { setTimeout(function () { res(false); }, 3500); })
    ]).catch(function () { return false; });
    return turnP;
  }
  // resolves once the first relay-credential request finished (or timed out); refreshes credentials older than 5 hours
  function ready() {
    if (!turnP || (Date.now() - turnAt > 5 * 3600e3 && turnAt)) return loadTurn();
    return turnP;
  }

  function mergeIce(cfg) {
    cfg = Object.assign({}, cfg || {});
    var cur = Array.isArray(cfg.iceServers) ? cfg.iceServers.slice() : [], have = {};
    cur.forEach(function (s) { [].concat((s && s.urls) || []).forEach(function (u) { have[u] = 1; }); });
    STUN.concat(turn).forEach(function (s) {
      var us = [].concat(s.urls).filter(function (u) { return !have[u]; });
      if (!us.length) return;
      us.forEach(function (u) { have[u] = 1; });
      var o = { urls: us }; if (s.username) o.username = s.username; if (s.credential) o.credential = s.credential;
      cur.push(o);
    });
    cfg.iceServers = cur;
    return cfg;
  }

  var MP = window.HTMLMediaElement && window.HTMLMediaElement.prototype, op = null;
  if (MP && MP.play && !MP.play.__sd) {
    op = MP.play;
    MP.play = function () {
      var el = this, r = op.apply(el, arguments);
      if (el.srcObject) played.add(el);
      if (r && r.catch) r.catch(function () { if (el.srcObject) pending.add(el); });
      return r;
    };
    MP.play.__sd = 1;
  }

  function resume() {
    if (!op) return;
    var list = Array.prototype.slice.call(document.querySelectorAll('audio'));
    pending.forEach(function (a) { list.push(a); });
    list.forEach(function (a) {
      if (!a.srcObject || !a.paused) { pending.delete(a); return; }
      var p = op.call(a);
      if (p && p.then) p.then(function () { pending.delete(a); }, function () {});
    });
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, resume, { passive: true, capture: true });
  });

  function holds(a, track) {
    var s = a.srcObject;
    return !!(s && s.getTracks && s.getTracks().indexOf(track) >= 0);
  }

  function onTrack(ev) {
    var tr = ev.track;
    if (!tr || tr.kind !== 'audio') return;
    setTimeout(function () {
      var held = null;
      Array.prototype.forEach.call(document.querySelectorAll('audio,video'), function (a) { if (holds(a, tr)) held = a; });
      played.forEach(function (a) { if (holds(a, tr)) held = a; });
      if (held) { if (held.paused) { var p = held.play(); if (p && p.catch) p.catch(function () {}); } return; }
      var stream = (ev.streams && ev.streams[0]) || new MediaStream([tr]);
      var a = document.createElement('audio');
      a.autoplay = true; a.playsInline = true; a.setAttribute('playsinline', '');
      a.dataset.sd = '1'; a.style.display = 'none'; a.srcObject = stream;
      document.body.appendChild(a);
      var q = a.play(); if (q && q.catch) q.catch(function () {});
    }, 400);
  }

  // how did this peer connect? 'host'/'srflx' = direct, 'relay' = through TURN
  function pathOf(pc) {
    if (!pc.getStats) return Promise.resolve('');
    return pc.getStats().then(function (st) {
      var sel = null, cands = {};
      st.forEach(function (r) { if (r.type === 'local-candidate') cands[r.id] = r; });
      st.forEach(function (r) { if (r.type === 'candidate-pair' && (r.selected || r.nominated && r.state === 'succeeded')) sel = r; });
      var l = sel && cands[sel.localCandidateId];
      return l ? (l.candidateType === 'relay' ? 'relay' : 'direct') : '';
    }).catch(function () { return ''; });
  }

  var Orig = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (Orig && !Orig.__sd) {
    var W = function (cfg, opt) {
      var pc = new Orig(mergeIce(cfg), opt);
      pcs.add(pc); pc.__sdPath = '';
      try {
        pc.addEventListener('track', onTrack);
        pc.addEventListener('iceconnectionstatechange', function () {
          var s = pc.iceConnectionState;
          if (s === 'connected' || s === 'completed') pathOf(pc).then(function (p) { pc.__sdPath = p; });
          if (s === 'closed') pcs.delete(pc);
        });
      } catch (e) {}
      return pc;
    };
    W.prototype = Orig.prototype;
    W.__sd = 1;
    if (Orig.generateCertificate) W.generateCertificate = Orig.generateCertificate.bind(Orig);
    window.RTCPeerConnection = W;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = W;
  }

  window.SDVoice = {
    STUN: STUN, mergeIce: mergeIce, resume: resume, ready: ready, loadTurn: loadTurn,
    hasRelay: function () { return turn.length > 0; },
    status: function () {
      var out = [];
      pcs.forEach(function (pc) { out.push({ ice: pc.iceConnectionState, conn: pc.connectionState, path: pc.__sdPath || '' }); });
      return { relay: turn.length > 0, peers: out };
    }
  };
  loadTurn();
  setInterval(function () { if (turnAt && Date.now() - turnAt > 5 * 3600e3) loadTurn(); }, 600e3);
})();
