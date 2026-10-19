#!/usr/bin/env node
'use strict';

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { nextTreatment } = require('./rotation');

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');
const LOGO_PATH = path.join(__dirname, '..', 'data', 'logo.png');
const FONT_DIR = path.join(__dirname, '..', 'data', 'fonts');

// Bundled fonts so output is identical on a Windows dev machine and GitHub's
// Linux runners (system fonts differ). Inter ExtraBold/SemiBold (SIL OFL, see
// data/fonts/Inter-OFL.txt) give the headline a current, native-social look;
// Archivo Black stays registered as a fallback and for src/video.js.
function registerFont(file, family) {
  const p = path.join(FONT_DIR, file);
  if (!fs.existsSync(p)) return null;
  GlobalFonts.registerFromPath(p, family);
  return family;
}
registerFont('ArchivoBlack-Regular.ttf', 'Archivo Black');
const HEAD_FONT = registerFont('Inter-ExtraBold.otf', 'Inter XB') || 'Archivo Black';
const LABEL_FONT = registerFont('Inter-SemiBold.otf', 'Inter SB') || HEAD_FONT;

const BRAND = {
  accent: '#D9FF3F',
  white: '#FFFFFF',
  size: 1080,
  font: HEAD_FONT,
};

// 2026-10: the first treatments read as 1980s retail ads, the second set
// (outlined meme type, tilted stickers, flash + grain) read as 1990s. These three
// are current UI-style layouts: tight-tracked Inter, frosted glass, clean cards,
// accent-colored key word, crisp photo with no grain.
const TREATMENTS = ['editorial', 'glass', 'card'];

// Every image gets a contact line by default - pass contactText: null to omit.
const DEFAULT_CONTACT_TEXT = 'ml-innovate.com';

