/* sd-voice.js - Street Dominoes 1.2.4. Voice compatibility shim; no changes to the existing voice code needed.
   1) Every RTCPeerConnection gets Google STUN (stun:stun.l.google.com:19302) merged into its iceServers.
   2) Remote audio: play() is called explicitly on every remote audio track; if the browser blocks autoplay,
      playback is retried on the next tap. Nothing is replaced: existing elements are reused. */
(function () {
  'use strict';
  if (window.__sdVoice) return;
  window.__sdVoice = 1;

  var STUN = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];
  var played = new Set(), pending = new Set();

  function mergeIce(cfg) {
    cfg = Object.assign({}, cfg || {});
    var cur = Array.isArray(cfg.iceServers) ? cfg.iceServers.slice() : [], have = {};
    cur.forEach(function (s) { [].concat((s && s.urls) || []).forEach(function (u) { have[u] = 1; }); });
    STUN.forEach(function (s) {
      var us = [].concat(s.urls).filter(function (u) { return !have[u]; });
      if (us.length) cur.push({ urls: us });
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

  var Orig = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (Orig && !Orig.__sd) {
    var W = function (cfg, opt) {
      var pc = new Orig(mergeIce(cfg), opt);
      try { pc.addEventListener('track', onTrack); } catch (e) {}
      return pc;
    };
    W.prototype = Orig.prototype;
    W.__sd = 1;
    if (Orig.generateCertificate) W.generateCertificate = Orig.generateCertificate.bind(Orig);
    window.RTCPeerConnection = W;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = W;
  }
  window.SDVoice = { STUN: STUN, mergeIce: mergeIce, resume: resume };
})();
