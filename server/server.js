/**
 * server.js
 * Express + Socket.io entry point.
 *
 * FIX LOG:
 *  - Added 'roomJoined' event emitted directly to the joining socket so they
 *    can navigate to the waiting screen (was missing — root cause of "other
 *    players can't see the game" bug).
 *  - Changed 'playerJoined' payload to { room, newPlayer } so the client can
 *    safely read the new player's name without fragile array-indexing.
 *  - Added 'syncGameState' emission for players who join a room mid-game.
 *  - socket.io cors set to '*' + transports for Render/Railway compatibility.
 *  - Dynamic PORT via process.env.PORT for cloud deployment.
 *  - Health endpoint for Render uptime checks.
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
  cors: {
    origin:  '*',
    methods: ['GET', 'POST'],
  },
  // Improve reliability on cloud platforms
  pingTimeout:  60000,
  pingInterval: 25000,
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// Health-check endpoint (Render / Railway keep-alive)
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
    if (result.error) {
      return socket.emit('gameError', result.error);
    }

    socket.join(code);

    // FIX 1: Tell the joining player their room info → client navigates to
    //        waiting screen. Previously missing — joiners were stuck on lobby.
    socket.emit('roomJoined', sanitizeRoom(result));

    // FIX 2: Broadcast updated room + who joined to everyone in room (including
    //        the new player so their waiting-room player list updates too).
    io.to(code).emit('playerJoined', {
      room:      sanitizeRoom(result),
      newPlayer: { name: playerName.trim() },
    });

    // FIX 3: If game is already in progress, send the current state only to
    //        the new player so they can follow along immediately.
    if (result.state === 'playing') {
      socket.emit('syncGameState', gameEngine.getGameState(result));
    }

    console.log(`[Room] Joined    ${code}  by  "${playerName}"  (${result.players.length} players)`);
  });

  // ── Game control (host only) ─────────────────────────────────────────────
  socket.on('startGame', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room)                       return socket.emit('gameError', 'Room not found.');
    if (room.hostId !== socket.id)   return socket.emit('gameError', 'Only the host can start the game.');
    if (room.players.length < 1)     return socket.emit('gameError', 'Need at least 1 player.');
    if (room.state === 'playing')    return socket.emit('gameError', 'Game already in progress.');
    console.log(`[Game] Start     ${roomCode}  (${room.players.length} players)`);
    gameEngine.startGame(io, room);
  });

  socket.on('skipMovie', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.hostId !== socket.id || room.state !== 'playing') return;
    console.log(`[Game] Skip      ${roomCode}`);
    gameEngine.skipMovie(io, room);
  });

  socket.on('restartRound', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || room.hostId !== socket.id || room.state !== 'playing') return;
    console.log(`[Game] Restart   ${roomCode}`);
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
    // XSS guard
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

// ─── Sanitize helper ─────────────────────────────────────────────────────────
// Only expose safe, serialisable fields to clients.
function sanitizeRoom(room) {
  return {
    code:               room.code,
    hostId:             room.hostId,
    players:            room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    state:              room.state,
    roundNumber:        room.roundNumber,
    currentPlayerIndex: room.currentPlayerIndex,
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎬  Bollywood FLG server → http://localhost:${PORT}\n`);
});
