#!/usr/bin/env node
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getActiveTemplate } = require('./templates');

const TOPIC_POOL = [
  'AI injury prediction and athlete load management',
  'Computer vision in match analysis — player tracking and heatmaps',
  'AI-powered scouting and talent identification',
  'Fan engagement personalization via machine learning',
  'AI in referee and VAR decision support',
  'Wearables and AI for real-time athlete biometrics',
  'AI-powered training periodization and recovery optimization',
  'Generative AI for sports media and commentary',
  'Predictive analytics for in-game strategy',
  'Ethics of AI in sport — fairness and data privacy',
  'AI performance analysis in esports',
  'Sports nutrition optimization via machine learning',
];

const SYSTEM_PROMPT = `You are the LinkedIn content strategist for "Elite Sports AI Forge" — a brand at the intersection of artificial intelligence and professional sport.

Your task: write a high-engagement LinkedIn post and return ONLY a valid JSON object. No markdown fences. No explanation.

CRITICAL FORMATTING RULES — LinkedIn renders plain text only:
- NEVER use ** bold **, * italic *, # headers, --- dividers, or any markdown
- Separate paragraphs with a single blank line (two newlines)
- You MAY use emojis sparingly (1-3 total) only where they add genuine emphasis
- Hashtags go at the very end, on their own line, space-separated
- Max 3000 characters total

POST STRUCTURE:
1. Hook line — a stat, bold claim, or provocative question (no "I'm excited to share")
2. 3-4 short paragraphs (2-4 sentences each), blank line between each
3. One concrete example or case study in paragraph 3
4. CTA closing line — invite a comment or share
5. 4-6 hashtags on final line

IMAGE PROMPT RULES — the prompt is for an abstract background image (NO people, NO human bodies, NO faces):
- Use: data visualizations, glowing neural networks, abstract geometric sport shapes, stadium silhouettes from above, sport equipment close-ups, digital dashboards, particle fields
- Style: cinematic, dark navy or deep sport colors, high-tech, photorealistic where possible
- Be specific and concrete rather than generic — name an actual composition (e.g. "glowing neural network over a stadium silhouette viewed from the upper tier, orange data-trails converging toward the pitch") rather than vague descriptors alone
- Include 2-3 technical quality terms that consistently improve output fidelity: cinematic lighting, volumetric light, 8k detail, sharp focus, professional render
- Keep a single clear focal point — a cluttered composition with too many competing elements renders worse than one strong idea
- Never ask for text, logos, or watermarks in the image itself — headline text and branding are added separately afterward, and AI-rendered text usually comes out garbled
- NEVER describe people, athletes, or human figures

JSON schema (return EXACTLY this shape):
{
  "angle": "<topic angle>",
  "body": "<full post text — plain text only, no markdown>",
  "hashtags": ["#Tag1", "#Tag2"],
  "imagePrompt": "<Pollinations Flux background prompt — abstract, no people>",
  "imageEngagementText": "<short punchy overlay line, max 8 words, different from headlineText>",
  "headlineText": "<max 60 char main headline for image overlay>",
  "scheduledFor": "<ISO8601 tomorrow at 08:00 UTC>"
}`;

async function generateContent(recentBodies = [], regenerationNotes = null) {
  const client = new Anthropic();

  const avoidTopics = recentBodies.length > 0
    ? `\n\nRECENT POSTS TO AVOID REPEATING:\n${recentBodies.slice(0, 7).map((b, i) => `${i + 1}. ${b.substring(0, 120)}...`).join('\n')}`
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
${TOPIC_POOL.map((t, i) => `${i + 1}. ${t}`).join('\n')}${avoidTopics}${notesSection}${styleSection}

Generate the LinkedIn post. Return only JSON.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const payload = JSON.parse(cleaned);

  // Sanitize: strip any accidental markdown that slipped through
  payload.body = payload.body
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // remove bold/italic
    .replace(/^#{1,6}\s+/gm, '')               // remove headers
    .replace(/^---+$/gm, '')                   // remove dividers
    .trim();

  if (!payload.scheduledFor) payload.scheduledFor = scheduledFor;
  if (!payload.imageEngagementText) payload.imageEngagementText = 'Data-driven. Game-changing.';

  return payload;
}

if (require.main === module) {
  const recentArg = process.argv[2] ? JSON.parse(process.argv[2]) : [];
  const notes = process.argv[3] || null;
  generateContent(recentArg, notes)
    .then(p => console.log(JSON.stringify(p, null, 2)))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { generateContent };
