/**
 * scoreManager.js
 * Each correct guess = +1 point.
 */

function addScore(player) {
  player.score = (player.score || 0) + 1;
  return 1;
}

module.exports = { addScore };
