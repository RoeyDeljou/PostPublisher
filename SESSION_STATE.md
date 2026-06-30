# Session State — Resume Guide

This file captures the exact state of the project so you can resume on any machine
with full context. Last updated: 2026-06-28.

---

## What this system does

Automated LinkedIn post creator and publisher for **Elite Sports AI Forge** (company page).
- Generates AI & Sport themed posts daily using Claude Haiku 4.5
- Creates branded 1080×1080 images via Pollinations.ai Flux + @napi-rs/canvas overlay
- Publishes to LinkedIn via the `v2/ugcPosts` API
- Two-phase schedule: **generate at 06:00 UTC → 2-hour review window → auto-publish at 08:00 UTC**
- Dashboard on GitHub Pages for visual review, approve/reject/regenerate

---

## Credentials & IDs (do NOT commit secrets — store in GitHub Secrets)

| Variable | Value / Where to find |
|---|---|
| `LINKEDIN_PERSON_URN` | `urn:li:person:JbsNQOjGRQ` |
| `LINKEDIN_ORG_URN` | `urn:li:organization:135054104` |
| `LINKEDIN_TOKEN_EXPIRES_AT` | `2026-08-27T18:27:31.379Z` |
| `LINKEDIN_CLIENT_ID` | `7722x75c88t0gl` (personal app) |
| All secrets | GitHub → Settings → Secrets → Actions |

**Token renewal:** Run `node scripts/auth.js` before 2026-08-22 and update `LINKEDIN_TOKEN` + `LINKEDIN_TOKEN_EXPIRES_AT` secrets.

---

## Pending work (what's NOT done yet)

### 1. Company page posting (BLOCKED — waiting on LinkedIn)
- Need **"Community Management API"** product on a **new separate LinkedIn app**
- LinkedIn requires this product to be the ONLY product on an app
- Current personal app (`7722x75c88t0gl`) has "Share on LinkedIn" + OpenID → cannot add Community Management
- **Action:** Create a new LinkedIn app at developer.linkedin.com, add ONLY "Community Management API", get new Client ID + Secret, run `node scripts/auth.js --org` with those credentials, update `.env` and GitHub Secrets
- Code is already wired: set `LINKEDIN_ORG_URN=urn:li:organization:135054104` in GitHub Secrets and the system will use it automatically

### 2. Push to GitHub / GitHub Actions automation
- Repo: https://github.com/RoeyDeljou/PostPublisher
- Secrets to add (Settings → Secrets → Actions):
  - `ANTHROPIC_API_KEY`
  - `LINKEDIN_TOKEN`
  - `LINKEDIN_TOKEN_EXPIRES_AT`
  - `LINKEDIN_PERSON_URN`
  - `LINKEDIN_ORG_URN`
  - `LINKEDIN_CLIENT_ID`
  - `LINKEDIN_CLIENT_SECRET`
- Set workflow permissions to **Read and write** (Settings → Actions → General)
- **Two workflows will auto-run:** `generate-post.yml` at 06:00 UTC, `daily-post.yml` at 08:00 UTC

### 3. GitHub Pages dashboard
- Settings → Pages → Branch: `main`, Folder: `/dashboard`
- Then open dashboard → ⚙ Settings → enter: GitHub username, repo name, and a fine-grained PAT with Actions+Contents write permissions
- This enables Approve / Regenerate buttons in the dashboard

### 4. Company logo
- Save your logo file as `data/logo.png` in the project root
- It will automatically appear top-left on all generated images

---

## Architecture (quick reference)

```
src/
  generate.js   Phase 1: content + image → saved as pending (06:00 UTC)
  run.js        Phase 2: publish pending post to LinkedIn (08:00 UTC)
  content.js    Claude Haiku call — returns ContentPayload JSON
  image.js      Pollinations fetch + @napi-rs/canvas brand overlay
  linkedin.js   LinkedIn API client (register upload, ugcPost)
  monitor.js    Token expiry check, post verification, run log
  db.js         node:sqlite wrapper (no native deps — Node 24 built-in)

.claude/agents/
  content-strategist.md
  image-designer.md
  publisher.md
  state-manager.md
  monitor-qa.md

.github/workflows/
  generate-post.yml       06:00 UTC daily + manual
  daily-post.yml          08:00 UTC daily + manual
  regenerate-image.yml    workflow_dispatch: post_id + notes
  update-post-status.yml  workflow_dispatch: post_id + status

dashboard/index.html      GitHub Pages dashboard (3 tabs: Next Post, Gallery, All Posts)
data/posts.db             SQLite DB — committed to repo after each run
data/pending-command.json Dashboard writes here; publish job reads and clears it
```

## Review flow (how the 2-hour window works)

1. 06:00 UTC: `generate-post.yml` runs → content + image generated → saved as `pending` in DB
2. You open the dashboard → **Next Post** tab shows the full preview
3. Options:
   - **Do nothing** → post auto-publishes at 08:00 UTC
   - **Edit text** → click "Save edits" → your text is used at publish time
   - **Regenerate Image** → enter notes → triggers `regenerate-image.yml` → new image in ~2 min → refresh dashboard
   - **Approve** → explicitly confirms (same as doing nothing, but recorded)
   - **Delete** → post is cancelled
4. 08:00 UTC: `daily-post.yml` runs → reads `data/pending-command.json` for any dashboard commands → publishes

## Key technical decisions
- `node:sqlite` (Node 24 built-in) instead of `better-sqlite3` — MSVC C++20 conflict on Windows
- `@napi-rs/canvas` instead of `node-canvas` — canvas needs GTK not on Windows
- Images committed to repo (not gitignored) so the dashboard can serve them
- All LinkedIn credentials in GitHub Secrets — never committed
- `w_organization_social` scope requires separate LinkedIn app (Community Management API product only)

## DB schema
```sql
posts(id, created_at, scheduled_for, status, review_status, angle, body, hashtags,
      image_path, image_prompt, engagement_text, asset_urn, post_urn, error,
      posted_at, approved_at, regeneration_notes)
token_log(id, checked_at, expires_at, days_remaining, alert_sent)
```

## Commands to know
```bash
npm run generate          # Phase 1: generate content + image
npm run post              # Phase 2: publish to LinkedIn
npm run auth              # Re-auth personal LinkedIn token
npm run auth:org          # Auth org LinkedIn token (new app)
npm run generate-batch    # Generate N pending posts for batch review
npm run dashboard         # Serve dashboard locally at localhost:3001
node scripts/auth.js --org  # Auth with Community Management API app
```
