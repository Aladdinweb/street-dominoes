# Changelog

## 1.2.1
- Fixed: the stone after a double no longer turns 90 degrees when there is room. It always continues straight along the line of play,
  and a turn happens only when a stone really reaches the table padding/frame (or would collide with a stone already placed).
- Fixed: pips (dots) lagging behind the stone body while stones move or the board auto-zooms. Each stone is now ONE GPU layer
  (translate3d + will-change: transform): body and pips are in the same container and move together, with no layout animation.

## 1.2.0
- Player identity & stats (hybrid persistence): playerId, name, avatar, title and preferences cached on the device; stats sync with
  Cloudflare KV only once per finished match (POST /api/match-result) plus a single GET /api/profile at startup. Results are queued
  offline and sent later. Titles by lifetime wins: Street Rookie (0-5), Café Player (6-20), Table Master (21-50),
  Domino General (51-100), Street Legend (101+).
- ProfileModal (tap your card in the menu): avatar, name, title progress, rank points, wins, win rate, blocked wins, win streak, sync status.
- Cinematic overlays: "TABLE BLOCKED!" (pulsing golden glow, remaining pips and stones per player) and the victory splash
  (pop & scale-up, sparks, count-up points, Rematch).
- Skins engine: registry + CSS variables for table themes, tile skins and audio FX (ready for the 1.4.0 themes hub).
- Board: bounding-box centring and smooth CSS-transition zoom
  (turn-budget: 1.0 -> 0.9 -> 0.85 -> 0.8 -> 0.75, down to 0.65 for collisions) with safe padding so tiles never touch the frame.
- Pass: heavy double-knock on the table + soft "pass" cue, and an animated PASSED badge beside the player's name tag for 1.5 s
  (also shown to LAN and online players).
- Server: moved to `server/src/worker.js`, new KV binding PLAYER_STATS, profile API with validation, rate limits and CORS.

## 1.1.2
- Drag & drop: drag a stone from your hand onto the open end you want (green outlines show the legal ends); tapping still works.
- Smart board layout: turns and doubles no longer overlap or clip at the table edge, doubles stay perpendicular to the chain,
  and every turn is checked against stones already on the table. If a turn would collide, the chain turns the other way /
  toward open space.
- Dynamic zoom-out as the chain grows (1.0 down to 0.65-0.70; 0.60/0.55 only in rare near-full one-sided chains).
- Online Multiplayer (Cloudflare Workers + WebSockets): Quick Match, private rooms with a code, server-side rules and
  anti-cheat, 30 s reconnect grace period, bots fill empty seats. Server code in `server/`.
- Player stats (matches, wins, rounds), coins and settings stay on the device; no account needed.
- Fixed: coins payout for LAN friends (the winner side was computed wrongly on a client phone).

## 1.1.1
- LAN multiplayer split into Casual Play and Coins Match. Coins Match: host picks a stake (500 / 1,000 / 5,000),
  every seat adds the stake to the pot and the winning player/team takes the full pot. Coins are virtual
  (start at 10,000, stored on each phone); friends without enough coins cannot join.
- Solo menu: Human vs Bot (1v1 or 2v2) or 1v1 Pass & Play (Human vs Human on one device).
- Back button / exit confirmation during a match ("Are you sure you want to quit the current match?").
  Quitting a Coins Match forfeits the stake.
- First move: the winner of the previous round (winning player, or the winning team's player with fewer pips after a
  blocked game) starts and plays the first tile automatically.
- Copyright footer on every screen, menu and dialog.
- Quick chat: emoji and street-slang reactions (including "خفلة!", "العب بسرعة!", "ضربة معلّم!") shown as animated
  pop-ups above the player's avatar, with a sound, also over LAN.
- Heavy double-slam sound and table shake when a double (6-6, 5-5 ...) is played.

## 1.1.0
- Main menu: Solo Game (BOT), Multiplayer / LAN, Online Multiplayer (disabled - "Coming Soon").
- 2v2 team play: Bottom + Top (green) vs Left + Right (white). Round winner's team scores the
  remaining pips of the losing team only (both partners combined); blocked games go to the team with fewer pips.
  Match target 100 / 200 / 300 (Settings).
- In-game scoreboard button (trophy in the top bar) with team scores, progress and stones left.
- Five table themes: Classic Green Felt, Dark Modern Wood, Royal Red Velvet, Deep Blue Slate, Marble Luxury.
- Profile in Settings: custom name and avatar (12 default avatars); shown on seats and sent to LAN friends.
- 1v1 Heads-Up mode (Human vs Bot, or Human vs Human on one phone / over LAN) next to 2v2 Teams.
  7 stones each; the other 14 stay face-down in a boneyard on the right side of the board.
  With no playable stone you tap any face-down stone to draw; Pass appears only when the boneyard is empty.
  In 1v1 the winner scores the loser's remaining pips (blocked game: fewer pips wins).
- Animations: tile shuffle (circular hand motion + shuffling sounds), deal to every seat (tap to skip),
  and a hand placing each tile on the board (360 ms) with a tile-drop sound. LAN friends see them too.
- 2v2 seats are fixed to four players; 1v1 uses Bottom and Top.

## 1.0.0
- First release: Street Dominoes, LAN play, in-app updates.
