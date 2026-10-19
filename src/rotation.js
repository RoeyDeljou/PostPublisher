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
      treatmentIndex: Number.isInteger(raw.treatmentIndex) ? raw.treatmentIndex : 0,
      closingIndex: Number.isInteger(raw.closingIndex) ? raw.closingIndex : 0,
      companyIndex: Number.isInteger(raw.companyIndex) ? raw.companyIndex : 0,
      voiceIndex: Number.isInteger(raw.voiceIndex) ? raw.voiceIndex : 0,
    };
  } catch {
    return { sportIndex: 0, topicIndex: 0, assetIndex: 0, treatmentIndex: 0, closingIndex: 0, companyIndex: 0, voiceIndex: 0 };
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

// Returns the next image visual treatment (e.g. bottom-bar / diagonal-ribbon /
// top-block) and advances its persisted counter - keeps consecutive posts from
// all looking like the same template with different words swapped in.
function nextTreatment(treatmentPool) {
  const state = readState();
  const index = state.treatmentIndex % treatmentPool.length;
  writeState({ ...state, treatmentIndex: (index + 1) % treatmentPool.length });
  return treatmentPool[index];
}

// Who the headline/post is talking to: 'address' (straight at the organization or
// reader), 'problem' (a general statement of what is broken in the sport/industry),
// 'weird' (a strange thing that is actually happening, told as a short clickbait line).
function nextVoice(advance = true) {
  const pool = ['problem', 'address', 'weird'];
  const state = readState();
  const index = state.voiceIndex % pool.length;
  if (advance) writeState({ ...state, voiceIndex: (index + 1) % pool.length });
  return pool[index];
}

// How a post ends: an explicit "let's talk" invitation, or a reflective
// question / stakes-raising reframe with no sales ask. Alternates deterministically
// (the model won't reliably vary this on its own). advance=false peeks without
// consuming a slot, for previews.
function nextClosingStyle(advance = true) {
  const pool = ['talk', 'reflective'];
  const state = readState();
  const index = state.closingIndex % pool.length;
  if (advance) writeState({ ...state, closingIndex: (index + 1) % pool.length });
  return pool[index];
}

// Whether the post names ML-Innovation. Its own 3-slot cycle (one in three posts)
// so it drifts against the closing style instead of locking to it: some "let's
// talk" posts name the company, some don't, and the same for reflective ones.
function nextCompanyMention(advance = true) {
  const pool = [false, true, false];
  const state = readState();
  const index = state.companyIndex % pool.length;
  if (advance) writeState({ ...state, companyIndex: (index + 1) % pool.length });
  return pool[index];
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
  writeState({ sportIndex: 0, topicIndex: 0, assetIndex: 0, treatmentIndex: 0, closingIndex: 0, companyIndex: 0, voiceIndex: 0 });
}

module.exports = { nextSport, nextTopic, nextAssetIsVideo, nextTreatment, nextClosingStyle, nextCompanyMention, nextVoice, resetRotation };

if (require.main === module) {
  if (process.argv[2] === 'reset') {
    resetRotation();
    console.log('Rotation (sport + topic) reset to index 0.');
  } else {
    console.log(JSON.stringify(readState()));
  }
}