function ensureDir() {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function fetchOpenAIBackground(prompt, outputPath) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY not set'));

    const payload = JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      quality: 'medium',
      size: '1024x1024',
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`OpenAI image API HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try {
          const parsed = JSON.parse(data);
          const b64 = parsed.data && parsed.data[0] && parsed.data[0].b64_json;
          if (!b64) return reject(new Error('OpenAI response missing image data'));
          fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
          resolve(outputPath);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('OpenAI image request timed out')));
    req.write(payload);
    req.end();
  });
}

function createGradientFallback(canvas, ctx) {
  const { width: w, height: h } = canvas;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#111418');
  grad.addColorStop(1, '#2b3340');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// node-canvas has no bundled emoji font - emoji glyphs render as tofu boxes, so
// strip them from anything drawn on the canvas (fine in the LinkedIn post body).
function stripEmoji(text) {
  return String(text || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

// ── Layout helpers ──────────────────────────────────────────────────────────

// Which word of the headline gets the marker highlight: a number/money token
// if there is one (that's the punch), otherwise the longest word in the back
// two thirds, otherwise the last word.
function pickHighlight(words) {
  const num = words.findIndex(w => /[\d$%£€]/.test(w));
  if (num !== -1) return num;
  let best = -1, len = 0;
  words.forEach((w, i) => {
    const clean = w.replace(/[^A-Za-z]/g, '');
    if (i >= Math.floor(words.length / 3) && clean.length >= 6 && clean.length > len) { best = i; len = clean.length; }
  });
  return best !== -1 ? best : words.length - 1;
}

// Headlines may mark their own highlight with single asterisks:
// "Your fans are *pissing* away your halftime sales". Returns plain words plus
// the set of word indexes to highlight (empty set = none marked).
function parseHeadline(text) {
  const words = [];
  const hl = new Set();
  let inStar = false;
  for (const tok of String(text).split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('*')) inStar = true;
    const clean = tok.replace(/\*/g, '');
    if (clean) {
      words.push(clean);
      if (inStar) hl.add(words.length - 1);
    }
    if (tok.endsWith('*')) inStar = false;
  }
  return { words, hl };
}

function baseFontPx(chars) {
  if (chars <= 24) return 112;
  if (chars <= 34) return 96;
  if (chars <= 46) return 84;
  if (chars <= 60) return 72;
  return 62;
}

// Greedy word wrap that keeps each word's index so the highlight survives.
function wrapWords(ctx, words, maxWidth) {
  const lines = [];
  let line = [];
  let width = 0;
  const space = ctx.measureText(' ').width;
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width;
    const add = line.length ? space + ww : ww;
    if (width + add > maxWidth && line.length) {
      lines.push(line);
      line = [{ w, i }];
      width = ww;
    } else {
      line.push({ w, i });
      width += add;
    }
  });
  if (line.length) lines.push(line);
  return lines;
}

// Pick the biggest font size (scaled) whose wrapped text fits in maxLines.
function fitHeadline(ctx, text, { scale = 1, maxWidth, maxLines = 4, family = HEAD_FONT }) {
  const { words, hl } = parseHeadline(text);
  let px = Math.round(baseFontPx(words.join(' ').length) * scale);
  let lines;
  for (;;) {
    ctx.font = `${px}px "${family}"`;
    ctx.letterSpacing = `${(-0.03 * px).toFixed(1)}px`;
    lines = wrapWords(ctx, words, maxWidth);
    if (lines.length <= maxLines || px <= 40) break;
    px = Math.round(px * 0.9);
  }
  return { px, lines, words, highlight: hl.size ? hl : new Set([pickHighlight(words)]) };
}

function applyGrain(ctx, size, amount = 16) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

async function drawLogo(ctx, x, y, s) {
  if (!fs.existsSync(LOGO_PATH)) return;
  try {
    const logo = await loadImage(LOGO_PATH);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, s * 0.22);
    ctx.clip();
    ctx.drawImage(logo, x, y, s, s);
    ctx.restore();
  } catch { /* branding is non-critical */ }
}

function drawLabel(ctx, text, x, y, { size = 26, color = 'rgba(255,255,255,0.88)', align = 'left', shadow = true } = {}) {
  if (!text) return;
  ctx.font = `${size}px "${LABEL_FONT}"`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; }
  ctx.fillText(stripEmoji(text), x, y);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

// Draw laid-out lines left-aligned at (x, firstBaseline). When `marker` is set
// the highlighted word gets a lime marker block behind dark text; otherwise it
// is simply tinted.
function drawLines(ctx, layout, x, firstBaseline, { lineHeight = 1.04, color = '#fff', marker = true, markerText = '#0B0B0B', tint = BRAND.accent, stroke = null }) {
  const { px, lines, highlight } = layout;
  ctx.font = `${px}px "${HEAD_FONT}"`;
  ctx.letterSpacing = `${(-0.03 * px).toFixed(1)}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const space = ctx.measureText(' ').width;
  let y = firstBaseline;
  for (const line of lines) {
    let cx = x;
    for (let k = 0; k < line.length; k++) {
      const { w, i } = line[k];
      const ww = ctx.measureText(w).width;
      const hl = highlight.has(i);
      if (hl && marker) {
        // adjacent highlighted words share one continuous marker block
        const prevHl = k > 0 && highlight.has(line[k - 1].i);
        const nextHl = k < line.length - 1 && highlight.has(line[k + 1].i);
        const left = prevHl ? cx - space : cx - px * 0.1;
        const right = nextHl ? cx + ww + space : cx + ww + px * 0.1;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.fillStyle = BRAND.accent;
        ctx.beginPath();
        ctx.roundRect(left, y - px * 0.86, right - left, px * 1.06, px * 0.12);
        ctx.fill();
        ctx.restore();
      }
      if (stroke) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = stroke;
        ctx.strokeStyle = '#000';
        ctx.strokeText(w, cx, y);
        ctx.restore();
      }
      ctx.fillStyle = hl ? (marker ? markerText : tint) : color;
      ctx.fillText(w, cx, y);
      cx += ww + space;
    }
    y += px * lineHeight;
  }
  ctx.letterSpacing = '0px';
}

