#!/usr/bin/env node
'use strict';

/**
 * Phase 1 — Generate content + image, save as pending.
 * Runs at 06:00 UTC daily, giving a 2-hour review window before auto-publish at 08:00 UTC.
 * Also called by regenerate-image.yml when the user requests a new image with notes.
 *
 * Args:
 *   --post-id N      Regenerate image for existing post N (keeps body, replaces image)
 *   --notes "text"   Extra instructions for content/image generation
 *   --image-only     Only regenerate image, do not touch the post body
 */

const path = require('path');
const fs = require('fs');
const { generateContent } = require('./content');
const { buildImage } = require('./image');
const { ops: db } = require('./db');

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}
const hasFlag = flag => process.argv.includes(flag);

async function main() {
  const postIdArg = getArg('--post-id');
  const notes = getArg('--notes');
  const imageOnly = hasFlag('--image-only');

  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  // ── Regeneration mode: re-make image for existing post ─────────────────────
  if (postIdArg) {
    const postId = Number(postIdArg);
    const post = db.getById(postId);
    if (!post) { console.error(`Post ${postId} not found`); process.exit(1); }

    console.log(`[generate] Regenerating image for post id=${postId}`);
    if (notes) console.log(`[generate] Notes: ${notes}`);

    const imagePrompt = notes
      ? `${post.image_prompt}. Additional guidance: ${notes}`
      : post.image_prompt;

    const outputPath = path.join(IMAGES_DIR, `post_${postId}_regen_${Date.now()}.png`);
    const imagePath = await buildImage({
      prompt: imagePrompt,
      headline: post.angle || 'AI & Sport',
      engagementText: post.engagement_text || 'Data-driven. Game-changing.',
      outputPath,
      notes,
    });

    db.update(postId, {
      imagePath,
      reviewStatus: 'pending',
      regenerationNotes: notes || null,
    });

    console.log(`[generate] ✅ New image: ${imagePath}`);
    console.log(JSON.stringify({ postId, imagePath }));
    return;
  }

  // ── Fresh generation mode ──────────────────────────────────────────────────
  console.log('[generate] Generating new post content via Claude Haiku...');
  const recentPosts = db.recent(7);
  const recentBodies = recentPosts.map(p => p.body);
  const content = await generateContent(recentBodies, notes);

  console.log(`[generate] Angle: ${content.angle}`);
  console.log(`[generate] Headline: ${content.headlineText}`);
  console.log(`[generate] Scheduled: ${content.scheduledFor}`);

  const { id: postId } = db.insert({
    angle: content.angle,
    body: content.body,
    hashtags: content.hashtags,
    imagePath: null,
    imagePrompt: content.imagePrompt,
    engagementText: content.imageEngagementText,
    scheduledFor: content.scheduledFor,
  });
  console.log(`[generate] Created pending post id=${postId}`);

  const outputPath = path.join(IMAGES_DIR, `post_${postId}_${Date.now()}.png`);
  let imagePath = null;
  try {
    console.log('[generate] Building image...');
    imagePath = await buildImage({
      prompt: content.imagePrompt,
      headline: content.headlineText,
      engagementText: content.imageEngagementText,
      outputPath,
    });
    console.log(`[generate] Image ready: ${imagePath}`);
    db.update(postId, { imagePath });
  } catch (err) {
    console.warn(`[generate] Image failed: ${err.message} — will post text-only`);
  }

  console.log(`[generate] ✅ Post id=${postId} ready for review. Auto-publishes at scheduled time unless rejected.`);
  console.log(JSON.stringify({ postId, angle: content.angle, imagePath, scheduledFor: content.scheduledFor }));
}

if (require.main === module) {
  main().catch(err => { console.error('[generate] Error:', err.message); process.exit(1); });
}
