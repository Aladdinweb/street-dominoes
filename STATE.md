# Street Dominoes - project state (v1.3.2)

> Long-term plan and phases: see [ROADMAP.md](ROADMAP.md). Update both files when a feature ships.

by ILINE TECH / FERAK ALADDIN. Android app (WebView + Kotlin) + Cloudflare Worker backend. Everything below describes what is in this repo now.

## 1. Repo map
| Path | What it is |
|---|---|
| `app/src/main/assets/www/index.html` | The whole game UI + logic (single file, vanilla JS, 3 languages EN/FR/AR) |
| `app/src/main/java/com/iline/streetdominoes/MainActivity.kt` | WebView host, JS bridge (`Native`): LAN WebSocket host/client, GitHub updater, back button, mic permission |
| `app/src/main/AndroidManifest.xml`, `app/build.gradle.kts` | Permissions (internet, wifi state, install packages, record audio), versionName/versionCode (default 1.2.2 / 10202; CI overrides from the git tag) |
| `server/src/worker.js` | Cloudflare Worker: online rooms (Durable Object `GameRoom`), matchmaking (`Matchmaker`), profile API (KV `PLAYER_STATS`) |
| `server/wrangler.toml` | KV binding + 2 Durable Objects + SQLite migration, `main = "src/worker.js"` |
| `.github/workflows/release.yml` | Tag `v*` -> signed APK attached to the GitHub release |
| `.github/workflows/deploy-worker.yml` | Push under `server/` (or manual) -> `wrangler deploy` (needs secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) |
| `tools/make-keystore.sh` | One-time signing key creation + GitHub secrets (`KEYSTORE_B64`, `KS_PASS`, `KEY_PASS`, `KEY_ALIAS`) |
| `CHANGELOG.md`, `README.md`, `server/README.md` | History and how-to |

## 2. Game modes
- **Solo**: Human vs Bot 1v1, Human + Bot vs 2 Bots (2v2), 1v1 Pass & Play (hands hidden until "show my tiles").
- **LAN** (app only): host phone runs a WebSocket server, friends join by IP; seats Human / Bot / Friend; Casual or Coins Match (virtual coins, stakes 500/1000/5000).
- **Online**: Quick Match, Create Room (code), Join by code; server-authoritative; bots fill empty seats; 30 s reconnect grace.
- 2v2: seats Bottom/Left/Top/Right, teams = Bottom+Top vs Left+Right. 1v1: Bottom vs Top with a 14-stone boneyard (tap a face-down stone to draw, Pass only when it is empty).
- Target score 100/200/300 (default 200). Round winner team scores the losing team's remaining pips; blocked game: fewer pips wins.

## 3. Rules implemented (engine = `place`, `playable`, `startRound`, `doPass`; mirrored in `server/src/worker.js`)
- 7 stones each. Opening: previous round's winner (or, first round, the holder of the highest double). **Bots open automatically; real players choose and place their opening stone** (empty board, every stone playable).
- Pass is only possible when no stone fits (and, in 1v1, the boneyard is empty). Double-knock sound + PASSED badge beside the name for 1.5 s.
- Heavy slam sound + table shake when a double is played.

## 4. Board layout engine (`layoutTry` / `layoutFit`, constants `ZL`, `MT`, `STRICT_MIN`)
- Stones are laid out in virtual coordinates; turns happen at the frame padding (16 virtual px) or on collision (checked against every stone already placed; the turn direction with more free room is chosen).
- **Double rule**: a double is perpendicular to the line, the stone attached to it continues straight (crosswise), never a pivot, also at the edge and in all four directions.
  Strategy order: 1) gentle zoom only (>= 0.70), 2) zoom + look-ahead turn of the stone BEFORE the double (>= 0.65), 3) fallback: old behaviour (turn allowed after a double) so stones never shrink below readability.
- Zoom ladder 1.0 -> 0.9 -> 0.85 -> 0.8 -> 0.75 -> 0.7 -> 0.65 (0.6/0.55 only for rare collisions); turn budget per zoom step; bounding box is centred; CSS `transition: transform` on the board and on each stone container.
- Each stone is ONE container (`.cw`, body + pips) moved with `translate3d` + `will-change: transform` (no layout animation, so pips never lag).
- Measured on 120 bot rounds (2,650 moves): average zoom 0.825 (0.853 without the double rule); the double rule could be kept in about 69% of moves within the zoom limits (bots chain doubles a lot, so this is a harsh sample); never below 0.65 except rare collision cases.
- Input: tap a stone, or drag it onto an open end (green outlines); on an empty board a drop anywhere on the table opens.

