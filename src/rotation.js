#!/usr/bin/env node
'use strict';

// Deterministic round-robin sport rotation, persisted to disk so it survives
// across separate CLI/Action invocations (each generation is a fresh process).
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'sport-rotation.json');

function readIndex() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return Number.isInteger(raw.index) ? raw.index : 0;
  } catch {
    return 0;
  }
}

function writeIndex(index) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ index, updatedAt: new Date().toISOString() }, null, 2));
}

// Returns the next sport in the pool and advances the persisted counter.
function nextSport(sportPool) {
  const index = readIndex() % sportPool.length;
  writeIndex((index + 1) % sportPool.length);
  return sportPool[index];
}

function resetRotation() {
  writeIndex(0);
}

module.exports = { nextSport, resetRotation };

if (require.main === module) {
  if (process.argv[2] === 'reset') {
    resetRotation();
    console.log('Sport rotation reset to index 0.');
  } else {
    console.log(JSON.stringify({ index: readIndex() }));
  }
}
