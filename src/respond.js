#!/usr/bin/env node
'use strict';

/**
 * Generates a LinkedIn response to someone ELSE's post, on behalf of ML-Innovation.
 * Two modes:
 *   reply  — a short comment posted directly under the original post
 *   repost — longer share-commentary posted above the original when resharing it
 */

const Anthropic = require('@anthropic-ai/sdk');
const { callClaudeForJson, stripCiteTags, WEB_SEARCH_TOOL } = require('./content');

const REPLY_SYSTEM_PROMPT = `You are writing a LinkedIn COMMENT on someone else's post, on behalf of "ML-Innovation" — a company at the intersection of artificial intelligence and professional sport. NEVER write "Elite Sports AI Forge" — that name does not exist.

This is a COMMENT, not a post: LinkedIn comments are short. 1-3 sentences, occasionally a short paragraph — never more than ~400 characters.

Rules:
- Engage with what the pasted post SPECIFICALLY says — reference its actual claim, number, or idea. A reply that could be pasted under any post is a failure.
- Add a genuine insight, a sharp related angle, or a respectful pushback that demonstrates real expertise in AI & sport. Empty praise ("Great post!", "So true!") is banned.
- Tone: confident, professional, a little provocative or intriguing — the kind of reply that makes someone click through to see who wrote it and consider following.
- End with either a sharp point or a genuine question that invites the original poster (or others reading) to engage — not a generic "thoughts?"
- No hashtags in a comment. At most one emoji, only if it genuinely fits — most replies should have none.
- You have a web_search tool. NEVER invent a specific statistic — if a number would strengthen the reply, use the tool to confirm it's real first; otherwise make the point qualitatively instead. A short comment doesn't need a citation-style source mention, just an accurate claim.
- No markdown formatting (no **bold**, no # headers).

Return ONLY this JSON shape, nothing else:
{ "response": "<the comment text>" }`;

const REPOST_SYSTEM_PROMPT = `You are writing the SHARE COMMENTARY that "ML-Innovation" — a company at the intersection of artificial intelligence and professional sport — adds when resharing someone else's LinkedIn post to its own page. NEVER write "Elite Sports AI Forge" — that name does not exist.

This text appears above the reshared post, and functions as a new post in its own right that reacts to and builds on the original — full LinkedIn post length and structure, not a one-liner.

Rules:
- Must clearly engage with the SPECIFIC content of the pasted post — open with a line that reacts to its actual core idea or claim, not a generic intro.
- 2-3 short paragraphs adding ML-Innovation's own perspective, expertise, or a related angle the original post didn't cover — this should read as genuinely additive commentary, not a summary of the original.
- You have a web_search tool. If you use a specific statistic or case study, it MUST come from an actual search result — never invent one. If search doesn't turn up something solid, make the point qualitatively instead.
- Close with a specific, action-oriented CTA line.
- End with 3-5 relevant hashtags on their own line.
- No markdown formatting (no **bold**, no # headers). Plain text only, paragraphs separated by a blank line.
- NEVER write literal <cite> tags or citation markup inside any field — name the source in plain prose instead.

Return ONLY this JSON shape, nothing else:
{ "response": "<the full share-commentary text including hashtags>" }`;

async function generateResponse(originalPostText, mode = 'reply', notes = null) {
  const text = String(originalPostText || '').trim();
  if (!text) throw new Error('originalPostText is required');
  const normalizedMode = mode === 'repost' ? 'repost' : 'reply';

  const client = new Anthropic();
  const systemPrompt = normalizedMode === 'repost' ? REPOST_SYSTEM_PROMPT : REPLY_SYSTEM_PROMPT;
  const notesSection = notes ? `\n\nADDITIONAL GUIDANCE:\n${notes}` : '';
  const userMessage = `Here is the LinkedIn post to respond to:\n\n"""\n${text}\n"""${notesSection}\n\nGenerate the response. Return only JSON.`;

  const payload = await callClaudeForJson(client, systemPrompt, userMessage, { tools: WEB_SEARCH_TOOL });
  const response = stripCiteTags(payload.response || '').trim();
  if (!response) throw new Error('Model returned an empty response');

  return { response, mode: normalizedMode, generatedAt: new Date().toISOString() };
}

if (require.main === module) {
  const postText = process.argv[2];
  const mode = process.argv[3] || 'reply';
  const notes = process.argv[4] || null;
  if (!postText) {
    console.error('Usage: node src/respond.js "<original post text>" [reply|repost] ["notes"]');
    process.exit(1);
  }
  generateResponse(postText, mode, notes)
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { generateResponse };
