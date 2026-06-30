# Social Posts System — Claude Code Orchestrator

## Project Purpose
Automated LinkedIn post creator and publisher. Generates AI & Sport themed posts daily using Claude Haiku for content, Pollinations.ai Flux for background images, node-canvas for branding overlays, and the LinkedIn ugcPosts API to publish.

## Architecture Overview

```
Orchestrator (Claude Code)
├── content-strategist  → picks angle, writes copy + hashtags → JSON
├── image-designer      → generates Pollinations prompt, creates PNG
├── publisher           → uploads image asset, creates ugcPost on LinkedIn
├── state-manager       → reads/writes SQLite (data/posts.db)
└── monitor-qa          → checks token expiry, verifies post live, logs metrics
```

## Sub-agent Invocation Rules

1. **content-strategist** — invoke first for every new post cycle. Pass today's date and any recent post history (last 7 post bodies from DB) to avoid topic repetition. Returns `ContentPayload` JSON.
2. **image-designer** — invoke after content-strategist succeeds. Pass the `ContentPayload`. Returns `ImagePayload` JSON with local image path.
3. **publisher** — invoke after image-designer succeeds. Pass `ContentPayload` + `ImagePayload`. Returns `PublishResult` JSON with post URN or error.
4. **state-manager** — invoke after publisher to persist the result. Also invoke standalone to query/update post status.
5. **monitor-qa** — invoke at start of every run to check token validity, and at end to verify the post went live. Also runs independently on schedule to alert near token expiry (day ~55).

## JSON Hand-off Schema

### ContentPayload
```json
{
  "angle": "string (the AI & Sport topic angle chosen)",
  "body": "string (full LinkedIn post text, max 3000 chars)",
  "hashtags": ["string"],
  "imagePrompt": "string (Pollinations/Flux background prompt)",
  "headlineText": "string (short headline for canvas overlay, max 60 chars)",
  "scheduledFor": "ISO8601 datetime"
}
```

### ImagePayload
```json
{
  "imagePath": "string (absolute local path to PNG)",
  "width": 1080,
  "height": 1080,
  "prompt": "string (prompt used)"
}
```

### PublishResult
```json
{
  "success": true,
  "postUrn": "urn:li:ugcPost:XXXX",
  "assetUrn": "urn:li:digitalmediaAsset:XXXX",
  "postedAt": "ISO8601 datetime",
  "error": null
}
```

## Database Schema (data/posts.db)

```sql
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  scheduled_for TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | posted | failed | deleted
  angle TEXT,
  body TEXT NOT NULL,
  hashtags TEXT,  -- JSON array
  image_path TEXT,
  image_prompt TEXT,
  asset_urn TEXT,
  post_urn TEXT,
  error TEXT,
  posted_at TEXT
);

CREATE TABLE IF NOT EXISTS token_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  days_remaining INTEGER,
  alert_sent INTEGER DEFAULT 0
);
```

## Environment Variables Required
- `ANTHROPIC_API_KEY` — Claude API key
- `LINKEDIN_TOKEN` — 60-day LinkedIn access token
- `LINKEDIN_PERSON_URN` — e.g. `urn:li:person:782bbtaQ`
- `LINKEDIN_CLIENT_ID` — LinkedIn app client ID
- `LINKEDIN_CLIENT_SECRET` — LinkedIn app client secret
- `LINKEDIN_TOKEN_EXPIRES_AT` — ISO8601 expiry datetime
- `GITHUB_TOKEN` — (optional) for dashboard write-back via GitHub API

## File Layout
```
src/
  run.js          — daily cron entrypoint
  content.js      — Claude Haiku content generation
  image.js        — Pollinations fetch + node-canvas overlay
  linkedin.js     — LinkedIn API client (ugcPosts, assets)
  db.js           — SQLite wrapper
  monitor.js      — token expiry check + post verification
scripts/
  auth.js         — interactive OAuth helper (run once)
  generate-batch.js — batch-generate posts via sub-agents
data/
  posts.db        — SQLite database (committed to repo)
dashboard/
  index.html      — GitHub Pages dashboard (sql.js read-only)
.github/workflows/
  daily-post.yml  — GitHub Actions cron
.claude/agents/   — 5 sub-agent markdown definitions
```

## Tool Access per Sub-agent
- **content-strategist**: Read (DB for history), no network except Claude API (handled by the script)
- **image-designer**: Bash (fetch Pollinations, run node-canvas), Read/Write (image files)
- **publisher**: Bash (curl LinkedIn API), Read (image file)
- **state-manager**: Read, Write, Bash (sqlite3 CLI fallback)
- **monitor-qa**: Read, Bash (check HTTP status, compute dates)

## Decomposition Rules for Orchestrator
- Never run publisher without a valid token check from monitor-qa first.
- Never commit the access token to git — always use secrets.
- On any LinkedIn 401 response: stop immediately, mark run as failed, trigger re-auth alert.
- On image generation failure: retry once with a simpler prompt, then post text-only.
- Log every run outcome to data/posts.db before exiting.
