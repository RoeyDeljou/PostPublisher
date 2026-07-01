#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PAUSE_FILE = path.join(__dirname, '..', 'data', 'pause.json');

function isPaused() {
  if (!fs.existsSync(PAUSE_FILE)) return false;
  try {
    return !!JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8')).paused;
  } catch {
    return false;
  }
}

module.exports = { isPaused };
