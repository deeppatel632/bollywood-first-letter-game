'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const roomManager = require('./roomManager');
const gameEngine  = require('./gameEngine');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, '../public')));
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] Connected    ${socket.id}`);

  // ── Room management ──────────────────────────────────────────────────────
  socket.on('createRoom', ({ playerName }) => {
    if (!playerName || !playerName.trim()) {
      return socket.emit('gameError', 'Please enter a valid name.');
    }
    const room = roomManager.createRoom(socket.id, playerName.trim());
    socket.join(room.code);
    socket.emit('roomCreated', sanitizeRoom(room));
    console.log(`[Room] Created   ${room.code}  by  "${playerName}"`);
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!roomCode || !playerName || !playerName.trim()) {
      return socket.emit('gameError', 'Room code and player name are required.');
    }
    const code   = roomCode.trim().toUpperCase();
    const result = roomManager.joinRoom(code, socket.id, playerName.trim());
    if (result.error) return socket.emit('gameError', result.error);

    socket.join(code);
    socket.emit('roomJoined', sanitizeRoom(result));

    io.to(code).emit('playerJoined', {
      room:      sanitizeRoom(result),
      newPlayer: { name: playerName.trim() },
    });

    if (result.state === 'playing') {
      socket.emit('syncGameState', gameEngine.getGameState(result));
    }

    console.log(`[Room] Joined    ${code}  by  "${playerName}"  (${result.players.length} players)`);
  });

  // ── Game control (host only) ─────────────────────────────────────────────
  socket.on('startGame', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room)                     return socket.emit('gameError', 'Room not found.');
    if (room.hostId !== socket.id) return socket.emit('gameError', 'Only the host can start the game.');
    if (room.players.length < 2)   return socket.emit('gameError', 'Need at least 2 players.');
    if (room.state === 'playing')  return socket.emit('gameError', 'Game already in progress.');
    console.log(`[Game] Start     ${roomCode}  (${room.players.length} players)`);
    gameEngine.startGame(io, room);
  });

  // ── Movie selection (any player) ─────────────────────────────────────────
  socket.on('selectMovie', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.state !== 'playing') return;
    if (room.currentMovie) return socket.emit('gameError', 'A round is already in progress.');
    console.log(`[Game] Select    ${roomCode}  by  ${socket.id}`);
    gameEngine.selectMovie(io, room, socket.id);
  });

  // ── Skip movie (selector or host) ───────────────────────────────────────
  socket.on('skipMovie', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.state !== 'playing' || !room.currentMovie) return;
    if (socket.id !== room.selectorId && socket.id !== room.hostId) return;
    console.log(`[Game] Skip      ${roomCode}`);
    gameEngine.skipMovie(io, room);
  });

  // ── Guessing ─────────────────────────────────────────────────────────────
  socket.on('guess', ({ roomCode, guess }) => {
    if (!guess || !guess.trim()) return;
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    gameEngine.handleGuess(io, room, socket.id, guess.trim());
  });

  // ── Chat ─────────────────────────────────────────────────────────────────
  socket.on('chat', ({ roomCode, message }) => {
    if (!message || !message.trim()) return;
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const safe = message.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 200);
    io.to(roomCode).emit('chatMessage', {
      playerName: player.name,
      message:    safe,
      time:       Date.now(),
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected ${socket.id}`);
    const result = roomManager.removePlayer(socket.id);
    if (result) {
      const room = roomManager.getRoom(result.roomCode);
      if (room) {
        io.to(result.roomCode).emit('playerLeft', sanitizeRoom(room));
        console.log(`[Room] Left      ${result.roomCode}  (${room.players.length} remaining)`);
      }
    }
  });
});

function sanitizeRoom(room) {
  return {
    code:        room.code,
    hostId:      room.hostId,
    players:     room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    state:       room.state,
    roundNumber: room.roundNumber,
    selectorId:  room.selectorId || null,
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎬  Bollywood FLG server → http://localhost:${PORT}\n`);
});