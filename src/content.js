#!/usr/bin/env node
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getActiveTemplate } = require('./templates');
const { nextTopic } = require('./rotation');

const WEB_SEARCH_TOOL = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }];

// 2026-09-08: switched from "AI capability in sport, illustrated with cinematic
// sport-action photography" to provocative photo+headline posts that stop the
// scroll first and deliver the insight second (see src/image.js for the visual
// side). The topic pool shifted to match: half sport-operations pain points
// with a genuinely surprising angle (the kind of thing that supports a
// scroll-stopping image), half organizational/adoption problems that apply to
// any sports organization trying to bring in new technology, per explicit
// request that not every post needs to be about a specific on-pitch sports
// problem. The old sport-rotation (SPORT_POOL/nextSport, pairing every image
// with a specific sport) was dropped - these images are concept-driven objects
// (a urinal, a dartboard, a vending machine), not sport-action photography, so
// forcing a sport into every image prompt no longer fits. The pre-pivot
// version of this file (with SPORT_POOL and the cinematic-photo style) is
// preserved on the git branch legacy-sport-rotation-v1.
const TOPIC_POOL = [
  // Sport/game-day operations - specific, surprising, image-able
  'Concession or beer sales lost to poor timing around halftime or breaks in play',
  'Static ticket or concession pricing that ignores real demand signals',
  'Scouting or recruitment decisions still driven by gut feel despite available performance data',
  'Empty seats or under-filled sections that better demand forecasting could have caught',
  'Stadium staffing that is scheduled the same way regardless of actual predicted crowd behavior',
  'Injury risk that was visible in the data days before it happened',
  'Fan experience friction (parking, entry lines, wait times) that quietly costs repeat attendance',
  'Merchandise or inventory decisions made on last season\'s guesswork instead of current demand signals',
  'Officiating or in-game decisions that data could have supported in real time',
  'Sponsorship value that is being sold on guesswork instead of actual exposure data',
  // Organizational / adoption problems - deliberately NOT about a specific
  // on-pitch sports problem, per explicit direction to cover this territory
  'An expensive AI or analytics tool that was bought but never actually adopted by staff',
  'Manual reporting work that burns out skilled analytics staff instead of being automated',
  'A promising AI pilot that stalled because no one in the organization owned rolling it out',
  'Resistance to new technology from staff who were never brought into the decision',
  'Leadership treating an AI purchase as the finish line instead of the starting point',
  'A vendor relationship that delivered a system but not the change management to use it',
  'Budget cycles that kill promising technology pilots before they get a real chance',
  'Departments quietly re-doing by hand what an already-purchased tool was supposed to automate',
  'Organizations that can describe their data problem clearly but have never fixed it',
  'The gap between a slick AI strategy presentation and something staff actually use day to day',
];

// These topics map directly to organizational/adoption problems rather than a
// specific on-pitch issue - never name a real organization for them, even a
// verified one. The problem should read as a pattern the reader recognizes in
// their own organization, not a story about a specific named team/company.
const NO_REAL_NAMES_TOPICS = new Set([
  'An expensive AI or analytics tool that was bought but never actually adopted by staff',
  'A promising AI pilot that stalled because no one in the organization owned rolling it out',
  'Resistance to new technology from staff who were never brought into the decision',
  'Leadership treating an AI purchase as the finish line instead of the starting point',
  'A vendor relationship that delivered a system but not the change management to use it',
  'Budget cycles that kill promising technology pilots before they get a real chance',
  'Organizations that can describe their data problem clearly but have never fixed it',
  'The gap between a slick AI strategy presentation and something staff actually use day to day',
]);

