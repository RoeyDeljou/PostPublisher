#!/usr/bin/env node
'use strict';

/**
 * Batch-generate N posts using Claude Haiku and store them as pending in the DB.
 * Does NOT publish — posts sit as 'pending' for review before publishing.
 *
 * Usage: node scripts/generate-batch.js [--count 7]
 * Env: ANTHROPIC_API_KEY
 */

const { generateContent } = require('../src/content');
const { ops: db } = require('../src/db');

async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf('--count');
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 7;

  console.log(`\n[batch] Generating ${count} posts...\n`);

  const results = [];
  for (let i = 0; i < count; i++) {
    console.log(`[batch] Post ${i + 1}/${count}...`);
    try {
      const recent = db.recent(i + 7);
      const recentBodies = recent.map(p => p.body);
      const content = await generateContent(recentBodies);

      const { id } = db.insert({
        angle: content.angle,
        body: content.body,
        hashtags: content.hashtags,
        imagePath: null,
        imagePrompt: content.imagePrompt,
        scheduledFor: content.scheduledFor,
      });

      results.push({ id, angle: content.angle, headline: content.headlineText });
      console.log(`  ✅ id=${id} — ${content.angle}`);

      // Pause between generations to avoid hitting rate limits
      if (i < count - 1) await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      results.push({ error: err.message });
    }
  }

  console.log(`\n[batch] Done. ${results.filter(r => !r.error).length}/${count} posts generated.`);
  console.log('\nPending posts (run `node src/db.js pending` to review):');
  const pending = db.pending();
  for (const p of pending) {
    console.log(`  id=${p.id} | ${p.scheduled_for || 'no schedule'} | ${(p.angle || '').substring(0, 60)}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