// ── Treatment: editorial - sentence-case type top-left over a soft top scrim,
// accent-colored key word. No eyebrow tag, the headline carries the post. ────
function drawPill(ctx, text, x, y, { size = 24, fill = 'rgba(255,255,255,0.16)', border = 'rgba(255,255,255,0.35)', color = '#fff' } = {}) {
  ctx.font = `${size}px "${LABEL_FONT}"`;
  ctx.letterSpacing = '1px';
  const w = ctx.measureText(text).width + 40;
  const h = size + 24;
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = border; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 20, y + h / 2 + 1);
  ctx.letterSpacing = '0px';
  return w;
}

async function renderEditorial(ctx, size, bg, { headline, contactText }) {
  if (bg) ctx.drawImage(bg, 0, 0, size, size);
  const grad = ctx.createLinearGradient(0, 0, 0, size * 0.72);
  grad.addColorStop(0, 'rgba(6,8,12,0.78)');
  grad.addColorStop(0.6, 'rgba(6,8,12,0.34)');
  grad.addColorStop(1, 'rgba(6,8,12,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size * 0.72);

  const layout = fitHeadline(ctx, stripEmoji(headline), { scale: 1.0, maxWidth: size - 128, maxLines: 4 });
  drawLines(ctx, layout, 64, 84 + layout.px * 0.8, { lineHeight: 1.02, color: '#fff', marker: false });

  drawPill(ctx, stripEmoji(contactText || DEFAULT_CONTACT_TEXT), 64, size - 60 - 48, { size: 22 });
  await drawLogo(ctx, size - 64 - 64, size - 60 - 64, 64);
}

// ── Treatment: glass - frosted-glass panel across the bottom, type on the
// blurred photo. ─────────────────────────────────────────────────────────────
async function renderGlass(ctx, size, bg, { headline, contactText }) {
  if (bg) ctx.drawImage(bg, 0, 0, size, size);
  const margin = 48;
  const pad = 44;
  const layout = fitHeadline(ctx, stripEmoji(headline), { scale: 0.86, maxWidth: size - margin * 2 - pad * 2, maxLines: 4 });
  const textH = (layout.lines.length - 1) * layout.px * 1.04 + layout.px * 0.82;
  const panelH = textH + pad * 2 + 58;
  const x = margin, y = size - margin - panelH, w = size - margin * 2;

  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, panelH, 36); ctx.clip();
  if (bg) {
    try { ctx.filter = 'blur(28px)'; ctx.drawImage(bg, -60, -60, size + 120, size + 120); ctx.filter = 'none'; } catch { ctx.filter = 'none'; }
  }
  ctx.fillStyle = 'rgba(10,12,18,0.46)';
  ctx.fillRect(x, y, w, panelH);
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.beginPath(); ctx.roundRect(x, y, w, panelH, 36); ctx.stroke();

  drawLines(ctx, layout, x + pad, y + pad + layout.px * 0.8, { lineHeight: 1.04, color: '#fff', marker: false });
  drawLabel(ctx, contactText, x + pad, y + panelH - pad + 8, { size: 24, color: 'rgba(255,255,255,0.7)', shadow: false });
  await drawLogo(ctx, size - margin - 64, margin, 64);
}

// ── Treatment: card - clean white rounded card, dark type, accent marker on
// the key word. No tilt, no shadow tricks. ───────────────────────────────────
async function renderCard(ctx, size, bg, { headline, contactText }) {
  if (bg) ctx.drawImage(bg, 0, 0, size, size);
  const pad = 46;
  const layout = fitHeadline(ctx, stripEmoji(headline), { scale: 0.7, maxWidth: 700, maxLines: 5 });
  ctx.font = `${layout.px}px "${HEAD_FONT}"`;
  ctx.letterSpacing = `${(-0.03 * layout.px).toFixed(1)}px`;
  const widest = Math.max(...layout.lines.map(line => ctx.measureText(line.map(t => t.w).join(' ')).width));
  const w = widest + pad * 2 + 8;
  const h = (layout.lines.length - 1) * layout.px * 1.06 + layout.px * 0.9 + pad * 2;
  const x = 56, y = 64;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 34); ctx.fill();
  ctx.restore();
  drawLines(ctx, layout, x + pad, y + pad + layout.px * 0.8, { lineHeight: 1.06, color: '#0B0B0B' });

  drawPill(ctx, stripEmoji(contactText || DEFAULT_CONTACT_TEXT), 56, size - 56 - 48, { size: 22 });
  await drawLogo(ctx, size - 56 - 64, size - 56 - 64, 64);
}

