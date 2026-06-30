#!/usr/bin/env node
'use strict';

/**
 * One-time OAuth helper. Run locally to get your initial LinkedIn access token.
 *
 * For the personal app (w_member_social):
 *   LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... node scripts/auth.js
 *
 * For the org app (Community Management API, w_organization_social):
 *   LINKEDIN_CLIENT_ID=<org_app_id> LINKEDIN_CLIENT_SECRET=<org_app_secret> node scripts/auth.js --org
 */

const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

const isOrgMode = process.argv.includes('--org');

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/callback';
const SCOPES = isOrgMode
  ? 'w_organization_social r_organization_social'
  : 'openid profile w_member_social';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌  Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET before running.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&state=${state}`;

console.log('\n=== LinkedIn OAuth Helper ===\n');
console.log('1. Open this URL in your browser:\n');
console.log('   ' + authUrl);
console.log('\n2. Approve the authorization request.');
console.log('3. You will be redirected to your redirect URI with a code parameter.');
console.log('4. Paste the full redirect URL below (or just the `code` value):\n');

// Start a local server to capture the callback automatically if redirect is localhost
const redirectHost = new URL(REDIRECT_URI).hostname;
if (redirectHost === 'localhost' || redirectHost === '127.0.0.1') {
  const port = new URL(REDIRECT_URI).port || 3000;
  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname !== '/callback') {
      res.end('Not found'); return;
    }
    const { code, state: returnedState, error } = parsed.query;

    if (error) {
      res.end(`<h1>Error: ${error}</h1>`);
      console.error('OAuth error:', error);
      server.close();
      process.exit(1);
    }
    if (returnedState !== state) {
      res.end('<h1>State mismatch — possible CSRF</h1>');
      server.close();
      process.exit(1);
    }

    res.end('<h1>Authorization received! Check your terminal.</h1>');
    server.close();

    await exchangeCode(code);
  });

  server.listen(port, () => {
    console.log(`Listening on http://localhost:${port}/callback for the OAuth callback...\n`);
  });
} else {
  // Manual mode: read from stdin
  process.stdin.resume();
  process.stdout.write('Paste code or full redirect URL: ');
  process.stdin.once('data', async (data) => {
    const input = data.toString().trim();
    let code = input;
    if (input.includes('code=')) {
      code = new URL(input).searchParams.get('code');
    }
    await exchangeCode(code);
    process.exit(0);
  });
}

async function exchangeCode(code) {
  console.log('\n[auth] Exchanging authorization code for access token...');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const tokenRes = await httpsPost('https://www.linkedin.com/oauth/v2/accessToken', params.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (tokenRes.status !== 200) {
    console.error('Token exchange failed:', tokenRes.body);
    process.exit(1);
  }

  const token = JSON.parse(tokenRes.body);
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  console.log('\n✅  Authorization successful!\n');

  if (isOrgMode) {
    console.log('Update your .env and GitHub Secrets with:\n');
    console.log(`LINKEDIN_TOKEN=${token.access_token}`);
    console.log(`LINKEDIN_TOKEN_EXPIRES_AT=${expiresAt}`);
    console.log(`LINKEDIN_ORG_URN=urn:li:organization:135054104`);
    console.log(`LINKEDIN_CLIENT_ID=${CLIENT_ID}`);
    console.log(`LINKEDIN_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`\nToken expires: ${expiresAt} (~60 days)`);
  } else {
    // Fetch person URN via OpenID userinfo
    const userInfoRes = await httpsGet('https://api.linkedin.com/v2/userinfo', token.access_token);
    const userInfo = JSON.parse(userInfoRes.body);
    const personUrn = `urn:li:person:${userInfo.sub}`;
    console.log('Add these to your GitHub repo Secrets:\n');
    console.log(`LINKEDIN_TOKEN=${token.access_token}`);
    console.log(`LINKEDIN_TOKEN_EXPIRES_AT=${expiresAt}`);
    console.log(`LINKEDIN_PERSON_URN=${personUrn}`);
    console.log(`LINKEDIN_CLIENT_ID=${CLIENT_ID}`);
    console.log(`LINKEDIN_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`\nToken expires: ${expiresAt} (~60 days)`);
  }
  console.log('');
}

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}
