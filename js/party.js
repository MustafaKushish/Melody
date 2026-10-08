// Party mode (full-screen light show + smooth DJ transitions) and chill mode.
import { player, MELODY_SOUNDS } from './player.js';
import { icon, hydrateIcons, setIcon } from './icons.js';
import { $, esc, toast, state, getTrack, coverHTML, hue } from './core.js';
import { localMix } from './foryou.js';
import { loadCatalog, ensureTracks, playable } from './catalog.js';

const P = { open: false, saved: null, raf: 0, lights: true, wake: null };
const reduceMotion = () => document.documentElement.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;

async function startSomething(mood) {
  if (player.playing) return;
  let ids = localMix('', mood).ids.filter((id) => playable(getTrack(id)));
  if (!ids.length) ids = (await ensureTracks(await loadCatalog())).map((t) => t.id).filter((id) => playable(getTrack(id)));
  if (ids.length) player.playShuffled(ids);
}

function render() {
  const t = player.mode === 'library' ? player.track : null;
  const el = $('#party');
  if (!el || !P.open) return;
  $('#pt-cover').innerHTML = t ? coverHTML(t, 'pt-art') : `<div class="cover pt-art" style="--h:${hue('party')}">${icon('note')}</div>`;
  $('#pt-title').textContent = t?.title || player.station?.name || 'Party-Modus';
  $('#pt-artist').textContent = t?.artist || '';
  setIcon($('#pt-play'), player.playing ? 'pause' : 'play');
  const next = getTrack(player.queue[player.index + 1]);
  $('#pt-next').innerHTML = next ? `Als Nächstes: <b>${esc(next.title)}</b> · ${esc(next.artist)}` : '';
}

function loop() {
  const canvas = $('#pt-canvas');
  if (!P.open || !canvas) return;
  const g = canvas.getContext('2d');
  const W = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const H = (canvas.height = canvas.clientHeight * devicePixelRatio);
  const data = player.analyser ? new Uint8Array(player.analyser.frequencyBinCount) : null;
  let hueBase = hue(player.track?.album || 'party');
  let lastBass = 0;
  const frame = (ts) => {
    if (!P.open) return;
    g.clearRect(0, 0, W, H);
    let bass = 0, energy = 0;
    if (data && player.playing) {
      player.analyser.getByteFrequencyData(data);
      for (let i = 0; i < 6; i++) bass += data[i];
      bass /= 6 * 255;
      for (const v of data) energy += v;
      energy /= data.length * 255;
    } else {
      bass = 0.3 + 0.1 * Math.sin(ts / 600);
      energy = 0.2;
    }
    hueBase = (hueBase + 0.25 + energy) % 360;
    const el = $('#party');
    if (P.lights && !reduceMotion()) {
      // A light pulse on each bass hit – soft, at most a few per second (no strobe).
      const hit = bass > 0.62 && bass - lastBass > 0.06;
      el.style.setProperty('--glow', (0.25 + bass * 0.75).toFixed(2));
      if (hit) el.style.setProperty('--h', Math.round(hueBase));
    } else {
      el.style.setProperty('--glow', '0.35');
    }
    lastBass = bass;
    // Radial bars around the centre.
    if (data) {
      const rc = $('#pt-cover .cover')?.getBoundingClientRect();
      const dpr = devicePixelRatio;
      const n = 96;
      const cx = rc ? (rc.left + rc.width / 2) * dpr : W / 2;
      const cy = rc ? (rc.top + rc.height / 2) * dpr : H / 2;
      const r0 = rc ? (rc.width / 2 + 10) * dpr : Math.min(W, H) * 0.24;
      for (let i = 0; i < n; i++) {
        const v = data[Math.floor((i / n) * data.length * 0.7)] / 255;
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const len = r0 * 0.15 + v * r0 * 0.9;
        g.strokeStyle = `hsla(${(hueBase + i * 2) % 360} 90% 60% / ${0.35 + v * 0.6})`;
        g.lineWidth = Math.max(2, W / 300);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        g.stroke();
      }
    }
    const cover = $('#pt-cover .cover');
    if (cover) cover.style.transform = `scale(${1 + bass * 0.06})`;
    P.raf = requestAnimationFrame(frame);
  };
  P.raf = requestAnimationFrame(frame);
}

export async function openParty() {
  if (P.open) return;
  P.open = true;
  const s = player.settings;
  P.saved = { preset: s.preset, eq: [...s.eq], dj: { ...s.dj } };
  player.applySound('Melody Party');
  player.setDj({ crossfade: 6 });
  const el = $('#party');
  el.hidden = false;
  el.innerHTML = `<canvas id="pt-canvas"></canvas>
    <header class="pt-head"><span class="pt-badge">${icon('sparkle')} Party-Modus</span>
      <button class="icon-btn" data-action="party-close" aria-label="Beenden">${icon('close')}</button></header>
    <div class="pt-center"><div id="pt-cover"></div>
      <div class="pt-title" id="pt-title"></div><div class="pt-artist" id="pt-artist"></div></div>
    <div class="pt-bottom">
      <div class="pt-next" id="pt-next"></div>
      <div class="pt-controls">
        <button class="icon-btn lg" data-action="prev">${icon('prev')}</button>
        <button class="icon-btn play xl" id="pt-play" data-action="toggle">${icon('play')}</button>
        <button class="icon-btn lg" data-action="next">${icon('next')}</button>
      </div>
      <div class="pt-pads">
        <button class="chip${P.lights ? ' on' : ''}" data-action="party-lights">Lichtshow</button>
        <button class="chip" data-action="pad" data-pad="padSweep">Filter-Sweep</button>
        <button class="chip" data-action="pad" data-pad="padEchoOut">Echo-Out</button>
        <button class="chip" data-action="pad" data-pad="padBassKill">Bass-Kill</button>
      </div>
      <p class="pt-hint">Übergänge zwischen Songs: 6 s · Klang: Melody Party</p>
    </div>`;
  hydrateIcons(el);
  try { P.wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  await startSomething('Party');
  render();
  loop();
}

export function closeParty() {
  if (!P.open) return;
  P.open = false;
  cancelAnimationFrame(P.raf);
  P.wake?.release?.().catch(() => {});
  const s = P.saved;
  if (s) {
    if (MELODY_SOUNDS[s.preset]) player.applySound(s.preset);
    else player.setEq(s.eq, s.preset);
    player.setDj(s.dj);
  }
  $('#party').hidden = true;
  $('#party').innerHTML = '';
  toast('Party vorbei – dein Sound ist wiederhergestellt');
}

player.addEventListener('track', render);
player.addEventListener('state', render);

export const partyActions = {
  party: () => openParty(),
  'party-close': () => closeParty(),
  'party-lights': (el) => { P.lights = !P.lights; el.classList.toggle('on', P.lights); },
  chill: async () => {
    player.applySound('Melody Chill');
    player.setSleep(30);
    await startSomething('Entspannen');
    toast('Entspannen: weicher Klang, Musik endet in 30 Minuten');
  },
};

export const isPartyOpen = () => P.open;
export { state };