const RENDERERS = { editorial: renderEditorial, glass: renderGlass, card: renderCard };

async function buildImage({ prompt, headline, engagementText, contactText = DEFAULT_CONTACT_TEXT, outputPath, notes = null, treatment = null }) {
  ensureDir();
  const size = BRAND.size;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // ── 1. Background (OpenAI gpt-image-2) ────────────────────────────────────
  const bgTemp = path.join(IMAGES_DIR, `_bg_${Date.now()}.png`);
  let bg;

  // Style: the old prompts asked for "photorealistic, bright even lighting,
  // sharp focus", which is exactly what produces glossy stock-photo output.
  // 2026 feed content that stops the scroll looks like a candid phone snapshot:
  // direct flash, grain, off-center, a little wrong. The safety clauses stay:
  // scenes full of real everyday objects and people can come back with a real
  // consumer logo or an identifiable person, a legal problem regardless of how
  // edgy the concept is.
  const peopleWords = /\b(people|person|player|players|human|humans|athlete|athletes|man|woman|men|women|coach|worker|analyst|employee|scout)\b/i;
  const wantsPeople = peopleWords.test(notes || '') || peopleWords.test(prompt || '');
  const styleSuffix = 'crisp ultra-sharp high-resolution contemporary photograph shot on a flagship 2026 smartphone, natural soft daylight or clean modern lighting, shallow depth of field, rich accurate colors, clean modern color grade, deadpan and slightly uncanny, no film grain, no flash, no vintage or retro look, no blur, no noise, not a stock photo, not an illustration';
  const safetySuffix = 'no real brand names or logos of any kind, no readable text or signage, no identifiable real person or public figure, generic fictional setting, no visible genitals or nudity';
  const safePrompt = wantsPeople
    ? `${prompt}, generic unbranded plain solid-color clothing (no polo shirts, no collar logos, no embroidered crests) and plain unmarked dark leather shoes or plain boots instead of sneakers, any held object (cups, bottles, phones) gripped firmly and physically supported by fingers wrapped around it, never floating (no swoosh, no stripes, no logos on any footwear), ${styleSuffix}, ${safetySuffix}`
    : `${prompt}, ${styleSuffix}, ${safetySuffix}`;

  try {
    await fetchOpenAIBackground(safePrompt, bgTemp);
    bg = await loadImage(bgTemp);
  } catch (err) {
    console.warn(`[image] Background generation failed, using gradient fallback: ${err.message}`);
    createGradientFallback(canvas, ctx);
    bg = null;
  } finally {
    try { if (fs.existsSync(bgTemp)) fs.unlinkSync(bgTemp); } catch {}
  }

  const chosen = treatment && RENDERERS[treatment] ? treatment : nextTreatment(TREATMENTS);
  const renderer = RENDERERS[chosen] || renderEditorial;

  // bg is null when the OpenAI call failed - the gradient is already painted
  // and each renderer's `if (bg)` guard leaves it in place.
  await renderer(ctx, size, bg, { headline: headline || '', engagementText, contactText });

  fs.writeFileSync(outputPath, await canvas.encode('png'));
  return outputPath;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  const prompt = get('--prompt');
  const headline = get('--headline');
  const contactText = get('--contact') || undefined; // fall through to buildImage's default when omitted
  const treatment = get('--treatment') || null;
  const output = get('--output') || path.join(IMAGES_DIR, `post_${Date.now()}.png`);
  if (!prompt || !headline) {
    console.error('Usage: node src/image.js --prompt "..." --headline "..." [--contact "..."] [--treatment editorial|glass|card] [--output path.png]');
    process.exit(1);
  }
  buildImage({ prompt, headline, contactText, treatment, outputPath: output })
    .then(p => console.log(JSON.stringify({ imagePath: p, width: 1080, height: 1080, prompt })))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { buildImage, fetchOpenAIBackground, stripEmoji, BRAND, LOGO_PATH, DEFAULT_CONTACT_TEXT, TREATMENTS };
