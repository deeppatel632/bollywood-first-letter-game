/**
 * gameEngine.js
 * Core game loop: round start, turn timer, guess handling, hint scheduling.
 */

const movies       = require('../data/movies.json');
const scoreManager = require('./scoreManager');
const { buildHints } = require('./hintSystem');

// roomCode → { turnInterval, hintTimeouts[] }
const timers = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

function getRandomMovie(room) {
  let pool = movies.filter(m => !room.usedMovies.includes(m.movie));
  if (pool.length === 0) {
    room.usedMovies = [];
    pool = movies;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function scoreboard(room) {
  return room.players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map(p => ({ id: p.id, name: p.name, score: p.score }));
}

function clearRoomTimers(roomCode) {
  const t = timers.get(roomCode);
  if (!t) return;
  if (t.turnInterval)   clearInterval(t.turnInterval);
  if (t.hintTimeouts)   t.hintTimeouts.forEach(x => clearTimeout(x));
  timers.delete(roomCode);
}

// ─── Public API ───────────────────────────────────────────────────────────────

function startGame(io, room) {
  room.state = 'playing';
  room.roundNumber = 0;
  room.players.forEach(p => (p.score = 0));
  startRound(io, room);
}

function startRound(io, room) {
  clearRoomTimers(room.code);

  const movie = getRandomMovie(room);
  room.usedMovies.push(movie.movie);
  room.currentMovie      = movie;
  room.wrongGuesses      = 0;
  room.guessedParts      = { hero: false, heroine: false, song: false, movie: false };
  room.hintsRevealed     = [];
  room.roundStartTime    = Date.now();
  room.roundNumber      += 1;

  const hints = buildHints(movie, room.guessedParts);

  io.to(room.code).emit('roundStart', {
    hints,
    wrongGuesses:   room.wrongGuesses,
    roundNumber:    room.roundNumber,
    currentPlayer:  room.players[room.currentPlayerIndex],
    scores:         scoreboard(room),
  });

  startTurnTimer(io, room);
  scheduleHints(io, room);
}

function startTurnTimer(io, room) {
  const TURN_SECONDS = 10;
  let timeLeft = TURN_SECONDS;

  const t = timers.get(room.code) || { hintTimeouts: [] };

  if (t.turnInterval) clearInterval(t.turnInterval);

  io.to(room.code).emit('timerUpdate', {
    timeLeft,
    currentPlayer: room.players[room.currentPlayerIndex],
  });

  t.turnInterval = setInterval(() => {
    timeLeft--;
    io.to(room.code).emit('timerUpdate', {
      timeLeft,
      currentPlayer: room.players[room.currentPlayerIndex],
    });

    if (timeLeft <= 0) {
      clearInterval(t.turnInterval);
      t.turnInterval = null;
      advanceTurn(io, room);
    }
  }, 1000);

  timers.set(room.code, t);
}

function advanceTurn(io, room) {
  room.currentPlayerIndex =
    (room.currentPlayerIndex + 1) % room.players.length;

  io.to(room.code).emit('turnChange', {
    currentPlayer: room.players[room.currentPlayerIndex],
  });

  startTurnTimer(io, room);
}

function scheduleHints(io, room) {
  const t = timers.get(room.code) || { hintTimeouts: [], turnInterval: null };

  const push = (delay, type, value) => {
    t.hintTimeouts.push(
      setTimeout(() => {
        const r = room; // closure over live room
        if (r.state !== 'playing') return;
        r.hintsRevealed.push(type);
        io.to(r.code).emit('hintRevealed', { type, value });
      }, delay)
    );
  };

  push(20000, 'year',     room.currentMovie.year);
  push(30000, 'director', room.currentMovie.director);
  push(40000, 'plot',     room.currentMovie.plot);

  timers.set(room.code, t);
}

function handleGuess(io, room, playerId, rawGuess) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || room.state !== 'playing') return;

  const guess  = normalize(rawGuess);
  const movie  = room.currentMovie;
  const gp     = room.guessedParts;

  let correct    = false;
  let partGuessed = null;
  let delta       = 0;

  if (!gp.movie   && guess === normalize(movie.movie))   { gp.movie   = true; partGuessed = 'movie';   correct = true; }
  else if (!gp.hero    && guess === normalize(movie.hero))    { gp.hero    = true; partGuessed = 'hero';    correct = true; }
  else if (!gp.heroine && guess === normalize(movie.heroine)) { gp.heroine = true; partGuessed = 'heroine'; correct = true; }
  else if (!gp.song    && guess === normalize(movie.song))    { gp.song    = true; partGuessed = 'song';    correct = true; }

  if (correct) {
    delta = scoreManager.addScore(player, partGuessed);
  } else {
    delta = scoreManager.addScore(player, 'wrong');
    room.wrongGuesses = Math.min(9, room.wrongGuesses + 1);
  }

  const hints    = buildHints(movie, gp);
  const allDone  = gp.hero && gp.heroine && gp.movie && gp.song;
  const livesOut = room.wrongGuesses >= 9;

  io.to(room.code).emit('guessResult', {
    playerId,
    playerName:   player.name,
    guess:        rawGuess,
    correct,
    partGuessed,
    delta,
    hints,
    wrongGuesses: room.wrongGuesses,
    scores:       scoreboard(room),
  });

  if (allDone || livesOut) {
    endRound(io, room);
    return;
  }

  // Correct guesser gets an immediate fresh turn
  if (correct) {
    const t = timers.get(room.code);
    if (t && t.turnInterval) {
      clearInterval(t.turnInterval);
      t.turnInterval = null;
    }
    startTurnTimer(io, room);
  }
}

function endRound(io, room) {
  clearRoomTimers(room.code);
  io.to(room.code).emit('roundEnd', {
    movie:  room.currentMovie,
    scores: scoreboard(room),
  });
  // Auto-start next round after 6 s
  setTimeout(() => {
    if (room.state === 'playing') startRound(io, room);
  }, 6000);
}

function skipMovie(io, room) {
  clearRoomTimers(room.code);
  io.to(room.code).emit('movieSkipped', {
    movie:  room.currentMovie,
    scores: scoreboard(room),
  });
  setTimeout(() => {
    if (room.state === 'playing') startRound(io, room);
  }, 3000);
}

function restartRound(io, room) {
  startRound(io, room);
}

module.exports = { startGame, handleGuess, skipMovie, restartRound, clearRoomTimers };
