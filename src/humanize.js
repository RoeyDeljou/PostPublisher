#!/usr/bin/env node
'use strict';

/**
 * Humanizer + "how machine-written does this look" scorer.
 *
 * JavaScript port of li-human (humanize.py + detect.py) from
 * github.com/avi691/linkedin-agent-skill, MIT licensed, copyright (c) 2026
 * Jake Schincariol and Avi Grondin - see licenses/linkedin-agent-skill-MIT.txt.
 * The lexicon lives in data/slop.json (edited: 'empower' now maps to 'help').
 *
 * humanize(text) -> { text, report }  removes invisible characters, normalises
 *   typography, swaps stock "AI" vocabulary for plain words. Structural tells
 *   (rule-of-three, "not just X, it's Y") are reported, never auto-rewritten.
 * detect(text)   -> { checks, overall, verdict, weakest }  five heuristic
 *   checks, 0-100, higher = more human. Local heuristics only, not a detector.
 */

const fs = require('fs');
const path = require('path');

const LEX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'slop.json'), 'utf8'));

const URL_RE = /https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g;
const SENT_RE = /[^.!?\n]+[.!?]*/g;
const WORD_RE = /[A-Za-z']+/g;
const CONTRACTIONS = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;
const PRONOUNS = /\b(i|me|my|mine|we|us|our|you|your)\b/gi;
const NUMBERS = /\b\d[\d,.]*%?\b|\$\d/g;
const PROPER = /(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/gm;

// JS-flavoured versions of the structural-tell regexes in slop.json (those are
// Python syntax with inline (?i) flags).
const STRUCTURES = [
  { id: 'not-just', name: "\"It's not just X, it's Y\"", re: /\bit'?s not (?:just|only) [^.!?\n]{2,60}[,.] it'?s\b/gi, fix: 'Say the one thing you actually mean. Delete the setup half.' },
  { id: 'not-only', name: '"Not only X but also Y"', re: /\bnot only\b[^.!?\n]{2,80}\bbut also\b/gi, fix: 'Split into two sentences, or drop the weaker half.' },
  { id: 'isnt-about', name: '"It isn\'t about X. It\'s about Y."', re: /\b(?:this|it) is(?:n'?t| not) about [^.!?\n]{2,60}[.!] it'?s about\b/gi, fix: 'Lead with Y. The reversal is the tell.' },
  { id: 'the-result', name: 'One-word rhetorical question line', re: /^\s*(?:the result|the best part|the kicker|the catch)\?\s*$/gim, fix: 'Answer it inline instead of staging a reveal.' },
  { id: 'heres-what', name: '"Here\'s what I learned"', re: /\bhere'?s what (?:i|we) learned\b/gi, fix: 'State the lesson. Skip the announcement.' },
  { id: 'triad', name: 'Rule-of-three triad', re: /\b\w+, \w+, and \w+\./gi, fix: "Two items or four. Three is the model's default rhythm." },
  { id: 'rocket', name: 'Rocket / fire / bulb / sparkle / dart emoji', re: /[\u{1F680}\u{1F525}\u{1F4A1}✨\u{1F3AF}]/gu, fix: 'One emoji max, and not one of these five.' },
  { id: 'hashtag-wall', name: 'Hashtag wall (5+)', re: /(?:#\w+[ \t]*){5,}/g, fix: 'Four hashtags is the house style.' },
  { id: 'as-an-ai', name: 'Model self-reference', re: /\bas an ai\b|\bas a language model\b/gi, fix: 'Delete the sentence.' },
  { id: 'in-summary', name: 'Essay-closer opener', re: /^\s*(?:in summary|to summarize|in conclusion)\b/gim, fix: 'A post does not need a conclusion paragraph.' },
  { id: 'engagement-bait', name: 'Reflex engagement bait', re: /\b(?:agree\?|thoughts\?|who else\b|am i wrong\?)\s*$/gim, fix: 'Ask a question only you could ask, about the specific thing above it.' },
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lexiconPattern(find) {
  const body = escapeRegExp(find).replace(/ /g, '\\s+');
  const lead = /^\w/.test(find) ? '\\b' : '';
  const trail = /\w$/.test(find) ? '\\b' : '';
  return new RegExp(lead + body + trail, 'gi');
}

function protectUrls(text) {
  const found = [];
  const out = text.replace(URL_RE, m => { found.push(m); return `\x00URL${found.length - 1}\x00`; });
  return { text: out, found };
}

function restoreUrls(text, found) {
  let out = text;
  found.forEach((url, i) => { out = out.split(`\x00URL${i}\x00`).join(url); });
  return out;
}

function cpToChars(spec) {
  if (spec.includes('-')) {
    const [a, b] = spec.split('-');
    return { range: [parseInt(a.slice(2), 16), parseInt(b.slice(2), 16)] };
  }
  return { single: parseInt(spec.slice(2), 16) };
}

function passInvisible(text) {
  const hits = [];
  let out = text;
  for (const entry of LEX.invisible) {
    const cp = cpToChars(entry.cp);
    const pattern = cp.range
      ? new RegExp(`[\\u{${cp.range[0].toString(16)}}-\\u{${cp.range[1].toString(16)}}]`, 'gu')
      : new RegExp(`\\u{${cp.single.toString(16)}}`, 'gu');
    const n = (out.match(pattern) || []).length;
    if (n) {
      hits.push({ name: `${entry.cp} ${entry.name}`, count: n, action: entry.action });
      out = out.replace(pattern, entry.action === 'delete' ? '' : ' ');
    }
  }
  const stray = out.match(/\p{Cf}/gu) || [];
  if (stray.length) {
    hits.push({ name: 'other invisible format chars', count: stray.length, action: 'delete' });
    out = out.replace(/\p{Cf}/gu, '');
  }
  return { text: out, hits };
}

function passTypographic(text) {
  const hits = [];
  let out = text;
  for (const entry of LEX.typographic) {
    const ch = entry.from;
    const n = out.split(ch).length - 1;
    if (!n) continue;
    hits.push({ name: `${ch} ${entry.name}`, count: n, to: entry.to.trim() || '(space)' });
    if (ch === '—') {
      out = out.replace(/\s*—\s*/g, ', ');
    } else if (ch === '–') {
      out = out.replace(/\s*–\s*(?=\d)/g, '-').replace(/\s+–\s+/g, ', ').split('–').join('-');
    } else {
      out = out.split(ch).join(entry.to);
    }
  }
  out = out.replace(/,\s*([,.;:!?])/g, '$1').replace(/,[ \t]*\n/g, '\n');
  return { text: out, hits };
}

function matchCase(src, repl) {
  if (!repl) return repl;
  if (src.length > 1 && src === src.toUpperCase() && src !== src.toLowerCase()) return repl.toUpperCase();
  if (src[0] !== src[0].toLowerCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

function passLexical(text) {
  const hits = [];
  let out = text;
  const entries = [...LEX.phrases, ...LEX.words].sort((a, b) => b.find.length - a.find.length);
  for (const entry of entries) {
    const base = lexiconPattern(entry.find);
    const deleting = !entry.replace;
    // A deleted opener ("let's face it:") must take its trailing punctuation
    // with it, and leave a marker so the next word can be re-capitalised.
    const pattern = deleting ? new RegExp(base.source + '[,:;]?[ \t]*', 'gi') : base;
    const found = out.match(pattern);
    if (!found) continue;
    hits.push({ find: entry.find, replace: entry.replace || '(deleted)', count: found.length, family: entry.family });
    out = out.replace(pattern, m => (deleting ? '\x01' : matchCase(m, entry.replace)));
  }
  // A swapped-in word can change which article is right ("a crucial play" ->
  // "a important play"). Fix a/an in front of every replacement we made.
  const vowelSound = w => /^[aeiou]/i.test(w) && !/^(use|usef|uni|eu|one)/i.test(w);
  for (const entry of entries) {
    if (!entry.replace || !hits.some(h => h.find === entry.find)) continue;
    const first = entry.replace.split(/\s+/)[0];
    const pat = new RegExp('\\b(an?)(\\s+)(' + escapeRegExp(entry.replace) + ')(?![A-Za-z])', 'gi');
    out = out.replace(pat, (m, art, sp, word) => {
      const want = vowelSound(first) ? 'an' : 'a';
      const fixed = art[0] === art[0].toUpperCase() ? want[0].toUpperCase() + want.slice(1) : want;
      return fixed + sp + word;
    });
  }
  // Clean up after deletions. Unlike the Python original, newlines are never
  // swallowed and a sentence that lost its opener is re-capitalised.
  out = out
    .replace(/(^|[.!?]["')\]]*[ \t]+|\n[ \t]*)\x01+[ \t]*([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase())
    .replace(/\x01+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/^([ \t]*)[,.;:][ \t]*(\S)/gm, (m, sp, ch) => sp + ch.toUpperCase())
    .replace(/^[ \t]*[,.;:][ \t]*$/gm, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/,\s*(also|so|still|basically|in the end)\s*,\s*/gi,
      (m, w) => '. ' + w[0].toUpperCase() + w.slice(1).toLowerCase() + ', ');
  return { text: out, hits };
}

function sentenceLengths(text) {
  return (text.match(SENT_RE) || [])
    .map(s => s.trim())
    .filter(s => s.split(/\s+/).length > 2)
    .map(s => s.split(/\s+/).length);
}

function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function pstdev(a) {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

function scanStructures(text) {
  const flags = [];
  for (const s of STRUCTURES) {
    const found = text.match(s.re);
    if (found) flags.push({ name: s.name, count: found.length, fix: s.fix });
  }
  const lens = sentenceLengths(text);
  if (lens.length >= 4) {
    const m = mean(lens);
    const cv = m ? pstdev(lens) / m : 0;
    if (cv < 0.35) {
      flags.push({
        name: `Uniform sentence length (variation ${cv.toFixed(2)})`,
        count: lens.length,
        fix: 'Break one sentence in half. Let another run long. Machines write even.',
      });
    }
  }
  return flags;
}

function humanize(text) {
  const { text: protectedText, found } = protectUrls(String(text || ''));
  const inv = passInvisible(protectedText);
  const typo = passTypographic(inv.text);
  const lexi = passLexical(typo.text);
  const out = restoreUrls(lexi.text, found).trim();
  return {
    text: out,
    report: {
      invisible: inv.hits,
      typographic: typo.hits,
      lexical: lexi.hits,
      structures: scanStructures(out),
    },
  };
}

// ── Detector ────────────────────────────────────────────────────────────────

const clamp = n => Math.max(0, Math.min(100, n));
function scale(value, human, machine) {
  if (human === machine) return 50;
  return clamp((value - machine) / (human - machine) * 100);
}

function checkBurstiness(text) {
  const lens = sentenceLengths(text);
  if (lens.length < 4) return [50, 'too short to judge'];
  const cv = pstdev(lens) / mean(lens);
  return [scale(cv, 0.70, 0.22), `variation ${cv.toFixed(2)} across ${lens.length} sentences (want 0.55+)`];
}

function checkSpecificity(text) {
  const w = text.match(WORD_RE) || [];
  if (w.length < 25) return [50, 'too short to judge'];
  const hits = (text.match(NUMBERS) || []).length + new Set(text.match(PROPER) || []).size;
  const density = hits * 100 / w.length;
  return [scale(density, 6.0, 0.5), `${hits} concrete markers, ${density.toFixed(1)} per 100 words (want 4+)`];
}

function checkSlop(text) {
  const w = text.match(WORD_RE) || [];
  if (!w.length) return [50, 'empty'];
  let hits = 0;
  const found = [];
  for (const entry of [...LEX.words, ...LEX.phrases]) {
    const n = (text.match(lexiconPattern(entry.find)) || []).length;
    if (n) { hits += n; found.push(entry.find); }
  }
  const density = hits * 100 / w.length;
  let detail = `${hits} stock terms, ${density.toFixed(1)} per 100 words`;
  if (found.length) detail += ` (${found.sort().slice(0, 4).join(', ')}${found.length > 4 ? ', ...' : ''})`;
  return [scale(density, 0.0, 4.0), detail];
}

function checkFingerprint(text) {
  const invisible = (text.match(/\p{Cf}/gu) || []).length;
  const em = (text.match(/—/g) || []).length;
  const curly = (text.match(/[‘’“”]/g) || []).length;
  const ellip = (text.match(/…/g) || []).length;
  const nbsp = (text.match(/[   ]/g) || []).length;
  const total = invisible * 4 + em * 2 + curly + ellip + nbsp;
  const per1k = total * 1000 / Math.max(text.length, 1);
  return [scale(per1k, 0.0, 12.0), `${invisible} invisible, ${em} em dash, ${curly} curly quote, ${ellip} ellipsis, ${nbsp} hard space`];
}

function checkVoice(text) {
  const w = text.match(WORD_RE) || [];
  if (w.length < 25) return [50, 'too short to judge'];
  const per100 = 100 / w.length;
  const contractions = (text.match(CONTRACTIONS) || []).length * per100;
  const person = (text.match(PRONOUNS) || []).length * per100;
  let tells = 0;
  const names = [];
  for (const s of STRUCTURES) {
    const n = (text.match(s.re) || []).length;
    if (n) { tells += n; names.push(s.id); }
  }
  const bullets = [...text.matchAll(/^\s*[-*•]\s+(.+)$/gm)].map(m => m[1].split(/\s+/).length);
  const uniform = bullets.length >= 3 && pstdev(bullets) < 1.6;
  let score = scale(contractions, 3.0, 0.0) * 0.35 + scale(person, 8.0, 1.0) * 0.35 + clamp(100 - tells * 22) * 0.30;
  if (uniform) { score -= 12; names.push('uniform-bullets'); }
  let detail = `${contractions.toFixed(1)} contractions, ${person.toFixed(1)} personal pronouns per 100 words, ${tells} structural tell(s)`;
  if (names.length) detail += ` [${names.slice(0, 4).join(', ')}]`;
  return [clamp(score), detail];
}

const CHECKS = ['BURSTINESS', 'SPECIFICITY', 'SLOP DENSITY', 'FINGERPRINT', 'VOICE'];

function detect(text) {
  const t = String(text || '');
  const results = {
    'BURSTINESS': checkBurstiness(t),
    'SPECIFICITY': checkSpecificity(t),
    'SLOP DENSITY': checkSlop(t),
    'FINGERPRINT': checkFingerprint(t),
    'VOICE': checkVoice(t),
  };
  const scores = CHECKS.map(c => results[c][0]);
  // The weakest check drags the verdict: a detector only needs one signal.
  const overall = mean(scores) * 0.6 + Math.min(...scores) * 0.4;
  const minScore = Math.min(...scores);
  const verdict = overall >= 70 && minScore >= 55 ? 'PASS' : (overall >= 50 ? 'REVIEW' : 'FLAGGED');
  const weakest = CHECKS.reduce((a, b) => (results[a][0] <= results[b][0] ? a : b));
  const checks = {};
  for (const c of CHECKS) checks[c] = { score: Math.round(results[c][0] * 10) / 10, detail: results[c][1] };
  return { checks, overall: Math.round(overall * 10) / 10, verdict, weakest };
}

module.exports = { humanize, detect };

if (require.main === module) {
  const file = process.argv[2];
  const raw = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const { text, report } = humanize(raw);
  const d = detect(text);
  console.log(JSON.stringify({ text, report, detect: d }, null, 2));
}
