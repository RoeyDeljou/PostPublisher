#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { verifyPost } = require('./linkedin');

const ALERT_FILE = path.join(__dirname, '..', 'data', 'token-expiry-alert.txt');
const RUN_LOG = path.join(__dirname, '..', 'data', 'run-log.jsonl');
const ALERT_THRESHOLD_DAYS = 5;

function checkToken() {
  const token = process.env.LINKEDIN_TOKEN;
  const expiresAt = process.env.LINKEDIN_TOKEN_EXPIRES_AT;

  if (!token) {
    return { valid: false, expiresAt: null, daysRemaining: 0, alertNeeded: true, reason: 'NO_TOKEN' };
  }
  if (!expiresAt) {
    // Token exists but no expiry tracked — assume valid, warn
    return { valid: true, expiresAt: null, daysRemaining: 60, alertNeeded: false, reason: 'NO_EXPIRY_DATE' };
  }

  const expiry = new Date(expiresAt);
  const now = new Date();
  const msRemaining = expiry - now;
  const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return { valid: false, expiresAt, daysRemaining, alertNeeded: true, reason: 'EXPIRED' };
  }

  const alertNeeded = daysRemaining <= ALERT_THRESHOLD_DAYS;

  if (alertNeeded) {
    const alertMsg = [
      `⚠️  LINKEDIN TOKEN EXPIRES IN ${daysRemaining} DAY${daysRemaining !== 1 ? 'S' : ''}  ⚠️`,
      `Checked at: ${now.toISOString()}`,
      `Expires at: ${expiresAt}`,
      '',
      'Action required: Re-authorize LinkedIn',
      'Steps:',
      '  1. Go to https://www.linkedin.com/developers/tools/oauth/token-generator',
      '  2. Generate new token with scopes: openid profile w_member_social',
      '  3. Update LINKEDIN_TOKEN secret in GitHub repo Settings → Secrets & Variables → Actions',
      `  4. Update LINKEDIN_TOKEN_EXPIRES_AT to: ${new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()}`,
    ].join('\n');
    fs.writeFileSync(ALERT_FILE, alertMsg, 'utf8');
    console.error('\n' + alertMsg + '\n');
  }

  return { valid: true, expiresAt, daysRemaining, alertNeeded };
}

async function verifyPostLive(postUrn, retries = 2) {
  const token = process.env.LINKEDIN_TOKEN;
  for (let i = 0; i < retries; i++) {
    try {
      const live = await verifyPost(token, postUrn);
      if (live) return { live: true, postUrn, verifiedAt: new Date().toISOString() };
    } catch { /* retry */ }
    if (i < retries - 1) await new Promise(r => setTimeout(r, 30000));
  }
  return { live: false, postUrn, verifiedAt: new Date().toISOString() };
}

function logRun(data) {
  const entry = JSON.stringify({ runAt: new Date().toISOString(), ...data }) + '\n';
  fs.appendFileSync(RUN_LOG, entry, 'utf8');
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = args[0];

  if (flag === '--check-token') {
    console.log(JSON.stringify(checkToken(), null, 2));
  } else if (flag === '--verify-post') {
    const postUrn = args[1];
    if (!postUrn) { console.error('--verify-post requires a post URN'); process.exit(1); }
    verifyPostLive(postUrn)
      .then(r => console.log(JSON.stringify(r, null, 2)))
      .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
  } else if (flag === '--log-run') {
    const data = JSON.parse(args[1] || '{}');
    logRun(data);
    console.log(JSON.stringify({ logged: true }));
  } else {
    console.error('Usage: node src/monitor.js --check-token | --verify-post <urn> | --log-run <json>');
    process.exit(1);
  }
}

module.exports = { checkToken, verifyPostLive, logRun };
