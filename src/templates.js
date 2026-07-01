#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES_FILE = path.join(__dirname, '..', 'data', 'templates.json');

function getActiveTemplate() {
  if (!fs.existsSync(TEMPLATES_FILE)) return null;
  try {
    const templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    if (!Array.isArray(templates)) return null;
    return templates.find(t => t && t.active) || null;
  } catch {
    return null;
  }
}

module.exports = { getActiveTemplate };
