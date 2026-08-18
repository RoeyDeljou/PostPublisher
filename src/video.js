#!/usr/bin/env node
'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { fetchOpenAIBackground, stripEmoji, BRAND, LOGO_PATH, DEFAULT_CONTACT_TEXT } = require('./image');

const VIDEO_DIR = path.join(__dirname, '..', 'data', 'videos');
const FPS = 24;
const DURATION_SEC = 6;
const TOTAL_FRAMES = FPS * DURATION_SEC;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

function drawTextWithShadow(ctx, text, x, y, alpha, shadowColor = 'rgba(0,0,0,0.85)', blur = 14) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function hasFfmpeg() {
  return new Promise(resolve => {
    execFile('ffmpeg', ['-version'], err => resolve(!err));
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${err.message}${stderr ? ' — ' + stderr.slice(-500) : ''}`));
      resolve();
    });
  });
}

async function renderFrame({ ctx, size, bg, frameIndex, totalFrames, headline, engagementText, contactText, hasLogo }) {
  // ── Ken Burns slow zoom + subtle horizontal drift ──────────────────────────
  const t = frameIndex / (totalFrames - 1);
  const scale = 1.0 + 0.12 * t;
  const panX = -10 * t;
  const drawW = size * scale;
  const drawH = size * scale;
  ctx.drawImage(bg, (size - drawW) / 2 + panX, (size - drawH) / 2, drawW, drawH);

  // ── Vignette (static, matches the still-image style) ──────────────────────
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.85);
  vignette.addColorStop(0, 'rgba(5,15,35,0.45)');
  vignette.addColorStop(1, 'rgba(5,15,35,0.85)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  // ── Brand logo, static top-left ────────────────────────────────────────────
  if (hasLogo) {
    try {
      const logo = await loadImage(LOGO_PATH);
      ctx.drawImage(logo, 28, 28, 72, 72);
    } catch { /* branding is non-critical */ }
  }

  // ── Headline: fades in + slides up over the first ~0.8s, then holds ───────
  const fadeInFrames = Math.round(totalFrames * (0.8 / DURATION_SEC));
  const headlineProgress = Math.min(1, frameIndex / fadeInFrames);
  const headlineEase = easeOutCubic(headlineProgress);
  const headlineOffsetY = (1 - headlineEase) * 24;

  const headSize = headline.length > 45 ? 60 : headline.length > 32 ? 68 : headline.length > 20 ? 78 : 88;
  ctx.font = `bold ${headSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const headLines = measureAndWrap(ctx, stripEmoji(headline).toUpperCase(), size - 120);
  const headLineH = headSize * 1.2;
  const headTotalH = headLines.length * headLineH;
  const headStartY = size / 2 - headTotalH / 2 - 60 + headlineOffsetY;

  const headPadX = 40, headPadY = 26;
  const ascent = headSize * 0.74, descentAllowance = headSize * 0.06;
  const textTop = headStartY - ascent;
  const textBottom = headStartY + (headLines.length - 1) * headLineH + descentAllowance;
  ctx.save();
  ctx.globalAlpha = headlineEase * 0.68;
  ctx.fillStyle = 'rgba(5,15,35,1)';
  ctx.beginPath();
  ctx.roundRect(headPadX, textTop - headPadY, size - headPadX * 2, (textBottom - textTop) + headPadY * 2, 16);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = BRAND.white;
  headLines.forEach((line, i) => {
    drawTextWithShadow(ctx, line, size / 2, headStartY + i * headLineH, headlineEase, 'rgba(0,0,0,0.9)', 18);
  });

  const underlineY = headStartY + headTotalH + 10;
  const underlineW = 200;
  ctx.save();
  ctx.globalAlpha = headlineEase;
  const underlineGrad = ctx.createLinearGradient(size / 2 - underlineW / 2, 0, size / 2 + underlineW / 2, 0);
  underlineGrad.addColorStop(0, 'rgba(0,200,150,0.3)');
  underlineGrad.addColorStop(0.5, BRAND.accent);
  underlineGrad.addColorStop(1, 'rgba(0,200,150,0.3)');
  ctx.fillStyle = underlineGrad;
  ctx.fillRect(size / 2 - underlineW / 2, underlineY, underlineW, 8);
  ctx.restore();

  // ── Engagement sub-text: fades in staggered ~0.3s after the headline ──────
  if (engagementText) {
    const engDelayFrames = Math.round(totalFrames * (0.3 / DURATION_SEC));
    const engProgress = Math.min(1, Math.max(0, frameIndex - engDelayFrames) / fadeInFrames);
    const engAlpha = easeOutCubic(engProgress);
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = BRAND.accent;
    drawTextWithShadow(ctx, stripEmoji(engagementText), size / 2, underlineY + 56, engAlpha, 'rgba(0,0,0,0.8)', 10);
  }

  // ── Contact footer: static throughout, same treatment as the still image ──
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
    ctx.save();
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
    drawTextWithShadow(ctx, footText, size / 2, footY, 1, 'rgba(0,0,0,0.85)', 10);
    ctx.restore();
  }
}

async function buildVideo({ prompt, headline, engagementText, contactText = DEFAULT_CONTACT_TEXT, outputPath, notes = null }) {
  if (!(await hasFfmpeg())) throw new Error('ffmpeg not available on this machine');

  ensureDir(VIDEO_DIR);
  const size = BRAND.size;
  const framesDir = path.join(VIDEO_DIR, `_frames_${Date.now()}`);
  ensureDir(framesDir);
  const bgTemp = path.join(VIDEO_DIR, `_bg_${Date.now()}.png`);

  const peopleWords = /\b(people|person|player|players|human|humans|athlete|athletes|man|woman|men|women|coach|sprinter|striker|goalkeeper)\b/i;
  const wantsPeople = peopleWords.test(notes || '') || peopleWords.test(prompt || '');
  const safePrompt = wantsPeople
    ? `${prompt}, photorealistic, natural body proportions, professional sports photography, dynamic action, generic unbranded athletic wear, no real team logos, no sponsor branding, no readable text`
    : `${prompt}, no people, no human figures, no faces, no bodies, photorealistic, highly detailed, sharp focus, no text, no logos`;

  try {
    await fetchOpenAIBackground(safePrompt, bgTemp);
    const bg = await loadImage(bgTemp);
    const hasLogo = fs.existsSync(LOGO_PATH);

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      await renderFrame({ ctx, size, bg, frameIndex: i, totalFrames: TOTAL_FRAMES, headline, engagementText, contactText, hasLogo });
      const buf = await canvas.encode('png');
      fs.writeFileSync(path.join(framesDir, `frame_${String(i).padStart(4, '0')}.png`), buf);
    }

    await runFfmpeg([
      '-y',
      '-framerate', String(FPS),
      '-i', path.join(framesDir, 'frame_%04d.png'),
      '-vf', 'format=yuv420p',
      '-c:v', 'libx264',
      '-movflags', '+faststart',
      outputPath,
    ]);

    return outputPath;
  } finally {
    try { if (fs.existsSync(bgTemp)) fs.unlinkSync(bgTemp); } catch {}
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  const prompt = get('--prompt');
  const headline = get('--headline');
  const engagementText = get('--engagement') || 'Data-driven. Game-changing.';
  const contactText = get('--contact') || undefined; // fall through to buildVideo's default when omitted
  const output = get('--output') || path.join(VIDEO_DIR, `post_${Date.now()}.mp4`);
  if (!prompt || !headline) {
    console.error('Usage: node src/video.js --prompt "..." --headline "..." [--engagement "..."] [--contact "..."] [--output path.mp4]');
    process.exit(1);
  }
  buildVideo({ prompt, headline, engagementText, contactText, outputPath: output })
    .then(p => console.log(JSON.stringify({ videoPath: p })))
    .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
}

module.exports = { buildVideo, hasFfmpeg, renderFrame };