## 5. Player profile and stats
- Local: `localStorage` keys `dm_set` (settings, names, avatars, coins, stats snapshot, skins), `dm_pid` (`usr_xxxxxx`), `dm_pend` (unsent match results), `dm_lang`.
- Cloud (KV `PLAYER_STATS`, key `profile:<playerId>`): startup `GET /api/profile?playerId=...` (read only); after each finished match `POST /api/match-result` (the only write). Offline results are queued and flushed later.
- Titles by total wins: Street Rookie 0-5, Cafe Player 6-20, Table Master 21-50, Domino General 51-100, Street Legend 101+. Rank points exist (1000) but are not used until 1.3.0.
- Validation on the server: id format, result/blockedWins ranges, 2 KB body, 3 s gap, 150 matches/day, name sanitising, avatar whitelist, CORS.
- Skins engine (`Skins` registry): table, tile and audio skins applied through CSS variables / `data-*` attributes (themes hub planned for 1.4.0).

## 6. Online protocol (WebSocket `wss://street-dominoes-server.alaacasanova31.workers.dev/ws`)
- Connect: `?quick=1&gm=` | `?create=1&gm=&target=` | `?room=CODE`, plus `pid`, `name`, `av`.
- Server -> client: `state` (personalised view, opponents' hands hidden), `olobby`, `queue`, `matched`, `err`, `rx` (emoji/quick chat), `vcs`, `rtc`, `pong`.
- Client -> server: `play{i,side}`, `draw{i}`, `pass`, `rematch`, `rx{k}`, `start`, `leave`, `vc`, `rtc`, `ping`.
- Server checks turn ownership, stone ownership, side legality, draw/pass legality, rate limits (30/s; 240/s for `rtc`), AFK auto-play after 45 s, 30 s reconnect grace (1v1 forfeits afterwards, in 2v2 a bot takes the seat). LAN uses the same message shapes (host-authoritative, Kotlin WebSocket server).

## 7. Voice chat (online rooms only)
WebRTC audio is peer-to-peer; the room only relays signalling (`vc`, `rtc`). Lower seat offers (no glare). A mic button sits next to every human profile card: yours = mute/unmute (first tap asks for microphone permission), others = local mute. STUN only (Cloudflare, Google); no TURN, so some mobile networks may fail to connect directly (add a TURN relay later if needed). Android: `RECORD_AUDIO` + WebChromeClient permission bridge + autoplay allowed.

## 8. Testing status (scripted, Node; not run on a phone)
- Layout fuzz: 4,000 random chains + 1,500 long chains: no overlaps, nothing outside the table, doubles perpendicular; strict-rule property tests (successor straight, room for the successor of the last double).
- Engine: 2v2 and 1v1 rounds with bots (scoring, blocked games, boneyard, tile conservation), opening rules (human manual / bot automatic / LAN remote opener), coins settlement, quit confirm, chat, solo modes, drag and drop, profile modal, overlays, count-up, skins.
- Server (simulated sockets): match flow, bots, anti-cheat, reconnect, forfeit, matchmaking, voice relay validation and rate limits; KV API with a mock KV (one write per match, validation, CORS).
- End-to-end: the real app code against the real worker code (create/join/quick match, reconnect, 2v2, chat, voice between two clients with mocked WebRTC peers).
- NOT verified: real Cloudflare (KV, Durable Objects), real WebRTC on phones, Android compilation (Kotlin changes), visual look on devices.

## 9. Known limits / risks
- Profile stats are reported by the app (no login yet) and can be forged; leaderboards (1.3.0) should use results the server saw itself in online rooms.
- Coins are virtual and stored on each phone; LAN/online payout trusts the host/server flow, no real money.
- No TURN server: voice may not connect across strict mobile NAT.
- Double-heavy chains (bots love them) can force the fallback turn after a double when the stricter rule would need tiny stones.
- Titles overlap in the spec at exactly 100 wins: implemented as 100 = Domino General, 101+ = Street Legend.

## 10. Release / deploy checklist
1. Server: `cd server && npx wrangler deploy` (or push `server/` to run the workflow); check `/health` and `/api/profile?playerId=usr_abc123`.
2. App: `git add -A && git commit -m "..." && git push`, then `git tag vX.Y.Z && git push origin vX.Y.Z`; Actions builds `StreetDominoes-vX.Y.Z.apk`; installed apps offer the update.
3. Keep `release.jks` + password backed up (updates only install over builds signed with the same key).

## 11. Roadmap
Superseded by [ROADMAP.md](ROADMAP.md) (phases 1-5).
1.3.0 leaderboards + Elo (+25/+10/+5 blocked bonus/-15), weekly coins board; 1.4.0 themes hub (table, tile skins, material audio); 1.5.0 street audio emotes and animated emojis; optional TURN for voice.

<!-- sd130 -->
## 12. Changes since v1.2.2 (client)
- 1.2.3-1.2.4: `ux-layer.css` (glass panels, dark charcoal + red accents, scale micro-interactions); Cloudflare Pages deploy (`.github/workflows/deploy-pages.yml`, project `street-dominoes`, https://street-dominoes.pages.dev; `pages/` holds `_headers`, manifest and mirrored copies, `app/src/main/assets/www/` wins); `sd-voice.js` (Google STUN merged into every RTCPeerConnection + explicit `play()` with tap-to-resume); `sd-layout.js` (`SDLayout` module, NOT used by the engine).
- 1.2.5 / 1.2.8: layout engine `layoutTry0` / `layoutTry` / `layoutFit`: strict double rule down to zoom 0.45, rigid-run look-ahead, start-point search (`SHIFTS`); the non-strict "turn after a double" fallback remains as a last resort (< 1% of moves in tests).
- 1.2.6: invite links (`?room=CODE` auto-join, Copy Invite Link in the lobby, guest-name prompt).
- 1.2.7: profile photo (250x250 JPEG in `dm_photo`), 12 procedural street avatars, country flag picker (`IL` excluded), active-turn pulse (CSS), localized Pass voice (`PassVoice`, device TTS), default name "Player 1".
- 1.2.9: menu card + wallet, glowing top-centre title, Daily Mystery Box (24 h, coins / XP / 4 exclusive avatars), XP levels (`dm_eco`), leaderboard window (Daily / Weekly / Friends / Global), solo entry fee, native photo picker (`MainActivity.kt`: `onShowFileChooser`, `Native.supportsFilePicker()`).
- Local storage keys: `dm_set` (settings, names, coins, stats snapshot), `dm_pid`, `dm_pend`, `dm_lang`, `dm_prof2` (avatar kind, flag), `dm_photo`, `dm_eco` (XP, box timer, owned avatars, solo fee), `dm_friends`.
- Limits: coins, XP and the box timer are client-side (forgeable); photo, flag and street avatars are local only (the server accepts emoji avatars only).

## 13. Server v1.3.0: ranking, leaderboards, stakes
- Online results are recorded by the room itself at match end (`GameRoom.recordMatch`): profile stats for every human, rank points only for "rated" matches (>= 2 humans; 1v1 forfeit only after 2 rounds; forfeiters always lose; max 40 rated per player per day). Constants: `LB` in `worker.js`. `POST /api/match-result` with `mode:"online"` is acknowledged but ignored.
- Leaderboard store: instance `idFromName('lb')` of the `Matchmaker` class, internal paths `/_lb/record` and `/_lb/top` (not reachable from outside). Public API: `GET /api/leaderboard?scope=daily|weekly|global&limit=50`.
- Stakes: `stake` (0 / 100 / 500 / 1000 / 5000) is set by the room creator or the first quick-match connector and sent in `olobby` and `state`; quick match queues are per stake; the client deducts the fee when a new `mid` starts and pays the winning team the pot at the end (coins live on the devices).
- Tests: `node server/test/worker.test.mjs` (real room code, fake KV / Durable Object storage).

## 14. Working on this repo
- Features ship as `apply-vX.Y.Z.sh` patch scripts: exact-match anchors (abort unless exactly one match), syntax checks with automatic restore, idempotent, version bump, changelog, commit, push, tag. Scripts use `$TMPDIR` (Termux has no `/tmp`).
- Tag `vX.Y.Z` builds the APK; a push to `main` redeploys the web build; a push under `server/` redeploys the Worker. Kotlin changes are only compiled by the GitHub Actions APK build.
- Long-term plan: `ROADMAP.md`.

<!-- sd131 -->
## 15. v1.3.1: speed mode, presence, invites, voice relay, identity
- Server (`worker.js`): `cfg.turn` (10/15/20/30, 0 = standard) and `cfg.auto` (`play` | `pass`) set by the room creator; `GameRoom.timeout()` handles a human's timer (`pass` mode skips the turn when a tile was playable, resets the blocked counter, 3 timeouts in a row set `seat.auto`). `view` adds `tl` / `tt` (time left / total), `turn`, `auto`, `pids` (human seats' player ids). `cfg.res` reserves seats for invited friends (`seatFor`), `cfg.seek` asks the matchmaker (`/_mm/seek`) for 2 random opponents with the same stake. `dn` = unique display name inside a room (profile name unchanged).
- Presence + invites: instance `idFromName('pr')` of `Matchmaker` (hibernatable WebSockets, `?presence=1&pid=`): messages `st` (1 online / 2 in game), `watch` (max 40 ids), pushes `pres` and `inv`. Internal `/_pr/invite` does the rate limiting and in-app delivery; `POST /api/invite` then sends FCM pushes to offline friends (`fcmAccess` / `fcmSend`, HTTP v1, secret `FCM_SERVICE_ACCOUNT`). `POST /api/push-token` stores up to 3 tokens in KV `push:<id>`.
- Voice relay: `GET /api/turn` (secrets `TURN_KEY_ID`, `TURN_API_TOKEN`, Cloudflare `generate-ice-servers`, port-53 URLs removed). `sd-voice.js` fetches it, merges STUN + TURN into every `RTCPeerConnection`, exposes `SDVoice.status()`; the game sets `data-vs` (ok / wait / bad) on the mic buttons.
- Chat: `{t:'rx',k:'txt',x}` (server `cleanChat`, client `cleanChat` / `sendTxt` / `showTextBubble`; the old emoji / phrase keys still work).
- App identity: `ME` / `myName()` / `myAv()` / `syncMe()` / `restoreMe()` (key `dm_me`); `saveSet()` writes the profile names from `net.bk` while connected as a client; default `Guest_XXXX`.
- App social: `Pres` (presence socket), `recents()` / `saveRecents()` (`dm_recent`), friends window `openFr()` (invite sheet, Street Ping), `showInvite()` / `joinInvite()` / `sendInvites()`, `window.onPushOpen / onPushToken / onPushMsg` (inert without `Native.pushSupported()`), language button `setLangTo()`.
- New storage keys: `dm_me`, `dm_recent`, `dm_ptok`, `dm_ptat`. Android FCM wiring is not in the repo yet (see ROADMAP.md).

<!-- sd132 -->
## 16. v1.3.2: optional modes, manual control, RTL, Android push
- Room settings are all optional: `normSpeed(turn, auto)` (worker) returns `{turn, auto}`; no timer means `auto:'manual'`. `GameRoom.timed()` is true only for `turn > 0` with `auto` `play` / `pass`; `turnMs()` is `turn * 1000` when timed, else `CFG.IDLE` (2 min inactivity safety net, then `botStep()`). `view.tl` is 0 unless timed (the app only shows a countdown then). Quick-match queue keys are `gm|stake|turn|auto`; `matched` carries `stake`, `turn`, `auto`; `seek` requests carry them too.
- App: `onlineType` (`casual` | `coins`), `onlineStake`, `onlineTurn`, `onlineAuto` (`manual` | `play` | `pass`), `speedOpen`; `modeHtml()` / `speedHtml()` / `lobbyOpts()`. Defaults: casual, 0, 0, manual, closed.
- RTL: `render()` sets `document.documentElement.dir`; `#game{direction:ltr}` keeps the board physical; `.lgb` / `#lgp` use `inset-inline-start`.
- Android (`app/src/main/java/com/iline/streetdominoes/`): `Push.kt` (`ready`, channel `invites`, token storage), `StreetMessagingService.kt` (`onNewToken`, foreground `onMessageReceived` -> `window.onPushMsg`), `MainActivity.kt` (`handleIntent` reads the tapped notification's extras -> `window.onPushOpen`, `fetchToken`, permission code 79, bridge `pushSupported` / `getPushToken` / `pushPermission` / `requestPushPermission`, callbacks `onPushToken` / `onPushPerm`). Gradle: root plugin `com.google.gms.google-services` 4.4.2 (apply false), app applies it only if `app/google-services.json` exists; `firebase-bom:33.1.2` + `firebase-messaging`. Manifest: `POST_NOTIFICATIONS`, service, default channel / icon (`res/drawable/ic_stat_domino.xml`), `launchMode=singleTop`. CI (`release.yml`) writes `app/google-services.json` from the `GOOGLE_SERVICES_B64` secret (optional).
- FCM data keys: never use `from`, `message_type`, `google*`, `gcm*` (reserved); the sender id is `sid`.
