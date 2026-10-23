/* Street Dominoes - voice chat fixes. Merge into your existing voice code. */

// 1) ICE servers: Google STUN first (as requested), Cloudflare as backup.
//    STUN alone fails behind strict mobile NAT; add a TURN entry for those users.
const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // { urls: ['turn:YOUR_TURN_HOST:3478?transport=udp', 'turns:YOUR_TURN_HOST:5349'],
    //   username: '...', credential: '...' },   // short-lived creds from your Worker
  ],
  iceCandidatePoolSize: 4,
};
// const pc = new RTCPeerConnection(RTC_CONFIG);

// 2) Remote audio: attach element to the DOM, call play() explicitly, and retry after a tap.
const pendingAudio = new Set();

function attachRemoteAudio(pc, peerId) {
  pc.ontrack = (ev) => {
    const stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
    let a = document.getElementById('vc-' + peerId);
    if (!a) {
      a = document.createElement('audio');
      a.id = 'vc-' + peerId;
      a.autoplay = true;
      a.playsInline = true;
      a.style.display = 'none';
      document.body.appendChild(a);   // detached audio elements are flaky on some WebViews
    }
    a.srcObject = stream;
    const p = a.play();
    if (p && p.catch) p.catch(() => pendingAudio.add(a));   // autoplay blocked -> retry on gesture
  };

  // 3) Recover from dropped connections instead of staying silent.
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' && pc.restartIce) pc.restartIce();
  };
}

function resumeAudio() {
  pendingAudio.forEach((a) => a.play().then(() => pendingAudio.delete(a)).catch(() => {}));
}
['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) =>
  addEventListener(ev, resumeAudio, { passive: true })
);

// 4) Add the mic track BEFORE createOffer/createAnswer, from a user gesture (mic button tap):
// const stream = await navigator.mediaDevices.getUserMedia({
//   audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
// stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));
