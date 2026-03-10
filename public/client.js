/* ─────────────────────────────────────────────────────────────
   Bollywood First Letter Guess Game — Client
   ───────────────────────────────────────────────────────────── */
'use strict';

// ═══ State ═══════════════════════════════════════════════════
const state = {
  socket:            null,
  roomCode:          null,
  playerName:        null,
  isHost:            false,
  isSelector:        false,
  myId:              null,
  roundActive:       false,
  timerMax:          300,
  overlayCountdown:  null,
  guessToastTimer:   null,
};

// ═══ Audio ═══════════════════════════════════════════════════
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new AudioCtx(); return audioCtx; }

function playTone(freq, dur, type = 'sine', gain = 0.18) {
  try {
    const ctx = getAudioCtx(), osc = ctx.createOscillator(), vol = ctx.createGain();
    osc.connect(vol); vol.connect(ctx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    vol.gain.setValueAtTime(gain, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
  } catch (_) {}
}
function playSuccess() { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f,.18,'sine',.2), i*80)); }
function playWrong()   { playTone(180,.35,'sawtooth',.14); }
function playTick()    { playTone(880,.06,'square',.07); }
function playRoundEnd(){ [784,659,523,392].forEach((f,i) => setTimeout(() => playTone(f,.22,'sine',.15), i*90)); }

// ═══ DOM refs ════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const screens = {
  lobby:   $('lobby-screen'),
  waiting: $('waiting-screen'),
  game:    $('game-screen'),
};
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ═══ Init ════════════════════════════════════════════════════
function init() {
  state.socket = io();
  bindSocketEvents();
  bindUIEvents();
}

