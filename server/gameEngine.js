/**
 * gameEngine.js
 *
 * New game rules:
 *   - Any player can select a movie for the round (the "selector").
 *   - The selector cannot guess answers.
 *   - Other players guess: hero, heroine, movie, song.
 *   - Each correct guess = +1 point; each answer solved once only.
 *   - Round timer = 5 minutes. Round ends when timer hits 0 OR all 4 answers solved.
 */

'use strict';

const movies         = require('../data/movies.json');
const { buildHints } = require('./hintSystem');

// roomCode → { interval, hintTimeouts[] }
const timers = new Map();

const ROUND_SECONDS = 300; // 5 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function removeSpaces(str) {
  return str.replace(/\s+/g, '');
}

// Levenshtein distance
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Common Bollywood actor/movie aliases
const ALIASES = {
  'srk':              'shah rukh khan',
  'shahrukh':         'shah rukh khan',
  'shahrukh khan':    'shah rukh khan',
  'king khan':        'shah rukh khan',
  'sallu':            'salman khan',
  'sallu bhai':       'salman khan',
  'bhai':             'salman khan',
  'aamir':            'aamir khan',
  'mr perfectionist': 'aamir khan',
  'hrithik':          'hrithik roshan',
  'duggu':            'hrithik roshan',
  'akki':             'akshay kumar',
  'ranveer':          'ranveer singh',
  'deepika':          'deepika padukone',
  'dp':               'deepika padukone',
  'alia':             'alia bhatt',
  'pc':               'priyanka chopra',
  'desi girl':        'priyanka chopra',
  'katrina':          'katrina kaif',
  'kat':              'katrina kaif',
  'anushka':          'anushka sharma',
  'kareena':          'kareena kapoor',
  'bebo':             'kareena kapoor',
  'kajol':            'kajol',
  'vidya':            'vidya balan',
  'rani':             'rani mukerji',
  'madhuri':          'madhuri dixit',
  'preity':           'preity zinta',
  'shahid':           'shahid kapoor',
  'sanju':            'sanjay dutt',
  'sanju baba':       'sanjay dutt',
  'ranbir':           'ranbir kapoor',
  'saif':             'saif ali khan',
  'abhishek':         'abhishek bachchan',
  'amitabh':          'amitabh bachchan',
  'big b':            'amitabh bachchan',
  'varun':            'varun dhawan',
  'tiger':            'tiger shroff',
  'aishwarya':        'aishwarya rai',
  'ash':              'aishwarya rai',
  'sonam':            'sonam kapoor',
  'kangana':          'kangana ranaut',
  'irrfan':           'irrfan khan',
  'nawaz':            'nawazuddin siddiqui',
  'rajkumar':         'rajkumar rao',
  'vicky':            'vicky kaushal',
  'ayushmann':        'ayushmann khurrana',
  'k3g':              'kabhi khushi kabhie gham',
  'kkkg':             'kabhi khushi kabhie gham',
  'ddlj':             'dilwale dulhania le jayenge',
  'znmd':             'zindagi na milegi dobara',
  'yjhd':             'yeh jawaani hai deewani',
  '3 idiots':         'three idiots',
  'pk':               'pk',
  'rab ne':           'rab ne bana di jodi',
  'dce':              'dil chahta hai',
  'dch':              'dil chahta hai',
  'jwm':              'jab we met',
  'oso':              'om shanti om',
  'cdi':              'chak de india',
  'tzp':              'taare zameen par',
};

/**
 * matchAnswer — flexible answer matching.
 *   1. Exact normalized match → instant pass
 *   2. Alias lookup → compare resolved alias to answer
 *   3. Space-removed comparison
 *   4. Partial (first-name / substring) match — guess must be >= 3 chars
 *   5. Fuzzy similarity >= 0.7
 */
