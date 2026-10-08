// Fitness mode: music matched to the workout's tempo, interval & rest timers, voice coach, running cadence.
import { player } from './player.js';
import { db } from './db.js';
import { icon, hydrateIcons, setIcon } from './icons.js';
import { $, esc, toast, state, getTrack, coverHTML, hue, plural } from './core.js';
import { loadCatalog, ensureTracks, catalogEntry, playable } from './catalog.js';
import { bpmOfBlob } from './bpm.js';

export const WORKOUTS = {
  kraft: { name: 'Krafttraining', emoji: '🏋️', bpm: [95, 135], sound: 'Melody Bass', timer: 'rest', desc: 'Satzpausen-Timer, druckvoller Bass', c: ['#ef4444', '#7c2d12'] },
  hiit: { name: 'HIIT', emoji: '🔥', bpm: [124, 180], sound: 'Melody Party', timer: 'interval', work: 30, rest: 30, rounds: 10, desc: '30 s Vollgas, 30 s Pause · 10 Runden', c: ['#f97316', '#be123c'] },
  tabata: { name: 'Tabata', emoji: '⚡', bpm: [126, 180], sound: 'Melody Party', timer: 'interval', work: 20, rest: 10, rounds: 8, desc: '20 s / 10 s · 8 Runden · 4 Minuten', c: ['#eab308', '#c2410c'] },
  laufen: { name: 'Laufen', emoji: '🏃', bpm: [135, 185], sound: 'Melody Signature', timer: 'run', desc: 'Musik passend zu deinem Schritt-Tempo', c: ['#22c55e', '#0e7490'] },
  cardio: { name: 'Cardio & Spinning', emoji: '🚴', bpm: [115, 140], sound: 'Melody Party', timer: 'watch', desc: 'Gleichmäßiger Beat für Ausdauer', c: ['#06b6d4', '#4338ca'] },
  yoga: { name: 'Yoga & Dehnen', emoji: '🧘', bpm: [0, 100], sound: 'Melody Chill', timer: 'watch', desc: 'Ruhige Musik, weicher Klang', c: ['#a78bfa', '#334155'] },
};

const HIST_KEY = 'melody.workouts';
const F = {
  open: false, w: null, key: '', started: 0, phase: 'idle', phaseEnd: 0, round: 0, sets: 0, restSecs: 90,
  tick: null, songs: new Set(), matchTempo: false, targetBpm: 0, cadence: 0, steps: [], motion: false,
  wake: null, duckRest: true, saved: null,
};

