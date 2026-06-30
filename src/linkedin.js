#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');

function linkedinRequest({ method, path, token, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.linkedin.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function uploadBinary(uploadUrl, filePath, token) {
  return new Promise((resolve, reject) => {
    const fileBuffer = fs.readFileSync(filePath);
    const url = new URL(uploadUrl);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileBuffer.length,
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

async function getUserInfo(token) {
  const res = await linkedinRequest({ method: 'GET', path: '/v2/userinfo', token });
  if (res.status !== 200) throw new Error(`userinfo failed: ${res.status} ${res.body}`);
  return JSON.parse(res.body);
}

async function registerImageUpload(token, personUrn) {
  const body = {
    registerUploadRequest: {
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      owner: personUrn,
      serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
    },
  };
  const res = await linkedinRequest({
    method: 'POST',
    path: '/v2/assets?action=registerUpload',
    token,
    body,
  });
  if (res.status !== 200) throw new Error(`registerUpload failed: ${res.status} ${res.body}`);
  const parsed = JSON.parse(res.body);
  const assetUrn = parsed.value.asset;
  const uploadUrl = parsed.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  return { assetUrn, uploadUrl };
}

async function uploadImage(uploadUrl, imagePath, token) {
  const res = await uploadBinary(uploadUrl, imagePath, token);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`image upload failed: ${res.status} ${res.body}`);
  }
  return true;
}

async function createUgcPost({ token, personUrn, body, assetUrn, headlineText }) {
  const postBody = {
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: body },
        shareMediaCategory: assetUrn ? 'IMAGE' : 'NONE',
        ...(assetUrn ? {
          media: [{ status: 'READY', media: assetUrn, title: { text: headlineText || 'AI & Sport' } }],
        } : {}),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const res = await linkedinRequest({ method: 'POST', path: '/v2/ugcPosts', token, body: postBody });

  if (res.status === 201) {
    const postUrn = res.headers['x-restli-id'] || res.headers['X-RestLi-Id'];
    return { success: true, postUrn };
  }
  if (res.status === 401) throw Object.assign(new Error('TOKEN_EXPIRED'), { code: 'TOKEN_EXPIRED' });
  if (res.status === 429) throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
  throw new Error(`ugcPost failed: ${res.status} ${res.body}`);
}

async function verifyPost(token, postUrn) {
  const encoded = encodeURIComponent(postUrn);
  // LinkedIn may return a urn:li:share or urn:li:ugcPost — check both endpoints
  const path = postUrn.includes('urn:li:share:')
    ? `/v2/shares/${encoded}`
    : `/v2/ugcPosts/${encoded}`;
  const res = await linkedinRequest({ method: 'GET', path, token });
  return res.status === 200;
}

module.exports = { getUserInfo, registerImageUpload, uploadImage, createUgcPost, verifyPost };
