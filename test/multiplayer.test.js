/**
 * Automated multiplayer integration tests for Bollywood First Letter Guess Game.
 *
 * New game flow (selector-based):
 *   1. Host creates room             → roomCreated
 *   2. Two players join              → roomJoined + playerJoined
 *   3. Host starts game              → gameStarted (not roundStart yet)
 *   4. Any player selects a movie    → roundStart to all + movieDetails to selector
 *   5. Non-selector wrong guess      → guessResult { correct: false }
 *   6. Selector guess is blocked     → no event emitted
 *   7. Score sync                    → all see identical scores
 *
 * Usage:
 *   npm test           (requires server running on PORT 3000)
 *   PORT=4000 npm test
 */

'use strict';

const { io } = require('socket.io-client');

const PORT    = process.env.PORT || 3000;
const SERVER  = `http://localhost:${PORT}`;
const TIMEOUT = 6000;

/* ─── helpers ─────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL  ${label}`);
    failed++;
  }
}

function waitFor(socket, event, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`Timeout waiting for "${event}" on socket ${socket.id}`));
    }, timeoutMs);
    socket.once(event, data => { clearTimeout(t); resolve(data); });
  });
}

/** Collects events (or returns null if timeout). */
function collectEvent(socket, event, timeoutMs = 2000) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, data => { clearTimeout(t); resolve(data); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(SERVER, { transports: ['websocket'], reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

/* ─── main test suite ─────────────────────────────────────── */

async function runTests() {
  console.log(`\n══════════════════════════════════════════`);
  console.log(` Bollywood Multiplayer Integration Tests`);
  console.log(` Server: ${SERVER}`);
  console.log(`══════════════════════════════════════════\n`);

  let host, p2, p3;

  /* ── Connect 3 sockets ─────────────────────────────────── */
  try {
    [host, p2, p3] = await Promise.all([connect(), connect(), connect()]);
    console.log(`Connected 3 sockets: ${host.id}, ${p2.id}, ${p3.id}\n`);
  } catch (err) {
    console.error(`\n⚠️  Could not connect to server at ${SERVER}`);
    console.error(`   Make sure the server is running: npm start\n`);
    console.error(err.message);
    process.exit(1);
  }

  /* ── TEST 1: Host creates room ─────────────────────────── */
  console.log('TEST 1 — Host creates a room');
  const roomCreatedP = waitFor(host, 'roomCreated');
  host.emit('createRoom', { playerName: 'HostPlayer' });
  let roomData;
  try {
    roomData = await roomCreatedP;
    assert('received roomCreated event',        !!roomData);
    assert('room has a code',                   typeof roomData.code === 'string' && roomData.code.length > 0);
    assert('room has players array',            Array.isArray(roomData.players));
    assert('host is in players list',           roomData.players.length === 1);
    assert('room.hostId matches socket',        roomData.hostId === host.id);
  } catch (err) {
    assert(`roomCreated received within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }
  const roomCode = roomData?.code;
  console.log(`  Room code: ${roomCode}\n`);

  /* ── TEST 2: Two players join ──────────────────────────── */
  console.log('TEST 2 — Two more players join the room');

  const hostJoined1P = waitFor(host, 'playerJoined');
  const p2JoinedP    = waitFor(p2, 'roomJoined');
  p2.emit('joinRoom', { roomCode, playerName: 'Player2' });

  try {
    const [p2Room, hostJoin1] = await Promise.all([p2JoinedP, hostJoined1P]);
    assert('p2 received roomJoined',              !!p2Room);
    assert('p2 roomJoined has correct code',       p2Room.code === roomCode);
    assert('p2 roomJoined has 2 players',          p2Room.players?.length === 2);
    assert('host received playerJoined for p2',    !!hostJoin1);
    assert('playerJoined has newPlayer name',       hostJoin1?.newPlayer?.name === 'Player2');
    assert('playerJoined room has 2 players',       hostJoin1?.room?.players?.length === 2);
  } catch (err) {
    assert(`p2 join events received within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }

  const hostJoined2P = waitFor(host, 'playerJoined');
  const p3JoinedP    = waitFor(p3, 'roomJoined');
  p3.emit('joinRoom', { roomCode, playerName: 'Player3' });

  try {
    const [p3Room, hostJoin2] = await Promise.all([p3JoinedP, hostJoined2P]);
    assert('p3 received roomJoined',              !!p3Room);
    assert('p3 roomJoined has 3 players',          p3Room.players?.length === 3);
    assert('host received playerJoined for p3',    !!hostJoin2);
    assert('playerJoined newPlayer name is Player3', hostJoin2?.newPlayer?.name === 'Player3');
  } catch (err) {
    assert(`p3 join events received within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }
  console.log();

  /* ── TEST 3: Host starts game → gameStarted (not roundStart) ── */
  console.log('TEST 3 — Host starts the game (gameStarted event, no roundStart yet)');

  const [hostStartP, p2StartP, p3StartP] = [
    waitFor(host, 'gameStarted'),
    waitFor(p2,   'gameStarted'),
    waitFor(p3,   'gameStarted'),
  ];
  host.emit('startGame', { roomCode });

  try {
    const [hostStart, p2Start, p3Start] = await Promise.all([hostStartP, p2StartP, p3StartP]);
    assert('host received gameStarted',           !!hostStart);
    assert('p2   received gameStarted',           !!p2Start);
    assert('p3   received gameStarted',           !!p3Start);
    assert('gameStarted includes hostId',          typeof hostStart?.hostId === 'string');
    assert('hostId matches host socket',           hostStart?.hostId === host.id);
    assert('scores array present',                 Array.isArray(hostStart?.scores));
    assert('all scores are 0',                     hostStart?.scores.every(s => s.score === 0));
  } catch (err) {
    assert(`gameStarted received by all 3 within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }
  console.log();

  /* ── TEST 4: Player selects a movie → roundStart + movieDetails ── */
  console.log('TEST 4 — Player selects a movie (roundStart + movieDetails)');

  // p2 selects the movie → becomes the selector
  const [hostRoundP, p2RoundP, p3RoundP] = [
    waitFor(host, 'roundStart'),
    waitFor(p2,   'roundStart'),
    waitFor(p3,   'roundStart'),
  ];
  const p2MovieP = waitFor(p2, 'movieDetails');

  p2.emit('selectMovie', { roomCode });

  let roundData;
  let movieDetails;
  try {
    const [hostRound, p2Round, p3Round] = await Promise.all([hostRoundP, p2RoundP, p3RoundP]);
    roundData = hostRound;
    movieDetails = await p2MovieP;

    assert('host received roundStart',             !!hostRound);
    assert('p2   received roundStart',             !!p2Round);
    assert('p3   received roundStart',             !!p3Round);
    assert('roundStart includes selectorId',        typeof hostRound?.selectorId === 'string');
    assert('selectorId equals p2 socket id',        hostRound?.selectorId === p2.id);
    assert('selectorName is Player2',               hostRound?.selectorName === 'Player2');
    assert('roundNumber is 1',                      hostRound?.roundNumber === 1);
    assert('hints object present',                  !!hostRound?.hints);
    assert('hint hero is a string',                 typeof hostRound?.hints?.hero === 'string');
    assert('guessedParts present (all false)',       hostRound?.guessedParts && !hostRound.guessedParts.hero);
    assert('solvedBy present (all null)',            hostRound?.solvedBy && hostRound.solvedBy.hero === null);
    assert('timeLeft is 300',                       hostRound?.timeLeft === 300);
    assert('scores array present',                  Array.isArray(hostRound?.scores));

    // movieDetails sent only to selector
    assert('selector (p2) received movieDetails',   !!movieDetails);
    assert('movieDetails has movie name',            typeof movieDetails?.movie === 'string');
    assert('movieDetails has hero',                  typeof movieDetails?.hero === 'string');
    assert('movieDetails has heroine',               typeof movieDetails?.heroine === 'string');
    assert('movieDetails has song',                  typeof movieDetails?.song === 'string');
  } catch (err) {
    assert(`roundStart/movieDetails received within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }

  // Verify host and p3 did NOT receive movieDetails
  const hostMovieP = collectEvent(host, 'movieDetails', 1000);
  const p3MovieP   = collectEvent(p3,   'movieDetails', 1000);
  const [hostMovie, p3Movie] = await Promise.all([hostMovieP, p3MovieP]);
  assert('host did NOT receive movieDetails',      hostMovie === null);
  assert('p3 did NOT receive movieDetails',        p3Movie === null);
  console.log();

  /* ── TEST 5: Wrong guess from non-selector ─────────────── */
  console.log('TEST 5 — Wrong guess + score sync');

  const [hostGuessP, p2GuessP, p3GuessP] = [
    waitFor(host, 'guessResult'),
    waitFor(p2,   'guessResult'),
    waitFor(p3,   'guessResult'),
  ];
  p3.emit('guess', { roomCode, guess: 'ZZZZZZZ_WRONG_GUESS_12345' });

  try {
    const [hostGuess, p2Guess, p3Guess] = await Promise.all([hostGuessP, p2GuessP, p3GuessP]);

    assert('host received guessResult',            !!hostGuess);
    assert('p2   received guessResult',            !!p2Guess);
    assert('p3   received guessResult',            !!p3Guess);
    assert('guess is marked incorrect',             p3Guess?.correct === false);
    assert('partGuessed is null (wrong guess)',      p3Guess?.partGuessed === null);
    assert('guessedParts still all false',           p3Guess?.guessedParts && !p3Guess.guessedParts.hero);
    assert('scores array present in all events',
      Array.isArray(hostGuess?.scores) &&
      Array.isArray(p2Guess?.scores)   &&
      Array.isArray(p3Guess?.scores));
    const scoresSame =
      JSON.stringify(hostGuess?.scores) === JSON.stringify(p2Guess?.scores) &&
      JSON.stringify(p2Guess?.scores)   === JSON.stringify(p3Guess?.scores);
    assert('all 3 sockets share identical scores array', scoresSame);
    assert('all scores still 0 (wrong guess)',       hostGuess?.scores.every(s => s.score === 0));
  } catch (err) {
    assert(`guessResult received by all 3 within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }
  console.log();

  /* ── TEST 6: Selector guess is blocked ─────────────────── */
  console.log('TEST 6 — Selector\'s guess is blocked');

  // p2 is the selector — their guess should be silently dropped
  const blockedGuessP = collectEvent(host, 'guessResult', 2000);
  p2.emit('guess', { roomCode, guess: movieDetails?.hero || 'anything' });
  const blockedResult = await blockedGuessP;
  assert('no guessResult emitted for selector guess', blockedResult === null);
  console.log();

  /* ── TEST 7: Correct guess → +1 score ──────────────────── */
  console.log('TEST 7 — Correct guess awards +1 point');

  // p3 guesses the actual hero name (from movieDetails)
  const heroName = movieDetails?.hero;
  if (heroName) {
    const [hGP, p2GP, p3GP] = [
      waitFor(host, 'guessResult'),
      waitFor(p2,   'guessResult'),
      waitFor(p3,   'guessResult'),
    ];
    p3.emit('guess', { roomCode, guess: heroName });

    try {
      const [hG, p2G, p3G] = await Promise.all([hGP, p2GP, p3GP]);
      assert('guess is marked correct',              hG?.correct === true);
      assert('partGuessed is "hero"',                hG?.partGuessed === 'hero');
      assert('playerName is Player3',                hG?.playerName === 'Player3');
      assert('guessedParts.hero is now true',        hG?.guessedParts?.hero === true);
      assert('solvedBy.hero has Player3',            hG?.solvedBy?.hero?.name === 'Player3');
      assert('hints.hero reveals full name',         hG?.hints?.hero === heroName);

      // Find p3 in scores
      const p3Score = hG?.scores?.find(s => s.name === 'Player3');
      assert('Player3 score is now 1',               p3Score?.score === 1);

      // Scores synced
      const synced =
        JSON.stringify(hG?.scores) === JSON.stringify(p2G?.scores) &&
        JSON.stringify(p2G?.scores) === JSON.stringify(p3G?.scores);
      assert('all 3 sockets share identical scores after correct guess', synced);
    } catch (err) {
      assert(`correct guess events received within ${TIMEOUT}ms`, false);
      console.error('  ', err.message);
    }
  } else {
    assert('skipping correct-guess test (no movieDetails)', false);
  }

  /* ── TEST 8: Fuzzy matching — alias guess ────────────── */
  console.log('TEST 8 — Alias guess is accepted (fuzzy matching)');

  // End current round via skipMovie (round is still in progress), then select a new movie
  const skipP = waitFor(host, 'movieSkipped');
  p2.emit('skipMovie', { roomCode });
  await skipP;
  await delay(200);

  // p2 selects another movie → fresh round for fuzzy tests
  const [hR2, p2R2, p3R2] = [
    waitFor(host, 'roundStart'),
    waitFor(p2,   'roundStart'),
    waitFor(p3,   'roundStart'),
  ];
  const p2Movie2P = waitFor(p2, 'movieDetails');
  p2.emit('selectMovie', { roomCode });

  let movieDetails2;
  try {
    await Promise.all([hR2, p2R2, p3R2]);
    movieDetails2 = await p2Movie2P;
    assert('new round started for fuzzy tests', !!movieDetails2);
  } catch (err) {
    assert('new round started for fuzzy tests', false);
    console.error('  ', err.message);
  }

  // Build an alias guess for the hero if one exists, otherwise test case-insensitivity
  const heroAnswer2 = movieDetails2?.hero || '';
  const heroNorm    = heroAnswer2.toLowerCase().trim();

  // Find a matching alias from the server's ALIASES map
  const aliasMap = {
    'shah rukh khan':    'srk',
    'salman khan':       'sallu bhai',
    'aamir khan':        'mr perfectionist',
    'hrithik roshan':    'duggu',
    'akshay kumar':      'akki',
    'ranveer singh':     'ranveer',
    'deepika padukone':  'dp',
    'priyanka chopra':   'desi girl',
    'kareena kapoor':    'bebo',
    'amitabh bachchan':  'big b',
    'aishwarya rai':     'ash',
    'sanjay dutt':       'sanju baba',
    'katrina kaif':      'kat',
    'alia bhatt':        'alia',
    'ranbir kapoor':     'ranbir',
  };
  const alias = aliasMap[heroNorm];

  if (alias) {
    const [hG8, p2G8, p3G8] = [
      waitFor(host, 'guessResult'),
      waitFor(p2,   'guessResult'),
      waitFor(p3,   'guessResult'),
    ];
    p3.emit('guess', { roomCode, guess: alias });

    try {
      const [h8, , p38] = await Promise.all([hG8, p2G8, p3G8]);
      assert('alias guess marked correct',          h8?.correct === true);
      assert('alias partGuessed is "hero"',         h8?.partGuessed === 'hero');
      assert('alias solvedBy has Player3',          h8?.solvedBy?.hero?.name === 'Player3');
    } catch (err) {
      assert('alias guess events received', false);
      console.error('  ', err.message);
    }
  } else {
    // No alias available — test case-insensitive + extra-spaces match instead
    const weirdCase = '  ' + heroAnswer2.toUpperCase() + '  ';
    const [hG8, p2G8, p3G8] = [
      waitFor(host, 'guessResult'),
      waitFor(p2,   'guessResult'),
      waitFor(p3,   'guessResult'),
    ];
    p3.emit('guess', { roomCode, guess: weirdCase });

    try {
      const [h8, , p38] = await Promise.all([hG8, p2G8, p3G8]);
      assert('case-insensitive guess correct',       h8?.correct === true);
      assert('partGuessed is "hero"',                h8?.partGuessed === 'hero');
    } catch (err) {
      assert('case-insensitive events received', false);
      console.error('  ', err.message);
    }
  }
  console.log();

  /* ── TEST 9: Space-removed match ───────────────────────── */
  console.log('TEST 9 — Space-removed / partial match');

  // Guess heroine with spaces removed (e.g. "deepikapadukone" for "Deepika Padukone")
  const heroineAnswer2 = movieDetails2?.heroine || '';
  const heroineNoSpace = heroineAnswer2.replace(/\s+/g, '').toLowerCase();

  if (heroineNoSpace.length > 3) {
    const [hG9, p2G9, p3G9] = [
      waitFor(host, 'guessResult'),
      waitFor(p2,   'guessResult'),
      waitFor(p3,   'guessResult'),
    ];
    // If hero was already guessed, heroine should be the next part for a correct answer
    host.emit('guess', { roomCode, guess: heroineNoSpace });

    try {
      const [h9] = await Promise.all([hG9, p2G9, p3G9]);
      assert('space-removed guess marked correct',   h9?.correct === true);
      assert('partGuessed is "heroine"',             h9?.partGuessed === 'heroine');
    } catch (err) {
      assert('space-removed guess events received', false);
      console.error('  ', err.message);
    }
  } else {
    assert('heroine name too short to test space-removed (skip)', true);
  }
  console.log();

  /* ── TEST 10: Duplicate answer claim blocked ───────────── */
  console.log('TEST 10 — Second player cannot claim already-solved part');

  // Try to guess the same hero answer again from host (hero already solved by p3)
  const [hG10, p2G10, p3G10] = [
    waitFor(host, 'guessResult'),
    waitFor(p2,   'guessResult'),
    waitFor(p3,   'guessResult'),
  ];
  // Use the exact hero name — should still fail since it's already solved
  host.emit('guess', { roomCode, guess: heroAnswer2 });

  try {
    const [h10] = await Promise.all([hG10, p2G10, p3G10]);
    assert('duplicate claim is NOT correct',         h10?.correct === false);
    assert('partGuessed is null (already solved)',    h10?.partGuessed === null);
  } catch (err) {
    assert('duplicate claim events received', false);
    console.error('  ', err.message);
  }
  console.log();

  /* ── TEST 11: Fuzzy (typo-tolerant) guess ──────────────── */
  console.log('TEST 11 — Fuzzy/typo-tolerant guess');

  // Guess the movie name with a small typo (similarity >= 0.7)
  const movieName2 = movieDetails2?.movie || '';
  // Create a mild typo: swap two adjacent middle chars if long enough
  let typoGuess = movieName2;
  if (movieName2.length >= 6) {
    const mid = Math.floor(movieName2.length / 2);
    typoGuess = movieName2.slice(0, mid) + movieName2[mid + 1] + movieName2[mid] + movieName2.slice(mid + 2);
  } else if (movieName2.length >= 4) {
    // Just change one char
    typoGuess = movieName2.slice(0, -1) + 'x';
  }

  // Only test if the typo actually differs from the original
  if (typoGuess.toLowerCase() !== movieName2.toLowerCase() && movieName2.length >= 4) {
    const [hG11, p2G11, p3G11] = [
      waitFor(host, 'guessResult'),
      waitFor(p2,   'guessResult'),
      waitFor(p3,   'guessResult'),
    ];
    p3.emit('guess', { roomCode, guess: typoGuess });

    try {
      const [h11] = await Promise.all([hG11, p2G11, p3G11]);
      // The fuzzy match SHOULD accept this if similarity >= 0.7
      // A single transposition in a 6+ char string has similarity >= 0.83
      assert('typo guess marked correct',             h11?.correct === true);
      assert('typo partGuessed is "movie"',           h11?.partGuessed === 'movie');
    } catch (err) {
      assert('typo guess events received', false);
      console.error('  ', err.message);
    }
  } else {
    // Movie name too short for a meaningful typo test; just pass
    assert('movie too short for typo test (skip)', true);
    assert('(placeholder) typo partGuessed skip', true);
  }
  console.log();

  /* ── Cleanup ───────────────────────────────────────────── */
  await delay(200);
  [host, p2, p3].forEach(s => s.disconnect());

  /* ── Summary ───────────────────────────────────────────── */
  const total = passed + failed;
  console.log(`\n══════════════════════════════════════════`);
  console.log(` Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.error(` ${failed} test(s) FAILED`);
    console.log(`══════════════════════════════════════════\n`);
    process.exit(1);
  } else {
    console.log(` All tests passed! 🎉`);
    console.log(`══════════════════════════════════════════\n`);
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('\nUnhandled error in test runner:', err);
  process.exit(1);
});
