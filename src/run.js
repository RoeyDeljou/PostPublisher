#!/usr/bin/env node
'use strict';

/**
 * Phase 2 — Publish the next pending post to LinkedIn.
 * Runs at 08:00 UTC daily. Reads the earliest pending post that hasn't been rejected.
 * If review_status='approved' or 'pending' (default) → publishes.
 * If review_status='rejected' → skips and logs.
 *
 * Also reads data/pending-command.json for last-minute overrides from the dashboard.
 */

const path = require('path');
const fs = require('fs');
const { checkToken, verifyPostLive, logRun } = require('./monitor');
const { registerImageUpload, uploadImage, createUgcPost } = require('./linkedin');
const { ops: db } = require('./db');

const COMMAND_FILE = path.join(__dirname, '..', 'data', 'pending-command.json');

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function loadCommand() {
  try {
    if (fs.existsSync(COMMAND_FILE)) {
      const cmd = JSON.parse(fs.readFileSync(COMMAND_FILE, 'utf8'));
      console.log(`[run] Dashboard command loaded: action=${cmd.action}, post_id=${cmd.post_id}`);
      return cmd;
    }
  } catch { /* ignore malformed command */ }
  return null;
}

function clearCommand() {
  try { if (fs.existsSync(COMMAND_FILE)) fs.unlinkSync(COMMAND_FILE); } catch {}
}

async function run() {
  console.log(`[run] Starting at ${new Date().toISOString()}`);

  // ── 1. Token check ──────────────────────────────────────────────────────────
  const tokenStatus = checkToken();
  if (!tokenStatus.valid) {
    console.error('[run] ABORT: LinkedIn token invalid or expired.');
    logRun({ status: 'aborted', reason: 'TOKEN_INVALID' });
    process.exit(1);
  }
  if (tokenStatus.alertNeeded) {
    console.warn(`[run] ⚠️  Token expires in ${tokenStatus.daysRemaining} days — re-auth needed soon!`);
  }

  const LINKEDIN_TOKEN = requireEnv('LINKEDIN_TOKEN');
  const LINKEDIN_PERSON_URN = requireEnv('LINKEDIN_PERSON_URN');
  const AUTHOR_URN = process.env.LINKEDIN_ORG_URN || LINKEDIN_PERSON_URN;
  console.log(`[run] Author: ${AUTHOR_URN}`);

  // ── 2. Load dashboard command (if any) ─────────────────────────────────────
  const command = loadCommand();

  // ── 3. Find the post to publish ────────────────────────────────────────────
  let post = db.nextToPublish();
  if (!post) {
    console.log('[run] No pending posts to publish. Done.');
    logRun({ status: 'skipped', reason: 'NO_PENDING_POST' });
    clearCommand();
    process.exit(0);
  }

  // Apply dashboard command overrides
  if (command && command.post_id === post.id) {
    if (command.action === 'delete') {
      db.update(post.id, { status: 'deleted' });
      console.log(`[run] Post ${post.id} deleted by dashboard command.`);
      logRun({ status: 'skipped', reason: 'DELETED_BY_USER', postId: post.id });
      clearCommand();
      process.exit(0);
    }
    if (command.action === 'reject_image') {
      db.update(post.id, { reviewStatus: 'rejected', regenerationNotes: command.notes || null });
      console.log(`[run] Post ${post.id} image rejected — skipping publish.`);
      logRun({ status: 'skipped', reason: 'IMAGE_REJECTED', postId: post.id });
      clearCommand();
      process.exit(0);
    }
    if (command.action === 'edit' && command.body) {
      // Use dashboard-edited body
      post = { ...post, body: command.body };
      console.log(`[run] Using dashboard-edited body for post ${post.id}`);
    }
  }

  if (post.review_status === 'rejected') {
    console.log(`[run] Post ${post.id} was rejected — skipping.`);
    logRun({ status: 'skipped', reason: 'POST_REJECTED', postId: post.id });
    clearCommand();
    process.exit(0);
  }

  console.log(`[run] Publishing post id=${post.id}: ${post.angle}`);

  // ── 4. Upload image + create post ─────────────────────────────────────────
  let assetUrn = null;
  try {
    const imagePath = post.image_path;
    if (imagePath && fs.existsSync(imagePath)) {
      console.log('[run] Registering image asset...');
      const { assetUrn: au, uploadUrl } = await registerImageUpload(LINKEDIN_TOKEN, AUTHOR_URN);
      assetUrn = au;
      console.log('[run] Uploading image...');
      await uploadImage(uploadUrl, imagePath, LINKEDIN_TOKEN);
      console.log(`[run] Asset: ${assetUrn}`);
    } else {
      console.log('[run] No image — publishing text-only.');
    }

    const { postUrn } = await createUgcPost({
      token: LINKEDIN_TOKEN,
      personUrn: AUTHOR_URN,
      body: post.body,
      assetUrn,
      headlineText: post.angle || 'AI & Sport',
    });

    const postedAt = new Date().toISOString();
    db.update(post.id, { status: 'posted', postUrn, assetUrn, postedAt });
    clearCommand();

    console.log(`[run] Verifying post live...`);
    const v = await verifyPostLive(postUrn);
    if (!v.live) console.warn('[run] Post not yet verifiable — still processing.');

    logRun({ status: 'success', postId: post.id, postUrn, daysUntilExpiry: tokenStatus.daysRemaining });
    console.log(`[run] ✅ Done. Post URN: ${postUrn}`);
    process.exit(0);

  } catch (err) {
    const errCode = err.code || err.message;
    console.error(`[run] Publish error: ${errCode}`);
    db.update(post.id, { status: 'failed', error: errCode });
    logRun({ status: 'failed', postId: post.id, error: errCode });
    clearCommand();
    if (errCode === 'TOKEN_EXPIRED') process.exit(2);
    process.exit(1);
  }
}

run().catch(err => { console.error('[run] Unhandled error:', err); process.exit(1); });
