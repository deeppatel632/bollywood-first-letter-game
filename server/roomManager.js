/**
 * roomManager.js
 * Manages the lifecycle of game rooms: create, join, remove players.
 */

const { v4: uuidv4 } = require('uuid');

// roomCode → room object
const rooms = new Map();

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(hostId, hostName) {
  let code = generateCode();
  // Avoid collisions (astronomically rare but safe)
  while (rooms.has(code)) code = generateCode();

  const room = {
    code,
    hostId,
    players: [{ id: hostId, name: hostName, score: 0 }],
    state: 'waiting',          // 'waiting' | 'playing'
    currentMovie: null,
    currentPlayerIndex: 0,
    wrongGuesses: 0,           // 0-9; 9 = BOLLYWOOD wiped out
    guessedParts: { hero: false, heroine: false, song: false, movie: false },
    hintsRevealed: [],
    roundNumber: 0,
    usedMovies: [],
    roundStartTime: null,
  };

  rooms.set(code, room);
  return room;
}

function joinRoom(code, playerId, playerName) {
  const room = rooms.get(code);
  if (!room)                          return { error: 'Room not found. Check the code and try again.' };
  if (room.players.length >= 8)       return { error: 'Room is full (max 8 players).' };
  if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
    return { error: 'That name is already taken in this room.' };
  }
  // FIX: removed state !== 'waiting' restriction.
  // Players can now join a room while the game is already running.
  // server.js will emit syncGameState so they see the current round immediately.

  room.players.push({ id: playerId, name: playerName, score: 0 });
  return room;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

/**
 * Find which room the given socket is in and remove them.
 * Returns { roomCode } if a room was affected, null otherwise.
 */
function removePlayer(playerId) {
  for (const [code, room] of rooms.entries()) {
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx === -1) continue;

    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      rooms.delete(code);
      return null;
    }

    // Pass host to next player if host left
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }

    // Keep currentPlayerIndex in bounds
    if (room.currentPlayerIndex >= room.players.length) {
      room.currentPlayerIndex = 0;
    }

    return { roomCode: code };
  }
  return null;
}

function getRoomByPlayerId(playerId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.id === playerId)) return room;
  }
  return null;
}

module.exports = { createRoom, joinRoom, getRoom, removePlayer, getRoomByPlayerId };