// ═══ UI Events ═══════════════════════════════════════════════
function bindUIEvents() {
  $('tab-create').addEventListener('click', () => switchTab('create'));
  $('tab-join').addEventListener('click',   () => switchTab('join'));
  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click',   joinRoom);
  ['create-name'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); }));
  ['join-name','join-code'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); }));
  $('btn-copy').addEventListener('click', copyRoomCode);
  $('btn-start-game').addEventListener('click', () => state.socket.emit('startGame', { roomCode: state.roomCode }));
  $('btn-guess').addEventListener('click', submitGuess);
  $('guess-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });
  $('btn-select-movie').addEventListener('click', () => state.socket.emit('selectMovie', { roomCode: state.roomCode }));
  $('btn-skip').addEventListener('click', () => state.socket.emit('skipMovie', { roomCode: state.roomCode }));
  $('btn-chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

function switchTab(tab) {
  ['create','join'].forEach(t => {
    $(`tab-${t}`).classList.toggle('active', t === tab);
    $(`panel-${t}`).classList.toggle('active', t === tab);
  });
  $('lobby-error').textContent = '';
}

// ═══ Socket Events ═══════════════════════════════════════════
function bindSocketEvents() {
  const s = state.socket;
  s.on('connect',        () => { state.myId = s.id; });
  s.on('roomCreated',    onRoomCreated);
  s.on('roomJoined',     onRoomJoined);
  s.on('playerJoined',   onPlayerJoined);
  s.on('playerLeft',     onPlayerLeft);
  s.on('gameStarted',    onGameStarted);
  s.on('roundStart',     onRoundStart);
  s.on('movieDetails',   onMovieDetails);
  s.on('syncGameState',  onSyncGameState);
  s.on('timerUpdate',    onTimerUpdate);
  s.on('guessResult',    onGuessResult);
  s.on('hintRevealed',   onHintRevealed);
  s.on('roundEnd',       onRoundEnd);
  s.on('movieSkipped',   onMovieSkipped);
  s.on('chatMessage',    onChatMessage);
  s.on('gameError',      onGameError);
}

// ═══ Lobby ═══════════════════════════════════════════════════
function createRoom() {
  const name = $('create-name').value.trim();
  if (!name) return showLobbyError('Please enter your name.');
  state.playerName = name;
  state.socket.emit('createRoom', { playerName: name });
}
function joinRoom() {
  const name = $('join-name').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if (!name) return showLobbyError('Please enter your name.');
  if (!code || code.length < 4) return showLobbyError('Please enter a valid room code.');
  state.playerName = name;
  state.socket.emit('joinRoom', { roomCode: code, playerName: name });
}
function showLobbyError(msg) { $('lobby-error').textContent = msg; }

// ═══ Socket Handlers ═════════════════════════════════════════

function onRoomCreated(room) {
  state.roomCode = room.code;
  state.isHost   = true;
  renderWaitingRoom(room);
  showScreen('waiting');
}

function onRoomJoined(room) {
  state.roomCode = room.code;
  state.isHost   = room.hostId === state.myId;
  renderWaitingRoom(room);
  showScreen('waiting');
}

function onPlayerJoined({ room, newPlayer }) {
  if (screens.waiting.classList.contains('active')) renderWaitingRoom(room);
  state.isHost = room.hostId === state.myId;
  const name = newPlayer?.name || 'Someone';
  addChatSystem(`${escHtml(name)} joined the room.`);
  showNotif(`👋 ${name} joined!`);
  // update leaderboard if game screen is active
  if (screens.game.classList.contains('active')) {
    updateScoreboard(room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
  }
}

function onPlayerLeft(room) {
  if (screens.waiting.classList.contains('active')) renderWaitingRoom(room);
  state.isHost = room.hostId === state.myId;
  addChatSystem('A player left the room.');
  if (screens.game.classList.contains('active')) {
    updateScoreboard(room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
  }
}

function onGameStarted(data) {
  showScreen('game');
  $('round-badge').textContent     = 'Round 0';
  $('room-code-badge').textContent = state.roomCode;
  state.isHost = data.hostId === state.myId;
  state.roundActive = false;
  state.isSelector  = false;
  updateScoreboard(data.scores);
  resetHints();
  resetSolvedTracker();
  showSelectMovieButton(true);
  hideGuessArea(false);
  $('selector-name').textContent = '—';
  $('timer-count').textContent = '5:00';
  hideOverlay();
  addChatSystem('🎮 Game started! Anyone can pick a movie.');
}

function onRoundStart(data) {
  showScreen('game');
  state.roundActive = true;
  state.isSelector  = data.selectorId === state.myId;
  state.isHost      = data.hostId === state.myId;

  $('round-badge').textContent     = `Round ${data.roundNumber}`;
  $('room-code-badge').textContent = state.roomCode;
  $('selector-name').textContent   = data.selectorName;

  resetHints();
  renderHints(data.hints, data.guessedParts);
  resetSolvedTracker();
  updateSolvedTracker(data.guessedParts, data.solvedBy);
  updateScoreboard(data.scores);
  updateTimer(data.timeLeft);

  // Hide select button, show guess area (or movie details for selector)
  showSelectMovieButton(false);
  if (state.isSelector) {
    hideGuessArea(true);
    $('selector-controls').classList.remove('hidden');
  } else {
    hideGuessArea(false);
    $('selector-controls').classList.add('hidden');
    $('movie-details-bar').classList.add('hidden');
  }

  // Selector OR host can skip
  if (state.isSelector || state.isHost) {
    $('selector-controls').classList.remove('hidden');
  }

  hideOverlay();
  $('guess-input').value = '';
  hideGuessToast();
  addChatSystem(`🎬 Round ${data.roundNumber} — ${escHtml(data.selectorName)} selected a movie!`);
}

function onMovieDetails(data) {
  // Only the selector receives this
  const bar = $('movie-details-bar');
  bar.classList.remove('hidden');
  $('detail-movie').textContent   = `🎬 ${data.movie}`;
  $('detail-hero').textContent    = `🎭 ${data.hero}`;
  $('detail-heroine').textContent = `💃 ${data.heroine}`;
  $('detail-song').textContent    = `🎵 ${data.song}`;
}

function onSyncGameState(data) {
  showScreen('game');
  $('room-code-badge').textContent = state.roomCode;
  state.isHost = data.hostId === state.myId;

  if (data.phase === 'selecting') {
    state.roundActive = false;
    $('round-badge').textContent = `Round ${data.roundNumber}`;
    updateScoreboard(data.scores);
    showSelectMovieButton(true);
    return;
  }
  // phase === 'guessing'
  onRoundStart(data);
  if (Array.isArray(data.hintsRevealed)) {
    data.hintsRevealed.forEach(({ type, value }) => onHintRevealed({ type, value }));
  }
}

function onTimerUpdate(data) {
  updateTimer(data.timeLeft);
  if (data.timeLeft <= 10 && data.timeLeft > 0) playTick();
}

function onGuessResult(data) {
  if (data.correct) {
    playSuccess();
    const labels = { movie:'🎬 Movie', hero:'🎭 Hero', heroine:'💃 Heroine', song:'🎵 Song' };
    showGuessToast(`✅ ${data.playerName} guessed ${labels[data.partGuessed]}! (+1)`, 'correct');
    addChatSystem(`✅ ${escHtml(data.playerName)} guessed "${escHtml(data.guess)}" — ${data.partGuessed}!`);
    revealHintCard(data.partGuessed, data.hints[data.partGuessed]);
  } else {
    playWrong();
    showGuessToast(`❌ ${data.playerName}: "${data.guess}" — wrong`, 'wrong');
    addChatSystem(`❌ ${escHtml(data.playerName)} guessed "${escHtml(data.guess)}" — wrong.`);
  }

  if (data.hints) syncHints(data.hints);
  updateSolvedTracker(data.guessedParts, data.solvedBy);
  updateScoreboard(data.scores);
}

function onHintRevealed(data) {
  const map = {
    year:     { id: 'hint-year',     inner: `📅 <b id="yr">${escHtml(String(data.value))}</b>` },
    director: { id: 'hint-director', inner: `🎥 <b id="dir">${escHtml(String(data.value))}</b>` },
    plot:     { id: 'hint-plot',     inner: `📖 <b id="plt">${escHtml(String(data.value))}</b>` },
  };
  const entry = map[data.type];
  if (entry) {
    const el = $(entry.id);
    el.innerHTML = entry.inner;
    el.classList.remove('hidden');
  }
  addChatSystem(`💡 Hint: ${data.type} revealed`);
}

function onRoundEnd(data) {
  playRoundEnd();
  state.roundActive = false;
  showRoundEndOverlay(data);
  showSelectMovieButton(true);
  $('selector-controls').classList.add('hidden');
  $('movie-details-bar').classList.add('hidden');
  addChatSystem(`🏁 Round over! Movie: ${escHtml(data.movie.movie)}`);
}

function onMovieSkipped(data) {
  playRoundEnd();
  state.roundActive = false;
  state.isSelector  = false;
  showRoundEndOverlay(data);
  showSelectMovieButton(true);
  $('selector-controls').classList.add('hidden');
  $('movie-details-bar').classList.add('hidden');
  addChatSystem(`⏭ Movie skipped: ${escHtml(data.movie.movie)}`);
}

function onChatMessage(data) { addChatMessage(data.playerName, data.message, false); }

function onGameError(msg) {
  if (screens.lobby.classList.contains('active')) showLobbyError(msg);
  else showNotif(`⚠ ${msg}`, 'bad');
}

// ═══ Game Actions ════════════════════════════════════════════
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
  navigator.clipboard.writeText(state.roomCode)
    .then(() => showNotif('📋 Code copied!', 'good'))
    .catch(() => showNotif(`Code: ${state.roomCode}`));
}

// ═══ Render Helpers ══════════════════════════════════════════

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

function resetHints() {
  ['hero','heroine','movie','song'].forEach(part => {
    $(`hint-${part}`).textContent = '?';
    $(`full-${part}`).textContent = '';
    $(`full-${part}`).classList.add('hidden');
    $(`card-${part}`).classList.remove('guessed');
    $(`badge-${part}`).textContent = '';
    $(`badge-${part}`).classList.add('hidden');
  });
  ['hint-year','hint-director','hint-plot'].forEach(id => $(id).classList.add('hidden'));
}

function renderHints(hints, guessedParts) {
  ['hero','heroine','movie','song'].forEach(part => {
    const letterEl = $(`hint-${part}`);
    const fullEl   = $(`full-${part}`);
    const cardEl   = $(`card-${part}`);
    if (guessedParts[part]) {
      letterEl.textContent = hints[part][0].toUpperCase();
      fullEl.textContent   = hints[part];
      fullEl.classList.remove('hidden');
      cardEl.classList.add('guessed');
    } else {
      letterEl.textContent = hints[part];
      fullEl.classList.add('hidden');
      cardEl.classList.remove('guessed');
    }
  });
}

function syncHints(hints) {
  ['hero','heroine','movie','song'].forEach(part => {
    const letterEl = $(`hint-${part}`);
    const fullEl   = $(`full-${part}`);
    const cardEl   = $(`card-${part}`);
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
  const cardEl = $(`card-${part}`);
  const letterEl = $(`hint-${part}`);
  const fullEl   = $(`full-${part}`);
  if (fullText) {
    letterEl.textContent = fullText[0].toUpperCase();
    fullEl.textContent   = fullText;
  }
  fullEl.classList.remove('hidden');
  cardEl.classList.add('guessed');
}

function resetSolvedTracker() {
  ['hero','heroine','movie','song'].forEach(part => {
    const el = $(`solved-${part}`);
    el.classList.remove('done');
    el.querySelector('.solved-icon').textContent = '○';
  });
}

function updateSolvedTracker(guessedParts, solvedBy) {
  ['hero','heroine','movie','song'].forEach(part => {
    const el    = $(`solved-${part}`);
    const badge = $(`badge-${part}`);
    if (guessedParts[part]) {
      el.classList.add('done');
      el.querySelector('.solved-icon').textContent = '●';
      if (solvedBy && solvedBy[part]) {
        badge.textContent = `✓ ${solvedBy[part].name}`;
        badge.classList.remove('hidden');
      }
    }
  });
}

function updateTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  $('timer-count').textContent = `${m}:${String(s).padStart(2, '0')}`;

  // SVG arc
  const C      = 163.4;
  const offset = C - (C * (seconds / state.timerMax));
  const arc    = $('timer-arc');
  arc.style.strokeDashoffset = offset;
  const urgent = seconds <= 30;
  $('timer-count').classList.toggle('urgent', urgent);
  arc.classList.toggle('urgent', urgent);
}

function showSelectMovieButton(show) {
  $('btn-select-movie').classList.toggle('hidden', !show);
}

function hideGuessArea(isSelector) {
  $('guess-area').classList.toggle('hidden', isSelector);
}

function updateScoreboard(scores) {
  const list = $('scoreboard-list');
  list.innerHTML = '';
  const medals = ['🥇','🥈','🥉'];
  scores.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'score-item' + (s.id === state.myId ? ' me' : '');
    li.innerHTML = `
      <span class="score-rank">${medals[i] || (i+1)}</span>
      <span class="score-name">${escHtml(s.name)}</span>
      <span class="score-pts">${s.score}</span>`;
    list.appendChild(li);
  });
}

// ── Overlay ─────────────────────────────────────────────────
function showRoundEndOverlay(data) {
  const { movie, scores, solvedBy } = data;
  $('overlay-title').textContent = '🎬 Round Over!';

  const grid = $('reveal-grid');
  grid.innerHTML = '';
  [
    { label: '🎭 Hero',     val: movie.hero },
    { label: '💃 Heroine',  val: movie.heroine },
    { label: '🎬 Movie',    val: movie.movie },
    { label: '🎵 Song',     val: movie.song },
    { label: '📅 Year',     val: movie.year },
    { label: '🎥 Director', val: movie.director },
  ].forEach(({ label, val }) => {
    const div = document.createElement('div');
    div.className = 'reveal-item';
    div.innerHTML = `<div class="ri-label">${label}</div><div class="ri-value">${escHtml(String(val))}</div>`;
    grid.appendChild(div);
  });

  // Solved summary
  const sumDiv = $('solved-summary');
  sumDiv.innerHTML = '';
  if (solvedBy) {
    ['hero','heroine','movie','song'].forEach(part => {
      if (solvedBy[part]) {
        const sp = document.createElement('span');
        sp.className = 'solved-pill';
        sp.textContent = `${part}: ${solvedBy[part].name}`;
        sumDiv.appendChild(sp);
      }
    });
  }

  const scoreDiv = $('overlay-scores');
  scoreDiv.innerHTML = '';
  scores.forEach(s => {
    const pill = document.createElement('span');
    pill.className = 'fs-pill';
    pill.textContent = `${s.name}: ${s.score}`;
    scoreDiv.appendChild(pill);
  });

  $('overlay-msg').textContent = 'Pick a new movie to start the next round!';
  $('round-end-overlay').classList.remove('hidden');
}

function hideOverlay() {
  $('round-end-overlay').classList.add('hidden');
  clearInterval(state.overlayCountdown);
}

// ── Chat ────────────────────────────────────────────────────
function addChatMessage(sender, text, isSystem) {
  const box = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isSystem ? ' system' : '');
  div.innerHTML = `<span class="chat-sender">${escHtml(sender)}: </span><span class="chat-text">${escHtml(text)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function addChatSystem(text) { addChatMessage('System', text, true); }

// ── Toast / Notif ───────────────────────────────────────────
function showGuessToast(msg, type) {
  const el = $('guess-toast');
  el.textContent = msg;
  el.className   = `guess-toast ${type}`;
  el.classList.remove('hidden');
  clearTimeout(state.guessToastTimer);
  state.guessToastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
function hideGuessToast() { $('guess-toast').classList.add('hidden'); }

let notifTimer = null;
function showNotif(msg, type = '') {
  const el = $('notif-toast');
  el.textContent = msg;
  el.className   = `notif-toast${type ? ' ' + type : ''}`;
  el.classList.remove('hidden');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

window.addEventListener('DOMContentLoaded', init);