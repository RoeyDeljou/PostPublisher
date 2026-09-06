#!/usr/bin/env node
'use strict';

/**
 * Builds a short (~20-25s) narrated video for a post: real stock footage
 * (Pexels/Pixabay, chosen by keyword) assembled with ffmpeg, a spoken-word
 * narration script (written by Claude, synthesized with free Edge neural TTS)
 * muxed in as the audio track, and the brand logo + a caption burned in.
 *
 * This replaced an earlier "Ken Burns" approach (a still AI image with a slow
 * zoom/pan and animated text) that read as a moving graphic, not a video.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { callClaudeForJson, stripCiteTags } = require('./content');
const { LOGO_PATH, stripEmoji, DEFAULT_CONTACT_TEXT } = require('./image');

const VIDEO_DIR = path.join(__dirname, '..', 'data', 'videos');
const FONT_PATH = path.join(__dirname, '..', 'data', 'fonts', 'ArchivoBlack-Regular.ttf');

// 4:5 portrait — LinkedIn's best-performing ratio for mobile feed engagement
// (fills most of the screen without triggering full-screen immersive mode).
const WIDTH = 1080;
const HEIGHT = 1350;

// The "Multilingual" neural voices (a 2024+ Azure addition) sound noticeably
// more human/expressive than the older base neural voices - use one of those
// as the default rather than the flatter-sounding en-US-GuyNeural.
const NARRATION_VOICE = process.env.NARRATION_VOICE || 'en-US-AndrewMultilingualNeural';
const CLIP_COUNT = 3;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hasFfmpeg() {
  return new Promise(resolve => {
    execFile('ffmpeg', ['-version'], err => resolve(!err));
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${err.message}${stderr ? ' - ' + stderr.slice(-500) : ''}`));
      resolve();
    });
  });
}

function getDurationSec(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], (err, stdout) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      const seconds = parseFloat(stdout.trim());
      if (!Number.isFinite(seconds) || seconds <= 0) return reject(new Error('ffprobe returned an invalid duration'));
      resolve(seconds);
    });
  });
}

// ── 1. Narration script + stock-footage search keywords (Claude) ───────────

const SCRIPT_SYSTEM_PROMPT = `You are writing a short SPOKEN-WORD VIDEO NARRATION script for "ML-Innovation" — a company at the intersection of artificial intelligence and professional sport. If you name the company, it is ALWAYS "ML-Innovation" — never any other name.

This is narration for a ~20-25 second video - one flowing paragraph meant to be READ ALOUD, not a LinkedIn post. No hashtags, no line breaks, no markdown, no emojis.

HARD LENGTH LIMIT: 70 words maximum, no exceptions - count as you write. This applies even when the topic angle given to you is long, nuanced, or multi-part (e.g. a complex format/venue/role scenario): your job is to compress it down to the ONE simplest, most concrete takeaway a listener could grasp on first hearing, not to explain the nuance. A longer, more complete explanation is a FAILURE here even if it's more accurate to the source topic - simplifying further is always the right move over running long.

Rules:
- Open with a punchy, attention-grabbing line (a claim, a scene, or a question) since the video needs to hook someone scrolling within the first couple seconds.
- Make ONE clear, sharp, informative point about the given topic and sport, in plain spoken language — short, natural sentences a person would actually say out loud, not written prose. Every sentence should earn its place: this is a tight ~20-25 seconds, not a summary of the whole post, so cut anything that doesn't build directly toward the point and the closing invitation.
- Do NOT include specific statistics, percentages, or named case studies — a short spoken teaser doesn't have room to properly source a claim, so keep it qualitative ("a growing number of teams", "far earlier than before") instead of inventing a precise figure.
- NEVER reveal ML-Innovation's own implementation method, architecture, or step-by-step approach — name the capability or the shift, not how it's built.
- Always call the sport "football", never "soccer" ("American football" stays as-is when that's genuinely the assigned sport).
- NEVER use the em dash (—) anywhere — use a period, comma, colon, or a regular hyphen with spaces ( - ) instead.
- CLOSING LINE (required, spend your last ~5-8 words on this): a direct, specific invitation to reach out to ML-Innovation and discuss it - not a vague "food for thought" close and not a hard sales pitch, a genuine, natural-sounding invitation to talk (e.g. "If that sounds like your organization, let's talk." / "Curious what that could look like for your team? Get in touch."). It must still sound like something a person would actually say out loud, not an ad slogan.

Also provide 3 short stock-footage search phrases (2-4 words each, in English) for a general stock-video library search (Pexels/Pixabay). These searches are keyword-matched, not meaning-matched, so vague or tech/office words ("tablet", "data", "screen", "analytics", "dashboard", "AI", "overlay", "computer", "laptop") pull totally unrelated generic business-and-gadget footage instead of sport footage — NEVER use words like that in a keyword phrase, even if the script itself mentions data or technology. Every single keyword phrase MUST contain the assigned sport's name (or its venue/equipment, e.g. "pitch", "court", "arena", "track") so the search can't drift off-topic.

TRADEMARK RISK — this is real footage, not an AI generation we can steer away from logos, so avoid the keyword shapes most likely to surface an actual named club's branded stadium (team crests, sponsor boards, seat-back branding, painted stadium names are common in real footage of professional stadiums and would look like an unauthorized endorsement on a business page): prefer AERIAL/WIDE pitch shots, TRAINING/practice footage, and close-up action or equipment over ground-level spectator-stand shots of a named professional stadium. Never use the bare word "stadium" alone as or within a keyword - use "training pitch", "training session", "aerial pitch", "match action", or sport-specific equipment instead. Good examples: "football training session", "football aerial pitch", "basketball arena crowd" (crowd/court angle, not team branding), "tennis court aerial". Bad examples: "coach reviewing tablet" (irrelevant results), "football stadium" or "football scout stadium" (surfaces real branded professional stadiums).

Return ONLY this JSON shape, nothing else:
{ "script": "<the narration text>", "keywords": ["<phrase 1>", "<phrase 2>", "<phrase 3>"] }`;

// The prompt's 70-word hard cap isn't always obeyed for a long/nuanced topic
// angle (seen in testing: a complex format/venue scenario produced a 150+
// word script, a 50s video instead of ~20-25s) - a code-level check with one
// corrective retry catches that instead of silently shipping an oversized
// video. Even after strengthening the prompt, outputs still commonly landed
// at 80-84 words - set the threshold at 75 (a little above the 70-word
// prompt limit for natural variance) so those still trigger the retry
// instead of shipping a video noticeably longer than intended.
const MAX_SCRIPT_WORDS = 75;

async function generateNarrationScript({ angle, body, imagePrompt, notes }) {
  const client = new Anthropic();
  const notesSection = notes ? `\n\nADDITIONAL GUIDANCE:\n${notes}` : '';
  const userMessage = `Topic angle: ${angle || '(none given)'}

Full post this video accompanies (for context only - do not just read this aloud, write a distinct shorter script):
${body || '(none given)'}

Background scene concept (tells you the assigned sport for this post): ${imagePrompt || '(none given)'}${notesSection}

Write the narration script and stock-footage keywords now. Return only JSON.`;

  let payload = await callClaudeForJson(client, SCRIPT_SYSTEM_PROMPT, userMessage, {});
  let script = stripCiteTags(payload.script || '').trim();
  let wordCount = script.split(/\s+/).filter(Boolean).length;

  if (wordCount > MAX_SCRIPT_WORDS) {
    const retryMessage = `${userMessage}\n\nYour previous attempt was ${wordCount} words, which is far too long for a ~20-25 second video: "${script}"\n\nRewrite it to 70 words or fewer by simplifying to the single most concrete takeaway - do not just trim sentences, cut the scope of what you're trying to explain. Return only JSON.`;
    payload = await callClaudeForJson(client, SCRIPT_SYSTEM_PROMPT, retryMessage, {});
    script = stripCiteTags(payload.script || '').trim();
    wordCount = script.split(/\s+/).filter(Boolean).length;
  }

  return {
    script,
    keywords: Array.isArray(payload.keywords) ? payload.keywords.filter(Boolean).map(String) : [],
  };
}

// ── 2. Stock footage (Pexels, falling back to Pixabay) ──────────────────────

function httpsGetJson(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${options.hostname}${options.path}: ${data.slice(0, 200)}`));
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timed out')));
    req.end();
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.destroy();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.destroy();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', err => {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      reject(err);
    });
  });
}

// Picks the file closest to our target portrait frame without upscaling too far.
function pickBestPexelsFile(videoFiles) {
  const portrait = (videoFiles || []).filter(f => f.height >= f.width);
  const pool = portrait.length ? portrait : (videoFiles || []);
  if (!pool.length) return null;
  pool.sort((a, b) => Math.abs((a.height || 0) - HEIGHT) - Math.abs((b.height || 0) - HEIGHT));
  return pool[0].link;
}

async function searchPexelsVideos(query) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  const json = await httpsGetJson({
    hostname: 'api.pexels.com',
    path: `/videos/search?query=${encodeURIComponent(query)}&per_page=6&orientation=portrait`,
    method: 'GET',
    headers: { Authorization: apiKey },
  });
  return (json.videos || []).map(v => pickBestPexelsFile(v.video_files)).filter(Boolean);
}

async function searchPixabayVideos(query) {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) return [];
  const json = await httpsGetJson({
    hostname: 'pixabay.com',
    path: `/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=6&video_type=film`,
    method: 'GET',
  });
  return (json.hits || [])
    .map(h => h.videos && (h.videos.large || h.videos.medium || h.videos.small))
    .filter(Boolean)
    .map(v => v.url);
}

async function searchAnyProvider(query) {
  const fromPexels = await searchPexelsVideos(query).catch(() => []);
  if (fromPexels.length) return fromPexels;
  return searchPixabayVideos(query).catch(() => []);
}

// Stock search is keyword-matched, not meaning-matched, so a query can still
// return an occasional off-topic top result (seen in testing: a "basketball
// player action" search surfaced an irrelevant backstage portrait clip). As a
// defense-in-depth check on top of the prompt's keyword rules, only Pexels
// URLs carry a descriptive slug we can sanity-check against the query - a
// video whose slug doesn't share any distinctive word with the search is
// pushed to the back rather than dropped outright (still used if nothing
// better turns up, since this heuristic is imperfect and Pixabay URLs never
// match it at all).
const FOOTAGE_KEYWORD_STOPWORDS = new Set([
  'training', 'session', 'action', 'aerial', 'court', 'pitch', 'match', 'footage',
  'players', 'player', 'movement', 'view', 'field', 'arena', 'track', 'game',
  'sport', 'sports', 'close-up', 'closeup',
]);
function keywordTokens(kw) {
  return kw.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !FOOTAGE_KEYWORD_STOPWORDS.has(w));
}
function looksRelevant(url, kw) {
  const tokens = keywordTokens(kw);
  if (!tokens.length) return true;
  const slug = url.toLowerCase();
  return tokens.some(t => slug.includes(t));
}
function rankByRelevance(results, kw) {
  const relevant = results.filter(u => looksRelevant(u, kw));
  const rest = results.filter(u => !looksRelevant(u, kw));
  return [...relevant, ...rest];
}

async function fetchStockClips(keywords, fallbackKeyword, tempDir) {
  // Search every keyword up front (each returns several candidates) so we can
  // take ONE clip per keyword first - each keyword describes a different shot
  // (training, aerial, action, ...), so this actually gives the video visual
  // variety instead of all 3 clips silently coming from whichever keyword was
  // searched first, which is what happened when this just concatenated every
  // result and cut it off at CLIP_COUNT.
  const perKeywordResults = [];
  for (const kw of keywords) {
    const found = await searchAnyProvider(kw);
    perKeywordResults.push(rankByRelevance(found, kw));
  }

  const urls = [];
  for (const results of perKeywordResults) {
    if (results.length) urls.push(results[0]);
  }
  outer: for (const results of perKeywordResults) {
    for (const u of results.slice(1)) {
      if (urls.length >= CLIP_COUNT) break outer;
      if (!urls.includes(u)) urls.push(u);
    }
  }
  if (!urls.length && fallbackKeyword) {
    urls.push(...await searchAnyProvider(fallbackKeyword));
  }
  if (!urls.length) throw new Error('No stock footage found for any search keyword');

  const uniqueUrls = [...new Set(urls)].slice(0, CLIP_COUNT);
  const clipPaths = [];
  for (let i = 0; i < uniqueUrls.length; i++) {
    const dest = path.join(tempDir, `clip_${i}.mp4`);
    await downloadFile(uniqueUrls[i], dest);
    clipPaths.push(dest);
  }
  return clipPaths;
}

// ── 3. Narration audio (free Edge neural TTS) ────────────────────────────────

// Word-boundary offsets/durations come back in 100-nanosecond ticks (the
// standard Azure Speech unit) - divide by 1e7 to get seconds.
const TICKS_PER_SECOND = 1e7;

async function synthesizeNarration(script, outBasePath) {
  const { EdgeTTS } = await import('@andresaya/edge-tts');
  const tts = new EdgeTTS();
  await tts.synthesize(script, NARRATION_VOICE);
  await tts.toFile(outBasePath);
  const mp3Path = `${outBasePath}.mp3`;
  if (!fs.existsSync(mp3Path)) throw new Error('Edge TTS did not produce an audio file');

  const wordBoundaries = tts.getWordBoundaries().map(w => ({
    text: w.text,
    start: w.offset / TICKS_PER_SECOND,
    end: (w.offset + w.duration) / TICKS_PER_SECOND,
  }));

  return { audioPath: mp3Path, wordBoundaries };
}

// Groups timed words into short on-screen caption chunks (a handful of words
// each, breaking early on sentence-ending punctuation) so captions read like
// real subtitles instead of one word flashing at a time or one wall of text
// sitting on screen for the whole video.
function buildCaptionCues(wordBoundaries, maxWordsPerCue = 3) {
  const cues = [];
  let current = [];
  for (const w of wordBoundaries) {
    current.push(w);
    const endsClause = /[.,!?]$/.test(w.text);
    if (current.length >= maxWordsPerCue || endsClause) {
      cues.push(current);
      current = [];
    }
  }
  if (current.length) cues.push(current);
  return cues.map(words => ({
    text: words.map(w => w.text).join(' '),
    start: words[0].start,
    end: words[words.length - 1].end,
  }));
}

// ── 4. ffmpeg escaping helpers ────────────────────────────────────────────

// ffmpeg's filtergraph parser needs BOTH single-quote wrapping (so spaces in
// Windows paths/text don't get treated as separators) AND an escaped colon
// even inside the quotes (a bare drive-letter colon like "C:" still breaks
// the parser otherwise) - confirmed empirically, quoting alone isn't enough.
function escapeDrawtext(text) {
  const cleaned = String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/'/g, '');
  return `'${cleaned}'`;
}

function escapeFilterPath(filePath) {
  const cleaned = filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, '');
  return `'${cleaned}'`;
}

// ── 5. Assembly ────────────────────────────────────────────────────────────

async function buildVideo({ prompt, headline, angle, body, contactText = DEFAULT_CONTACT_TEXT, outputPath, notes = null }) {
  if (!(await hasFfmpeg())) throw new Error('ffmpeg not available on this machine');

  ensureDir(VIDEO_DIR);
  const tempDir = path.join(VIDEO_DIR, `_tmp_${Date.now()}`);
  ensureDir(tempDir);

  try {
    const { script, keywords } = await generateNarrationScript({ angle, body, imagePrompt: prompt, notes });
    if (!script) throw new Error('Narration script generation returned an empty script');

    const { audioPath: narrationPath, wordBoundaries } = await synthesizeNarration(script, path.join(tempDir, 'narration'));
    const narrationDuration = await getDurationSec(narrationPath);
    const captionCues = buildCaptionCues(wordBoundaries);

    const fallbackKeyword = (prompt || headline || 'sports training').split(',')[0].trim();
    const clipPaths = await fetchStockClips(keywords.length ? keywords : [fallbackKeyword], fallbackKeyword, tempDir);

    const targetDuration = narrationDuration + 1.0;
    const perClip = targetDuration / clipPaths.length;

    const hasLogo = fs.existsSync(LOGO_PATH);
    const inputArgs = [];
    // -stream_loop -1 loops each clip indefinitely at the demuxer level so the
    // later `trim=0:perClip` always has enough source frames even when a
    // downloaded stock clip is shorter than its allotted segment - without
    // this, a short clip would silently cut its segment short and truncate
    // the narration audio (via -shortest) below its actual length.
    clipPaths.forEach(p => inputArgs.push('-stream_loop', '-1', '-i', p));
    const narrationInputIndex = clipPaths.length;
    inputArgs.push('-i', narrationPath);
    let logoInputIndex = null;
    if (hasLogo) {
      logoInputIndex = narrationInputIndex + 1;
      inputArgs.push('-i', LOGO_PATH);
    }

    const filterParts = clipPaths.map((_, i) =>
      `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},trim=0:${perClip.toFixed(2)},setpts=PTS-STARTPTS,fps=24[v${i}]`
    );
    const concatInputs = clipPaths.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${clipPaths.length}:v=1:a=0[vconcat]`);

    let videoChain = '[vconcat]';
    if (hasLogo) {
      filterParts.push(`${videoChain}[${logoInputIndex}:v]overlay=28:28[vlogo]`);
      videoChain = '[vlogo]';
    }

    // Real subtitles synced to the narration (via Edge TTS's word-boundary
    // timestamps) replace what used to be one static headline sitting on
    // screen the whole video - each cue only shows while it's actually being
    // said, like real captions.
    const fontPathEscaped = escapeFilterPath(FONT_PATH);
    const captionDrawtexts = captionCues.map(cue => {
      const raw = stripEmoji(cue.text);
      const text = escapeDrawtext(raw);
      // A short word-chunk can still be long in characters ("Automatically
      // finding" etc.) - a fixed font size overflowed both edges of a 1080px
      // frame in testing since drawtext doesn't wrap or clip. Scale down for
      // longer chunks the same way image.js sizes headlines by length.
      const fontSize = raw.length > 26 ? 40 : raw.length > 18 ? 46 : 54;
      return `drawtext=fontfile=${fontPathEscaped}:text=${text}:fontcolor=white:fontsize=${fontSize}:borderw=4:bordercolor=black@0.8:x=(w-text_w)/2:y=h-260:line_spacing=8:enable='between(t,${cue.start.toFixed(2)},${cue.end.toFixed(2)})'`;
    });
    const contactTextEscaped = escapeDrawtext(stripEmoji(contactText || ''));
    const contactDrawtext = `drawtext=fontfile=${fontPathEscaped}:text=${contactTextEscaped}:fontcolor=white:fontsize=26:borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=h-80`;
    filterParts.push(`${videoChain}${[...captionDrawtexts, contactDrawtext].join(',')}[vout]`);

    const filterComplex = filterParts.join(';');

    await runFfmpeg([
      '-y',
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-map', `${narrationInputIndex}:a`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ]);

    return outputPath;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  const prompt = get('--prompt');
  const headline = get('--headline');
  const angle = get('--angle') || headline;
  const body = get('--body') || '';
  const contactText = get('--contact') || undefined;
  const output = get('--output') || path.join(VIDEO_DIR, `post_${Date.now()}.mp4`);
  if (!prompt || !headline) {
    console.error('Usage: node src/video.js --prompt "..." --headline "..." [--angle "..."] [--body "..."] [--contact "..."] [--output path.mp4]');
    process.exit(1);
  }
  buildVideo({ prompt, headline, angle, body, contactText, outputPath: output })
    .then(p => console.log(JSON.stringify({ videoPath: p })))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = {
  buildVideo, hasFfmpeg, generateNarrationScript, synthesizeNarration,
  fetchStockClips, getDurationSec, runFfmpeg, escapeDrawtext, escapeFilterPath,
  buildCaptionCues,
};