// ---------- Sounds & voice ----------
let beepCtx;
function beep(freq = 880, ms = 140) {
  try {
    beepCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = beepCtx.createOscillator(), g = beepCtx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.25, beepCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, beepCtx.currentTime + ms / 1000);
    o.connect(g).connect(beepCtx.destination);
    o.start();
    o.stop(beepCtx.currentTime + ms / 1000);
  } catch { /* no audio */ }
}
function say(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = 1.05;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ---------- Tempo-matched song selection ----------
const bpmOf = (t) => t.bpm || catalogEntry(t.catalogId)?.bpm || 0;
// A 70 BPM song also works for 140 BPM (every second step on the beat).
function fits(bpm, [lo, hi]) {
  if (!bpm) return false;
  return [bpm, bpm * 2, bpm / 2].some((b) => b >= lo && b <= hi);
}

async function measureMissing(tracks, onProgress) {
  const todo = tracks.filter((t) => !bpmOf(t) && !t.bpmChecked).slice(0, 40);
  for (const [i, t] of todo.entries()) {
    onProgress?.(i + 1, todo.length);
    try {
      const blob = await db.get('files', t.id);
      if (!blob) continue;
      t.bpm = await bpmOfBlob(blob);
    } catch { /* undecodable */ }
    t.bpmChecked = true;
    await db.put('tracks', t);
  }
}

async function pickSongs(w) {
  let pool = state.tracks.filter(playable);
  if (pool.length < 6) pool = [...pool, ...(await ensureTracks(await loadCatalog())).filter((t) => !pool.includes(t) && playable(t))];
  await measureMissing(pool, (i, n) => setStatus(`Tempo wird gemessen … ${i}/${n}`));
  setStatus('');
  let list = pool.filter((t) => fits(bpmOf(t), w.bpm));
  if (list.length < 4) {
    // Not enough exact matches: take the closest tempi.
    const mid = (w.bpm[0] + w.bpm[1]) / 2;
    list = [...pool].sort((a, b) => Math.abs((bpmOf(a) || 999) - mid) - Math.abs((bpmOf(b) || 999) - mid)).slice(0, 12);
  }
  // Warm up → peak: ascending *effective* tempo (a 82 BPM song counts as 164 when that fits), favourites earlier.
  const eff = (t) => { const b = bpmOf(t); return [b, b * 2, b / 2].find((x) => x >= w.bpm[0] && x <= w.bpm[1]) || b; };
  return list.sort((a, b) => (eff(a) - eff(b)) || (b.favorite - a.favorite)).map((t) => t.id);
}

// Nudge the playback speed (±8 %, pitch kept) so the beat matches the target.
function applyTempo() {
  const t = player.track;
  if (!F.open || !t) return;
  if (!F.matchTempo || !F.targetBpm || !bpmOf(t)) {
    player.setRate(1);
    return;
  }
  let b = bpmOf(t);
  if (Math.abs(b * 2 - F.targetBpm) < Math.abs(b - F.targetBpm)) b *= 2;
  if (Math.abs(b / 2 - F.targetBpm) < Math.abs(b - F.targetBpm)) b /= 2;
  const rate = Math.max(0.92, Math.min(1.08, F.targetBpm / b));
  player.setDj({ keepPitch: true });
  player.setRate(Math.round(rate * 100) / 100);
}

// ---------- Running cadence from the phone's motion sensor ----------
let lastPeak = 0, smooth = 0;
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
  smooth = smooth * 0.8 + mag * 0.2;
  const now = performance.now();
  if (mag - smooth > 2.2 && now - lastPeak > 260) {
    lastPeak = now;
    F.steps.push(now);
  }
  F.steps = F.steps.filter((t) => now - t < 10000);
  if (F.steps.length > 6) F.cadence = Math.round((F.steps.length / Math.min(10, (now - F.steps[0]) / 1000)) * 60);
}

async function startMotion() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
      if ((await DeviceMotionEvent.requestPermission()) !== 'granted') throw new Error('denied');
    }
    window.addEventListener('devicemotion', onMotion);
    F.motion = true;
    toast('Schritt-Tempo wird gemessen – Handy einfach mitnehmen');
  } catch {
    toast('Bewegungssensor nicht verfügbar – stell dein Tempo per Regler ein.');
  }
  render();
}

// ---------- Timer ----------
const now = () => Date.now();
function setPhase(phase, secs) {
  F.phase = phase;
  F.phaseEnd = secs ? now() + secs * 1000 : 0;
  F.phaseLen = secs || 0;
  if (F.duckRest) player.duck(phase === 'rest' || phase === 'setrest');
  render();
}

function tick() {
  if (!F.open) return;
  const w = F.w;
  const left = F.phaseEnd ? Math.ceil((F.phaseEnd - now()) / 1000) : 0;
  if (F.phaseEnd && left <= 3 && left > 0 && left !== F.lastBeep) {
    F.lastBeep = left;
    beep(660);
  }
  if (F.phaseEnd && now() >= F.phaseEnd) {
    F.lastBeep = 0;
    if (F.phase === 'prepare' || F.phase === 'rest') {
      F.round++;
      beep(1200, 300);
      say(F.round === w.rounds ? 'Letzte Runde! Gib alles!' : `Runde ${F.round}. Los!`);
      setPhase('work', w.work);
    } else if (F.phase === 'work') {
      if (F.round >= w.rounds) {
        beep(1200, 500);
        say('Geschafft! Super Training!');
        setPhase('done', 0);
      } else {
        beep(440, 300);
        say(F.round === w.rounds - 1 ? 'Pause. Gleich kommt die letzte Runde.' : 'Pause');
        setPhase('rest', w.rest);
      }
    } else if (F.phase === 'setrest') {
      beep(1200, 300);
      say(`Satz ${F.sets + 1}. Los geht's!`);
      setPhase('active', 0);
    }
  }
  if (w.timer === 'run' && F.motion && F.cadence && F.matchTempo) {
    if (Math.abs(F.cadence - F.targetBpm) > 3) {
      F.targetBpm = F.cadence;
      applyTempo();
    }
  }
  renderTime();
}

// ---------- UI ----------
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function setStatus(t) {
  const el = $('#ft-status');
  if (el) { el.textContent = t; el.hidden = !t; }
}

