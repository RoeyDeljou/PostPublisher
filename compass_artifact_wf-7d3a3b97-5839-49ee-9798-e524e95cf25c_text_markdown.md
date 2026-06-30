# Building a Free, Automated LinkedIn Post Creator & Auto-Poster with Claude Code Sub-Agents

## TL;DR
- **You can build ~95% of this for $0**, but one hard constraint breaks "fully hands-off": a self-serve LinkedIn app does **not** receive refresh tokens, so a human must re-run LinkedIn's OAuth consent roughly every 60 days. Everything else (content via Claude API, images via Pollinations/Canvas, scheduling via GitHub Actions, storage via SQLite, dashboard via GitHub Pages) is genuinely free or near-free.
- **Recommended free stack:** Claude Haiku 4.5 (content, pay-per-token but pennies) → Pollinations.ai Flux (free background images) + node-canvas (text/brand overlay) → GitHub Actions cron (free scheduler) → SQLite committed to repo (state) → GitHub Pages + sql.js dashboard → LinkedIn `v2/ugcPosts` with `w_member_social`.
- **The Claude Code 5-sub-agent design is for *building/operating* the system, not for the daily cron run.** The daily run should be a plain Node.js/Python script (no API cost). Use Claude Code's orchestrator + sub-agents for development, content batch-generation, and supervised operations.

## Key Findings

### 1. LinkedIn posting is free but NOT fully unattended on the free tier
- The `w_member_social` scope (post on behalf of a person) is **self-serve** — adding the "Share on LinkedIn" product in the Developer Portal grants it automatically; no partner review. Per Microsoft Learn: adding the Share on LinkedIn product "will grant you `w_member_social`."
- Access tokens last **60 days (hard cap)**. The LinkedIn Developer FAQ states verbatim: *"No, LinkedIn will only provide you access tokens that last 60 days."* **Refresh tokens are only issued to approved Marketing Developer Platform (MDP) partners**, not self-serve apps. The official Programmatic Refresh Tokens doc says: *"LinkedIn supports programmatic refresh tokens for all approved Marketing Developer Platform (MDP) partners... access tokens are valid for 60 days and programmatic refresh tokens are valid for a year."* This is corroborated by n8n GitHub issue #29434: *"Standard apps using the 'Share on LinkedIn' product receive a 60-day access token and no refresh token. This is documented LinkedIn behavior, not a user misconfiguration."* So a free app must have a human re-authorize via 3-legged OAuth roughly every 60 days. This is the single unavoidable manual step.
- Posting itself is fully automatable: once you have a valid token, a script can create text + image posts daily with zero human clicks.
- Rate limits: LinkedIn's official Rate Limiting page states *"Standard rate limits are not published in documentation. You can look up the rate limit of any endpoint your app has access to through the Developer Portal,"* and over-limit requests return HTTP 429. (Some third-party guides cite ~150 requests/member/day and 100,000/app/day for Share on LinkedIn, but these are not in current official docs — check your app's actual limit under Developer Portal → Usage & Limits. At one post/day you are nowhere near any plausible ceiling.)

### 2. Free image generation: Pollinations.ai Flux + node-canvas overlay is the winner
- **Pollinations.ai**: Flux image model is free, no API key required for basic use, via a simple URL. Best free option for backgrounds.
- **AI models render text poorly** — so generate a clean AI *background* with Pollinations, then overlay headline text + brand colors + logo with **node-canvas** (server-side HTML Canvas). This avoids garbled AI text and gives consistent branding.
- Hugging Face and Stability AI free tiers exist but are small trial credits, not durable daily-free — keep as fallbacks.

### 3. GitHub Actions is a genuinely free daily scheduler
- **Public repo = unlimited free Actions minutes** (GitHub billing docs: standard-runner minutes in public repositories are "free and unlimited"). **Private repo = 2,000 free Linux minutes/month** on the Free plan (GitHub Docs: GitHub Free "includes... 2,000 Actions minutes for private repositories"). A daily 2–3 min job uses ~60–90 min/month, well within either.
- Cron syntax runs your Node/Python script daily; secrets stored encrypted in repo settings; full outbound internet for API calls.

### 4. Claude Code 5-sub-agent architecture (orchestrator pattern)
- One orchestrator agent + 5 specialist sub-agents defined as markdown files in `.claude/agents/`. Sub-agents are stateless, return one final message to the orchestrator, and cannot spawn further sub-agents.

