#!/usr/bin/env node
'use strict';

/**
 * Phase 1 — Generate content + image, save as pending.
 * Runs at 06:00 UTC daily. Publishing is currently manual (daily-post.yml's cron is
 * disabled) — the new post becomes the featured "Next Post" in the dashboard, auto-
 * archiving whatever was previously featured so it doesn't get stuck there forever.
 * Also called by regenerate-post.yml when the user requests a rework with notes.
 *
 * Args:
 *   --post-id N          Regenerate an existing post N
 *   --mode <mode>        image (default) | text | both — what to regenerate
 *   --notes "text"       Extra instructions for the regeneration
 */

const path = require('path');
const fs = require('fs');
const { generateContent, reviseContent } = require('./content');
const { buildImage } = require('./image');
const { ops: db } = require('./db');
const { isPaused } = require('./pause');
const { getActiveTemplate } = require('./templates');

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function main() {
  if (isPaused()) {
    console.log('[generate] Pipeline paused — skipping generation.');
    return;
  }

  const postIdArg = getArg('--post-id');
  const notes = getArg('--notes');
  const mode = getArg('--mode') || 'image';

  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  // ── Regeneration mode: re-make image and/or text for an existing post ──────
  if (postIdArg) {
    const postId = Number(postIdArg);
    const post = db.getById(postId);
    if (!post) { console.error(`Post ${postId} not found`); process.exit(1); }

    console.log(`[generate] Regenerating post id=${postId} (mode=${mode})`);
    if (notes) console.log(`[generate] Notes: ${notes}`);

    let angle = post.angle;
    let body = post.body;
    let hashtags = post.hashtags;
    let imagePrompt = post.image_prompt;
    let engagementText = post.engagement_text;
    let headlineText = post.angle || 'AI & Sport';

    // ── Text revision (mode=text or mode=both) ────────────────────────────────
    if (mode === 'text' || mode === 'both') {
      let parsedHashtags = [];
      try { parsedHashtags = JSON.parse(post.hashtags || '[]'); } catch { /* leave empty */ }

      const revised = await reviseContent({
        angle: post.angle,
        body: post.body,
        hashtags: parsedHashtags,
        imagePrompt: post.image_prompt,
      }, notes);

      angle = revised.angle;
      body = revised.body;
      hashtags = JSON.stringify(revised.hashtags || parsedHashtags);
      imagePrompt = revised.imagePrompt || post.image_prompt;
      engagementText = revised.imageEngagementText || post.engagement_text;
      headlineText = revised.headlineText || angle;

      db.update(postId, {
        angle,
        body,
        hashtags,
        imagePrompt,
        engagementText,
        reviewStatus: 'pending',
        regenerationNotes: notes || null,
      });
      console.log(`[generate] ✅ Text revised for post ${postId}`);
    }

    // ── Image rebuild (mode=image or mode=both) ───────────────────────────────
    if (mode === 'image' || mode === 'both') {
      const template = getActiveTemplate();
      const finalImagePrompt = mode === 'both'
        ? [imagePrompt, template ? `Style reference: ${template.styleNotes}` : null].filter(Boolean).join('. ')
        : [
            post.image_prompt,
            notes ? `Additional guidance: ${notes}` : null,
            template ? `Style reference: ${template.styleNotes}` : null,
          ].filter(Boolean).join('. ');

      const outputPath = path.join(IMAGES_DIR, `post_${postId}_regen_${Date.now()}.png`);
      const newImagePath = await buildImage({
        prompt: finalImagePrompt,
        headline: headlineText,
        engagementText: engagementText || 'Data-driven. Game-changing.',
        outputPath,
        notes,
      });

      db.update(postId, {
        imagePath: newImagePath,
        reviewStatus: 'pending',
        regenerationNotes: notes || null,
      });
      console.log(`[generate] ✅ New image: ${newImagePath}`);
    }

    console.log(JSON.stringify({ postId, mode }));
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

  // Auto-archive whatever was previously featured as "Next Post" so this new one
  // takes its place — unless the user already moved it themselves. Posts that are
  // pending/rejected stay as-is; only the currently-featured (non-archived) ones
  // get archived, since Gallery/All Posts remain fully browsable regardless.
  const previouslyFeatured = db.all().filter(p =>
    p.id !== postId && p.status === 'pending' && p.review_status !== 'archived' && p.review_status !== 'rejected'
  );
  for (const p of previouslyFeatured) {
    db.update(p.id, { reviewStatus: 'archived' });
    console.log(`[generate] Auto-moved previous post ${p.id} to gallery (archived)`);
  }

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

  console.log(`[generate] ✅ Post id=${postId} ready for review — publishing is manual right now.`);
  console.log(JSON.stringify({ postId, angle: content.angle, imagePath, scheduledFor: content.scheduledFor }));
}

if (require.main === module) {
  main().catch(err => { console.error('[generate] Error:', err.message); process.exit(1); });
}