function history() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}

function pickerHTML() {
  const h = history();
  const week = h.filter((x) => x.at > now() - 7 * 86400000);
  const mins = Math.round(week.reduce((s, x) => s + x.secs, 0) / 60);
  return `<header class="ft-head"><span class="ft-badge">${icon('fitness')} Fitness</span>
      <button class="icon-btn" data-action="fit-close" aria-label="Schließen">${icon('close')}</button></header>
    <div class="ft-pick">
      <h1>Was trainierst du heute?</h1>
      <p class="ft-sub">${week.length ? `Diese Woche: ${plural(week.length, 'Training', 'Trainings')} · ${mins} Minuten 💪` : 'Melody sucht Songs im passenden Tempo und zählt für dich mit.'}</p>
      <div class="ft-grid">${Object.entries(WORKOUTS).map(([k, w]) => `
        <button class="ft-card" style="--c1:${w.c[0]};--c2:${w.c[1]}" data-action="fit-start" data-w="${k}">
          <span class="ft-emoji">${w.emoji}</span><b>${w.name}</b><span>${w.desc}</span>
          <small>${w.bpm[0] ? `${w.bpm[0]}–${w.bpm[1]} BPM` : 'bis 100 BPM'}</small></button>`).join('')}</div>
      ${h.length ? `<h2>Letzte Trainings</h2><div class="ft-hist">${h.slice(0, 5).map((x) => `<div><b>${esc(x.name)}</b><span>${new Date(x.at).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })} · ${Math.round(x.secs / 60)} Min. · ${plural(x.songs, 'Song', 'Songs')}${x.rounds ? ` · ${x.rounds} Runden` : ''}${x.sets ? ` · ${x.sets} Sätze` : ''}</span></div>`).join('')}</div>` : ''}
    </div>`;
}

function sessionHTML() {
  const w = F.w;
  const rest = [60, 90, 120, 180];
  return `<header class="ft-head"><span class="ft-badge">${w.emoji} ${w.name}</span>
      <span class="ft-elapsed" id="ft-elapsed">0:00</span>
      <button class="icon-btn" data-action="fit-stop" aria-label="Training beenden">${icon('close')}</button></header>
    <div class="ft-status" id="ft-status" hidden></div>
    <div class="ft-main">
      <div class="ft-ring" id="ft-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" class="ft-ring-bg"/><circle cx="60" cy="60" r="54" class="ft-ring-fg" id="ft-ring-fg" pathLength="100"/></svg>
        <div class="ft-ring-text"><div class="ft-phase" id="ft-phase"></div><div class="ft-time" id="ft-time"></div><div class="ft-count" id="ft-count"></div></div>
      </div>
      ${w.timer === 'rest' ? `<div class="ft-rest">
          <button class="ft-big" data-action="fit-set">${icon('check')} Satz fertig</button>
          <div class="seg ft-seg">${rest.map((s) => `<label><input type="radio" name="ft-rest" value="${s}" ${s === F.restSecs ? 'checked' : ''}><span>${s} s Pause</span></label>`).join('')}</div>
        </div>` : ''}
      ${w.timer === 'interval' && F.phase === 'idle' ? `<button class="ft-big" data-action="fit-go">${icon('play')} Intervall starten</button>` : ''}
      ${w.timer === 'run' ? `<div class="ft-run">
          <div class="ft-cadence"><b id="ft-cad">${F.cadence || '–'}</b><span>Schritte/min</span></div>
          <button class="chip${F.motion ? ' on' : ''}" data-action="fit-motion">${icon('fitness')} Schritte messen</button>
          <label class="ft-slider">Ziel-Tempo <b id="ft-target-v">${F.targetBpm} BPM</b><input type="range" id="ft-target" min="120" max="190" step="1" value="${F.targetBpm}"></label>
        </div>` : ''}
    </div>
    <div class="ft-player">
      <div class="ft-now"><div id="ft-cover"></div><div class="ft-meta"><div class="ft-title" id="ft-title"></div><div class="ft-artist" id="ft-artist"></div></div><span class="ft-bpm" id="ft-bpm"></span></div>
      <div class="ft-controls">
        <button class="dv-btn" data-action="prev" aria-label="Zurück">${icon('prev')}</button>
        <button class="dv-btn play" id="ft-play" data-action="toggle" aria-label="Abspielen">${icon('play')}</button>
        <button class="dv-btn" data-action="next" aria-label="Weiter">${icon('next')}</button>
        <button class="dv-btn power" data-action="fit-power" aria-label="Power-Song">${icon('bolt')}<span>Power</span></button>
      </div>
      <div class="ft-opts">
        <label class="ft-toggle"><input type="checkbox" id="ft-match" ${F.matchTempo ? 'checked' : ''}><span>Musik ans Tempo anpassen</span></label>
        <label class="ft-toggle"><input type="checkbox" id="ft-duck" ${F.duckRest ? 'checked' : ''}><span>In Pausen leiser</span></label>
        <button class="chip" data-action="fit-screen">${icon('grid')} Großbildschirm</button>
      </div>
    </div>`;
}