### 5. Dashboard: GitHub Pages static page + sql.js (read) + GitHub API (write)
- A static HTML/JS page on GitHub Pages reads the committed SQLite file in-browser via sql.js; "create/delete pending post" buttons write by committing back through the GitHub API or by triggering a workflow.

### 6. Total recurring cost ≈ the Claude API only, which is pennies/month at Haiku rates.

### 7. Token strategy: store token + expiry in a GitHub secret; alert before day ~55; re-auth manually.

---

## Details

### 1. LinkedIn API for Automated Posting (FREE)

**1a. Register the app & get OAuth credentials**
1. Go to the LinkedIn Developer Portal (`developer.linkedin.com`) → **Create app**.
2. You must associate the app with a **LinkedIn company Page** — required even if you only post to a personal profile. If Elite Sports AI Forge has no Page, create one first.
3. Verify the app: Settings tab → **Verify** → generate URL → a Page super admin approves (30-day window).
4. Add a Privacy Policy URL (use ml-innovate.com privacy page).
5. Products tab → add **"Share on LinkedIn"** (grants `w_member_social`) and **"Sign In with LinkedIn using OpenID Connect"** (grants `openid profile email`).
6. Auth tab → copy **Client ID** and **Client Secret**.

**1b. Scopes required**
- `w_member_social` — create/modify/delete posts on behalf of the member (personal profile).
- `openid profile` — retrieve the person's identity / URN. Add `email` if needed.
- Combined authorization string: `openid profile w_member_social`.
- Note: the older `r_liteprofile` is superseded by OpenID Connect's `profile`; use the OpenID flow.

**1c. Getting the access token (3-legged OAuth)**
- Authorization URL: `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}&scope=openid%20profile%20w_member_social&state={RANDOM}`
- Authorization code is valid 30 minutes, single-use.
- Exchange code for token:
```
POST https://www.linkedin.com/oauth/v2/accessToken
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code={CODE}&redirect_uri={REDIRECT_URI}&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}
```
- Returns `access_token` (60-day TTL) and `id_token`. For a personal-use app, you can also generate a token directly from the Developer Portal's OAuth token generator tool (Docs and Tools → token generator) — the simplest one-time bootstrap.

**1d. Get the author URN**
```
GET https://api.linkedin.com/v2/userinfo
Authorization: Bearer {ACCESS_TOKEN}
```
- Response includes `sub` (e.g. `"sub": "782bbtaQ"`). Author URN = `urn:li:person:{sub}`. (OIDC discovery: userinfo_endpoint = `https://api.linkedin.com/v2/userinfo`; claims include `sub, name, given_name, family_name, picture, email`.)

**1e. Create a text post (exact syntax)**
```
curl -X POST 'https://api.linkedin.com/v2/ugcPosts' \
 -H 'Authorization: Bearer {TOKEN}' \
 -H 'X-Restli-Protocol-Version: 2.0.0' \
 -H 'Content-Type: application/json' \
 --data '{
  "author": "urn:li:person:{sub}",
  "lifecycleState": "PUBLISHED",
  "specificContent": {
    "com.linkedin.ugc.ShareContent": {
      "shareCommentary": { "text": "AI and Sport: how AI helps clubs..." },
      "shareMediaCategory": "NONE"
    }
  },
  "visibility": { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
}'
```
- Success = HTTP 201; the new post ID is in the `X-RestLi-Id` response header. Max text length 3,000 chars.

**1f. Post an image (3-step process)**
- **Step 1 — register upload:**
```
POST https://api.linkedin.com/v2/assets?action=registerUpload
{
  "registerUploadRequest": {
    "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
    "owner": "urn:li:person:{sub}",
    "serviceRelationships": [
      { "relationshipType": "OWNER", "identifier": "urn:li:userGeneratedContent" }
    ]
  }
}
```
Response returns `value.asset` (e.g. `urn:li:digitalmediaAsset:...`) and `value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl`.
- **Step 2 — upload the binary** to that `uploadUrl`:
```
curl -X POST '{uploadUrl}' \
 -H 'Authorization: Bearer {TOKEN}' \
 -H 'Content-Type: application/octet-stream' \
 --data-binary @image.png
```
- **Step 3 — create the post** with `shareMediaCategory: "IMAGE"` and the asset URN:
```json
{
  "author": "urn:li:person:{sub}",
  "lifecycleState": "PUBLISHED",
  "specificContent": {
    "com.linkedin.ugc.ShareContent": {
      "shareCommentary": { "text": "..." },
      "shareMediaCategory": "IMAGE",
      "media": [ { "status": "READY", "media": "{ASSET_URN}", "title": {"text":"..."} } ]
    }
  },
  "visibility": { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
}
```
- Confirm image upload succeeds **before** creating the post (use `SYNCHRONOUS_UPLOAD` in the register step), otherwise the post may publish without the image. LinkedIn's docs explicitly recommend synchronous mode for this reason.

