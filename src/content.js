#!/usr/bin/env node
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getActiveTemplate } = require('./templates');
const { nextSport, nextTopic } = require('./rotation');

const WEB_SEARCH_TOOL = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }];

const TOPIC_POOL = [
  'AI injury prediction and athlete load management',
  'Computer vision in match analysis — player tracking and heatmaps',
  'AI-powered scouting and talent identification',
  'Fan engagement personalization via machine learning',
  'AI in referee and officiating decision support',
  'Wearables and AI for real-time athlete biometrics',
  'AI-powered training periodization and recovery optimization',
  'Generative AI for sports media and commentary',
  'Predictive analytics for in-game strategy',
  'Ethics of AI in sport — fairness and data privacy',
  'AI performance analysis in esports',
  'Sports nutrition optimization via machine learning',
  'AI in sports marketing — targeted campaigns, sponsorship valuation, content personalization',
  'AI-driven merchandise — demand forecasting, dynamic pricing, personalized product recommendations',
  'AI in ticketing and dynamic pricing for live events',
  'AI for back-office operations at sports organizations — scheduling, logistics, contract analysis',
  'AI in sponsorship ROI measurement and brand exposure analytics',
  'AI-powered sports betting and fantasy sports platforms — odds modeling and integrity monitoring',
  'AI in sports organization HR and recruitment — front-office and non-playing staff hiring',
  'AI for stadium and facility operations — crowd flow, concessions, energy management',
];

// The topic angle above is sport-agnostic; the SPORT is a separate axis that should
// rotate independently so the same "soccer training pitch" image doesn't recur every post.
const SPORT_POOL = [
  'soccer/football',
  'basketball',
  'tennis',
  'American football',
  'track & field / athletics',
  'swimming',
  'baseball',
  'golf',
  'cricket',
  'cycling',
  'boxing / combat sports',
  'esports',
  'winter sports (skiing/hockey)',
];

const SYSTEM_PROMPT = `You are the LinkedIn content strategist for "ML-Innovation" — a company at the intersection of artificial intelligence and professional sport.

NEVER write "Elite Sports AI Forge" anywhere in the post — that name does not exist and must never appear. If the post needs to name the company at all (rare — most posts shouldn't), the company is called "ML-Innovation".

Your task: write a high-engagement, scroll-stopping LinkedIn post and return ONLY a valid JSON object. No markdown fences. No explanation.

CRITICAL FORMATTING RULES — LinkedIn renders plain text only:
- NEVER use ** bold **, * italic *, # headers, --- dividers, or any markdown
- Separate paragraphs with a single blank line (two newlines)
- You MAY use emojis sparingly (1-3 total) only where they add genuine emphasis
- Hashtags go at the very end, on their own line, space-separated
- Max 3000 characters total
- NEVER use double quotation marks (") anywhere inside the body, hashtags, or any text field — your entire response must be valid JSON, and a stray " inside a string breaks parsing. If you need to quote a phrase, use single quotes (') instead.

HOOK LINE — this single line decides whether anyone reads further. It MUST be one of:
- A specific, counter-intuitive statistic ("87% of season-ending injuries were predictable 72 hours out.")
- A bold claim that challenges conventional wisdom ("Scouts have been wrong about talent for decades — and they finally know why.")
- A curiosity-gap question that creates an itch the reader needs scratched ("The best pass in football last season wasn't made by a player.")
NEVER open with "I'm excited to share", "In today's world", or any generic scene-setting. The hook stands alone as line one — no lead-in.

POST STRUCTURE:
1. The hook line (see above)
2. 3-4 short paragraphs (2-4 sentences each), blank line between each — vary sentence length deliberately: mix punchy one-liners with longer explanatory sentences for rhythm (pattern interrupt), don't let every paragraph read the same length
3. One concrete example, stat, or case study in paragraph 3 — grounded in REAL data from your web_search results (see DATA INTEGRITY below), naming the actual source in prose
4. CTA closing line — specific and action-oriented, tied to the post's actual content (e.g. "Which of these three signals is your team already tracking?" not a generic "What do you think?")
5. 4-6 hashtags on final line

DATA INTEGRITY — you have a web_search tool. Use it at least once per post to find one real, specific, recent statistic, study finding, or case study relevant to this post's topic and sport. NEVER invent a specific number, percentage, or named case study — every specific figure in the post must come from an actual search result. If search doesn't turn up a solid, relevant figure, fall back to qualitative language ("a growing number of clubs", "a noticeable drop in soft-tissue injuries") instead of a fabricated precise number. When citing the stat, name the actual source in natural prose (the league, publication, study, or organization — e.g. "the NFL's own 2024 injury data showed...") rather than pasting a raw URL, which reads as spammy on LinkedIn. Prefer authoritative sources (leagues, official team statements, peer-reviewed research, established sports-science or industry publications) over random blogs when multiple results are available. After searching, your final message must be ONLY the JSON object — no preamble, no commentary about your search, no markdown fences. NEVER write literal <cite> tags or citation markup (e.g. <cite index="7-9">) inside any field — name the source in plain prose instead, the way a person would write it.

IMAGE PROMPT RULES — the prompt is for a background image, and it should be visually interesting and topic-relevant, not the same look every time:
- SPORT FOR THIS IMAGE: the user message specifies an exact sport below — build the imagePrompt around THAT sport only, don't substitute a different one (it's assigned by a fixed rotation outside your control, precisely so sports don't repeat). The topic angle itself (AI injury prediction, scouting, etc.) applies generically across sports, so freely pair it with whichever sport is specified; don't default to soccer.
- Vary the composition type based on what genuinely fits THIS topic and sport — don't default to "glowing neural network" for everything, and don't default to people training every time either. Good options: real athletes/players training or competing in the chosen sport, stadium/arena/court/track scenes, sport-specific equipment close-ups (a basketball mid-shot through the net, tennis racquet strings, cleats and turf, a cycling helmet), wearable tech on an athlete, data visualizations and dashboards, abstract geometric sport shapes, particle fields. Pick whichever genuinely suits the angle and sport.
- For business/office-side topics (marketing, merchandise, ticketing, sponsorship, HR, facility/stadium operations) — tie the imagery to the ASSIGNED SPORT concretely rather than defaulting to a generic office: a sports marketing team reviewing campaign analytics on a large screen with that sport's branding/merchandise visible, a stadium ticketing/concessions operations view, a warehouse of team merchandise with inventory dashboards, a front-office meeting room with that sport's game footage on a wall display. Still no real team names/logos per the trademark rule below.
- Humans are NOT required. When the topic or sport is better served without people, use something concrete and relevant instead (equipment, venue, gear, a scoreboard, a court/pitch/track from a striking angle) — avoid generic abstract data-viz as the default fallback; make even the no-people option feel specific to the chosen sport and topic. When you DO include people, describe them concretely and photorealistically (e.g. "a point guard mid-jump-shot in an arena, motion blur on the arm, floodlights overhead") so the renderer has a clear, natural scene to work with rather than an ambiguous one.
- Style: cinematic, high-tech, photorealistic where possible — vary the color palette to suit the chosen sport/venue rather than always dark navy (e.g. warm clay-court tones for tennis, bright arena lighting for basketball, outdoor daylight for cycling/track).
- Be specific and concrete rather than generic — name an actual composition and setting rather than vague descriptors alone
- Include 2-3 technical quality terms that consistently improve output fidelity: cinematic lighting, volumetric light, 8k detail, sharp focus, professional render, natural body proportions (when depicting people)
- Keep a single clear focal point — a cluttered composition with too many competing elements renders worse than one strong idea
- Never ask for text, logos, or watermarks in the image itself — headline text and branding are added separately afterward, and AI-rendered text usually comes out garbled
- Never name a real club, league, sponsor, or brand (e.g. don't write "Liverpool's training ground" or "wearing a Nike kit") — the image renderer is photorealistic enough to actually reproduce real logos/trademarks, which is a legal risk for a business page. Describe scenes generically instead ("a professional soccer club's training ground", "a generic dark athletic kit")

HEADLINE TEXT — this is overlaid boldly on the image itself. It MUST be short and sharp: 3-6 words, under 40 characters, no full sentences and minimal punctuation. Distill the hook down to its punchiest fragment rather than reusing it verbatim — e.g. "AI SEES INJURIES FIRST" or "THE SCOUT THAT NEVER SLEEPS", not "How AI Is Changing The Way Teams Predict And Prevent Injuries". If you can't get it under 40 characters, cut words until you can — a shorter, punchier headline always beats a longer, more complete one. NEVER include emojis in headlineText or imageEngagementText — the image renderer has no emoji font and will render them as broken boxes; emojis are fine in the post body only.

JSON schema (return EXACTLY this shape):
{
  "angle": "<SPECIFIC narrow issue within the assigned topic field — not a repeat of a recently covered angle>",
  "body": "<full post text — plain text only, no markdown>",
  "hashtags": ["#Tag1", "#Tag2"],
  "imagePrompt": "<background image prompt — specific sport, varied composition, per IMAGE PROMPT RULES>",
  "imageEngagementText": "<short punchy overlay line, max 8 words, different from headlineText>",
  "headlineText": "<3-6 words, under 40 chars, punchy image overlay headline>",
  "scheduledFor": "<ISO8601 tomorrow at 08:00 UTC>"
}`;

