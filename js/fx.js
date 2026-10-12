// Visual effects: colours taken from the cover, the record and beat glow of the full-screen player,
// and the "now playing" state the rest of the app reacts to (ambient background, mini equalizers).
import { player } from './player.js';
import { $, hue, coverUrl } from './core.js';
import { catalogEntry } from './catalog.js';

const root = document.documentElement;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || root.classList.contains('calm');

// ---------- Colours from the cover ----------
const colorCache = new Map();
const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
const fromHue = (h) => [hsl(h, 72, 52), hsl(h + 48, 70, 46), hsl(h - 40, 62, 34)];

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

// Two vivid colours and one deep one: hues are bucketed, weighted by how colourful a pixel is.
function paletteOf(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 32, 32);
  const px = g.getImageData(0, 0, 32, 32).data; // throws for foreign images without CORS
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  let grey = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    const w = (s / 100) * (1 - Math.abs(l - 50) / 50);
    if (w < 0.08) { grey++; continue; }
    const b = buckets[Math.floor(h / 30) % 12];
    // hues are averaged as vectors on the circle, so red (350° + 10°) stays red
    b.w += w; b.h += Math.cos((h * Math.PI) / 180) * w; b.s += s * w; b.l += l * w;
    b.y = (b.y || 0) + Math.sin((h * Math.PI) / 180) * w;
  }
  const top = buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  if (!top.length) return null;
  const col = (b, lMin, lMax) => {
    const h = (Math.atan2(b.y, b.h) * 180) / Math.PI + 360;
    return [h % 360, Math.max(48, Math.min(90, b.s / b.w)), Math.max(lMin, Math.min(lMax, b.l / b.w))];
  };
  const a = col(top[0], 38, 60);
  const b = top[1] && top[1].w > top[0].w * 0.18 ? col(top[1], 34, 58) : [a[0] + 42, a[1], a[2] - 6];
  const d = [a[0] - 30, Math.min(a[1], 70), 22];
  // a mostly grey cover gets calmer colours
  if (grey > 900) { a[1] = Math.min(a[1], 45); b[1] = Math.min(b[1], 45); }
  return [hsl(...a), hsl(...b), hsl(...d)];
}

function loadPalette(url) {
  if (colorCache.has(url)) return colorCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    const own = /^(blob|data):/.test(url) || new URL(url, location.href).origin === location.origin;
    if (!own) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => { try { resolve(paletteOf(img)); } catch { resolve(null); } };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  colorCache.set(url, p);
  return p;
}

let colorToken = 0;
let artKey = '';
function setColors(list) {
  [1, 2, 3].forEach((n, i) => root.style.setProperty(`--np-c${n}`, list[i]));
}

// Called whenever the player UI updates; does nothing unless the picture changed.
export async function showArt({ url = null, seed = '' } = {}) {
  const key = `${url}|${seed}`;
  if (key === artKey) return;
  artKey = key;
  const token = ++colorToken;
  const stage = $('#np-stage');
  if (stage) stage.style.setProperty('--np-art', url ? `url("${url.replace(/"/g, '%22')}")` : 'none');
  root.classList.toggle('np-has-art', !!url);
  const pal = url ? await loadPalette(url) : null;
  if (token === colorToken) setColors(pal || fromHue(hue(seed)));
}

// ---------- Track change: the cover slides in, the record spins up ----------
let lastKey = '';
let lastIndex = -1;
export function trackChanged(key) {
  if (key === lastKey) return;
  const first = !lastKey;
  lastKey = key;
  const idx = player.index;
  const dir = idx < lastIndex && player.mode === 'library' ? 'prev' : 'next';
  lastIndex = idx;
  const stage = $('#np-stage');
  if (first || !stage || reduced()) return;
  stage.classList.remove('swap-next', 'swap-prev');
  void stage.offsetWidth;
  stage.classList.add(`swap-${dir}`);
  clearTimeout(stage._swap);
  stage._swap = setTimeout(() => stage.classList.remove('swap-next', 'swap-prev'), 700);
}

// ---------- Playing state + beat ----------
const bpmOf = (t) => t?.bpm || catalogEntry(t?.catalogId)?.bpm || 0;
let beatRunning = false;
let level = 0;

export function playingChanged() {
  const playing = player.playing;
  document.body.classList.toggle('is-playing', playing);
  const t = player.mode === 'library' ? player.track : null;
  const bpm = bpmOf(t);
  // Without an analyser (effects off, e.g. iPhone) the glow pulses with the song's tempo when it is known.
  root.style.setProperty('--beat', bpm ? `${(60 / bpm).toFixed(3)}s` : '2.4s');
  startBeat();
}

function startBeat() {
  const np = $('#now-playing');
  if (beatRunning || !np || np.hidden || !player.playing || reduced()) return;
  const an = player.mode === 'library' ? player.analyser : null;
  np.classList.toggle('live-beat', !!an);
  if (!an) return;
  beatRunning = true;
  const data = new Uint8Array(an.frequencyBinCount);
  const stage = $('#np-stage'), bg = $('#np-bg');
  const step = () => {
    if (np.hidden || !player.playing || player.analyser !== an) {
      beatRunning = false;
      np.classList.remove('live-beat');
      stage.style.setProperty('--lvl', '0');
      bg.style.setProperty('--lvl', '0');
      return;
    }
    an.getByteFrequencyData(data);
    // bass (first bins) drives the pulse: quick attack, slow release
    let sum = 0;
    for (let i = 1; i < 9; i++) sum += data[i];
    const v = Math.max(0, (sum / 8 / 255 - 0.35) / 0.65);
    level = v > level ? level + (v - level) * 0.6 : level * 0.9;
    const s = level.toFixed(3);
    stage.style.setProperty('--lvl', s);
    bg.style.setProperty('--lvl', s);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function nowPlayingOpened() { startBeat(); }

// Colours for the canvas visualizer (read once per track, not per frame).
export function vizColors() {
  const cs = getComputedStyle(root);
  return [cs.getPropertyValue('--np-c1').trim() || '#8b5cf6', cs.getPropertyValue('--np-c2').trim() || '#ec4899'];
}

// Cover URL for a library track (helper for app.js).
export const artOf = (t) => (t ? coverUrl(t) : null);
