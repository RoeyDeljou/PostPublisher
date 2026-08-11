#!/usr/bin/env node
'use strict';

// Deterministic round-robin rotation (sport + topic field), persisted to disk
// so it survives across separate CLI/Action invocations (each generation is a
// fresh process).
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'sport-rotation.json');

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      sportIndex: Number.isInteger(raw.sportIndex) ? raw.sportIndex : (Number.isInteger(raw.index) ? raw.index : 0),
      topicIndex: Number.isInteger(raw.topicIndex) ? raw.topicIndex : 0,
      assetIndex: Number.isInteger(raw.assetIndex) ? raw.assetIndex : 0,
    };
  } catch {
    return { sportIndex: 0, topicIndex: 0, assetIndex: 0 };
  }
}

function writeState(state) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
}

// Returns the next sport in the pool and advances its persisted counter.
function nextSport(sportPool) {
  const state = readState();
  const index = state.sportIndex % sportPool.length;
  writeState({ ...state, sportIndex: (index + 1) % sportPool.length });
  return sportPool[index];
}

// Returns the next topic field in the pool and advances its persisted counter.
function nextTopic(topicPool) {
  const state = readState();
  const index = state.topicIndex % topicPool.length;
  writeState({ ...state, topicIndex: (index + 1) % topicPool.length });
  return topicPool[index];
}

// Returns true once every `everyN` calls (e.g. everyN=5 -> post 1,6,11,... use
// video), and always advances the counter — used to make video an occasional
// alternative to the static image rather than every single post.
function nextAssetIsVideo(everyN = 5) {
  const state = readState();
  const index = state.assetIndex;
  writeState({ ...state, assetIndex: (index + 1) % everyN });
  return index % everyN === 0;
}

function resetRotation() {
  writeState({ sportIndex: 0, topicIndex: 0, assetIndex: 0 });
}

module.exports = { nextSport, nextTopic, nextAssetIsVideo, resetRotation };

if (require.main === module) {
  if (process.argv[2] === 'reset') {
    resetRotation();
    console.log('Rotation (sport + topic) reset to index 0.');
  } else {
    console.log(JSON.stringify(readState()));
  }
}