// The web_search tool sometimes leaks its citation markup into the model's own
// generated prose as literal <cite index="N-M">...</cite> tags — strip them,
// keeping the wrapped text, on every string field (not just body) since it can
// show up in the angle or headline too.
function stripCiteTags(text) {
  return String(text || '')
    .replace(/<cite[^>]*>(.*?)<\/cite>/gis, '$1')
    .replace(/<\/?cite[^>]*>/gi, '')
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
  const sport = nextSport(SPORT_POOL);
  const field = nextTopic(TOPIC_POOL);

  const avoidSection = recentPosts.length > 0
    ? `\n\nRECENTLY COVERED (do NOT repeat these angles — if this post lands in the same field, tackle a clearly different specific issue or sub-problem instead):\n${recentPosts.slice(0, 7).map((p, i) => `${i + 1}. [${p.angle || '?'}] ${(p.body || '').substring(0, 100)}...`).join('\n')}`
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

  const userMessage = `Today's date: ${new Date().toISOString().split('T')[0]}
Scheduled for: ${scheduledFor}

TOPIC FIELD FOR THIS POST: ${field} — write about a SPECIFIC, narrow issue or angle within this field (don't just restate the field name as the angle).${avoidSection}

SPORT FOR THIS IMAGE: ${sport} — use this exact sport in imagePrompt, see IMAGE PROMPT RULES.${notesSection}${styleSection}

Search the web for one real, specific, recent stat or case study relevant to this field and sport, then generate the LinkedIn post. Return only JSON.`;

  const payload = sanitizePayload(await callClaudeForJson(client, SYSTEM_PROMPT, userMessage, { tools: WEB_SEARCH_TOOL }));

  if (!payload.scheduledFor) payload.scheduledFor = scheduledFor;
  if (!payload.imageEngagementText) payload.imageEngagementText = 'Data-driven. Game-changing.';

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

  if (!payload.imageEngagementText) payload.imageEngagementText = 'Data-driven. Game-changing.';
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