function render() {
  const el = $('#fitness');
  if (!F.open || !el) return;
  if (!F.w) {
    el.innerHTML = pickerHTML();
  } else {
    if (!el.querySelector('.ft-main') || el.dataset.view !== F.key + F.phase.replace(/work|rest|prepare|active|setrest/, 'x')) {
      el.innerHTML = sessionHTML();
      el.dataset.view = F.key + F.phase.replace(/work|rest|prepare|active|setrest/, 'x');
    }
    el.className = `fitness phase-${F.phase}`;
    renderPlayer();
    renderTime();
  }
  hydrateIcons(el);
}

function renderTime() {
  if (!F.w) return;
  const w = F.w;
  const el = $('#ft-elapsed');
  if (el) el.textContent = fmtClock((now() - F.started) / 1000);
  const left = F.phaseEnd ? Math.max(0, (F.phaseEnd - now()) / 1000) : 0;
  const labels = { idle: 'Bereit', prepare: 'Gleich geht\'s los', work: 'LOS!', rest: 'PAUSE', active: w.timer === 'rest' ? `Satz ${F.sets + 1}` : 'Training', setrest: 'SATZPAUSE', done: 'Geschafft! 🎉' };
  const ph = $('#ft-phase'), tm = $('#ft-time'), ct = $('#ft-count'), fg = $('#ft-ring-fg');
  if (!ph) return;
  ph.textContent = labels[F.phase] || '';
  tm.textContent = F.phaseEnd ? fmtClock(Math.ceil(left)) : fmtClock((now() - F.started) / 1000);
  ct.textContent = w.timer === 'interval' ? `Runde ${Math.max(1, F.round)} / ${w.rounds}` : w.timer === 'rest' ? `${F.sets} ${F.sets === 1 ? 'Satz' : 'Sätze'}` : F.matchTempo && F.targetBpm ? `${F.targetBpm} BPM` : '';
  fg.style.strokeDashoffset = F.phaseEnd && F.phaseLen ? String(100 - (left / F.phaseLen) * 100) : '0';
  const cad = $('#ft-cad');
  if (cad) cad.textContent = F.cadence || '–';
}

function renderPlayer() {
  const t = player.mode === 'library' ? player.track : null;
  if (!$('#ft-title')) return;
  $('#ft-cover').innerHTML = t ? coverHTML(t, 'ft') : `<div class="cover ft" style="--h:${hue('fit')}">${icon('note')}</div>`;
  $('#ft-title').textContent = t?.title || 'Musik wird ausgesucht …';
  $('#ft-artist').textContent = t?.artist || '';
  const b = t && bpmOf(t);
  $('#ft-bpm').textContent = b ? `${b} BPM${player.settings.rate !== 1 ? ` · ${Math.round(player.settings.rate * 100)} %` : ''}` : '';
  setIcon($('#ft-play'), player.playing ? 'pause' : 'play');
  if (t) F.songs.add(t.id);
}

// ---------- Session ----------
export async function openFitness() {
  F.open = true;
  F.w = null;
  const el = $('#fitness');
  el.hidden = false;
  el.className = 'fitness';
  render();
}

