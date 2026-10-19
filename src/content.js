#!/usr/bin/env node
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getActiveTemplate } = require('./templates');
const { nextTopic, nextClosingStyle, nextCompanyMention, nextVoice } = require('./rotation');
const { humanize, detect } = require('./humanize');

const WEB_SEARCH_TOOL = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];

// History: the pre-pivot version (SPORT_POOL, cinematic sport photography) lives
// on the git branch legacy-sport-rotation-v1. Since then: concept-driven photos
// (2026-09), the "Pain Points" PDF structure with real named evidence, rotating
// closing style / company-name mentions, and (2026-10) deliberately weird,
// controversial, candid-photo content plus the humanizer quality gate.
const TOPIC_POOL = [
  // Sport/game-day operations - specific, surprising, image-able
  'Concession or beer sales lost to poor timing around halftime or breaks in play',
  'Wait times and queues (concessions, restrooms, entry) treated as an ops metric instead of the revenue metric they are',
  'Static ticket or concession pricing that ignores real demand signals',
  'Scouting or recruitment decisions still driven by gut feel despite available performance data',
  'Empty seats or under-filled sections that better demand forecasting could have caught',
  'Stadium staffing that is scheduled the same way regardless of actual predicted crowd behavior',
  'Injury risk that was visible in the data days before it happened',
  'Fan experience friction (parking, entry lines, wait times) that quietly costs repeat attendance',
  'Merchandise or inventory decisions made on last season\'s guesswork instead of current demand signals',
  'Officiating or in-game decisions that data could have supported in real time',
  'Sponsorship value that is being sold on guesswork instead of actual exposure data',
  'Gambling and betting sponsorship revenue exposed to fast-moving regulation',
  'Loyalty and CRM programs that only look healthy because fans have nowhere else to go',
  'Fan support chatbots and automation with no path to a real human when it matters',
  'Fan tokens, NFTs and Web3 collectibles that were hype-driven and quietly failed, versus the unglamorous infrastructure that survived',
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

// Organizational/adoption topics: never name a real organization for these. The
// problem should read as a pattern the reader recognizes in their own
// organization, not a story about a specific named team or company. (Published
// survey statistics are still fine, attributed generically.)
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

const SYSTEM_PROMPT = `You are the LinkedIn voice of "ML-Innovation", a company at the intersection of artificial intelligence and professional sport that helps sports organizations adopt technology that actually works.

COMPANY NAME: the user message says, post by post, whether to name the company. When it says yes, write "ML-Innovation" exactly, once, naturally (usually in the closing). When it says no, do not name any company as the author or the seller, ML-Innovation included. "Elite Sports AI Forge" does not exist and must never appear, and neither does any other product, app or project name for us.

YOUR JOB: write a controversial, opinionated LinkedIn post that makes a decision-maker in a sports organization stop scrolling, feel slightly called out, and either argue with it or forward it to a colleague. It is three things working together: a weird photo, a provocative headline laid over it, and a short post that pays both off with real, specific, checkable facts. Return ONLY a valid JSON object. No markdown fences. No explanation.

BE CONTROVERSIAL. Take a side that part of the audience will push back on. Go after a comfortable industry habit, a sacred cow, a vanity project, a deck everyone copies, a number everyone quotes wrong. Say the thing people in the room think and nobody posts. Blunt beats balanced: no "on the one hand", no hedging, no corporate softeners. Mild crude language is welcome where it lands (piss, bullshit, crap, hell, ass), most of all in the headline and hook, but never a slur and never aimed at a group of people. Mock behaviors and decisions, not individuals. Never accuse a named person or company of anything beyond verified public facts. Being edgy never means being vague: the more provocative the claim, the more concrete the evidence has to be.

POST STRUCTURE (this is the house format, follow it closely):
1. HOOK: one line, blunt. Usually second person and accusatory ("Your fans aren't in that bathroom line because they hate you.") or a contrarian claim ("Most 'AI strategy for sports' is a 40-page PDF nobody reads.").
2. TWIST: one short line straight after that escalates or reframes it ("They're there because you designed it that way." / "Nobody updated the marketing deck." / "It's in every deck. It's been in mine.").
3. EVIDENCE: one to three short paragraphs of REAL, SPECIFIC facts from your searches: figures, named companies, leagues, products, regulations, dates. Fragments are fine ("DraftKings Reignmakers: shut down. Candy Digital: for sale."). Concrete beats abstract every time, but a stat wall is not a post: use only the 3 or 4 most striking facts, keep each evidence paragraph to 1 or 2 short sentences, and never open the post with a statistic.
4. REFRAME: one sharp line that changes how the reader sees it ("Wait time isn't an ops metric. It's a revenue metric you're leaving on the table every single home game.").
5. CLOSING, in the style the user message asks for:
   - talk: a plain, direct invitation to discuss their situation privately ("If this sounds like your organization, let's talk."). One sentence, no sales pitch.
   - reflective: a specific question about their own experience ("What's the longest concession line you've stood in this season?") or a declarative stakes-raising line ("If your Web3 strategy is still about the token price, you missed the pivot two years ago."). No ask, no "contact us", no company pitch.
6. HASHTAGS: exactly 4, on the final line. The first is always #SportsBusiness. The other three are topical (#AI, #FanExperience, #Sponsorship...).

Style model (rhythm only, NEVER reuse these facts in another post):
Your fans aren't in that bathroom line because they hate you.

They're there because you designed it that way.

53% of fans wait 15+ minutes for concessions. 79% miss a key play because of it. Meanwhile, stadiums that swapped a few concession stands for checkout-free tech saw sales jump 78%, not because they cut prices, because they cut the line.

Wait time isn't an ops metric. It's a revenue metric you're leaving on the table every single home game.

Every stadium already has the data to fix this: gate scans, POS timestamps, camera feeds. Nobody's wiring it together.

What's the longest concession line you've stood in this season? Curious how bad it really gets.

#SportsBusiness #FanExperience #AI #MatchDay

FORMAT RULES (LinkedIn renders plain text only):
- 700 to 1100 characters for the whole post including hashtags, hard maximum 1300. Short paragraphs of 1 to 3 sentences, a blank line between them. Mix one-line punches with longer sentences.
- No markdown: no ** bold **, no * italics *, no # headers, no --- dividers, no bullet lists.
- At most one emoji, and usually none.
- NEVER use double quotation marks (") anywhere inside any text field, because your whole response must be valid JSON. Use single quotes (') for quoted phrases.
- NEVER use the em dash anywhere, in any field. Use a period, a comma, a colon or a plain hyphen with spaces ( - ).
- If a sport comes up, call it "football", never "soccer" ("American football" stays as-is).
- Never open with "I'm excited to share", "In today's world" or similar. Avoid stock AI vocabulary (delve, leverage, robust, seamless, game-changing, landscape, journey): the text is scored for how machine-written it sounds and weak drafts get thrown out.

DATA INTEGRITY: NEVER fabricate any fact. That covers numbers, named companies and products, partnerships, regulations, dates, what a study found, and claims about how a technology works. You have a web_search tool and MUST use it, at least twice per post, to find real specifics for the evidence paragraphs: a published survey figure, a named product or partnership, a real regulation, a real shutdown or launch. Every specific figure or named entity in the post must come from an actual search result. Name the source in plain prose when it helps credibility ("according to Deloitte's sports survey"), never paste a URL, never write cite tags or citation markup. If a figure is regional, dated or from a vendor, say so. If searching does not turn up something solid, use fewer numbers but still one verifiable real example, and never fill a gap with an invented one. Public facts about named organizations (a partnership announcement, a shutdown, a ban, a published stat) are fine and encouraged; what happened INSIDE an organization (its internal decisions, dysfunction, results nobody published) must come from a real source or be left out. Describing a pattern generically ("one front office we've seen...") is always safe.

IMAGE PROMPT: this is the hook people actually see, so make it weird.
- THE BAR: a viewer must stop and think "what the f*** am I looking at?" in under a second, then need to read the post to understand it. If the scene could pass as a quirky stock photo, it fails. Object-only still lifes (a mug on a report, a whistle on a desk) are boring and banned: the scene needs a living subject (a person, an animal, or a person-sized object in a human role) doing something absurd, with a clear and slightly disturbing wrongness the eye lands on immediately.
- Describe ONE bizarre, funny, gross or deeply uncomfortable real-world scene that literalizes the post's point as an absurd visual metaphor or pun, the kind of picture that makes someone think "what the hell is this?" and then need to read why. Examples of the level we want: a man pissing at a stadium urinal with a beer cup in his hand (beer revenue going down the drain), a dead potted plant sitting in an office chair wearing a lanyard (the AI transformation lead), a scout sniffing a muddy boot with his eyes closed (scouting by gut feel).
- Crude and bodily humor, mess, decay, animals or objects in human roles, things in the wrong place, an everyday scene with one deeply wrong detail: all welcome. Stock-photo office scenes, handshakes, glowing brains, dashboards, stadium wide shots and generic "person at a desk" shots are exactly what we do NOT want.
- Describe only the SCENE: who or what, doing what, where, with which concrete physical details. The renderer already makes it look like a raw candid flash photo, so do not ask for lighting, style, lenses or quality words.
- Hard limits: no visible genitals or nudity, no sexual content, no gore or serious injury, no children, no real brand names or logos, no readable text or signage, no real or identifiable people (keep any person generic, plain clothes, unremarkable). Visible bodily fluids and gross-out are fine; anatomy is not.
- Vary the subject post to post. Do not reuse the examples above for a different topic.

HEADLINE TEXT: the bold text laid over the photo. It IS the hook, not a summary. 3 to 10 words, blunt, crude words welcome, always controversial and clickbait. Wrap the one or two punchiest words in single asterisks so they get highlighted. Never a plain description of the topic. No emojis, no double quotes. The user message gives a HEADLINE VOICE for this post, follow it:
- address: talks straight to the organization or reader. Example: Your fans are *pissing* away your halftime sales
- problem: states a general problem or uncomfortable truth about the sport or the industry, no "you". Examples: Sports clubs still *run* on gut feel and a spreadsheet. / The transfer market is *fraud* with a nicer name.
- weird: presents a strange, specific thing that is really happening, as a short clickbait teaser. Examples: Pro football clubs are *hiring* sleep coaches for their turf. / A top-flight club *paid* millions for a striker its own data hated.
Never start more than a third of headlines with "Your". The body should match the voice: for problem and weird, write about the sport and the industry in general (third person, observational), not as a pitch aimed at one organization.

JSON schema (return EXACTLY this shape):
{
  "angle": "<SPECIFIC narrow issue within the assigned topic, not a repeat of a recently covered angle>",
  "body": "<full post text, plain text, hashtags on the last line>",
  "hashtags": ["#SportsBusiness", "#Tag2", "#Tag3", "#Tag4"],
  "imagePrompt": "<the one weird scene, per IMAGE PROMPT>",
  "imageEngagementText": "Read more",
  "headlineText": "<the provocative headline with *highlighted* words>",
  "scheduledFor": "<ISO8601 tomorrow at 08:00 UTC>"
}`;

// The web_search tool sometimes leaks its citation markup into the model's own
// generated prose as literal (cite index="N-M">...</cite> tags - strip them,
// keeping the wrapped text, on every string field (not just body) since it can
// show up in the angle or headline too. Also normalizes em dashes to a plain
// hyphen with spacing - the prompt rule alone doesn't reliably stop the model
// from reaching for it as a stylistic habit, same lesson as cite tags. Used
// everywhere generated text passes through, including src/respond.js.
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

// Cite-tag leakage isn't limited to the body - strip it from every string field.
// (headlineText keeps its *highlight* asterisks on purpose - src/image.js reads them.)
function sanitizePayload(payload) {
  if (payload.body) payload.body = sanitizeBody(payload.body);
  if (payload.angle) payload.angle = stripCiteTags(payload.angle);
  if (payload.headlineText) payload.headlineText = stripCiteTags(payload.headlineText);
  if (payload.imageEngagementText) payload.imageEngagementText = stripCiteTags(payload.imageEngagementText);
  if (payload.imagePrompt) payload.imagePrompt = stripCiteTags(payload.imagePrompt);
  if (Array.isArray(payload.hashtags)) payload.hashtags = payload.hashtags.map(stripCiteTags);
  return payload;
}

const PAD_HASHTAGS = ['#AI', '#SportsTech', '#FanExperience', '#Sponsorship'];

// House rule: exactly 4 hashtags on the final line, #SportsBusiness first.
// Enforced in code (the model drifts between 3 and 6 otherwise).
function normalizeHashtags(payload) {
  const fromBody = (String(payload.body || '').match(/#\w+/g) || []);
  let tags = (Array.isArray(payload.hashtags) && payload.hashtags.length ? payload.hashtags : fromBody)
    .map(t => '#' + String(t).replace(/^#+/, '').replace(/\W/g, ''))
    .filter(t => t.length > 1);
  tags = tags.filter(t => t.toLowerCase() !== '#sportsbusiness');
  tags.unshift('#SportsBusiness');
  tags = tags.filter((t, i) => tags.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i);
  for (const pad of PAD_HASHTAGS) {
    if (tags.length >= 4) break;
    if (!tags.some(t => t.toLowerCase() === pad.toLowerCase())) tags.push(pad);
  }
  tags = tags.slice(0, 4);
  payload.hashtags = tags;
  const withoutTrailingTags = String(payload.body || '').replace(/(?:\n+[ \t]*(?:#\w+[ \t]*)+)+\s*$/, '').trim();
  payload.body = `${withoutTrailingTags}\n\n${tags.join(' ')}`;
  return payload;
}

const TALK_RE = /\b(let'?s talk|let us talk|reach out|get in touch|contact us|message us|dm us|drop us a line|talk to us|book a call)\b/i;

// Everything about a finished draft that is checkable in code: how machine-
// written it reads (src/humanize.js), whether the company name and closing
// style match what this slot asked for, and the length ceiling.
function assessDraft(payload, { closingStyle, nameCompany }) {
  const problems = [];
  const body = String(payload.body || '');
  const withoutTags = body.replace(/(?:\n+[ \t]*(?:#\w+[ \t]*)+)+\s*$/, '').trim();
  const detection = detect(withoutTags);
  if (detection.overall < 55) {
    problems.push(`It reads machine-written (score ${detection.overall}/100, weakest check: ${detection.weakest} - ${detection.checks[detection.weakest].detail}). Fix that: more concrete real specifics from your searches (figures, named companies), contractions, varied sentence lengths, no stock AI vocabulary.`);
  }
  const mentions = /ML-Innovation/i.test(withoutTags);
  if (nameCompany && !mentions) problems.push('It must name ML-Innovation exactly once (usually in the closing) and does not.');
  if (!nameCompany && mentions) problems.push('It must NOT name ML-Innovation or any company as the author, and it does. Remove it.');
  const paragraphs = withoutTags.split(/\n{2,}/);
  const last = paragraphs[paragraphs.length - 1] || '';
  if (closingStyle === 'talk' && !TALK_RE.test(last)) problems.push("The closing must be a direct invitation to talk privately (for example 'If this sounds like your organization, let's talk.') and is not.");
  if (closingStyle === 'reflective' && TALK_RE.test(last)) problems.push('The closing must be reflective (a specific question or a stakes-raising line) with no invitation to contact or talk to anyone, and it has one.');
  if (body.length > 1300) problems.push(`It is ${body.length} characters; the hard maximum is 1300 and the target is 700 to 1100. Cut it to the 3 or 4 most striking facts.`);
  // Structure: a one-line hook, then a one-line twist, before any evidence.
  if (paragraphs.length < 5) problems.push('It needs the full structure: hook line, twist line, evidence, reframe line, closing, as separate short paragraphs.');
  if (paragraphs[0] && paragraphs[0].length > 150) problems.push(`The first paragraph must be ONE blunt hook line under 150 characters (it is ${paragraphs[0].length}). Do not open with statistics.`);
  if (paragraphs[1] && paragraphs[1].length > 130) problems.push(`The second paragraph must be a short twist line under 130 characters (it is ${paragraphs[1].length}).`);
  return { problems, detection };
}

// With the web_search tool enabled, the response contains extra content blocks
// (server_tool_use, web_search_tool_result) ahead of the assistant's prose - the
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
// despite the prompt instructing against it - retry the whole call rather than
// attempt fragile regex repair on malformed JSON.
async function callClaudeForJson(client, systemPrompt, userMessage, { retries = 2, tools = undefined } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tools ? 3500 : 1200,
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

// Sanitize, run the humanizer, enforce the 4-hashtag rule. The humanizer only
// swaps stock vocabulary and typography; it never rewrites sentence shape.
function finalizePayload(payload) {
  sanitizePayload(payload);
  if (payload.body) payload.body = humanize(payload.body).text;
  if (!payload.imageEngagementText) payload.imageEngagementText = 'Read more';
  return normalizeHashtags(payload);
}

// recentPosts: array of { angle, body } from the most recent posts (any status),
// used to steer topic-field variety.
// opts.topic    - use this topic instead of advancing the topic rotation
// opts.voice / opts.closing ('talk'|'reflective') / opts.company (bool) - override rotation
// opts.preview  - don't consume closing-style / company-mention rotation slots
async function generateContent(recentPosts = [], regenerationNotes = null, opts = {}) {
  const client = new Anthropic();
  const field = opts.topic || nextTopic(TOPIC_POOL);
  const closingStyle = opts.closing || nextClosingStyle(!opts.preview);
  const nameCompany = typeof opts.company === 'boolean' ? opts.company : nextCompanyMention(!opts.preview);
  const voice = opts.voice || nextVoice(!opts.preview);

  const avoidSection = recentPosts.length > 0
    ? `\n\nRECENTLY COVERED (do NOT repeat these angles, image subjects or opening structures - if this post lands in the same field, tackle a clearly different specific issue, and pick a clearly different weird image):\n${recentPosts.slice(0, 7).map((p, i) => `${i + 1}. [${p.angle || '?'}] ${(p.body || '').substring(0, 100)}...`).join('\n')}`
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
    ? `\n\nTHIS IS AN ORGANIZATIONAL-PATTERN TOPIC - two extra rules apply:

1. NO REAL NAMES: do not name any real team, league, company or organization anywhere in this post, even in passing. Describe the pattern generically ("many sports organizations", "a common pattern across front offices", "teams we talk to"). A real published statistic is still welcome (you must search for one): attribute it to "published research", "a survey of sports executives" or similar WITHOUT naming the specific league, team or dataset, and never describe independent research as a named organization's own work.

2. WRITE TO THE ORGANIZATIONS LIVING THIS PROBLEM: speak directly to the people struggling with this exact issue right now, so the reader thinks "that's us".`
    : '';

  const styleLine = closingStyle === 'talk'
    ? 'CLOSING STYLE FOR THIS POST: talk (end with a plain, direct invitation to talk privately about their situation).'
    : 'CLOSING STYLE FOR THIS POST: reflective (end with a specific question or a stakes-raising line; NO invitation to contact or talk to anyone).';
  const companyLine = nameCompany
    ? 'NAME THE COMPANY IN THIS POST: yes. Write "ML-Innovation" exactly once, naturally, usually in the closing.'
    : 'NAME THE COMPANY IN THIS POST: no. Do not name ML-Innovation or any company as the author or seller.';

  const userMessage = `Today's date: ${new Date().toISOString().split('T')[0]}
Scheduled for: ${scheduledFor}

TOPIC FIELD FOR THIS POST: ${field} - write about a SPECIFIC, narrow issue or angle within this field (don't just restate the field name as the angle).${avoidSection}${noRealNamesSection}

${styleLine}
${companyLine}
HEADLINE VOICE FOR THIS POST: ${voice}${notesSection}${styleSection}

Search the web now for real, specific, recent facts on this topic, then write the post, the weird photo concept and the provocative headline. Return only JSON.`;

  let payload = finalizePayload(await callClaudeForJson(client, SYSTEM_PROMPT, userMessage, { tools: WEB_SEARCH_TOOL }));
  let { problems, detection } = assessDraft(payload, { closingStyle, nameCompany });

  // One corrective retry. Keep whichever draft has fewer problems.
  if (problems.length) {
    console.log(`[content] Draft needs work (${problems.length} issue(s), human score ${detection.overall}) - retrying once.`);
    const retryMessage = `${userMessage}\n\nYour previous draft was rejected for these reasons:\n- ${problems.join('\n- ')}\n\nPrevious draft body:\n${payload.body}\n\nWrite a new version that fixes every issue. Keep real facts from search results only. Return only JSON.`;
    try {
      const retried = finalizePayload(await callClaudeForJson(client, SYSTEM_PROMPT, retryMessage, { tools: WEB_SEARCH_TOOL }));
      const second = assessDraft(retried, { closingStyle, nameCompany });
      if (second.problems.length <= problems.length) { payload = retried; problems = second.problems; detection = second.detection; }
    } catch (err) {
      console.warn(`[content] Retry failed (${err.message}) - keeping the first draft.`);
    }
  }
  console.log(`[content] Final draft: human score ${detection.overall} ${detection.verdict}, closing=${closingStyle}, company=${nameCompany ? 'named' : 'not named'}${problems.length ? `, remaining issues: ${problems.length}` : ''}`);

  if (!payload.scheduledFor) payload.scheduledFor = scheduledFor;
  payload.closingStyle = closingStyle;
  payload.companyNamed = nameCompany;
  payload.headlineVoice = voice;
  return payload;
}

// Revise an EXISTING post per user notes, keeping the same core angle/topic rather than
// picking a brand new one - used by the dashboard's "regenerate with notes" flow.
async function reviseContent(existingPost, notes = null) {
  const client = new Anthropic();

  const template = getActiveTemplate();
  const styleSection = template
    ? `\n\nIMAGE STYLE GUIDANCE (apply to imagePrompt):\n${template.styleNotes}`
    : '';

  const notesSection = notes
    ? `\n\nIMPROVEMENT INSTRUCTIONS:\n${notes}`
    : '\n\nNo specific instructions given - just make it stronger: sharper hook, more specific real evidence, more controversial, tighter writing.';

  const existingHashtags = Array.isArray(existingPost.hashtags)
    ? existingPost.hashtags.join(' ')
    : (existingPost.hashtags || '');

  const userMessage = `Here is an EXISTING LinkedIn post that needs revision. Keep the same core angle/topic - do not switch to a different subject, just improve the execution. Keep its closing style (talk vs reflective) and whether it names ML-Innovation exactly as they are now, unless the instructions below say otherwise.

ANGLE: ${existingPost.angle || '(none)'}

CURRENT BODY:
${existingPost.body || '(none)'}

CURRENT HASHTAGS: ${existingHashtags || '(none)'}
CURRENT IMAGE PROMPT: ${existingPost.imagePrompt || '(none)'}
${notesSection}${styleSection}

If the current body already contains a specific stat or named fact, keep it only if it is genuinely real - if you are not confident it came from a real source, replace it with a real one found via web_search rather than leaving a fabricated number in place.

Revise this post. Return only JSON with the same schema as before (angle, body, hashtags, imagePrompt, imageEngagementText, headlineText) - omit scheduledFor, the caller keeps the original.`;

  const payload = finalizePayload(await callClaudeForJson(client, SYSTEM_PROMPT, userMessage, { tools: WEB_SEARCH_TOOL }));

  if (!payload.angle) payload.angle = existingPost.angle;
  if (!payload.imagePrompt) payload.imagePrompt = existingPost.imagePrompt;

  return payload;
}

if (require.main === module) {
  // recentArg: JSON array of { angle, body } objects, e.g. '[{"angle":"...","body":"..."}]'
  // Preview mode (no rotation slots consumed): node src/content.js '[]' "notes" --preview [--topic "..."]
  const argv = process.argv.slice(2);
  const preview = argv.includes('--preview');
  const ti = argv.indexOf('--topic');
  const topic = ti !== -1 ? argv[ti + 1] : null;
  const flag = n => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : undefined; };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--topic', '--voice', '--closing', '--company'].includes(argv[i - 1]));
  const recentArg = positional[0] ? JSON.parse(positional[0]) : [];
  const notes = positional[1] || null;
  generateContent(recentArg, notes, { preview, topic, voice: flag('--voice'), closing: flag('--closing'), company: flag('--company') === undefined ? undefined : flag('--company') === 'yes' })
    .then(p => console.log(JSON.stringify(p, null, 2)))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { generateContent, reviseContent, callClaudeForJson, stripCiteTags, WEB_SEARCH_TOOL, TOPIC_POOL };
