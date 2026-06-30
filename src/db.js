#!/usr/bin/env node
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'posts.db');

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    scheduled_for TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    review_status TEXT NOT NULL DEFAULT 'pending',
    angle TEXT,
    body TEXT NOT NULL,
    hashtags TEXT,
    image_path TEXT,
    image_prompt TEXT,
    engagement_text TEXT,
    asset_urn TEXT,
    post_urn TEXT,
    error TEXT,
    posted_at TEXT,
    approved_at TEXT,
    regeneration_notes TEXT
  );
  CREATE TABLE IF NOT EXISTS token_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    days_remaining INTEGER,
    alert_sent INTEGER DEFAULT 0
  );
`;

function openDb() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(INIT_SQL);
  // Add new columns to existing DB (safe on new columns)
  const pragmas = db.prepare("PRAGMA table_info(posts)").all();
  const cols = pragmas.map(r => r.name);
  if (!cols.includes('review_status')) db.exec("ALTER TABLE posts ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'");
  if (!cols.includes('engagement_text')) db.exec("ALTER TABLE posts ADD COLUMN engagement_text TEXT");
  if (!cols.includes('approved_at')) db.exec("ALTER TABLE posts ADD COLUMN approved_at TEXT");
  if (!cols.includes('regeneration_notes')) db.exec("ALTER TABLE posts ADD COLUMN regeneration_notes TEXT");
  return db;
}

const ops = {
  insert(data) {
    const db = openDb();
    const stmt = db.prepare(`
      INSERT INTO posts (angle, body, hashtags, image_path, image_prompt, engagement_text, scheduled_for, status, review_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
    `);
    const result = stmt.run(
      data.angle || null,
      data.body,
      Array.isArray(data.hashtags) ? JSON.stringify(data.hashtags) : (data.hashtags || null),
      data.imagePath || null,
      data.imagePrompt || null,
      data.engagementText || null,
      data.scheduledFor || null,
    );
    db.close();
    return { id: Number(result.lastInsertRowid) };
  },

  update(id, data) {
    const db = openDb();
    const fieldMap = {
      status: 'status', reviewStatus: 'review_status', postUrn: 'post_urn',
      assetUrn: 'asset_urn', postedAt: 'posted_at', error: 'error',
      imagePath: 'image_path', approvedAt: 'approved_at',
      regenerationNotes: 'regeneration_notes', body: 'body',
      engagementText: 'engagement_text',
    };
    const allowed = Object.values(fieldMap);
    const setClauses = [];
    const values = [];
    for (const [key, val] of Object.entries(data)) {
      const col = fieldMap[key] || key;
      if (allowed.includes(col)) {
        setClauses.push(`${col} = ?`);
        values.push(val);
      }
    }
    if (setClauses.length === 0) { db.close(); return { updated: 0 }; }
    values.push(Number(id));
    const result = db.prepare(`UPDATE posts SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    db.close();
    return { updated: result.changes };
  },

  recent(n = 7) {
    const db = openDb();
    const rows = db.prepare(
      `SELECT id, created_at, angle, body, hashtags, status, review_status, post_urn, image_path, engagement_text, scheduled_for
       FROM posts WHERE status NOT IN ('deleted') ORDER BY created_at DESC LIMIT ?`
    ).all(Number(n));
    db.close();
    return rows;
  },

  pending() {
    const db = openDb();
    const rows = db.prepare(
      `SELECT * FROM posts WHERE status = 'pending' ORDER BY scheduled_for ASC`
    ).all();
    db.close();
    return rows;
  },

  // Get the next post scheduled to be published (status=pending, scheduled_for <= now)
  nextToPublish() {
    const db = openDb();
    const row = db.prepare(
      `SELECT * FROM posts WHERE status = 'pending' AND review_status != 'rejected'
       ORDER BY scheduled_for ASC LIMIT 1`
    ).get();
    db.close();
    return row || null;
  },

  getById(id) {
    const db = openDb();
    const row = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(Number(id));
    db.close();
    return row || null;
  },

  'log-token'(data) {
    const db = openDb();
    const result = db.prepare(
      `INSERT INTO token_log (expires_at, days_remaining) VALUES (?, ?)`
    ).run(data.expiresAt, data.daysRemaining);
    if (data.daysRemaining <= 5) {
      db.prepare(`UPDATE token_log SET alert_sent = 1 WHERE id = ?`).run(result.lastInsertRowid);
    }
    db.close();
    return { logged: Number(result.lastInsertRowid) };
  },

  all() {
    const db = openDb();
    const rows = db.prepare(`SELECT * FROM posts ORDER BY created_at DESC`).all();
    db.close();
    return rows;
  },
};

if (require.main === module) {
  const [,, op, ...rest] = process.argv;
  if (!op || !ops[op]) {
    console.error(`Usage: node src/db.js <op> [args]\nOps: ${Object.keys(ops).join(', ')}`);
    process.exit(1);
  }
  try {
    let result;
    if (op === 'update') result = ops.update(Number(rest[0]), JSON.parse(rest[1]));
    else if (op === 'recent') result = ops.recent(rest[0] ? Number(rest[0]) : 7);
    else if (op === 'getById') result = ops.getById(Number(rest[0]));
    else if (op === 'all') result = ops.all();
    else if (op === 'pending') result = ops.pending();
    else if (op === 'nextToPublish') result = ops.nextToPublish();
    else if (op === 'log-token') result = ops['log-token'](JSON.parse(rest[0]));
    else if (op === 'insert') result = ops.insert(JSON.parse(rest[0]));
    else result = ops[op](rest[0] ? JSON.parse(rest[0]) : undefined);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

module.exports = { openDb, ops };