function matchAnswer(guess, answer) {
  const ng = normalize(guess);
  const na = normalize(answer);
  if (!ng || !na) return false;

  // 1. Exact
  if (ng === na) return true;

  // 2. Alias: resolve guess to canonical, then compare
  const aliasResolved = ALIASES[ng];
  if (aliasResolved && normalize(aliasResolved) === na) return true;

  // 3. Space-removed comparison
  if (removeSpaces(ng) === removeSpaces(na)) return true;

  // 4. Partial match — guess matches the first word(s) of the answer
  if (ng.length >= 3) {
    // Answer starts with guess (e.g. "shah rukh" matches "shah rukh khan")
    if (na.startsWith(ng + ' ') || na.startsWith(ng)) {
      // Require at least 50% of the answer length to avoid single-word gaming
      if (ng.length >= na.length * 0.5) return true;
    }
    // Without spaces
    const ngNoSp = removeSpaces(ng);
    const naNoSp = removeSpaces(na);
    if (naNoSp.startsWith(ngNoSp) && ngNoSp.length >= naNoSp.length * 0.5) return true;
  }

  // 5. Fuzzy similarity >= 0.7
  if (similarity(ng, na) >= 0.7) return true;

  // Also fuzzy on space-removed versions
  if (similarity(removeSpaces(ng), removeSpaces(na)) >= 0.7) return true;

  return false;
}

function getRandomMovie(room) {
  let pool = movies.filter(m => !room.usedMovies.includes(m.movie));
  if (pool.length === 0) { room.usedMovies = []; pool = movies; }
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
  if (t.interval)      clearInterval(t.interval);
  if (t.hintTimeouts)  t.hintTimeouts.forEach(x => clearTimeout(x));
  timers.delete(roomCode);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * startGame — host clicks Start. Resets scores, enters 'playing' state.
 * Players then pick a movie via selectMovie.
 */
function startGame(io, room) {
  room.state       = 'playing';
  room.roundNumber = 0;
  room.usedMovies  = [];
  room.selectorId  = null;
  room.currentMovie = null;
  room.players.forEach(p => (p.score = 0));

  io.to(room.code).emit('gameStarted', {
    hostId:  room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    scores:  scoreboard(room),
  });
}

/**
 * selectMovie — a player picks a random movie for this round.
 * They become the "selector" and cannot guess.
 */
function selectMovie(io, room, selectorId) {
  if (room.state !== 'playing') return;

  clearRoomTimers(room.code);

  const selector = room.players.find(p => p.id === selectorId);
  if (!selector) return;

  const movie = getRandomMovie(room);
  room.usedMovies.push(movie.movie);

  room.currentMovie   = movie;
  room.selectorId     = selectorId;
  room.guessedParts   = { hero: false, heroine: false, song: false, movie: false };
  room.solvedBy       = { hero: null, heroine: null, song: null, movie: null };
  room.hintsRevealed  = [];
  room.roundStartTime = Date.now();
  room.roundNumber   += 1;
  room.timeLeft       = ROUND_SECONDS;

  const hints = buildHints(movie, room.guessedParts);

  io.to(room.code).emit('roundStart', {
    hints,
    hostId:       room.hostId,
    selectorId:   room.selectorId,
    selectorName: selector.name,
    roundNumber:  room.roundNumber,
    timeLeft:     ROUND_SECONDS,
    guessedParts: room.guessedParts,
    solvedBy:     room.solvedBy,
    scores:       scoreboard(room),
  });

  // Send full movie details only to the selector
  const selectorSocket = io.sockets.sockets.get(selectorId);
  if (selectorSocket) {
    selectorSocket.emit('movieDetails', {
      movie:    movie.movie,
      hero:     movie.hero,
      heroine:  movie.heroine,
      song:     movie.song,
      year:     movie.year,
      director: movie.director,
      plot:     movie.plot,
    });
  }

  startRoundTimer(io, room);
  scheduleHints(io, room);
}

function startRoundTimer(io, room) {
  const existing = timers.get(room.code);
  const t = { interval: null, hintTimeouts: existing?.hintTimeouts || [] };

  room.timeLeft = ROUND_SECONDS;

  t.interval = setInterval(() => {
    if (!room.players.length || room.state !== 'playing') {
      clearInterval(t.interval);
      t.interval = null;
      return;
    }
    room.timeLeft--;
    io.to(room.code).emit('timerUpdate', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(t.interval);
      t.interval = null;
      endRound(io, room);
    }
  }, 1000);

  timers.set(room.code, t);
}

function scheduleHints(io, room) {
  const t = timers.get(room.code) || { interval: null, hintTimeouts: [] };

  const push = (delay, type, value) => {
    t.hintTimeouts.push(
      setTimeout(() => {
        if (room.state !== 'playing' || !room.currentMovie) return;
        room.hintsRevealed.push({ type, value });
        io.to(room.code).emit('hintRevealed', { type, value });
      }, delay)
    );
  };

  // Reveal extra hints at 1 min, 2 min, 3 min
  push(60000,  'year',     room.currentMovie.year);
  push(120000, 'director', room.currentMovie.director);
  push(180000, 'plot',     room.currentMovie.plot);

  timers.set(room.code, t);
}

/**
 * handleGuess — any player except the selector can guess.
 * +1 point per correct answer. Each answer solved once only.
 */
function handleGuess(io, room, playerId, rawGuess) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || room.state !== 'playing' || !room.currentMovie) return;

  // Selector cannot guess
  if (playerId === room.selectorId) return;

  const movie = room.currentMovie;
  const gp    = room.guessedParts;

  let correct     = false;
  let partGuessed = null;

  if      (!gp.movie   && matchAnswer(rawGuess, movie.movie))   { gp.movie   = true; partGuessed = 'movie';   correct = true; }
  else if (!gp.hero    && matchAnswer(rawGuess, movie.hero))    { gp.hero    = true; partGuessed = 'hero';    correct = true; }
  else if (!gp.heroine && matchAnswer(rawGuess, movie.heroine)) { gp.heroine = true; partGuessed = 'heroine'; correct = true; }
  else if (!gp.song    && matchAnswer(rawGuess, movie.song))    { gp.song    = true; partGuessed = 'song';    correct = true; }

  if (correct) {
    player.score += 1;
    room.solvedBy[partGuessed] = { id: player.id, name: player.name };
  }

  const hints   = buildHints(movie, gp);
  const allDone = gp.hero && gp.heroine && gp.movie && gp.song;

  io.to(room.code).emit('guessResult', {
    playerId,
    playerName:   player.name,
    guess:        rawGuess,
    correct,
    partGuessed,
    hints,
    guessedParts: gp,
    solvedBy:     room.solvedBy,
    scores:       scoreboard(room),
  });

  if (allDone) {
    endRound(io, room);
  }
}