const SYSTEM_PROMPT = `You are the LinkedIn content strategist for "ML-Innovation" — a company at the intersection of artificial intelligence and professional sport.

If the post needs to name the company at all (rare — most posts shouldn't), it is ALWAYS "ML-Innovation" — never any other name. "Elite Sports AI Forge" does not exist and must never appear; neither does any other product/app/project name.

Your task: design a provocative, scroll-stopping LinkedIn post built around an unusual, eye-catching PHOTO with a bold headline overlaid on it, and return ONLY a valid JSON object. No markdown fences. No explanation.

WHAT "PROVOCATIVE" MEANS HERE - a provocative post is bold, edgy, or a little controversial: it breaks the pattern of normal LinkedIn content, challenges standard thinking, and makes someone who actually has budget and authority in their organization stop, feel a jolt of "wait, what?", and recognize their own problem in it. The image and headline together are the hook. The body is where you pay it off with the real, credible insight. Two valid kinds of post, roughly balanced across a run of posts:
1. SPORT-OPERATIONS: a specific, surprising operational insight from the sport/game-day side (concessions timing, pricing, staffing, scouting, fan experience) illustrated with an unusual real-world object or scene that makes the connection to the payoff feel earned once you read it, not just a shocking image bolted onto an unrelated post.
2. ORGANIZATIONAL: a relatable problem about getting new technology adopted inside an organization - resistance to change, tools bought but never used, burnout from manual work, stalled pilots, budget cycles killing good ideas. These do NOT need to be about a specific on-pitch sports problem at all, per explicit direction - most sports-org decision-makers will recognize this pain immediately regardless of the sport they're in.

CRITICAL FORMATTING RULES - LinkedIn renders plain text only:
- NEVER use ** bold **, * italic *, # headers, --- dividers, or any markdown
- Separate paragraphs with a single blank line (two newlines)
- You MAY use emojis sparingly (1-3 total) only where they add genuine emphasis
- Hashtags go at the very end, on their own line, space-separated
- Max 3000 characters total
- NEVER use double quotation marks (") anywhere inside the body, hashtags, or any text field - your entire response must be valid JSON, and a stray " inside a string breaks parsing. If you need to quote a phrase, use single quotes (') instead.
- NEVER use the em dash (—) anywhere, in any field. Use a period to split into two sentences, a comma, a colon, or a regular hyphen with spaces ( - ) instead, whichever reads most naturally in context.
- If a sport comes up, always call it "football", never "soccer" ("American football" stays as-is when that's genuinely what's being discussed). Most posts in this style don't need to name a specific sport at all.

POST STRUCTURE:
1. Opening line that directly acknowledges or escalates the image/headline's premise - the reader just saw something unusual, this line earns their next few seconds rather than resetting with generic scene-setting. NEVER open with "I'm excited to share", "In today's world", or similar.
2. 2-4 short paragraphs (2-4 sentences each), blank line between each, unpacking the real mechanism behind the hook: what's actually going on, why it's a bigger deal than it sounds, and (often, not always) how it reflects a broader organizational pattern rather than a one-off. Vary sentence length for rhythm - mix punchy one-liners with longer explanatory sentences.
3. CTA closing line - a direct, specific invitation to talk about THEIR situation privately (e.g. "If that sounds like your organization, let's talk." / "If your team is still doing this the hard way, let's talk about what that's costing you.") rather than a generic "What do you think?".
4. 4-6 hashtags on final line

VARY THE STRUCTURE across posts - don't let every post open the same way or land the CTA with the same phrasing. Check RECENTLY COVERED below and deliberately do something structurally different if recent posts share an opening pattern.

POSITIONING - this is a services company, not a media outlet or a tutorial account. Every post should make the reader recognize a real problem in their own organization and trust that ML-Innovation has the expertise to solve it - NEVER explain the actual method, architecture, tool stack, or step-by-step approach in enough detail that the reader's own team could replicate the solution without engaging us. Name the pain point precisely, establish that it's solvable with the right expertise, and stop there.

DATA INTEGRITY - NEVER fabricate any fact in any post. This is an absolute rule, not limited to statistics: it covers numbers, named case studies, claims about how a technology works, claims about what a study found, claims about an industry trend, or any other assertion presented as true. This style is short and reveal-driven, not proof-driven, so DEFAULT TO QUALITATIVE language ("a growing number of clubs", "most organizations we talk to") rather than a specific number - you do not need a citation-backed stat to make these posts land. You have a web_search tool available if a specific real, verifiable stat would genuinely strengthen a post, but it is optional, not required. If you do cite one, it must come from an actual search result, named in natural prose, never invented. NEVER write literal <cite> tags or citation markup inside any field.

NAMED-ORGANIZATION CASE STUDIES - if you ever name a real team, league, or company (rare in this style), EVERY specific detail about what happened inside it must come directly from a real search result you actually ran - never extrapolate or invent plausible-sounding internal specifics. When in doubt, describe the pattern generically ("one front office we've seen...", "a common pattern across venues...") without naming a real organization.

IMAGE PROMPT RULES - this is the whole hook, so it needs to actually be unusual:
- Describe ONE concrete, ordinary-but-unexpected real-world object or scene that visually embodies the post's core insight - the thing a reader would do a double-take at in their feed. Think: a public urinal (beer sales timing), a dusty forgotten laptop in a closet (unused AI investment), a messy desk at 2am (analyst burnout), a dartboard (guesswork in scouting), a vending machine's price display (static pricing). NOT a generic "cinematic sports action" shot, NOT an abstract data-visualization graphic, NOT a stock-photo-looking office.
- The connection between the image and the post's actual point should make sense once the reader reads the post, even if it's not obvious from the image alone - that gap is exactly what makes someone stop and read.
- Vary the composition and subject significantly from post to post - don't repeat the same handful of objects/scenes, and don't let every image be a "person at a desk" variant.
- People are optional. When you include a person, keep them generic and unidentifiable: no real athlete, no real team, no readable brand name or logo anywhere in the scene, plain unbranded clothing, a fictional/generic venue - the image renderer is photorealistic enough to reproduce real logos, jersey names, and recognizable people if not told not to, which is a real legal and reputational risk for a business page.
- Stay provocative through SURPRISE and JUXTAPOSITION, not through explicit or graphic content: convey an edgy premise (like a bathroom scene) through framing and implication rather than anything graphic, sexual, or gory - the goal is content that gets shared and debated, not content that gets a LinkedIn post taken down or embarrasses the brand.
- Bright, vivid, photorealistic, high-contrast lighting - NOT moody, dark, or desaturated. The photo needs to read clearly and pop at a glance, since the visual treatment adds bold opaque color blocks/banners over parts of it, not a dark overlay across the whole thing.
- Never ask for text, logos, headline copy, or watermarks in the image itself - that's added separately afterward, and AI-rendered text usually comes out garbled.

HEADLINE TEXT - this is the bold overlay text on the image, and it IS the hook, not a summary of the post. Short, punchy, often second-person or directly accusatory, built to create real disbelief or curiosity ("You just burned $500K", "Your best analyst quits tomorrow", "A vending machine prices better than your stadium"). Aim for well under 60 characters where possible - shorter reads punchier - but a slightly longer line that lands harder beats a shorter, flatter one. Never a plain description of the topic ("AI Improves Scouting Accuracy" is exactly what NOT to write). NEVER include emojis in headlineText or imageEngagementText - the image renderer has no emoji font and will render them as broken boxes.

JSON schema (return EXACTLY this shape):
{
  "angle": "<SPECIFIC narrow issue within the assigned topic field - not a repeat of a recently covered angle>",
  "body": "<full post text - plain text only, no markdown>",
  "hashtags": ["#Tag1", "#Tag2"],
  "imagePrompt": "<the single unusual/provocative photo concept, per IMAGE PROMPT RULES>",
  "imageEngagementText": "<almost always 'Read more' - a short CTA tag under the headline>",
  "headlineText": "<the provocative hook headline overlaid on the image, per HEADLINE TEXT>",
  "scheduledFor": "<ISO8601 tomorrow at 08:00 UTC>"
}`;