**1g. Fully automated?** Yes for the posting itself once a token exists; **no** for token renewal — the 60-day manual re-auth is unavoidable on the free self-serve tier.

**1h. URN format:** Author = `urn:li:person:{id}` (personal) or `urn:li:organization:{id}` (company Page). Post URNs: `urn:li:ugcPost:{id}` or `urn:li:share:{id}`. URNs in URL paths must be URL-encoded.

**Endpoint note (2026):** `v2/ugcPosts` is still the documented self-serve endpoint and works (the consumer "Share on LinkedIn" doc still uses it). The newer `/rest/posts` Posts API is the strategic successor but lives under Community Management (versioned `Linkedin-Version: YYYYMM` header, approval-oriented); LinkedIn states the ugcPosts→Posts deprecation is "applicable for partners with Marketing permissions only." Stick with `v2/ugcPosts` for a free self-serve app.

### 2. Free Image Generation APIs

**Pollinations.ai** — open-source, Berlin-based. Flux model is free and unlimited. Two ways to call:
- Legacy/simple URL (no key): `https://image.pollinations.ai/prompt/{URL-encoded-prompt}?width=1080&height=1080&model=flux&nologo=true&seed=123`
- Newer unified endpoint: `https://gen.pollinations.ai/image/{prompt}?model=flux`
- Just GET the URL and save the bytes. The anonymous tier is rate-limited (documented at roughly one request every 15s) and is the first to be throttled under load; free registration raises limits. Quality (Flux) is good for professional backgrounds. No SLA. Pollinations' own FAQ confirms Flux images are "completely free, always."

**Stability AI** — new accounts get 25 free credits (one-time). Stable Image Core ≈ $0.03/image, Ultra ≈ $0.08. Not a durable daily-free option; fallback only.

**Hugging Face Inference Providers** — small monthly free credit; supports `black-forest-labs/FLUX.1-dev` via `InferenceClient.text_to_image`. The free tier is an evaluation sandbox ("not meant to be used for heavy production applications"), not production volume; fallback only.

**Best for professional LinkedIn images:** Pollinations Flux for the background + **node-canvas overlay** for text/logo/brand colors. This avoids AI text-rendering failures entirely. node-canvas (`createCanvas`, `loadImage`, `ctx.drawImage`, `ctx.fillText`, `ctx.measureText` for centering, `registerFont` for brand fonts, `canvas.toBuffer("image/png")`) draws headline text and brand elements on top of the AI background deterministically. Higher-level wrappers like `text2png` and `text-to-image` sit on node-canvas if you want helpers.

### 3. GitHub Actions as Free Scheduler
- **Public repo:** unlimited free standard-runner minutes. **Private repo:** 2,000 free Linux minutes/month on the Free plan (Windows counts 2×, macOS 10×). A daily 2–3 minute job costs ~60–90 min/month — free either way.
- Example daily workflow:
```yaml
name: Daily LinkedIn Post
on:
  schedule:
    - cron: "0 8 * * *"   # 08:00 UTC daily
  workflow_dispatch:
permissions:
  contents: write
jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: node src/run.js
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LINKEDIN_TOKEN: ${{ secrets.LINKEDIN_TOKEN }}
          LINKEDIN_PERSON_URN: ${{ secrets.LINKEDIN_PERSON_URN }}
      - name: Persist DB
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/posts.db
          git diff --staged --quiet || git commit -m "Update state $(date -u +%F)"
          git push
```
- **Secrets:** stored encrypted under repo Settings → Secrets and variables → Actions; injected as env vars. Set Workflow permissions to "Read and write" so the run can commit the DB back. Cron timing can drift a few minutes under GitHub load.
- **Limitations:** the runner is ephemeral, so any state (the SQLite DB) must be committed back (shown above) or stored as an artifact. Outbound calls to LinkedIn, Pollinations, and the Claude API all work.

### 4. System Architecture: Claude Code Orchestrator + 5 Sub-Agents

Sub-agents live as markdown files with YAML frontmatter in `.claude/agents/` (project) or `~/.claude/agents/` (user). Each has its own context window, tool allow-list, and optional model. The orchestrator calls them via the Agent/Task tool; each returns one final message. Sub-agents are stateless and cannot nest. Example definition:
```markdown
---
name: publisher
description: Validates the LinkedIn token, uploads the image asset, and creates the ugcPost. Use after image-designer produces a PNG.
tools: Bash, Read
model: haiku
---
You are the LinkedIn publisher. Given post copy, an image path, and the person URN,
register+upload the image asset, then POST to v2/ugcPosts. Return the post URN or a clear error.
```