function endRound(io, room) {
  clearRoomTimers(room.code);

  io.to(room.code).emit('roundEnd', {
    movie:        room.currentMovie,
    guessedParts: room.guessedParts,
    solvedBy:     room.solvedBy,
    scores:       scoreboard(room),
  });

  room.currentMovie = null;
  room.selectorId   = null;
}

function skipMovie(io, room) {
  clearRoomTimers(room.code);

  io.to(room.code).emit('movieSkipped', {
    movie:  room.currentMovie,
    scores: scoreboard(room),
  });

  room.currentMovie = null;
  room.selectorId   = null;
}

/**
 * getGameState — snapshot for mid-game joiners.
 */
function getGameState(room) {
  if (!room.currentMovie) {
    return {
      phase:       'selecting',
      hostId:      room.hostId,
      scores:      scoreboard(room),
      roundNumber: room.roundNumber,
    };
  }
  return {
    phase:         'guessing',
    hints:         buildHints(room.currentMovie, room.guessedParts),
    hostId:        room.hostId,
    selectorId:    room.selectorId,
    selectorName:  (room.players.find(p => p.id === room.selectorId) || {}).name || '?',
    roundNumber:   room.roundNumber,
    timeLeft:      room.timeLeft || 0,
    guessedParts:  room.guessedParts,
    solvedBy:      room.solvedBy,
    scores:        scoreboard(room),
    hintsRevealed: room.hintsRevealed || [],
  };
}

module.exports = {
  startGame,
  selectMovie,
  handleGuess,
  endRound,
  skipMovie,
  getGameState,
  clearRoomTimers,
};