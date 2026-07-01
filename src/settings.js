#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

// Defaults to false (safe) if the file is missing, malformed, or the field is absent —
// personal-profile posting must be explicitly opted into from the dashboard.
function isPersonalPostingAllowed() {
  if (!fs.existsSync(SETTINGS_FILE)) return false;
  try {
    return !!JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).allowPersonalPosting;
  } catch {
    return false;
  }
}

module.exports = { isPersonalPostingAllowed };
