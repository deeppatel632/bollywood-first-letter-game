/* ─────────────────────────────────────────────────────────────
   Bollywood First Letter Guess Game — Client
   ───────────────────────────────────────────────────────────── */

'use strict';

// ═══ State ═══════════════════════════════════════════════════
const state = {
  socket:               null,
  roomCode:             null,
  playerName:           null,
  isHost:               false,
  myId:                 null,
  currentPlayerName:    null,
  wrongGuesses:         0,
  timerMax:             10,
  timerLeft:            10,
  overlayCountdown:     null,
  guessToastTimer:      null,
};

// ═══ Audio (Web Audio API) ═══════════════════════════════════
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', gain = 0.18) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const vol  = ctx.createGain();
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    vol.gain.setValueAtTime(gain, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function playSuccess() {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.18, 'sine', 0.2), i * 80));
}

function playWrong() {
  playTone(180, 0.35, 'sawtooth', 0.14);
}

function playTick() {
  playTone(880, 0.06, 'square', 0.07);
}

function playRoundEnd() {
  [784, 659, 523, 392].forEach((f, i) => setTimeout(() => playTone(f, 0.22, 'sine', 0.15), i * 90));
}

function playHintReveal() {
  [440, 554, 659].forEach((f, i) => setTimeout(() => playTone(f, 0.14, 'sine', 0.13), i * 70));
}

// ═══ DOM references ══════════════════════════════════════════
const $ = id => document.getElementById(id);

const screens = {
  lobby:   $('lobby-screen'),
  waiting: $('waiting-screen'),
  game:    $('game-screen'),
};

// ═══ Screen management ═══════════════════════════════════════
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ═══ Initialise ══════════════════════════════════════════════
function init() {
  state.socket = io();
  bindSocketEvents();
  bindUIEvents();
}

