# Tic-Tac-Toe Multiplayer

A real-time multiplayer Tic-Tac-Toe game with a server-authoritative architecture. Two players are matched automatically via a matchmaking queue, take turns on a shared board, and earn stats tracked on a global leaderboard.

## 🔗 Live Demo

**[Play here →](https://marvelous-bravery-production-03da.up.railway.app)**

---

## Features

- **Real-time multiplayer** — moves sync instantly between players via WebSocket
- **Server-authoritative** — all game logic (turn validation, win detection, timeouts) runs on the server; clients cannot cheat
- **Automatic matchmaking** — players are paired automatically; no room codes needed
- **Two game modes** — Classic (unlimited time) and Timed (30 seconds per turn, auto-forfeit on timeout)
- **Global leaderboard** — wins, losses, draws, and win streak tracked per player and persisted in PostgreSQL
- **Rematch** — instant rematch without leaving the game
- **Join by room ID** — share a match ID to play with a specific person

---

## Tech Stack

| Layer | Technology |
|---|---|
| Game server | [Nakama](https://heroiclabs.com/) 3.25 (open-source) |
| Game logic | JavaScript (Nakama authoritative match handler) |
| Database | PostgreSQL 15 |
| Frontend | React 18 + TypeScript + Vite |
| Routing | React Router v6 |
| Real-time client | `@heroiclabs/nakama-js` v2.8 (WebSocket) |
| Local environment | Docker + Docker Compose |
| Production hosting | [Railway](https://railway.app) |

---

## Project Structure

```
nakama-tictactoe/
├── docker-compose.yml            # Local dev: Nakama + PostgreSQL
├── Dockerfile                    # Production: Nakama service image
├── nakama.yml                    # Nakama server configuration
├── railway.json                  # Railway config for Nakama service
│
├── backend/
│   └── data/
│       └── modules/
│           └── index.js          # Nakama JS runtime module (game logic)
│
└── frontend/
    ├── Dockerfile                # Production: React + nginx image
    ├── railway.json              # Railway config for frontend service
    ├── nginx.conf                # nginx routing for SPA
    ├── .env                      # Local env vars (VITE_NAKAMA_URL)
    └── src/
        ├── context/
        │   └── GameContext.tsx   # Nakama client, session, game state
        ├── pages/
        │   ├── HomePage.tsx      # Connect, choose mode, enter matchmaking
        │   ├── MatchmakingPage.tsx
        │   ├── GamePage.tsx      # Live game board
        │   └── LeaderboardPage.tsx
        ├── components/
        │   ├── Board.tsx
        │   └── Timer.tsx
        └── lib/
            └── nakama.ts         # Server URL config
```

---

## How It Works

### Matchmaking
1. Player enters a name and connects to Nakama (creates a session via custom auth)
2. Player clicks **Quick Play** — the client calls `socket.addMatchmaker` with the selected mode
3. When two players with the same mode are queued, Nakama fires the `matchmakerMatched` hook
4. The hook creates an authoritative `tictactoe` match and returns the match ID to both clients
5. Both clients navigate to the game page and join the match

### Game Loop
- The server runs a match loop at **2 ticks/second**
- OpCode `1` (client → server): player sends `{ cell: number }` to make a move
- The server validates the move (correct turn, empty cell, game is playing), updates the board, and broadcasts the new state
- OpCode `2` (server → client): full game state is broadcast to all players after every change
- OpCode `3` (client → server): rematch request

### Stats
- After each game (win/loss/draw/forfeit), the server writes updated stats to Nakama's Storage Engine (PostgreSQL)
- The leaderboard is sorted by net score (`wins − losses`), then win streak, then total wins

---

## Local Development

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- [Node.js](https://nodejs.org/) 18+

### Step 1 — Start the backend

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5432`
- **Nakama** on port `7350` (automatically runs DB migrations on first start)

Wait ~15 seconds for both to be healthy. You can verify with:

```bash
docker compose ps
```

Both services should show `healthy`.

### Step 2 — Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The app is now running at **http://localhost:5173**

### Step 3 — Test multiplayer

1. Open **http://localhost:5173** in your browser
2. Enter a name → click **Connect to Server**
3. Open a second browser window (or Incognito) → connect with a different name
4. Both players click **Quick Play**
5. Matchmaking pairs them automatically — the board appears for both

### Nakama Admin Console

Available at **http://localhost:7350** — useful for inspecting storage, sessions, and matches.

> Default credentials: `admin` / `adminpass123`

### Stopping

```bash
docker compose down
```

To also delete the database volume:

```bash
docker compose down -v
```

---

## OpCode Reference

| Code | Direction | Payload | Description |
|---|---|---|---|
| `1` | Client → Server | `{ "cell": 0–8 }` | Make a move |
| `2` | Server → Client | Full game state (JSON) | State broadcast after every change |
| `3` | Client → Server | _(empty)_ | Request rematch |
| `5` | Client → Server | _(empty)_ | Request current state sync |

---

## Notes

- Players authenticate with a randomly generated ID (no account/password required)
- Sessions expire after 1 hour and are refreshed automatically from `sessionStorage`
- The leaderboard and stats persist across server restarts (stored in PostgreSQL)
- WebSockets are fully supported on Railway's infrastructure
