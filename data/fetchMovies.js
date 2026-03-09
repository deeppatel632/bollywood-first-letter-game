/**
 * fetchMovies.js
 * Validates and displays stats for the bundled Bollywood movies dataset.
 * The dataset (movies.json) is pre-curated — no external API calls are required.
 *
 * Usage:  node data/fetchMovies.js
 */

const fs   = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'movies.json');

if (!fs.existsSync(dataPath)) {
  console.error('❌  movies.json not found at', dataPath);
  process.exit(1);
}

const movies = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

const requiredFields = ['movie', 'hero', 'heroine', 'song', 'year', 'director', 'plot'];

let valid   = 0;
let invalid = 0;
const errors = [];

movies.forEach((m, i) => {
  const missing = requiredFields.filter(f => !m[f]);
  if (missing.length) {
    invalid++;
    errors.push(`  [${i + 1}] "${m.movie || 'UNKNOWN'}" — missing: ${missing.join(', ')}`);
  } else {
    valid++;
  }
});

console.log('\n🎬  Bollywood First Letter Guess Game — Dataset Report');
console.log('═'.repeat(52));
console.log(`  Total movies  : ${movies.length}`);
console.log(`  ✅  Valid      : ${valid}`);
console.log(`  ❌  Invalid    : ${invalid}`);

if (errors.length) {
  console.log('\n  Issues found:');
  errors.forEach(e => console.log(e));
} else {
  console.log('\n  All entries are complete. Dataset is ready to use! 🚀');
}

// Year distribution
const years = {};
movies.forEach(m => {
  const decade = `${Math.floor(m.year / 10) * 10}s`;
  years[decade] = (years[decade] || 0) + 1;
});

console.log('\n  Movies by decade:');
Object.keys(years).sort().forEach(d => {
  console.log(`    ${d} : ${years[d]}`);
});
console.log();