async function start(key) {
  const w = WORKOUTS[key];
  Object.assign(F, { w, key, started: now(), phase: 'idle', phaseEnd: 0, round: 0, sets: 0, songs: new Set(), cadence: 0, steps: [] });
  F.saved = { preset: player.settings.preset, eq: [...player.settings.eq], dj: { ...player.settings.dj }, rate: player.settings.rate };
  F.targetBpm = key === 'laufen' ? 160 : 0;
  F.matchTempo = key === 'laufen';
  render();
  player.applySound(w.sound);
  player.setDj({ crossfade: key === 'yoga' ? 8 : 4 });
  try { F.wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  const ids = await pickSongs(w);
  if (ids.length) {
    player.setShuffle(false);
    await player.playList(ids, 0);
  } else {
    toast('Keine passende Musik gefunden – importiere Songs oder lade den Katalog.');
  }
  if (w.timer === 'interval') { say(`${w.name}. ${w.rounds} Runden. Tippe auf Start, wenn du bereit bist.`); }
  else if (w.timer === 'rest') { say('Krafttraining. Tippe nach jedem Satz auf Satz fertig.'); setPhase('active', 0); }
  else { say(`${w.name}. Viel Spaß!`); setPhase('active', 0); }
  F.tick = setInterval(tick, 250);
  render();
}

async function stop() {
  clearInterval(F.tick);
  window.removeEventListener('devicemotion', onMotion);
  F.motion = false;
  player.duck(false);
  F.wake?.release?.().catch(() => {});
  const secs = Math.round((now() - F.started) / 1000);
  if (F.w && secs > 30) {
    const h = history();
    h.unshift({ name: F.w.name, at: now(), secs, songs: F.songs.size, rounds: F.w.timer === 'interval' ? F.round : 0, sets: F.sets });
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 50))); } catch { /* ignore */ }
    toast(`Training gespeichert: ${Math.round(secs / 60)} Min. · ${plural(F.songs.size, 'Song', 'Songs')} 💪`);
  }
  const s = F.saved;
  if (s) {
    player.setEq(s.eq, s.preset);
    player.setDj(s.dj);
    player.setRate(s.rate);
    F.saved = null;
  }
  F.w = null;
  F.phase = 'idle';
}

export async function closeFitness() {
  if (F.w) await stop();
  F.open = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('#fitness').hidden = true;
  $('#fitness').innerHTML = '';
}

export const isFitnessOpen = () => F.open;

player.addEventListener('track', () => { if (F.open && F.w) { renderPlayer(); applyTempo(); } });
player.addEventListener('state', () => { if (F.open && F.w) renderPlayer(); });

export const fitnessActions = {
  fitness: () => openFitness(),
  'fit-close': () => closeFitness(),
  'fit-start': (el) => start(el.dataset.w),
  'fit-stop': async () => { await stop(); render(); },
  'fit-go': () => { F.round = 0; say('Mach dich bereit'); setPhase('prepare', 5); },
  'fit-set': () => {
    F.sets++;
    const secs = Number(document.querySelector('[name=ft-rest]:checked')?.value || F.restSecs);
    F.restSecs = secs;
    beep(440, 200);
    say(`${F.sets}. Satz geschafft. ${secs} Sekunden Pause.`);
    setPhase('setrest', secs);
  },
  'fit-power': async () => {
    // Jump to the fastest fitting song in the queue (or library) right now.
    const ids = player.queue.slice(player.index + 1).map(getTrack).filter(Boolean);
    const pool = ids.length ? ids : state.tracks.filter(playable);
    const best = pool.sort((a, b) => bpmOf(b) - bpmOf(a))[0];
    if (!best) return;
    player.addNext([best.id]);
    player.next();
    toast(`⚡ Power-Song: ${best.title}`);
  },
  'fit-motion': () => (F.motion ? (window.removeEventListener('devicemotion', onMotion), (F.motion = false), render()) : startMotion()),
  'fit-screen': () => {
    const el = $('#fitness');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => toast('Vollbild wird hier nicht unterstützt.'));
  },
};

// Inputs inside the fitness screen. Returns true when handled.
export function onFitnessInput(el) {
  if (el.id === 'ft-target') {
    F.targetBpm = +el.value;
    $('#ft-target-v').textContent = `${F.targetBpm} BPM`;
    applyTempo();
    return true;
  }
  if (el.id === 'ft-match') { F.matchTempo = el.checked; if (F.matchTempo && !F.targetBpm) F.targetBpm = bpmOf(player.track || {}) || 128; applyTempo(); renderTime(); return true; }
  if (el.id === 'ft-duck') { F.duckRest = el.checked; if (!el.checked) player.duck(false); return true; }
  if (el.name === 'ft-rest') { F.restSecs = +el.value; return true; }
  return false;
}

// Test hook
window.__melodyFit = { state: F, tick, fits };
