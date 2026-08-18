#!/usr/bin/env node
'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');
const LOGO_PATH = path.join(__dirname, '..', 'data', 'logo.png');

const BRAND = {
  accent: '#00C896',
  white: '#FFFFFF',
  size: 1080,
};

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

async function buildImage({ prompt, headline, engagementText, contactText = null, outputPath, notes = null }) {
  ensureDir();
  const size = BRAND.size;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // ── 1. Background (OpenAI gpt-image-2) ────────────────────────────────────
  const bgTemp = path.join(IMAGES_DIR, `_bg_${Date.now()}.png`);
  let bgLoaded = false;

  // Steer toward photorealistic action shots when the prompt calls for people,
  // abstract data-viz otherwise. Always avoid real team/sponsor branding —
  // gpt-image-2 is good enough at photorealism that it will render real logos
  // if not told not to, which is a trademark risk for a business page.
  const peopleWords = /\b(people|person|player|players|human|humans|athlete|athletes|man|woman|men|women|coach|sprinter|striker|goalkeeper)\b/i;
  const wantsPeople = peopleWords.test(notes || '') || peopleWords.test(prompt || '');
  const safePrompt = wantsPeople
    ? `${prompt}, photorealistic, natural body proportions, professional sports photography, dynamic action, generic unbranded athletic wear, no real team logos, no sponsor branding, no readable text`
    : `${prompt}, no people, no human figures, no faces, no bodies, photorealistic, highly detailed, sharp focus, no text, no logos`;

  try {
    await fetchOpenAIBackground(safePrompt, bgTemp);
    const bg = await loadImage(bgTemp);
    ctx.drawImage(bg, 0, 0, size, size);
    bgLoaded = true;
  } catch (err) {
    console.warn(`[image] Background generation failed, using gradient fallback: ${err.message}`);
    createGradientFallback(canvas, ctx);
  } finally {
    try { if (fs.existsSync(bgTemp)) fs.unlinkSync(bgTemp); } catch {}
  }

  // ── 2. Stronger dark vignette overlay (enhanced contrast) ─────────────────────
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.85);
  vignette.addColorStop(0, 'rgba(5,15,35,0.45)');
  vignette.addColorStop(1, 'rgba(5,15,35,0.85)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  // ── 3. Brand mark — the company logo appears on every image when the logo
  // file exists (position rotates for visual variety); falls back to the
  // company name as text only if the logo file is genuinely missing. No
  // topic labels or added bars/strips/frames — this sits directly on the photo.
  const hasLogo = fs.existsSync(LOGO_PATH);

  async function drawLogoAt(x, y, logoSize) {
    // The logo file is a flat, opaque square with its own background baked
    // in — draw it as-is, no extra backdrop shape behind it.
    const logo = await loadImage(LOGO_PATH);
    ctx.drawImage(logo, x, y, logoSize, logoSize);
  }

  function drawNameAt(x, y, align) {
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = BRAND.white;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    drawTextWithShadow(ctx, 'ML-Innovation', x, y, 'rgba(0,0,0,0.6)', 8);
  }

  // An explicit position request in the notes (e.g. "put the logo in the top
  // left") picks the side; otherwise it rotates randomly for visual variety.
  const notesLower = (notes || '').toLowerCase();
  const wantsTopRight = /top[\s-]?right/.test(notesLower);
  const wantsTopLeft = /top[\s-]?left/.test(notesLower);

  let treatment;
  if (wantsTopLeft) treatment = hasLogo ? 'logo-top-left' : 'name-top-left';
  else if (wantsTopRight) treatment = hasLogo ? 'logo-top-right' : 'name-top-right';
  else if (hasLogo) treatment = Math.random() < 0.5 ? 'logo-top-left' : 'logo-top-right';
  else treatment = Math.random() < 0.5 ? 'name-top-left' : 'name-top-right';

  try {
    if (treatment === 'logo-top-left') await drawLogoAt(28, 28, 72);
    else if (treatment === 'logo-top-right') await drawLogoAt(size - 28 - 72, 28, 72);
    else if (treatment === 'name-top-left') drawNameAt(28, 50, 'left');
    else if (treatment === 'name-top-right') drawNameAt(size - 28, 50, 'right');
  } catch { /* branding is non-critical — skip on failure */ }

  // ── 6. Main headline (centered, large, with high-contrast backdrop) ──────────
  const headSize = headline.length > 45 ? 60 : headline.length > 32 ? 68 : headline.length > 20 ? 78 : 88;
  ctx.font = `bold ${headSize}px sans-serif`;
  ctx.fillStyle = BRAND.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const headLines = measureAndWrap(ctx, stripEmoji(headline).toUpperCase(), size - 120);
  const headLineH = headSize * 1.2;
  const headTotalH = headLines.length * headLineH;
  const headStartY = size / 2 - headTotalH / 2 - 60;

  // Add semi-transparent pill/panel behind headline for extra contrast and pop.
  // textBaseline is 'alphabetic', so headStartY is the FIRST line's baseline —
  // glyphs extend upward (ascent) from there, not downward. Since the headline
  // is always uppercase there are no true descenders, so the panel only needs
  // to wrap ascent-above to baseline-of-last-line-below, symmetrically padded.
  const headPadX = 40;
  const headPadY = 26;
  const ascent = headSize * 0.74;
  const descentAllowance = headSize * 0.06;
  const textTop = headStartY - ascent;
  const textBottom = headStartY + (headLines.length - 1) * headLineH + descentAllowance;
  const headlineBackY = textTop - headPadY;
  const headlineBackH = (textBottom - textTop) + headPadY * 2;
  ctx.fillStyle = 'rgba(5,15,35,0.68)';
  ctx.beginPath();
  ctx.roundRect(headPadX, headlineBackY, size - headPadX * 2, headlineBackH, 16);
  ctx.fill();

  // Draw headline text on top of the backdrop (reset fillStyle — it was overwritten by the pill above)
  ctx.fillStyle = BRAND.white;
  headLines.forEach((line, i) => {
    drawTextWithShadow(ctx, line, size / 2, headStartY + i * headLineH, 'rgba(0,0,0,0.9)', 18);
  });

  // ── 7. Bolder accent underline below headline ─────────────────────────────
  const underlineY = headStartY + headTotalH + 10;
  const underlineW = 200;
  // Create a gradient for the underline for extra visual impact
  const underlineGrad = ctx.createLinearGradient(size / 2 - underlineW / 2, 0, size / 2 + underlineW / 2, 0);
  underlineGrad.addColorStop(0, 'rgba(0,200,150,0.3)');
  underlineGrad.addColorStop(0.5, BRAND.accent);
  underlineGrad.addColorStop(1, 'rgba(0,200,150,0.3)');
  ctx.fillStyle = underlineGrad;
  ctx.fillRect(size / 2 - underlineW / 2, underlineY, underlineW, 8);

  // ── 8. Engagement sub-text ────────────────────────────────────────────────
  if (engagementText) {
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = BRAND.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    drawTextWithShadow(ctx, stripEmoji(engagementText), size / 2, underlineY + 56, 'rgba(0,0,0,0.8)', 10);
  }

  // ── 8b. Contact footer (optional) — small pill near the bottom edge ───────
  if (contactText) {
    const footSize = 26;
    ctx.font = `bold ${footSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const footText = stripEmoji(contactText);
    const footWidth = ctx.measureText(footText).width;
    const footPadX = 26, footPadY = 16;
    const footY = size - 46;
    const footAscent = footSize * 0.74, footDescent = footSize * 0.22;
    ctx.fillStyle = 'rgba(5,15,35,0.72)';
    ctx.beginPath();
    ctx.roundRect(
      size / 2 - footWidth / 2 - footPadX,
      footY - footAscent - footPadY,
      footWidth + footPadX * 2,
      footAscent + footDescent + footPadY * 2,
      12
    );
    ctx.fill();
    ctx.fillStyle = BRAND.white;
    drawTextWithShadow(ctx, footText, size / 2, footY, 'rgba(0,0,0,0.85)', 10);
  }

  // ── 9. Save ──────────────────────────────────────────────────────────────
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
  const engagementText = get('--engagement') || 'Data-driven. Game-changing.';
  const contactText = get('--contact');
  const output = get('--output') || path.join(IMAGES_DIR, `post_${Date.now()}.png`);
  if (!prompt || !headline) {
    console.error('Usage: node src/image.js --prompt "..." --headline "..." [--engagement "..."] [--contact "..."] [--output path.png]');
    process.exit(1);
  }
  buildImage({ prompt, headline, engagementText, contactText, outputPath: output })
    .then(p => console.log(JSON.stringify({ imagePath: p, width: 1080, height: 1080, prompt })))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { buildImage, fetchOpenAIBackground, stripEmoji, BRAND, LOGO_PATH };