// The web_search tool sometimes leaks its citation markup into the model's own
// generated prose as literal <cite index="N-M">...</cite> tags — strip them,
// keeping the wrapped text, on every string field (not just body) since it can
// show up in the angle or headline too. Also normalizes em dashes (—) to a
// plain hyphen with spacing — the prompt rule alone doesn't reliably stop the
// model from reaching for it as a stylistic habit, same lesson as cite tags.
// Used everywhere generated text passes through, including src/respond.js.
function stripCiteTags(text) {
  return String(text || '')
    .replace(/<cite[^>]*>(.*?)<\/cite>/gis, '$1')
    .replace(/<\/?cite[^>]*>/gi, '')
    .replace(/\s*—\s*/g, ' - ')
    .trim();
}

function sanitizeBody(body) {
  return stripCiteTags(body)
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // remove bold/italic
    .replace(/^#{1,6}\s+/gm, '')               // remove headers
    .replace(/^---+$/gm, '')                   // remove dividers
    .trim();
}

// Cite-tag leakage isn't limited to the body — strip it from every string field.
function sanitizePayload(payload) {
  if (payload.body) payload.body = sanitizeBody(payload.body);
  if (payload.angle) payload.angle = stripCiteTags(payload.angle);
  if (payload.headlineText) payload.headlineText = stripCiteTags(payload.headlineText);
  if (payload.imageEngagementText) payload.imageEngagementText = stripCiteTags(payload.imageEngagementText);
  if (payload.imagePrompt) payload.imagePrompt = stripCiteTags(payload.imagePrompt);
  if (Array.isArray(payload.hashtags)) payload.hashtags = payload.hashtags.map(stripCiteTags);
  return payload;
}

// With the web_search tool enabled, the response contains extra content blocks
// (server_tool_use, web_search_tool_result) ahead of the assistant's prose — the
// final JSON answer is the LAST text-type block, not necessarily content[0]. That
// block also often isn't PURE JSON despite instructions: the model tends to add a
// stray line of commentary before a fenced ```json block after a search turn, so
// extract the JSON substring rather than assuming the whole block is clean JSON.
function parseClaudeJson(response) {
  const textBlocks = response.content.filter(b => b.type === 'text');
  if (!textBlocks.length) throw new Error('No text content in Claude response');
  const raw = textBlocks[textBlocks.length - 1].text.trim();

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1].trim());

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
  }

  return JSON.parse(raw);
}

