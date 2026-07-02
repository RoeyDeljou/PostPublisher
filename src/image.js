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

  // ── 2. Dark vignette overlay ───────────────────────────────────────────────
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.85);
  vignette.addColorStop(0, 'rgba(5,15,35,0.35)');
  vignette.addColorStop(1, 'rgba(5,15,35,0.72)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  // ── 3. Brand strip (bottom) ────────────────────────────────────────────────
  const stripY = size - BRAND.stripHeight;

  // Strip background with slight transparency
  ctx.fillStyle = BRAND.primary;
  ctx.fillRect(0, stripY, size, BRAND.stripHeight);

  // Accent line above strip
  const accentGrad = ctx.createLinearGradient(0, 0, size, 0);
  accentGrad.addColorStop(0, BRAND.accent);
  accentGrad.addColorStop(0.5, '#00ffbb');
  accentGrad.addColorStop(1, BRAND.accent);
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, stripY - 5, size, 5);

  // ── 4. Logo (top-left corner) ──────────────────────────────────────────────
  const logoSize = 72;
  const logoPad = 28;
  let logoLoaded = false;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      const logo = await loadImage(LOGO_PATH);
      // White circle background behind logo
      ctx.beginPath();
      ctx.arc(logoPad + logoSize / 2, logoPad + logoSize / 2, logoSize / 2 + 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fill();
      ctx.drawImage(logo, logoPad, logoPad, logoSize, logoSize);
      logoLoaded = true;
    } catch { /* skip */ }
  }

  // ── 5. Brand name in strip ────────────────────────────────────────────────
  const stripMid = stripY + BRAND.stripHeight / 2;
  const textStart = logoLoaded ? 28 : 28;

  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = BRAND.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  drawTextWithShadow(ctx, 'Elite Sports AI Forge', textStart, stripMid, 'rgba(0,0,0,0.6)', 8);

  // Website / tagline right side
  ctx.font = '18px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'right';
  drawTextWithShadow(ctx, 'elitesportsaiforge.com', size - 28, stripMid, 'rgba(0,0,0,0.4)', 4);

  // ── 6. Main headline (centered, large) ────────────────────────────────────
  const headSize = headline.length > 45 ? 56 : headline.length > 30 ? 64 : 72;
  ctx.font = `bold ${headSize}px sans-serif`;
  ctx.fillStyle = BRAND.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const headLines = measureAndWrap(ctx, headline.toUpperCase(), size - 120);
  const headLineH = headSize * 1.2;
  const headTotalH = headLines.length * headLineH;
  const headStartY = size / 2 - headTotalH / 2 - 60;

  headLines.forEach((line, i) => {
    drawTextWithShadow(ctx, line, size / 2, headStartY + i * headLineH, 'rgba(0,0,0,0.9)', 18);
  });

  // ── 7. Accent underline below headline ────────────────────────────────────
  const underlineY = headStartY + headTotalH + 10;
  const underlineW = 140;
  ctx.fillStyle = BRAND.accent;
  ctx.fillRect(size / 2 - underlineW / 2, underlineY, underlineW, 5);

  // ── 8. Engagement sub-text ────────────────────────────────────────────────
  if (engagementText) {
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = BRAND.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    drawTextWithShadow(ctx, engagementText, size / 2, underlineY + 56, 'rgba(0,0,0,0.8)', 10);
  }

  // ── 9. Bottom badge (top-right corner) ────────────────────────────────────
  const badgeText = 'AI & SPORT';
  ctx.font = 'bold 20px sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 32;
  const badgeH = 40;
  const badgeX = size - badgeW - 24;
  const badgeY = 24;
  ctx.fillStyle = BRAND.accent;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
  ctx.fill();
  ctx.fillStyle = '#050f23';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);

  // ── 10. Save ──────────────────────────────────────────────────────────────
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