// ═══════════════════════════════════════════════════════════════
//  UI EVENT BINDINGS
// ═══════════════════════════════════════════════════════════════
function bindUIEvents() {
  // Tab switching
  $('tab-create').addEventListener('click', () => switchTab('create'));
  $('tab-join').addEventListener('click',   () => switchTab('join'));

  // Lobby actions
  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click',   joinRoom);

  // Enter key support in lobby inputs
  ['create-name'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
  });
  ['join-name', 'join-code'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  });

  // Waiting room
  $('btn-copy').addEventListener('click', copyRoomCode);
  $('btn-start-game').addEventListener('click', () => {
    state.socket.emit('startGame', { roomCode: state.roomCode });
  });

  // Game controls
  $('btn-guess').addEventListener('click', submitGuess);
  $('guess-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });

  $('btn-skip').addEventListener('click', () => {
    state.socket.emit('skipMovie', { roomCode: state.roomCode });
  });
  $('btn-restart').addEventListener('click', () => {
    state.socket.emit('restartRound', { roomCode: state.roomCode });
  });

  // Chat
  $('btn-chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

function switchTab(tab) {
  ['create', 'join'].forEach(t => {
    $(`tab-${t}`).classList.toggle('active', t === tab);
    $(`panel-${t}`).classList.toggle('active', t === tab);
  });
  $('lobby-error').textContent = '';
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET EVENT BINDINGS
// ═══════════════════════════════════════════════════════════════
function bindSocketEvents() {
  const s = state.socket;

  s.on('connect', () => { state.myId = s.id; });

  s.on('roomCreated',  onRoomCreated);
  s.on('playerJoined', onPlayerJoined);
  s.on('playerLeft',   onPlayerLeft);
  s.on('roundStart',   onRoundStart);
  s.on('timerUpdate',  onTimerUpdate);
  s.on('turnChange',   onTurnChange);
  s.on('guessResult',  onGuessResult);
  s.on('hintRevealed', onHintRevealed);
  s.on('roundEnd',     onRoundEnd);
  s.on('movieSkipped', onMovieSkipped);
  s.on('chatMessage',  onChatMessage);
  s.on('gameError',    onGameError);
}

// ═══════════════════════════════════════════════════════════════
//  LOBBY ACTIONS
// ═══════════════════════════════════════════════════════════════
function createRoom() {
  const name = $('create-name').value.trim();
  if (!name) { showLobbyError('Please enter your name.'); return; }
  state.playerName = name;
  state.socket.emit('createRoom', { playerName: name });
}

function joinRoom() {
  const name = $('join-name').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if (!name) { showLobbyError('Please enter your name.'); return; }
  if (!code || code.length < 4) { showLobbyError('Please enter a valid room code.'); return; }
  state.playerName = name;
  state.socket.emit('joinRoom', { roomCode: code, playerName: name });
}

function showLobbyError(msg) {
  $('lobby-error').textContent = msg;
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET HANDLERS
// ═══════════════════════════════════════════════════════════════
function onRoomCreated(room) {
  state.roomCode = room.code;
  state.isHost   = true;
  renderWaitingRoom(room);
  showScreen('waiting');
}

function onPlayerJoined(room) {
  if (screens.waiting.classList.contains('active')) {
    renderWaitingRoom(room);
  }
  // Update host status in case of reconnect / host change
  state.isHost = room.hostId === state.myId;
  addChatSystem(`${room.players[room.players.length - 1].name} joined the room.`);
  showNotif(`👋 ${room.players[room.players.length - 1].name} joined!`);
}

function onPlayerLeft(room) {
  if (screens.waiting.classList.contains('active')) {
    renderWaitingRoom(room);
  }
  updateScoreboard(room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
  addChatSystem('A player left the room.');
  // Host may have changed
  state.isHost = room.hostId === state.myId;
  toggleHostControls();
}

function onRoundStart(data) {
  showScreen('game');
  $('round-badge').textContent     = `Round ${data.roundNumber}`;
  $('room-code-badge').textContent = state.roomCode;

  // Reset BOLLYWOOD lives
  state.wrongGuesses = 0;
  renderBollywoodLives(0);

  // Update hints
  renderHints(data.hints, { hero: false, heroine: false, song: false, movie: false });

  // Clear extra hints
  ['hint-year', 'hint-director', 'hint-plot'].forEach(id => $(id).classList.add('hidden'));

  // Set current player
  state.currentPlayerName = data.currentPlayer.name;
  $('current-turn-name').textContent = data.currentPlayer.name;

  // Scoreboard
  updateScoreboard(data.scores);

  // Toggle host controls
  state.isHost = (data.currentPlayer.id !== undefined); // re-checked via state
  toggleHostControls();

  // Hide overlay
  hideOverlay();

  // Reset guess input
  $('guess-input').value = '';
  hideGuessToast();

  addChatSystem(`🎬 Round ${data.roundNumber} started!`);
}

function onTimerUpdate(data) {
  const t = data.timeLeft;
  state.timerLeft = t;
  $('timer-count').textContent = t;

  // SVG arc: circumference of r=26 circle ≈ 163.4
  const C      = 163.4;
  const offset = C - (C * (t / state.timerMax));
  const arc    = $('timer-arc');
  arc.style.strokeDashoffset = offset;

  const isUrgent = t <= 3;
  $('timer-count').classList.toggle('urgent', isUrgent);
  arc.classList.toggle('urgent', isUrgent);

  if (t <= 3 && t > 0) playTick();

  // Also show whose turn it is
  if (data.currentPlayer) {
    state.currentPlayerName = data.currentPlayer.name;
    $('current-turn-name').textContent = data.currentPlayer.name;
  }
}

function onTurnChange(data) {
  state.currentPlayerName = data.currentPlayer.name;
  $('current-turn-name').textContent = data.currentPlayer.name;
  addChatSystem(`⏩ ${data.currentPlayer.name}'s turn.`);
}

function onGuessResult(data) {
  if (data.correct) {
    playSuccess();
    const labels = { movie: '🎬 Movie', hero: '🎭 Hero', heroine: '💃 Heroine', song: '🎵 Song' };
    showGuessToast(
      `✅ ${data.playerName} guessed the ${labels[data.partGuessed] || data.partGuessed}! (+${data.delta})`,
      'correct'
    );
    addChatSystem(`✅ ${data.playerName} guessed "${data.guess}" correctly! (+${data.delta} pts)`);

    // Reveal card
    revealHintCard(data.partGuessed, getFullValueForPart(data.partGuessed, data.hints));
  } else {
    playWrong();
    state.wrongGuesses = data.wrongGuesses;
    renderBollywoodLives(data.wrongGuesses);
    showGuessToast(`❌ ${data.playerName}: "${data.guess}" — wrong! (${data.delta}pts)`, 'wrong');
    addChatSystem(`❌ ${data.playerName} guessed "${data.guess}" — wrong.`);
  }

  // Update all hints (in case a new part was revealed)
  if (data.hints) syncHints(data.hints);
  updateScoreboard(data.scores);
}

function onHintRevealed(data) {
  playHintReveal();
  const map = {
    year:     { id: 'hint-year',     inner: `📅 <b id="yr">${data.value}</b>` },
    director: { id: 'hint-director', inner: `🎥 <b id="dir">${data.value}</b>` },
    plot:     { id: 'hint-plot',     inner: `📖 <b id="plt">${data.value}</b>` },
  };
  const entry = map[data.type];
  if (entry) {
    const el = $(entry.id);
    el.innerHTML = entry.inner;
    el.classList.remove('hidden');
  }
  showNotif(`💡 New hint: ${data.type} revealed!`, 'good');
  addChatSystem(`💡 Hint revealed: ${data.type}`);
}

function onRoundEnd(data) {
  playRoundEnd();
  showRoundEndOverlay(data);
  addChatSystem(`🏁 Round over! Movie was: ${data.movie.movie}`);

  // Start overlay countdown
  let count = 6;
  $('next-countdown').textContent = count;
  clearInterval(state.overlayCountdown);
  state.overlayCountdown = setInterval(() => {
    count--;
    $('next-countdown').textContent = count;
    if (count <= 0) {
      clearInterval(state.overlayCountdown);
      hideOverlay();
    }
  }, 1000);
}

function onMovieSkipped(data) {
  showNotif(`⏭ Movie skipped: ${data.movie.movie}`);
  addChatSystem(`⏭ Host skipped the movie. It was: ${data.movie.movie}`);
  setTimeout(hideOverlay, 3000);
}

function onChatMessage(data) {
  addChatMessage(data.playerName, data.message, false);
}

function onGameError(msg) {
  // Could be on lobby or mid-game
  if (screens.lobby.classList.contains('active')) {
    showLobbyError(msg);
  } else {
    showNotif(`⚠ ${msg}`, 'bad');
  }
}

// ═══════════════════════════════════════════════════════════════
//  GAME ACTIONS
// ═══════════════════════════════════════════════════════════════
function submitGuess() {
  const val = $('guess-input').value.trim();
  if (!val) return;
  state.socket.emit('guess', { roomCode: state.roomCode, guess: val });
  $('guess-input').value = '';
  $('guess-input').focus();
}

function sendChat() {
  const val = $('chat-input').value.trim();
  if (!val) return;
  state.socket.emit('chat', { roomCode: state.roomCode, message: val });
  $('chat-input').value = '';
}

function copyRoomCode() {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    showNotif('📋 Room code copied!', 'good');
  }).catch(() => {
    showNotif(`Room code: ${state.roomCode}`);
  });
}

// ═══════════════════════════════════════════════════════════════
//  RENDER HELPERS
// ═══════════════════════════════════════════════════════════════

function renderWaitingRoom(room) {
  state.roomCode = room.code;
  state.isHost   = room.hostId === state.myId;
  $('display-code').textContent = room.code;

  const list = $('waiting-player-list');
  list.innerHTML = '';
  room.players.forEach(p => {
    const pill = document.createElement('span');
    pill.className = 'waiting-player-pill' + (p.id === room.hostId ? ' host' : '');
    pill.textContent = p.name;
    list.appendChild(pill);
  });

  $('host-controls').classList.toggle('hidden', !state.isHost);
  $('waiting-msg').classList.toggle('hidden', state.isHost);
}

function renderBollywoodLives(wrongCount) {
  document.querySelectorAll('.bw-letter').forEach((el, i) => {
    el.classList.toggle('lost', i < wrongCount);
  });
}

function renderHints(hints, guessedParts) {
  const parts = ['hero', 'heroine', 'movie', 'song'];
  parts.forEach(part => {
    const letterEl  = $(`hint-${part}`);
    const fullEl    = $(`full-${part}`);
    const cardEl    = $(`card-${part}`);

    if (guessedParts[part]) {
      letterEl.textContent = hints[part][0].toUpperCase();
      fullEl.textContent   = hints[part];
      fullEl.classList.remove('hidden');
      cardEl.classList.add('guessed');
    } else {
      letterEl.textContent = hints[part];
      fullEl.textContent   = '';
      fullEl.classList.add('hidden');
      cardEl.classList.remove('guessed');
    }
  });
}

function syncHints(hints) {
  // Called on guessResult — only reveal newly guessed cards
  const parts = ['hero', 'heroine', 'movie', 'song'];
  parts.forEach(part => {
    const letterEl = $(`hint-${part}`);
    const fullEl   = $(`full-${part}`);
    const cardEl   = $(`card-${part}`);

    // If the hint shows the full word (length > 1), it was guessed
    const isRevealed = hints[part] && hints[part].length > 1;
    if (isRevealed && !cardEl.classList.contains('guessed')) {
      letterEl.textContent = hints[part][0].toUpperCase();
      fullEl.textContent   = hints[part];
      fullEl.classList.remove('hidden');
      cardEl.classList.add('guessed');
    } else if (!isRevealed) {
      letterEl.textContent = hints[part];
    }
  });
}

function revealHintCard(part, fullText) {
  const cardEl   = $(`card-${part}`);
  const letterEl = $(`hint-${part}`);
  const fullEl   = $(`full-${part}`);
  if (fullText) {
    letterEl.textContent = fullText[0].toUpperCase();
    fullEl.textContent   = fullText;
  }
  fullEl.classList.remove('hidden');
  cardEl.classList.add('guessed');
}

function getFullValueForPart(part, hints) {
  return hints ? hints[part] : '';
}

function updateScoreboard(scores) {
  const list = $('scoreboard-list');
  list.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  scores.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'score-item' + (s.id === state.myId ? ' me' : '');
    li.innerHTML = `
      <span class="score-rank">${medals[i] || (i + 1)}</span>
      <span class="score-name">${escHtml(s.name)}</span>
      <span class="score-pts">${s.score}</span>`;
    list.appendChild(li);
  });
}

function toggleHostControls() {
  $('host-game-controls').classList.toggle('hidden', !state.isHost);
}

// ── Round end overlay ───────────────────────────────────────
function showRoundEndOverlay(data) {
  const { movie, scores } = data;

  $('overlay-title').textContent = '🎬 Round Over!';

  const grid = $('reveal-grid');
  grid.innerHTML = '';
  [
    { label: '🎭 Hero',    val: movie.hero },
    { label: '💃 Heroine', val: movie.heroine },
    { label: '🎬 Movie',   val: movie.movie },
    { label: '🎵 Song',    val: movie.song },
    { label: '📅 Year',    val: movie.year },
    { label: '🎥 Director',val: movie.director },
  ].forEach(({ label, val }) => {
    const div = document.createElement('div');
    div.className = 'reveal-item';
    div.innerHTML = `<div class="ri-label">${label}</div><div class="ri-value">${escHtml(String(val))}</div>`;
    grid.appendChild(div);
  });

  // Plot spans full width
  if (movie.plot) {
    const div = document.createElement('div');
    div.className = 'reveal-item';
    div.style.gridColumn = '1/-1';
    div.innerHTML = `<div class="ri-label">📖 Plot</div><div class="ri-value" style="font-weight:400;font-size:.82rem;color:var(--text-dim)">${escHtml(movie.plot)}</div>`;
    grid.appendChild(div);
  }

  // Final scores
  const scoreDiv = $('overlay-scores');
  scoreDiv.innerHTML = '';
  scores.forEach(s => {
    const pill = document.createElement('span');
    pill.className = 'fs-pill';
    pill.textContent = `${s.name}: ${s.score}`;
    scoreDiv.appendChild(pill);
  });

  $('round-end-overlay').classList.remove('hidden');
}

function hideOverlay() {
  $('round-end-overlay').classList.add('hidden');
  clearInterval(state.overlayCountdown);
}

// ── Chat helpers ────────────────────────────────────────────
function addChatMessage(sender, text, isSystem) {
  const box = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isSystem ? ' system' : '');
  div.innerHTML = `<span class="chat-sender">${escHtml(sender)}: </span><span class="chat-text">${escHtml(text)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addChatSystem(text) {
  addChatMessage('System', text, true);
}

// ── Toasts / Notifications ──────────────────────────────────
function showGuessToast(msg, type) {
  const el = $('guess-toast');
  el.textContent = msg;
  el.className   = `guess-toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(state.guessToastTimer);
  state.guessToastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function hideGuessToast() {
  $('guess-toast').classList.add('hidden');
}

let notifTimer = null;
function showNotif(msg, type = '') {
  const el = $('notif-toast');
  el.textContent = msg;
  el.className   = `notif-toast${type ? ' ' + type : ''}`;
  el.classList.remove('hidden');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── XSS guard ───────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ═══ Boot ════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', init);
