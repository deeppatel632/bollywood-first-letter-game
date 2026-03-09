# 🎬 Bollywood First Letter Guess Game

A real-time multiplayer browser game where players guess Bollywood movies from first-letter hints.

---

## How the Game Works

Four hint boxes are shown on screen:

| Box | What Players See (initially) |
|---------|------------------------------|
| 🎭 Hero | First letter only, e.g. **A** |
| 💃 Heroine | First letter only, e.g. **K** |
| 🎬 Movie | First letter only, e.g. **D** |
| 🎵 Song | First letter only, e.g. **T** |

Players take turns guessing (10 seconds each). Guess any of the four answers to earn points.

### BOLLYWOOD Lives

Every wrong guess removes one letter from the word **BOLLYWOOD** — that's 9 lives per round. When all 9 letters are gone, the round ends.

### Scoring

| Guess | Points |
|-------|--------|
| Correct movie | +20 |
| Correct hero | +10 |
| Correct heroine | +10 |
| Correct song | +10 |
| Wrong guess | −2 (floor 0) |

### Timed Hints

After the round starts, extra hints are revealed automatically:

- **20 s** → Release year
- **30 s** → Director
- **40 s** → Plot summary

---

## Project Structure

```
bollywood-multiplayer/
├── server/
│   ├── server.js        # Express + Socket.io entry point
│   ├── gameEngine.js    # Round loop, timers, guess handling
│   ├── roomManager.js   # Create / join / leave rooms
│   ├── scoreManager.js  # Point calculation
│   └── hintSystem.js    # Build first-letter hint objects
├── data/
│   ├── movies.json      # 94-movie curated dataset (2000-2024)
│   └── fetchMovies.js   # Dataset validator / stats script
├── public/
│   ├── index.html       # Single-page UI
│   ├── style.css        # Dark cinematic glassmorphism theme
│   └── client.js        # Socket.io client + game UI logic
├── Dockerfile
└── package.json
```

---

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Inspect the dataset (optional)

```bash
node data/fetchMovies.js
```

This prints a dataset report — no internet required, everything is pre-bundled in `data/movies.json`.

### 3. Start the server

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

### 4. Open the game

```
http://localhost:3000
```

---

## Multiplayer Flow

1. **Player A** enters a name → clicks **Create Room** → gets a 6-character room code.
2. **Player B–H** enter a name + the code → click **Join Room**.
3. Host clicks **▶ Start Game**.
4. Players take turns guessing; scoreboard updates live.

### Host controls (visible only to the host)

| Button | Action |
|--------|--------|
| ⏭ Skip | Reveal the answer and move to the next movie |
| 🔄 Restart | Restart the current round with the same movie |

---

## Deployment

### Render.com

1. Create a new **Web Service** → connect your GitHub repo.
2. Set the **Start Command** to `npm start`.
3. Set the **Environment Variable** `PORT` (Render injects it automatically).
4. Deploy — Render gives you a public HTTPS URL.

### Railway.app

1. Create a new project → **Deploy from GitHub repo**.
2. Railway auto-detects Node.js and runs `npm start`.
3. Set `PORT` in the Variables tab if needed (Railway injects it by default).
4. Click **Deploy** — your URL is shown in the dashboard.

### Docker

Build and run locally:

```bash
docker build -t bollywood-game .
docker run -p 3000:3000 bollywood-game
```

Deploy to any container host (Fly.io, Render, Railway, etc.) using the provided `Dockerfile`.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 |
| Server | Express.js 4 |
| Real-time | Socket.io 4 |
| Frontend | Vanilla HTML / CSS / JS |
| Fonts | Google Fonts (Poppins, Cinzel Decorative) |
| Audio | Web Audio API (no files needed) |

---

## Dataset

`data/movies.json` contains **94 popular Bollywood films (2000–2024)**, each with:

```json
{
  "movie":    "3 Idiots",
  "hero":     "Aamir Khan",
  "heroine":  "Kareena Kapoor",
  "song":     "All Is Well",
  "year":     2009,
  "director": "Rajkumar Hirani",
  "plot":     "Three engineering students challenge the rat race..."
}
```

You can add or edit entries in `data/movies.json` at any time — no build step required.
