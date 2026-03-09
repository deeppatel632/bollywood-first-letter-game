/**
 * hintSystem.js
 * Builds the hint object sent to clients.
 * Revealed parts show full text; hidden parts show only the first letter.
 */

function buildHints(movie, guessedParts) {
  return {
    hero:    guessedParts.hero    ? movie.hero    : movie.hero[0].toUpperCase(),
    heroine: guessedParts.heroine ? movie.heroine : movie.heroine[0].toUpperCase(),
    movie:   guessedParts.movie   ? movie.movie   : movie.movie[0].toUpperCase(),
    song:    guessedParts.song    ? movie.song    : movie.song[0].toUpperCase(),
  };
}

module.exports = { buildHints };
