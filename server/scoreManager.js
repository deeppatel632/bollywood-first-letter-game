/**
 * scoreManager.js
 * Pure helper — adds/subtracts points from a player object.
 */

const POINTS = {
  movie:   20,
  hero:    10,
  heroine: 10,
  song:    10,
  wrong:  -2,
};

function addScore(player, type) {
  const delta = POINTS[type] ?? 0;
  player.score = Math.max(0, (player.score || 0) + delta);
  return delta;
}

module.exports = { addScore, POINTS };