**Proposed 5 sub-agents:**
1. **content-strategist** (model: Haiku/Sonnet) — picks the day's "AI & Sport" angle, writes the LinkedIn copy + hashtags, returns JSON.
2. **image-designer** — turns the copy into a Pollinations prompt + node-canvas overlay spec (headline, brand colors, logo placement), produces the PNG.
3. **publisher** — handles LinkedIn token validity, asset registration/upload, and the ugcPosts call; returns the post URN.
4. **state-manager** — reads/writes the SQLite DB (status: pending/posted/deleted, timestamps, asset paths, URNs).
5. **monitor/qa** — checks token expiry (alerts near day 55), verifies the post went live, logs metrics.

**Important architecture decision:** running Claude Code with 5 sub-agents *every day* is unnecessary and uses 4–7× the tokens of a single agent (Anthropic's own guidance). Use the multi-agent system for **development and supervised/batch operations** (e.g., generate a month of posts at once, review the queue). For the **daily unattended cron run**, ship a plain Node.js/Python script that calls the Claude API directly for copy — far cheaper and more reliable. Communication between agents is via the orchestrator (return messages) plus the shared SQLite file on disk.

**CLAUDE.md best practices:** describe the orchestrator's decomposition rules, name each sub-agent and when to invoke it, define the JSON hand-off schema between content→image→publisher, restrict tool access per agent (e.g., publisher gets network/Bash, state-manager gets file/DB only), and document the DB schema.

**State between runs:** SQLite (`data/posts.db`) committed to the repo after each run. Schema suggestion: `posts(id, created_at, scheduled_for, status, body, image_path, asset_urn, post_urn, error)`.

### 5. Dashboard (free)

**Recommended: static HTML/JS on GitHub Pages reading SQLite with sql.js.**
- Publish the repo's `data/posts.db` and a small `index.html`. Use **sql.js** (SQLite compiled to WebAssembly) to load the DB in-browser and render a table of posts (created, status, scheduled time, image thumbnail, metrics). For large DBs, `sql.js-httpvfs` fetches only the needed pages via HTTP Range requests (GitHub Pages supports Range out of the box), but for a small posts DB a full load is fine.
- **Reads are easy; writes need a path back to the repo.** Options for "create new post" / "delete pending post" buttons:
  1. Use the **GitHub REST API** from the page (with a fine-grained token the owner pastes in) to commit an updated DB or a small "command" JSON.
  2. Trigger a **`workflow_dispatch`** GitHub Action that runs a script to mutate the DB and commit it.
  3. Run a tiny **Express.js** server locally/on a free host if you want live read-write against SQLite directly (more capable, but no longer fully static/free-forever).
- For a 100%-free, zero-server setup, GitHub Pages + sql.js (read) + `workflow_dispatch` (write) is the cleanest. If you want true interactive CRUD, a lightweight Express app on a free tier is the alternative, at the cost of managing a server.

### 6. Complete Free Tech Stack Recommendation
| Layer | Choice | Cost |
|---|---|---|
| Content generation | **Claude API — Haiku 4.5** (`claude-haiku-4-5`) | Pay-per-token; ~pennies/month at 1 post/day |
| Image background | **Pollinations.ai Flux** (URL API, no key) | Free |
| Image branding | **node-canvas** overlay (text/logo/colors) | Free (open source) |
| Scheduling | **GitHub Actions** cron | Free (public repo unlimited; private 2,000 min/mo) |
| Storage/state | **SQLite** committed to repo | Free |
| Dashboard | **GitHub Pages + sql.js** (read) + `workflow_dispatch` (write) | Free |
| LinkedIn posting | **LinkedIn API v2 `ugcPosts`** + `w_member_social` | Free |

Note: Anthropic has **no permanent free API tier** for production usage (the free *Claude.ai* chat plan is not API access; the API is pay-as-you-go with no monthly subscription). New API accounts sometimes get trial credits. At Haiku 4.5 rates — confirmed in Anthropic's launch announcement as *"$1/$5 per million input and output tokens"* (model `claude-haiku-4-5`, 200K context) — one post/day is a fraction of a cent daily: effectively free but not literally $0. If you require literally zero cost for content, substitute a free text model (e.g., Pollinations' text endpoint or a Hugging Face free model), accepting lower quality.

