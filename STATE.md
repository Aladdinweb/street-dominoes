# Street Dominoes - project state (v1.2.5)

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
1.3.0 leaderboards + Elo (+25/+10/+5 blocked bonus/-15), weekly coins board; 1.4.0 themes hub (table, tile skins, material audio); 1.5.0 street audio emotes and animated emojis; optional TURN for voice.
