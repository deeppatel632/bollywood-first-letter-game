/**
 * server.js
 * Express + Socket.io entry point.
 */

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
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] Connected   ${socket.id}`);

  // ── Room management ──────────────────────────────────────────────────────
  socket.on('createRoom', ({ playerName }) => {
    if (!playerName || !playerName.trim()) {
      socket.emit('gameError', 'Please enter a valid name.');
      return;
    }
    const room = roomManager.createRoom(socket.id, playerName.trim());
    socket.join(room.code);
    socket.emit('roomCreated', sanitize(room));
    console.log(`[Room] Created  ${room.code}  by  ${playerName}`);
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!roomCode || !playerName || !playerName.trim()) {
      socket.emit('gameError', 'Room code and player name are required.');
      return;
    }
    const result = roomManager.joinRoom(roomCode.trim().toUpperCase(), socket.id, playerName.trim());
    if (result.error) {
      socket.emit('gameError', result.error);
      return;
    }
    socket.join(roomCode.trim().toUpperCase());
    io.to(result.code).emit('playerJoined', sanitize(result));
    console.log(`[Room] ${playerName} joined ${result.code}`);
  });

  // ── Game control (host only) ─────────────────────────────────────────────
  socket.on('startGame', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room)                        return socket.emit('gameError', 'Room not found.');
    if (room.hostId !== socket.id)    return socket.emit('gameError', 'Only the host can start the game.');
    if (room.players.length < 1)      return socket.emit('gameError', 'Need at least 1 player.');
    gameEngine.startGame(io, room);
  });

  socket.on('skipMovie', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.hostId !== socket.id) return;
    gameEngine.skipMovie(io, room);
  });

  socket.on('restartRound', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.hostId !== socket.id) return;
    gameEngine.restartRound(io, room);
  });

  // ── Gameplay ─────────────────────────────────────────────────────────────
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
    // Basic XSS guard — strip HTML tags
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
        io.to(result.roomCode).emit('playerLeft', sanitize(room));
      }
    }
  });
});

// ─── Sanitize helper (don't send internal timer refs etc.) ───────────────────
function sanitize(room) {
  return {
    code:        room.code,
    hostId:      room.hostId,
    players:     room.players,
    state:       room.state,
    roundNumber: room.roundNumber,
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎬  Bollywood First Letter Game server running on http://localhost:${PORT}\n`);
});
