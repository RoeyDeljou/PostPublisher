#!/usr/bin/env node
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getActiveTemplate } = require('./templates');

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

const SYSTEM_PROMPT = `You are the LinkedIn content strategist for "Elite Sports AI Forge" — a brand at the intersection of artificial intelligence and professional sport.

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
3. One concrete example, stat, or case study in paragraph 3 — specific team/company/number, not a vague generality
4. CTA closing line — specific and action-oriented, tied to the post's actual content (e.g. "Which of these three signals is your team already tracking?" not a generic "What do you think?")
5. 4-6 hashtags on final line

IMAGE PROMPT RULES — the prompt is for a background image, and it should be visually interesting and topic-relevant, not the same look every time:
- SPORT ROTATION: pick ONE specific sport for this image from: ${SPORT_POOL.join(', ')}. Check the recent posts/images list below and do NOT reuse the same sport as any of them — rotate to something different each time. The topic angle itself (AI injury prediction, scouting, etc.) applies generically across sports, so freely pair it with whichever sport you choose; don't default to soccer.
- Vary the composition type based on what genuinely fits THIS topic and sport — don't default to "glowing neural network" for everything, and don't default to people training every time either. Good options: real athletes/players training or competing in the chosen sport, stadium/arena/court/track scenes, sport-specific equipment close-ups (a basketball mid-shot through the net, tennis racquet strings, cleats and turf, a cycling helmet), wearable tech on an athlete, data visualizations and dashboards, abstract geometric sport shapes, particle fields. Pick whichever genuinely suits the angle and sport.
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
  "angle": "<topic angle>",
  "body": "<full post text — plain text only, no markdown>",
  "hashtags": ["#Tag1", "#Tag2"],
  "imagePrompt": "<background image prompt — specific sport, varied composition, per IMAGE PROMPT RULES>",
  "imageEngagementText": "<short punchy overlay line, max 8 words, different from headlineText>",
  "headlineText": "<3-6 words, under 40 chars, punchy image overlay headline>",
  "scheduledFor": "<ISO8601 tomorrow at 08:00 UTC>"
}`;

function sanitizeBody(body) {
  return body
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // remove bold/italic
    .replace(/^#{1,6}\s+/gm, '')               // remove headers
    .replace(/^---+$/gm, '')                   // remove dividers
    .trim();
}

function parseClaudeJson(response) {
  const raw = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

// LLM "JSON" occasionally breaks (e.g. a stray unescaped quote inside a text field)
// despite the prompt instructing against it — retry the whole call rather than
// attempt fragile regex repair on malformed JSON.
async function callClaudeForJson(client, systemPrompt, userMessage, retries = 2) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    try {
      return parseClaudeJson(response);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function generateContent(recentBodies = [], regenerationNotes = null, recentImagePrompts = []) {
  const client = new Anthropic();

  const avoidTopics = recentBodies.length > 0
    ? `\n\nRECENT POSTS TO AVOID REPEATING:\n${recentBodies.slice(0, 7).map((b, i) => `${i + 1}. ${b.substring(0, 120)}...`).join('\n')}`
    : '';

  const avoidSports = recentImagePrompts.length > 0
    ? `\n\nRECENT IMAGE PROMPTS (avoid reusing the same sport or composition as these):\n${recentImagePrompts.slice(0, 7).map((p, i) => `${i + 1}. ${p}`).join('\n')}`
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

Available topic pool (pick one not used recently):
${TOPIC_POOL.map((t, i) => `${i + 1}. ${t}`).join('\n')}${avoidTopics}${avoidSports}${notesSection}${styleSection}

Generate the LinkedIn post. Return only JSON.`;

  const payload = await callClaudeForJson(client, SYSTEM_PROMPT, userMessage);
  payload.body = sanitizeBody(payload.body);

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

Revise this post. Return only JSON with the same schema as before (angle, body, hashtags, imagePrompt, imageEngagementText, headlineText) — omit scheduledFor, the caller keeps the original.`;

  const payload = await callClaudeForJson(client, SYSTEM_PROMPT, userMessage);
  payload.body = sanitizeBody(payload.body);

  if (!payload.imageEngagementText) payload.imageEngagementText = 'Data-driven. Game-changing.';
  if (!payload.angle) payload.angle = existingPost.angle;
  if (!payload.imagePrompt) payload.imagePrompt = existingPost.imagePrompt;

  return payload;
}

if (require.main === module) {
  const recentArg = process.argv[2] ? JSON.parse(process.argv[2]) : [];
  const notes = process.argv[3] || null;
  generateContent(recentArg, notes)
    .then(p => console.log(JSON.stringify(p, null, 2)))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { generateContent, reviseContent };