// LLM "JSON" occasionally breaks (e.g. a stray unescaped quote inside a text field)
// despite the prompt instructing against it — retry the whole call rather than
// attempt fragile regex repair on malformed JSON.
async function callClaudeForJson(client, systemPrompt, userMessage, { retries = 2, tools = undefined } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tools ? 2500 : 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      ...(tools ? { tools } : {}),
    });
    try {
      return parseClaudeJson(response);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// recentPosts: array of { angle, body } from the most recent posts (any status),
// used to steer both topic-field variety and sport-image variety.
async function generateContent(recentPosts = [], regenerationNotes = null) {
  const client = new Anthropic();
  const field = nextTopic(TOPIC_POOL);

  const avoidSection = recentPosts.length > 0
    ? `\n\nRECENTLY COVERED (do NOT repeat these angles — if this post lands in the same field, tackle a clearly different specific issue or sub-problem instead. Also check how each one OPENS — if several start with "Your...", deliberately use a different opening structure per VARY THE OPENING STRUCTURE above):\n${recentPosts.slice(0, 7).map((p, i) => `${i + 1}. [${p.angle || '?'}] ${(p.body || '').substring(0, 100)}...`).join('\n')}`
    : '';

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const scheduledFor = tomorrow.toISOString().split('T')[0] + 'T08:00:00Z';

  const notesSection = regenerationNotes
    ? `\n\nSPECIAL INSTRUCTIONS FOR THIS POST:\n${regenerationNotes}`
    : '';

  const template = getActiveTemplate();
  const styleSection = template
    ? `\n\nIMAGE STYLE GUIDANCE (apply to imagePrompt):\n${template.styleNotes}`
    : '';

  const noRealNamesSection = NO_REAL_NAMES_TOPICS.has(field)
    ? `\n\nTHIS IS ONE OF ML-INNOVATION'S OWN SERVICE-AREA TOPICS — three extra rules apply:

1. NO REAL NAMES: do not name any real team, league, company, or organization ANYWHERE in this post, even a verified real one, and even in passing — this includes naming which real league or team's data a cited study happened to use. Describe the problem and pattern in general terms only ("many sports organizations", "a common pattern across front offices", "teams we talk to"). A real statistic or study finding is still fine to cite (per DATA INTEGRITY) — attribute it to "published research" / "a peer-reviewed study" / "recent academic research" WITHOUT naming which specific league, team, or dataset it used. Do not describe independent academic research as if it were a named organization's own internal work (e.g. don't write "a research team at [League]" when the truth is researchers used that league's public dataset — that misattributes authorship).

2. WRITE TO THE ORGANIZATIONS LIVING THIS PROBLEM: don't write neutral industry commentary — write as if speaking directly to the sports organizations struggling with this exact issue right now, so the reader thinks "that's us." Make clear ML-Innovation has seen this pattern before and knows how to fix it, without yet saying how (per POSITIONING).

3. EXPLICIT CONTACT CTA: the closing line must be a direct invitation for organizations who relate to this problem to contact ML-Innovation and discuss it privately (e.g. "If this is where your organization is stuck, contact us — let's talk about what's possible." / "Recognize this in your own operation? Reach out and let's discuss it."). Don't leave the CTA as just an open question here — make the "get in touch" ask explicit, though the phrasing should still vary post to post rather than reusing the same sentence.`
    : '';

  const userMessage = `Today's date: ${new Date().toISOString().split('T')[0]}
Scheduled for: ${scheduledFor}

TOPIC FIELD FOR THIS POST: ${field} — write about a SPECIFIC, narrow issue or angle within this field (don't just restate the field name as the angle).${avoidSection}${noRealNamesSection}${notesSection}${styleSection}

Now come up with the single unusual/provocative photo concept and headline that hooks the reader, and write the LinkedIn post that pays it off. Return only JSON.`;

  const payload = sanitizePayload(await callClaudeForJson(client, SYSTEM_PROMPT, userMessage, { tools: WEB_SEARCH_TOOL }));

  if (!payload.scheduledFor) payload.scheduledFor = scheduledFor;
  if (!payload.imageEngagementText) payload.imageEngagementText = 'Read more';

  return payload;
}

// Revise an EXISTING post per user notes, keeping the same core angle/topic rather than
// picking a brand new one — used by the dashboard's "regenerate with notes" flow.
async function reviseContent(existingPost, notes = null) {
  const client = new Anthropic();

  const template = getActiveTemplate();
  const styleSection = template
    ? `\n\nIMAGE STYLE GUIDANCE (apply to imagePrompt):\n${template.styleNotes}`
    : '';

  const notesSection = notes
    ? `\n\nIMPROVEMENT INSTRUCTIONS:\n${notes}`
    : '\n\nNo specific instructions given — just make it stronger: sharper hook, tighter writing, more compelling CTA.';

  const existingHashtags = Array.isArray(existingPost.hashtags)
    ? existingPost.hashtags.join(' ')
    : (existingPost.hashtags || '');

  const userMessage = `Here is an EXISTING LinkedIn post that needs revision. Keep the same core angle/topic — do not switch to a different subject, just improve the execution.

ANGLE: ${existingPost.angle || '(none)'}

CURRENT BODY:
${existingPost.body || '(none)'}

CURRENT HASHTAGS: ${existingHashtags || '(none)'}
CURRENT IMAGE PROMPT: ${existingPost.imagePrompt || '(none)'}
${notesSection}${styleSection}

If the current body already contains a specific stat, keep it only if it's genuinely real — if you're not confident it came from a real source, replace it with a real one found via web_search (or fall back to qualitative language per DATA INTEGRITY rules) rather than leaving a fabricated number in place.

Revise this post. Return only JSON with the same schema as before (angle, body, hashtags, imagePrompt, imageEngagementText, headlineText) — omit scheduledFor, the caller keeps the original.`;

  const payload = sanitizePayload(await callClaudeForJson(client, SYSTEM_PROMPT, userMessage, { tools: WEB_SEARCH_TOOL }));

  if (!payload.imageEngagementText) payload.imageEngagementText = 'Read more';
  if (!payload.angle) payload.angle = existingPost.angle;
  if (!payload.imagePrompt) payload.imagePrompt = existingPost.imagePrompt;

  return payload;
}

if (require.main === module) {
  // recentArg: JSON array of { angle, body } objects, e.g. '[{"angle":"...","body":"..."}]'
  const recentArg = process.argv[2] ? JSON.parse(process.argv[2]) : [];
  const notes = process.argv[3] || null;
  generateContent(recentArg, notes)
    .then(p => console.log(JSON.stringify(p, null, 2)))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { generateContent, reviseContent, callClaudeForJson, stripCiteTags, WEB_SEARCH_TOOL };
