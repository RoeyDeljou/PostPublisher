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
  primary: '#0A66C2',
  accent: '#00C896',
  white: '#FFFFFF',
  darkOverlay: 'rgba(5, 15, 35, 0.62)',
  stripHeight: 90,
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

async function fetchPollinationsBackground(prompt, outputPath, retries = 2) {
  const seed = Math.floor(Math.random() * 999999);
  const encoded = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1080&model=flux&nologo=true&enhance=true&seed=${seed}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fetchUrl(url, outputPath);
      return outputPath;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 16000));
    }
  }
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

async function buildImage({ prompt, headline, engagementText, outputPath, notes = null }) {
  ensureDir();
  const size = BRAND.size;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // ── 1. Background ──────────────────────────────────────────────────────────
  const bgTemp = path.join(IMAGES_DIR, `_bg_${Date.now()}.jpg`);
  let bgLoaded = false;

  // Strengthen the prompt to avoid humans
  const safePrompt = `${prompt}, no people, no human figures, no faces, no bodies, abstract, highly detailed`;

  try {
    await fetchPollinationsBackground(safePrompt, bgTemp);
    const bg = await loadImage(bgTemp);
    ctx.drawImage(bg, 0, 0, size, size);
    bgLoaded = true;
  } catch {
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

  // ── 2b. Add a subtle left-edge accent stripe for visual energy ───────────────
  const accentStripeGrad = ctx.createLinearGradient(0, 0, 0, size);
  accentStripeGrad.addColorStop(0, BRAND.accent);
  accentStripeGrad.addColorStop(0.5, '#00ffbb');
  accentStripeGrad.addColorStop(1, BRAND.accent);
  ctx.fillStyle = accentStripeGrad;
  ctx.fillRect(0, 0, 6, size);

  // ── 3. Brand strip (bottom) ────────────────────────────────────────────────
  const stripY = size - BRAND.stripHeight;

  // Strip background with slight transparency
  ctx.fillStyle = BRAND.primary;
  ctx.fillRect(0, stripY, size, BRAND.stripHeight);

  // Accent line above strip (bolder)
  const accentGrad = ctx.createLinearGradient(0, 0, size, 0);
  accentGrad.addColorStop(0, BRAND.accent);
  accentGrad.addColorStop(0.5, '#00ffbb');
  accentGrad.addColorStop(1, BRAND.accent);
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, stripY - 7, size, 7);

  // ── 4. Brand mark — logo or company name only, position/style rotates each
  // time so the same treatment doesn't appear on every post. No topic labels
  // or full brand-name text are ever drawn on the image itself.
  const stripMid = stripY + BRAND.stripHeight / 2;
  const hasLogo = fs.existsSync(LOGO_PATH);

  async function drawLogoAt(x, y, logoSize) {
    const logo = await loadImage(LOGO_PATH);
    ctx.beginPath();
    ctx.arc(x + logoSize / 2, y + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.drawImage(logo, x, y, logoSize, logoSize);
  }

  function drawNameAt(x, y, align) {
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = BRAND.white;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    drawTextWithShadow(ctx, 'ML-Innovation', x, y, 'rgba(0,0,0,0.6)', 8);
  }

  const treatments = hasLogo
    ? ['logo-top-left', 'logo-top-right', 'logo-strip-left', 'name-strip-left', 'name-top-left']
    : ['name-strip-left', 'name-top-left', 'name-top-right'];
  const treatment = treatments[Math.floor(Math.random() * treatments.length)];

  try {
    if (treatment === 'logo-top-left') await drawLogoAt(28, 28, 72);
    else if (treatment === 'logo-top-right') await drawLogoAt(size - 28 - 72, 28, 72);
    else if (treatment === 'logo-strip-left') await drawLogoAt(24, stripY + (BRAND.stripHeight - 56) / 2, 56);
    else if (treatment === 'name-strip-left') drawNameAt(28, stripMid, 'left');
    else if (treatment === 'name-top-left') drawNameAt(28, 50, 'left');
    else if (treatment === 'name-top-right') drawNameAt(size - 28, 50, 'right');
  } catch { /* branding is non-critical — skip on failure */ }

  // ── 6. Main headline (centered, large, with high-contrast backdrop) ──────────
  const headSize = headline.length > 45 ? 60 : headline.length > 30 ? 70 : 78;
  ctx.font = `bold ${headSize}px sans-serif`;
  ctx.fillStyle = BRAND.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const headLines = measureAndWrap(ctx, headline.toUpperCase(), size - 120);
  const headLineH = headSize * 1.2;
  const headTotalH = headLines.length * headLineH;
  const headStartY = size / 2 - headTotalH / 2 - 60;

  // Add semi-transparent pill/panel behind headline for extra contrast and pop
  const headPadX = 40;
  const headPadY = 30;
  const headlineBackY = headStartY - headPadY + headSize * 0.15;
  const headlineBackH = headTotalH + headPadY * 1.6;
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
    drawTextWithShadow(ctx, engagementText, size / 2, underlineY + 56, 'rgba(0,0,0,0.8)', 10);
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
  const output = get('--output') || path.join(IMAGES_DIR, `post_${Date.now()}.png`);
  if (!prompt || !headline) {
    console.error('Usage: node src/image.js --prompt "..." --headline "..." [--engagement "..."] [--output path.png]');
    process.exit(1);
  }
  buildImage({ prompt, headline, engagementText, outputPath: output })
    .then(p => console.log(JSON.stringify({ imagePath: p, width: 1080, height: 1080, prompt })))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { buildImage };
