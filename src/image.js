#!/usr/bin/env node
'use strict';

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { nextTreatment } = require('./rotation');

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');
const LOGO_PATH = path.join(__dirname, '..', 'data', 'logo.png');

// The generic 'sans-serif' font family resolves to whatever's installed on the
// machine — Arial/Segoe UI locally on Windows, some Linux default on GitHub's
// ubuntu-latest runner — which don't render identically (numerals in particular
// came out visibly smaller than letters at the same font-size in the system
// font). Bundling our own font guarantees identical output everywhere.
const FONT_PATH = path.join(__dirname, '..', 'data', 'fonts', 'ArchivoBlack-Regular.ttf');
const FONT_FAMILY = 'Archivo Black';
if (fs.existsSync(FONT_PATH)) GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);

const BRAND = {
  accent: '#00C896',
  white: '#FFFFFF',
  size: 1080,
  font: FONT_FAMILY,
};

const TREATMENTS = ['bottomBar', 'ribbon', 'topBlock'];

// Every image gets a contact CTA by default — pass contactText: null explicitly
// to omit it (there's no current use case for omitting it, but the override
// stays available rather than hardcoding it unconditionally).
const DEFAULT_CONTACT_TEXT = 'DM or visit ml-innovate.com for inquiries';

function ensureDir() {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function fetchUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.destroy();
        fs.unlinkSync(dest);
        return fetchUrl(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.destroy();
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', err => {
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function fetchOpenAIBackground(prompt, outputPath) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY not set'));

    const payload = JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      quality: 'low',
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
  grad.addColorStop(0, '#050f23');
  grad.addColorStop(0.45, '#0a2448');
  grad.addColorStop(1, '#0A66C2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // subtle grid lines for tech feel
  ctx.strokeStyle = 'rgba(0,200,150,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

function measureAndWrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// node-canvas has no bundled emoji font — emoji glyphs render as broken tofu
// boxes, so strip them from anything drawn on the canvas (fine in the LinkedIn
// post body, which renders via the browser/app's own emoji font instead).
function stripEmoji(text) {
  return String(text || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

function drawTextWithShadow(ctx, text, x, y, shadowColor = 'rgba(0,0,0,0.85)', blur = 14) {
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

async function drawLogo(ctx, x, y, s) {
  if (!fs.existsSync(LOGO_PATH)) return;
  try {
    const logo = await loadImage(LOGO_PATH);
    ctx.drawImage(logo, x, y, s, s);
  } catch { /* branding is non-critical — skip on failure */ }
}

function drawContactFooter(ctx, size, contactText, opts = {}) {
  if (!contactText) return;
  const { color = 'rgba(255,255,255,0.9)', barColor = null } = opts;
  ctx.font = `bold 22px "${BRAND.font}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const text = stripEmoji(contactText);
  if (barColor) {
    const w = ctx.measureText(text).width;
    ctx.fillStyle = barColor;
    ctx.beginPath();
    ctx.roundRect(size / 2 - w / 2 - 20, size - 26 - 26, w + 40, 40, 8);
    ctx.fill();
  }
  ctx.fillStyle = color;
  drawTextWithShadow(ctx, text, size / 2, size - 26, 'rgba(0,0,0,0.7)', 6);
}

// ── Treatment: bold opaque bottom bar, photo stays fully bright above it ────
async function renderBottomBar(ctx, size, bg, { headline, engagementText, contactText }) {
  if (bg) ctx.drawImage(bg, 0, 0, size, size);

  const barH = 380;
  const barY = size - barH;
  ctx.fillStyle = '#0A0E14';
  ctx.fillRect(0, barY, size, barH);
  ctx.fillStyle = '#FF3B30';
  ctx.fillRect(0, barY, size, 8);

  const headSize = headline.length > 40 ? 54 : headline.length > 26 ? 62 : 72;
  ctx.font = `bold ${headSize}px "${BRAND.font}"`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lines = measureAndWrap(ctx, stripEmoji(headline).toUpperCase(), size - 100);
  const lineH = headSize * 1.12;
  let ty = barY + 100;
  lines.forEach(l => { drawTextWithShadow(ctx, l, size / 2, ty); ty += lineH; });

  if (engagementText) {
    ctx.font = `bold 34px "${BRAND.font}"`;
    ctx.fillStyle = '#FF3B30';
    drawTextWithShadow(ctx, stripEmoji(engagementText).toUpperCase() + ' >', size / 2, ty + 24);
  }

  await drawLogo(ctx, 28, 28, 72);
  drawContactFooter(ctx, size, contactText);
}

// ── Treatment: diagonal stamp/ribbon banner across a bright photo ───────────
async function renderRibbon(ctx, size, bg, { headline, engagementText, contactText }) {
  if (bg) ctx.drawImage(bg, 0, 0, size, size);

  ctx.save();
  ctx.translate(size / 2, size / 2 - 20);
  ctx.rotate(-8 * Math.PI / 180);

  const fontSize = headline.length > 22 ? 58 : 72;
  ctx.font = `bold ${fontSize}px "${BRAND.font}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = measureAndWrap(ctx, stripEmoji(headline).toUpperCase(), size - 260);
  const lineH = fontSize + 8;
  const totalH = lines.length * lineH;
  const ribbonH = totalH + 90;

  const ribbonGrad = ctx.createLinearGradient(-size, 0, size, 0);
  ribbonGrad.addColorStop(0, '#B8140A');
  ribbonGrad.addColorStop(0.5, '#FF3B30');
  ribbonGrad.addColorStop(1, '#B8140A');
  ctx.fillStyle = ribbonGrad;
  ctx.fillRect(-size * 0.75, -ribbonH / 2, size * 1.5, ribbonH);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-size * 0.75, ribbonH / 2 - 10, size * 1.5, 10);
  ctx.fillRect(-size * 0.75, -ribbonH / 2, size * 1.5, 10);

  ctx.fillStyle = '#FFFFFF';
  let ty = -totalH / 2 + lineH / 2;
  lines.forEach(l => { drawTextWithShadow(ctx, l, 0, ty, 'rgba(0,0,0,0.5)', 12); ty += lineH; });
  ctx.restore();

  if (engagementText) {
    ctx.font = `bold 34px "${BRAND.font}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const text = stripEmoji(engagementText).toUpperCase() + ' >';
    const w = ctx.measureText(text).width;
    const py = (size / 2 - 20) + ribbonH / 2 + 55;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(size / 2 - w / 2 - 24, py - 34, w + 48, 56, 28);
    ctx.fill();
    ctx.fillStyle = '#B8140A';
    ctx.fillText(text, size / 2, py + 12);
  }

  await drawLogo(ctx, 28, 28, 72);
  drawContactFooter(ctx, size, contactText, { barColor: null });
}

// ── Treatment: bold opaque top block (highlighter-tape style) ───────────────
async function renderTopBlock(ctx, size, bg, { headline, engagementText, contactText }) {
  if (bg) ctx.drawImage(bg, 0, 0, size, size);

  const barH = 360;
  ctx.fillStyle = '#FFD400';
  ctx.fillRect(0, 0, size, barH);
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, barH - 8, size, 8);

  const headSize = headline.length > 40 ? 50 : headline.length > 26 ? 58 : 66;
  ctx.font = `bold ${headSize}px "${BRAND.font}"`;
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lines = measureAndWrap(ctx, stripEmoji(headline).toUpperCase(), size - 100);
  const lineH = headSize * 1.09;
  const totalH = lines.length * lineH;
  let ty = barH / 2 - totalH / 2 + headSize * 0.8;
  lines.forEach(l => { ctx.fillText(l, size / 2, ty); ty += lineH; });

  if (engagementText) {
    ctx.font = `bold 30px "${BRAND.font}"`;
    const text = stripEmoji(engagementText).toUpperCase() + ' >';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.roundRect(size / 2 - w / 2 - 20, size - 74, w + 40, 48, 24);
    ctx.fill();
    ctx.fillStyle = '#FFD400';
    ctx.fillText(text, size / 2, size - 42);
  }

  await drawLogo(ctx, size - 28 - 72, 28, 72);
}

const RENDERERS = { bottomBar: renderBottomBar, ribbon: renderRibbon, topBlock: renderTopBlock };

async function buildImage({ prompt, headline, engagementText, contactText = DEFAULT_CONTACT_TEXT, outputPath, notes = null, treatment = null }) {
  ensureDir();
  const size = BRAND.size;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // ── 1. Background (OpenAI gpt-image-2) ────────────────────────────────────
  const bgTemp = path.join(IMAGES_DIR, `_bg_${Date.now()}.png`);
  let bg;

  // The provocative style deliberately puts REAL, mundane, everyday objects and
  // scenes in front of the camera (a vending machine, a messy desk, a person at
  // a urinal) rather than staged "cinematic sports action" - that widens the
  // trademark/likeness surface area a lot: any of those scenes can trigger a
  // real, readable consumer brand logo or an identifiable real person if not
  // explicitly told not to, not just "team logos" like the old sport-photo style
  // had to worry about. This safety suffix is unconditional, not just for
  // scenes with people in them.
  const peopleWords = /\b(people|person|player|players|human|humans|athlete|athletes|man|woman|men|women|coach|worker|analyst|employee)\b/i;
  const wantsPeople = peopleWords.test(notes || '') || peopleWords.test(prompt || '');
  const safetySuffix = 'no real brand names or logos of any kind, no readable text or signage, no identifiable real person or public figure, generic/fictional setting, photorealistic, vivid natural color, bright even lighting';
  const safePrompt = wantsPeople
    ? `${prompt}, generic unbranded plain solid-color t-shirts (not polo shirts, no collar logos or embroidered crests) and plain unbranded footwear (no swoosh or stripe marks), candid documentary photography style, ${safetySuffix}`
    : `${prompt}, ${safetySuffix}, highly detailed, sharp focus`;

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

  const chosenTreatment = treatment || nextTreatment(TREATMENTS);
  const renderer = RENDERERS[chosenTreatment] || renderBottomBar;

  // bg is null when the OpenAI call failed - createGradientFallback already
  // painted the gradient directly onto ctx above, and each renderer's
  // `if (bg) ctx.drawImage(...)` guard leaves that gradient in place instead
  // of trying to draw a nonexistent photo, so this call is safe either way.
  await renderer(ctx, size, bg, { headline: headline || '', engagementText, contactText });

  const buf = await canvas.encode('png');
  fs.writeFileSync(outputPath, buf);
  return outputPath;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  const prompt = get('--prompt');
  const headline = get('--headline');
  const engagementText = get('--engagement') || 'Read more';
  const contactText = get('--contact') || undefined; // fall through to buildImage's default when omitted
  const treatment = get('--treatment') || null;
  const output = get('--output') || path.join(IMAGES_DIR, `post_${Date.now()}.png`);
  if (!prompt || !headline) {
    console.error('Usage: node src/image.js --prompt "..." --headline "..." [--engagement "..."] [--contact "..."] [--treatment bottomBar|ribbon|topBlock] [--output path.png]');
    process.exit(1);
  }
  buildImage({ prompt, headline, engagementText, contactText, treatment, outputPath: output })
    .then(p => console.log(JSON.stringify({ imagePath: p, width: 1080, height: 1080, prompt })))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { buildImage, fetchOpenAIBackground, stripEmoji, BRAND, LOGO_PATH, DEFAULT_CONTACT_TEXT, TREATMENTS };
