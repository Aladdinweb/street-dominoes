# Street Dominoes online server (Cloudflare Workers + Durable Objects)

Endpoint used by the app: `wss://street-dominoes-server.alaacasanova31.workers.dev/ws`

## Deploy
Option A - from a PC / Termux with Node:
    cd server
    npx wrangler login
    npx wrangler deploy

Option B - GitHub Actions: add repo secrets `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
and `CLOUDFLARE_ACCOUNT_ID`, then push any change under `server/` or run "Deploy online server" manually.

`wrangler.toml` declares two Durable Objects (`GameRoom`, `Matchmaker`) with a SQLite migration, which the free plan supports.
Check it is alive: open `https://street-dominoes-server.alaacasanova31.workers.dev/health`.

## URL parameters
- `/ws?quick=1&gm=1v1|2v2`                      quick matchmaking (after 12 s the table is filled with bots)
- `/ws?create=1&gm=1v1|2v2&target=100|200|300`  create a private room (server answers with the room code)
- `/ws?room=CODE`                               join / rejoin a room
- common: `pid` (stable random player id, used for reconnects), `name`, `av`

## Rules enforced on the server
The server owns the game state (deal, chain, turns, boneyard, scoring). It validates turn ownership, tile ownership, side
legality, draw/pass legality, rate-limits messages and only sends each player their own hand.
A player who drops has 30 s to reconnect with the same `pid`; after that a 1v1 is forfeited, and in 2v2 a bot takes the seat.
An idle player is auto-played after 45 s so the table never stalls.
