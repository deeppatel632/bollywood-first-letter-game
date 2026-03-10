/**
 * Automated multiplayer integration test for Bollywood First Letter Guess Game.
 *
 * Usage:
 *   npm test           (requires server already running on PORT 3000)
 *   PORT=4000 npm test (custom port)
 *
 * Tests:
 *   1. Host creates a room           → receives roomCreated with code
 *   2. Two players join              → both receive roomJoined; host receives playerJoined × 2
 *   3. Host starts game              → all 3 sockets receive roundStart with hostId + hints
 *   4. Non-host makes wrong guess    → all 3 receive guessResult { correct: false, wrongGuesses > 0 }
 *   5. Score sync                    → all 3 receive identical scores array in guessResult
 */

'use strict';

const { io } = require('socket.io-client');

const PORT    = process.env.PORT || 3000;
const SERVER  = `http://localhost:${PORT}`;
const TIMEOUT = 6000; // ms per assertion

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
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

  // Host listens for both playerJoined events
  const hostJoined1P  = waitFor(host, 'playerJoined');
  // p2 listens for roomJoined
  const p2JoinedP     = waitFor(p2, 'roomJoined');

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

  // p3 joins
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

  /* ── TEST 3: Host starts game ──────────────────────────── */
  console.log('TEST 3 — Host starts the game');

  const [hostRoundP, p2RoundP, p3RoundP] = [
    waitFor(host, 'roundStart'),
    waitFor(p2,   'roundStart'),
    waitFor(p3,   'roundStart'),
  ];
  host.emit('startGame', { roomCode });

  try {
    const [hostRound, p2Round, p3Round] = await Promise.all([hostRoundP, p2RoundP, p3RoundP]);

    assert('host received roundStart',             !!hostRound);
    assert('p2   received roundStart',             !!p2Round);
    assert('p3   received roundStart',             !!p3Round);
    assert('roundStart includes hostId',            typeof hostRound?.hostId === 'string');
    assert('all sockets share same hostId',
      hostRound?.hostId === p2Round?.hostId && p2Round?.hostId === p3Round?.hostId);
    assert('hints object present',                  !!hostRound?.hints);
    assert('hint hero is a single char or word',    typeof hostRound?.hints?.hero === 'string');
    assert('scores array present',                  Array.isArray(hostRound?.scores));
    assert('roundNumber is 1',                      hostRound?.roundNumber === 1);
    assert('currentPlayer is present',              !!hostRound?.currentPlayer?.name);
  } catch (err) {
    assert(`roundStart received by all 3 within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }
  console.log();

  /* ── TEST 4 & 5: Wrong guess + score sync ──────────────── */
  console.log('TEST 4 & 5 — Wrong guess + score synchronisation');

  // Give a definitely-wrong guess from p2
  const [hostGuessP, p2GuessP, p3GuessP] = [
    waitFor(host, 'guessResult'),
    waitFor(p2,   'guessResult'),
    waitFor(p3,   'guessResult'),
  ];
  p2.emit('guess', { roomCode, guess: 'ZZZZZZZ_WRONG_GUESS_12345' });

  try {
    const [hostGuess, p2Guess, p3Guess] = await Promise.all([hostGuessP, p2GuessP, p3GuessP]);

    assert('host received guessResult',            !!hostGuess);
    assert('p2   received guessResult',            !!p2Guess);
    assert('p3   received guessResult',            !!p3Guess);
    assert('guess is marked incorrect',             p2Guess?.correct === false);
    assert('wrongGuesses incremented',              p2Guess?.wrongGuesses >= 1);
    assert('all 3 see same wrongGuesses count',
      hostGuess?.wrongGuesses === p2Guess?.wrongGuesses &&
      p2Guess?.wrongGuesses  === p3Guess?.wrongGuesses);
    assert('scores array present in all events',
      Array.isArray(hostGuess?.scores) &&
      Array.isArray(p2Guess?.scores)   &&
      Array.isArray(p3Guess?.scores));
    // Verify score arrays are identical (synced)
    const scoresSame =
      JSON.stringify(hostGuess?.scores) === JSON.stringify(p2Guess?.scores) &&
      JSON.stringify(p2Guess?.scores)   === JSON.stringify(p3Guess?.scores);
    assert('all 3 sockets share identical scores array', scoresSame);
  } catch (err) {
    assert(`guessResult received by all 3 within ${TIMEOUT}ms`, false);
    console.error('  ', err.message);
  }

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