### 7. LinkedIn OAuth Long-Lived Token Strategy
- **Reality check:** LinkedIn does not issue long-lived tokens, and self-serve apps get **no refresh token**. The "system never needs manual re-authentication" goal is **not achievable on the free tier**. Refresh tokens (1-year, auto-renewing) require approved MDP partner status.
- **Bootstrap:** generate the initial 60-day token via the Developer Portal token generator (or one manual 3-legged flow). Store `access_token` + computed `expires_at` + person URN as GitHub secrets.
- **Operate:** the daily script uses the stored token. The monitor agent/script checks `expires_at`; when within ~5 days (≈ day 55), it fails loudly / emails / opens a GitHub issue prompting the owner to re-authorize.
- **Re-auth:** owner clicks the auth URL once, approves, pastes the new token (and updated `expires_at`) into the GitHub secret. ~2 minutes every ~2 months.
- **Graceful expiry handling:** on any `401`, the script should stop posting, mark the run failed, and trigger the re-auth alert rather than silently dropping posts.
- **If you want true zero-touch later:** apply for the LinkedIn Marketing Developer Platform / Community Management API to unlock programmatic refresh tokens (1-year, auto-renewable) — this is the only way to fully eliminate the manual step.

## Recommendations

**Stage 1 — Minimum viable poster (1–2 days):**
1. Create + verify the LinkedIn app, add Share on LinkedIn + OpenID Connect, get Client ID/Secret.
2. Do one 3-legged OAuth, fetch the person URN via `/v2/userinfo`, confirm a manual text post via `v2/ugcPosts` returns 201.
3. Store token + `expires_at` + person URN as GitHub secrets.

**Stage 2 — Automate the daily run (2–3 days):**
4. Write the Node.js script: Claude Haiku generates copy → Pollinations generates background → node-canvas overlays brand text → register/upload image → create image post → write status to SQLite → commit DB.
5. Wire the GitHub Actions cron (start with `workflow_dispatch` for testing, then enable schedule).

**Stage 3 — Visibility & control (2–3 days):**
6. Build the GitHub Pages + sql.js dashboard (read). Add create/delete via `workflow_dispatch`.
7. Add the token-expiry monitor that opens a GitHub issue near day 55.

**Stage 4 — Optional polish:**
8. Use Claude Code with the 5 sub-agents to batch-generate a month of posts and review the queue.
9. If volume/zero-touch matters, apply for MDP/Community Management access to get refresh tokens.

**Thresholds that change the plan:**
- If you ever approach LinkedIn's per-endpoint throttle (check Developer Portal → Usage & Limits; you won't at 1 post/day) → space out calls / handle 429 with backoff.
- If you move the repo private and exceed 2,000 Actions min/month (you won't at 1 post/day) → switch to public or pay.
- If Pollinations anonymous throttling causes failures → register for a free key/higher tier or fall back to Hugging Face/Stability.
- If you need truly unattended token renewal → MDP partner application is the only path.

## Caveats
- **The 60-day manual re-auth is the one genuine limitation** of an all-free build; plan operations around it. Some third-party blogs claim "refresh tokens last 365 days, just build refresh logic" — that applies only to MDP partners, not self-serve apps. Verified via official LinkedIn docs (developer.linkedin.com/support/faq and the Programmatic Refresh Tokens page) and multiple developer bug reports (e.g., n8n issue #29434).
- **Anthropic Claude API is not literally free** (no permanent free production tier), though cost at 1 post/day is negligible. For literal $0, use a free text model at lower quality.
- **Pollinations free tier has no SLA**, can be slow under shared GPU load, anonymous traffic is throttled first, and the model lineup changes; keep a fallback image provider.
- **GitHub Actions cron is best-effort** and can run a few minutes late; do not rely on exact-minute precision.
- **`v2/ugcPosts` vs `/rest/posts`:** the ecosystem is mid-migration. The self-serve `v2/ugcPosts` path still works and is documented (and the deprecation is scoped to Marketing-permission partners), but LinkedIn is steering new development to the versioned Posts API; monitor for any sunset notice.
- **Dashboard writes** cannot be done from a purely static page without a token or a workflow trigger — pure static hosting is read-only by nature.
- **Secrets in GitHub Actions** are safe in secrets storage, but never put tokens in the Actions *cache* or in a public artifact (anyone with read access can extract cache contents).
- Rate-limit and pricing figures reflect mid-2026 sources and can change; re-verify LinkedIn throttles (via your Developer Portal), GitHub free minutes, and Claude token prices before launch.