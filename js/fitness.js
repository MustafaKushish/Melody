// Fitness mode: music matched to the workout's tempo, interval & rest timers, voice coach, running cadence,
// and a personal trainer for strength training (plans, set logging, tips, careful progression – js/trainer.js).
import { player } from './player.js';
import { db } from './db.js';
import { icon, hydrateIcons, setIcon } from './icons.js';
import { $, esc, toast, state, getTrack, coverHTML, hue, plural, confirmSheet } from './core.js';
import { loadCatalog, ensureTracks, catalogEntry, playable } from './catalog.js';
import { bpmOfBlob } from './bpm.js';
import {
  EXERCISES, MUSCLES, GOALS, LEVELS, EFFORT, TEMPLATES, exInfo, isBw, repRange, fmtKg, parseNum, unitLabel, newPlanFrom,
  suggest, checkInput, setFeedback, deloadState, readinessWarnings, checkPlan, nextDay, sessionStats, progressSeries,
  bestE1rm, e1rm, weekStreak, weeklySets,
} from './trainer.js';

export const WORKOUTS = {
  kraft: { name: 'Krafttraining', emoji: '🏋️', bpm: [95, 135], sound: 'Melody Bass', timer: 'rest', desc: 'Trainer mit Plan, Sätzen & Tipps', c: ['#ef4444', '#7c2d12'] },
  hiit: { name: 'HIIT', emoji: '🔥', bpm: [124, 180], sound: 'Melody Party', timer: 'interval', work: 30, rest: 30, rounds: 10, desc: '30 s Vollgas, 30 s Pause · 10 Runden', c: ['#f97316', '#be123c'] },
  tabata: { name: 'Tabata', emoji: '⚡', bpm: [126, 180], sound: 'Melody Party', timer: 'interval', work: 20, rest: 10, rounds: 8, desc: '20 s / 10 s · 8 Runden · 4 Minuten', c: ['#eab308', '#c2410c'] },
  laufen: { name: 'Laufen', emoji: '🏃', bpm: [135, 185], sound: 'Melody Signature', timer: 'run', desc: 'Musik passend zu deinem Schritt-Tempo', c: ['#22c55e', '#0e7490'] },
  cardio: { name: 'Cardio & Spinning', emoji: '🚴', bpm: [115, 140], sound: 'Melody Party', timer: 'watch', desc: 'Gleichmäßiger Beat für Ausdauer', c: ['#06b6d4', '#4338ca'] },
  yoga: { name: 'Yoga & Dehnen', emoji: '🧘', bpm: [0, 100], sound: 'Melody Chill', timer: 'watch', desc: 'Ruhige Musik, weicher Klang', c: ['#a78bfa', '#334155'] },
};

const HIST_KEY = 'melody.workouts';
const TR_KEY = 'melody.trainer';
const LOG_KEY = 'melody.trainer.log';
const DRAFT_KEY = 'melody.trainer.draft';
const PREFS_KEY = 'melody.fit.prefs';
const F = {
  open: false, w: null, key: '', started: 0, phase: 'idle', phaseEnd: 0, round: 0, sets: 0,
  tick: null, songs: new Set(), matchTempo: false, targetBpm: 0, cadence: 0, steps: [], motion: false,
  wake: null, duckRest: true, saved: null, paused: 0,
  view: 'pick', // pick | plans | edit | ready | progress | summary (when no workout is running)
  tr: null, // running trainer session
  edit: null, ready: null, summary: null, prog: null,
};

// ---------- Storage ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Speichern nicht möglich – der Speicher ist voll.'); } };
const store = () => {
  const s = load(TR_KEY, {});
  return { profile: { goal: 'muskel', level: 'neu', weekGoal: 3, ...s.profile }, plans: s.plans || [], active: s.active || null, custom: s.custom || {} };
};
const saveStore = (s) => save(TR_KEY, s);
const trLog = () => load(LOG_KEY, []);
const activePlan = (s = store()) => s.plans.find((p) => p.id === s.active) || null;
const prefs = () => load(PREFS_KEY, {});

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
  if (!('speechSynthesis' in window) || F.mute) return;
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
    if (!F.w) return; // workout ended meanwhile
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
  F.paused = 0;
  F.said10 = false;
  if (F.duckRest) player.duck(phase === 'rest' || phase === 'setrest');
  render();
}

function tick() {
  if (!F.open || !F.w || F.paused) return;
  const w = F.w;
  const left = F.phaseEnd ? Math.ceil((F.phaseEnd - now()) / 1000) : 0;
  if (F.phaseEnd && left <= 3 && left > 0 && left !== F.lastBeep) {
    F.lastBeep = left;
    beep(660);
  }
  if (F.phase === 'work' && F.phaseLen >= 30 && left === 10 && !F.said10) { F.said10 = true; say('Noch 10 Sekunden'); }
  if (F.phase === 'setrest' && F.phaseLen >= 60 && left === 10 && !F.said10) { F.said10 = true; say('Noch 10 Sekunden Pause'); }
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
      const it = F.tr?.items[F.tr.cur];
      say(it ? `${exInfo(it.ex, store().custom).name}, Satz ${it.done.length + 1}. Los geht's!` : `Satz ${F.sets + 1}. Los geht's!`);
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

// The screen lock is released whenever the app goes to the background – take it again on return.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && F.open && F.w) {
    try { F.wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
    renderTime();
  }
});

// ---------- Trainer session ----------
const exName = (id, custom = store().custom) => exInfo(id, custom).name;

function buildItems(day, s, readiness, deload) {
  const log = trLog();
  return (day?.items || []).map((it) => ({ ex: it.ex, sets: it.sets, reps: it.reps, sug: suggest(it.ex, it, log, { goal: s.profile.goal, custom: s.custom, readiness, deload }), done: [] }));
}

function saveDraft() {
  if (F.tr) save(DRAFT_KEY, { at: now(), started: F.started, tr: F.tr });
}

function currentItem() { return F.tr?.items[F.tr.cur]; }

function prefill(item) {
  const last = item.done[item.done.length - 1];
  if (item.next) return item.next;
  if (last) return { kg: last.kg, reps: last.reps };
  return { kg: item.sug.kg, reps: item.sug.aim };
}

function trainerHTML() {
  const tr = F.tr;
  const s = store();
  const it = currentItem();
  const tabs = tr.items.map((x, i) => {
    const full = x.done.length >= x.sug.sets;
    return `<button class="tr-tab${i === tr.cur ? ' on' : ''}${full ? ' full' : ''}" data-action="tr-ex" data-i="${i}" aria-pressed="${i === tr.cur}">
      ${full ? icon('check') : `<i>${i + 1}</i>`}<span>${esc(exName(x.ex, s.custom))}</span><small>${x.done.length}/${x.sug.sets}</small></button>`;
  }).join('');
  const add = `<label class="tr-add">${icon('add')}<select id="tr-add" aria-label="Übung hinzufügen">${exOptions(s.custom, 'Übung hinzufügen …')}</select></label>`;
  if (!it) {
    return `<div class="tr-tabs">${tabs}</div><div class="tr-card tr-empty"><p>Füge deine erste Übung hinzu – Melody merkt sich Gewichte und Wiederholungen und schlägt beim nächsten Mal die passende Steigerung vor.</p>${add}</div>`;
  }
  const ex = exInfo(it.ex, s.custom);
  const bw = isBw(ex);
  const [lo, hi] = it.sug.reps;
  const pf = prefill(it);
  const n = it.done.length + 1;
  const trendIco = { up: '↑', down: '↓', same: '→', new: '★' }[it.sug.trend];
  return `<div class="tr-tabs" role="toolbar" aria-label="Übungen">${tabs}</div>
    <div class="tr-card">
      <div class="tr-title"><div><b>${esc(ex.name)}</b><span>${MUSCLES[ex.muscle] || ''} · ${it.sug.sets} × ${lo}–${hi} ${unitLabel(ex)}${it.sug.kg ? ` · ${fmtKg(it.sug.kg)} kg` : ''}</span></div>
        ${ex.cues?.length ? `<button class="chip${tr.cues ? ' on' : ''}" data-action="tr-cues" aria-expanded="${!!tr.cues}">Technik</button>` : ''}</div>
      ${tr.cues && ex.cues?.length ? `<ul class="tr-cues">${ex.cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <p class="tr-note t-${it.sug.trend}"><b aria-hidden="true">${trendIco}</b> ${esc(it.sug.note)}${tr.cur === 0 && !it.done.length && it.sug.kg >= 30 && ex.kind === 'c' ? ' Vorher 1–2 leichte Aufwärmsätze (ca. 50 %).' : ''}</p>
      ${it.done.length ? `<ol class="tr-sets">${it.done.map((st, i) => `<li><span>Satz ${i + 1}</span><b>${st.kg ? `${fmtKg(st.kg)} kg × ` : ''}${st.reps} ${unitLabel(ex)}</b><em>${EFFORT.find((e) => e.rir === st.rir)?.label || ''}</em>
        <button class="icon-btn" data-action="tr-del" data-s="${i}" aria-label="Satz ${i + 1} löschen">${icon('close')}</button></li>`).join('')}</ol>` : ''}
      ${it.fb?.length ? `<div class="tr-fb" role="status">${it.fb.map((m) => `<p class="fb-${m.t}">${esc(m.text)}</p>`).join('')}</div>` : ''}
      ${tr.pending ? `<div class="tr-fb tr-pending" role="alert"><p class="fb-warn">${esc(tr.pending.warn)}</p><div class="row">
          ${tr.pending.fix ? `<button class="btn btn-primary" data-action="tr-fix">${tr.pending.fix.kg !== undefined && tr.pending.fix.kg !== tr.pending.kg ? `Auf ${fmtKg(tr.pending.fix.kg)} kg korrigieren` : `Auf ${tr.pending.fix.reps} korrigieren`}</button>` : ''}
          ${tr.pending.ok ? '<button class="btn" data-action="tr-force">Trotzdem speichern</button>' : ''}</div></div>` : ''}
      <form class="tr-form" id="tr-form" autocomplete="off">
        <div class="tr-form-h">Satz ${n}${n > it.sug.sets ? ' (extra)' : ''}</div>
        <div class="tr-nums">
          <div class="tr-num"><label for="tr-kg">${bw ? 'Zusatz-kg' : 'kg'}</label><div>
            <button type="button" data-action="tr-step" data-f="kg" data-d="-1" aria-label="Weniger Gewicht">−</button>
            <input id="tr-kg" inputmode="decimal" enterkeyhint="next" value="${pf.kg ? fmtKg(pf.kg) : bw ? '0' : ''}" placeholder="0">
            <button type="button" data-action="tr-step" data-f="kg" data-d="1" aria-label="Mehr Gewicht">+</button></div></div>
          <div class="tr-num"><label for="tr-reps">${unitLabel(ex)}</label><div>
            <button type="button" data-action="tr-step" data-f="reps" data-d="-1" aria-label="Weniger">−</button>
            <input id="tr-reps" inputmode="numeric" enterkeyhint="done" value="${pf.reps || ''}" placeholder="${lo}">
            <button type="button" data-action="tr-step" data-f="reps" data-d="1" aria-label="Mehr">+</button></div></div>
        </div>
        <fieldset class="seg ft-seg tr-effort"><legend>Wie schwer war es?</legend>${EFFORT.map((e) => `<label><input type="radio" name="tr-rir" value="${e.rir}" ${e.rir === 2 ? 'checked' : ''}><span>${e.label}</span></label>`).join('')}</fieldset>
        <button class="ft-big" type="submit">${icon('check')} Satz speichern</button>
      </form>
      <div class="tr-nav">
        <button class="chip" data-action="tr-ex" data-i="${tr.cur - 1}" ${tr.cur === 0 ? 'disabled' : ''}>‹ Vorherige</button>
        ${add}
        <button class="chip" data-action="tr-ex" data-i="${tr.cur + 1}" ${tr.cur >= tr.items.length - 1 ? 'disabled' : ''}>Nächste ›</button>
      </div>
    </div>`;
}

function renderTrainer() {
  const box = $('#ft-trainer');
  if (!box || !F.tr) return;
  box.innerHTML = trainerHTML();
  hydrateIcons(box);
}

function saveSet(force = false) {
  const it = currentItem();
  if (!it) return;
  const s = store();
  const kg = parseNum($('#tr-kg')?.value || '0');
  const reps = Math.round(parseNum($('#tr-reps')?.value));
  const rir = Number(document.querySelector('[name=tr-rir]:checked')?.value ?? 2);
  const chk = checkInput(it.ex, kg, reps, trLog(), s.custom, it.done);
  if (!chk.ok || (chk.warn && !force)) {
    F.tr.pending = { ...chk, kg, reps };
    renderTrainer();
    return;
  }
  F.tr.pending = null;
  const set = { kg: Math.max(0, kg || 0), reps, rir };
  const fb = setFeedback(it.ex, set, it.done, it.sug, trLog(), { goal: s.profile.goal, custom: s.custom });
  it.done.push(set);
  it.fb = fb.msgs;
  it.next = fb.next;
  F.sets++;
  beep(440, 200);
  const top = fb.msgs.find((m) => m.t === 'pr' || m.t === 'warn');
  const finished = it.done.length === it.sug.sets;
  let nextIdx = F.tr.cur;
  if (finished) {
    const k = F.tr.items.findIndex((x, i) => i > F.tr.cur && x.done.length < x.sug.sets);
    nextIdx = k >= 0 ? k : F.tr.items.findIndex((x) => x.done.length < x.sug.sets);
  }
  const allDone = F.tr.items.every((x) => x.done.length >= x.sug.sets);
  if (allDone) {
    say('Alle Übungen geschafft! Stark! Tippe auf Beenden für deine Auswertung.');
    setPhase('active', 0);
  } else {
    say(top ? top.text.replace(/🎉/g, '') : `Satz ${it.done.length} gespeichert. ${fb.rest} Sekunden Pause.`);
    if (finished && nextIdx >= 0) {
      F.tr.cur = nextIdx;
      currentItem().fb = [...fb.msgs.filter((m) => m.t === 'pr' || m.t === 'warn'), { t: 'ok', text: `${exName(it.ex, s.custom)} geschafft ✓ – jetzt ${exName(currentItem().ex, s.custom)}.` }];
    }
    setPhase('setrest', fb.rest);
  }
  saveDraft();
  renderTrainer();
}

function finishTrainer() {
  const tr = F.tr;
  if (!tr) return null;
  const s = store();
  const entries = tr.items.filter((x) => x.done.length).map((x) => ({ ex: x.ex, sets: x.done }));
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  if (!entries.length) return null;
  const log = trLog();
  const session = { id: 's' + now().toString(36), at: F.started, secs: Math.round((now() - F.started) / 1000), planId: tr.planId || null, dayIdx: tr.dayIdx ?? null, dayName: tr.dayName || 'Freies Training', readiness: tr.readiness, deload: !!tr.deload, entries };
  const prs = entries.filter((e) => {
    const before = bestE1rm(e.ex, log);
    return before > 0 && Math.max(...e.sets.map((st) => e1rm(st.kg, st.reps))) > before + 0.01;
  }).map((e) => exName(e.ex, s.custom));
  const newLog = [session, ...log].slice(0, 400);
  save(LOG_KEY, newLog);
  const plan = s.plans.find((p) => p.id === tr.planId);
  const nextUp = entries.map((e) => {
    const item = plan?.days[tr.dayIdx]?.items.find((x) => x.ex === e.ex) || { sets: e.sets.length };
    return { ex: e.ex, sets: e.sets, sug: suggest(e.ex, item, newLog, { goal: s.profile.goal, custom: s.custom, now: now() + 2 * 86400000 }) };
  });
  const skipped = tr.items.filter((x) => x.done.length < x.sug.sets).map((x) => exName(x.ex, s.custom));
  return { session, stats: sessionStats(session), prs, nextUp, skipped, nextDay: plan ? plan.days[nextDay(plan, newLog)]?.name : '' };
}

// ---------- UI ----------
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDay = (t) => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

function setStatus(t) {
  const el = $('#ft-status');
  if (el) { el.textContent = t; el.hidden = !t; }
}

function history() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}

function exOptions(custom, placeholder) {
  const all = { ...EXERCISES, ...custom };
  return `<option value="">${esc(placeholder)}</option>` + Object.entries(MUSCLES).map(([m, label]) => {
    const list = Object.entries(all).filter(([, e]) => e.muscle === m).sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'));
    return list.length ? `<optgroup label="${label}">${list.map(([id, e]) => `<option value="${esc(id)}">${esc(e.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

// The title text gets its own element so a long plan name is cut off with "…" instead of pushing the buttons.
const badge = (lead, text) => `<span class="ft-badge">${lead}<span class="ft-badge-t">${text}</span></span>`;
const head = (lead, text, back = 'fit-home') => `<header class="ft-head"><button class="icon-btn" data-action="${back}" aria-label="Zurück">${icon('back')}</button>
  ${badge(lead, text)}<button class="icon-btn" data-action="fit-close" aria-label="Schließen">${icon('close')}</button></header>`;

function pickerHTML() {
  const h = history();
  const s = store();
  const plan = activePlan(s);
  const week = h.filter((x) => x.at > now() - 7 * 86400000);
  const mins = Math.round(week.reduce((a, x) => a + x.secs, 0) / 60);
  const goal = s.profile.weekGoal || 3;
  const streak = weekStreak(h.map((x) => x.at));
  const draft = load(DRAFT_KEY, null);
  const resumable = draft && now() - draft.at < 12 * 3600000 && draft.tr?.items?.some((x) => x.done.length);
  const log = trLog();
  const dl = deloadState(log);
  let trainer;
  if (plan) {
    const di = nextDay(plan, log);
    const day = plan.days[di];
    trainer = `<div class="tr-hero">
      <div class="tr-hero-t"><small>Dein Trainer · ${esc(plan.name)}</small><b>Heute: ${esc(day?.name || '–')}</b>
        <span>${day ? esc(day.items.map((x) => exName(x.ex, s.custom)).join(' · ')) : 'Der Plan hat noch keine Tage.'}</span>
        ${dl.due ? `<span class="tr-hint">🌿 ${esc(dl.reason)}</span>` : ''}</div>
      <div class="tr-hero-b">
        <button class="ft-big" data-action="tr-ready" ${day ? '' : 'disabled'}>${icon('play')} Training starten</button>
        <button class="chip" data-action="tr-plans">${icon('edit')} Pläne</button>
        <button class="chip" data-action="tr-progress">${icon('chart')} Fortschritt</button>
      </div></div>`;
  } else {
    trainer = `<div class="tr-hero">
      <div class="tr-hero-t"><small>Neu: Dein persönlicher Trainer</small><b>Trainingsplan erstellen</b>
        <span>Sätze eintragen, Tipps und Korrekturen bekommen. Melody steigert dein Training Schritt für Schritt – ohne dich zu überlasten.</span></div>
      <div class="tr-hero-b"><button class="ft-big" data-action="tr-plans">${icon('add')} Plan wählen</button>
        ${log.length ? `<button class="chip" data-action="tr-progress">${icon('chart')} Fortschritt</button>` : ''}</div></div>`;
  }
  return `<header class="ft-head">${badge(icon('fitness'), 'Fitness')}
      <button class="icon-btn" data-action="fit-close" aria-label="Schließen">${icon('close')}</button></header>
    <div class="ft-pick">
      <h1>Was trainierst du heute?</h1>
      <div class="ft-week" aria-label="Wochenziel">
        <div class="ft-week-bar"><i style="width:${Math.min(100, (week.length / goal) * 100)}%"></i></div>
        <span>${week.length >= goal ? `Wochenziel geschafft: ${week.length} von ${goal} 💪` : `Diese Woche: ${week.length} von ${goal} Trainings`}${mins ? ` · ${mins} Min.` : ''}${streak > 1 ? ` · 🔥 ${streak} Wochen in Folge` : ''}</span>
      </div>
      ${resumable ? `<div class="tr-resume">${icon('timer')}<span>Unterbrochenes Training: <b>${esc(draft.tr.dayName || 'Krafttraining')}</b> · ${plural(draft.tr.items.reduce((a, x) => a + x.done.length, 0), 'Satz', 'Sätze')}</span>
        <button class="btn btn-primary" data-action="tr-resume">Fortsetzen</button><button class="icon-btn" data-action="tr-discard" aria-label="Verwerfen">${icon('close')}</button></div>` : ''}
      ${trainer}
      <div class="ft-grid">${Object.entries(WORKOUTS).map(([k, w]) => `
        <button class="ft-card" style="--c1:${w.c[0]};--c2:${w.c[1]}" data-action="fit-start" data-w="${k}">
          <span class="ft-emoji">${w.emoji}</span><b>${w.name}</b><span>${k === 'kraft' && !plan ? 'Ohne Plan: Übungen frei wählen' : w.desc}</span>
          <small>${w.bpm[0] ? `${w.bpm[0]}–${w.bpm[1]} BPM` : 'bis 100 BPM'}</small></button>`).join('')}</div>
      ${h.length ? `<h2>Letzte Trainings</h2><div class="ft-hist">${h.slice(0, 5).map((x) => `<div><b>${esc(x.name)}</b><span>${fmtDay(x.at)} · ${Math.round(x.secs / 60)} Min. · ${plural(x.songs, 'Song', 'Songs')}${x.rounds ? ` · ${x.rounds} Runden` : ''}${x.sets ? ` · ${x.sets} Sätze` : ''}${x.vol ? ` · ${fmtKg(x.vol)} kg bewegt` : ''}</span></div>`).join('')}</div>` : ''}
    </div>`;
}

function plansHTML() {
  const s = store();
  const p = s.profile;
  return `${head(icon('edit'), 'Trainingspläne')}
    <div class="ft-pick">
      <h2>Über dich</h2>
      <div class="tr-profile">
        <div><span>Ziel</span><div class="seg ft-seg">${Object.entries(GOALS).map(([k, g]) => `<label><input type="radio" name="tr-goal" value="${k}" ${p.goal === k ? 'checked' : ''}><span>${g.name}</span></label>`).join('')}</div></div>
        <div><span>Erfahrung</span><div class="seg ft-seg">${Object.entries(LEVELS).map(([k, l]) => `<label><input type="radio" name="tr-level" value="${k}" ${p.level === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <div><span>Wochenziel</span><div class="seg ft-seg">${[2, 3, 4, 5].map((n) => `<label><input type="radio" name="tr-wgoal" value="${n}" ${p.weekGoal === n ? 'checked' : ''}><span>${n}× pro Woche</span></label>`).join('')}</div></div>
      </div>
      ${s.plans.length ? `<h2>Meine Pläne</h2><div class="tr-plans">${s.plans.map((pl) => `
        <div class="tr-plan${pl.id === s.active ? ' on' : ''}"><div><b>${esc(pl.name)}</b><span>${plural(pl.days.length, 'Tag', 'Tage')} · ${pl.perWeek}× pro Woche${pl.id === s.active ? ' · aktiv' : ''}</span></div>
          ${pl.id === s.active ? '' : `<button class="chip" data-action="tr-activate" data-id="${pl.id}">Aktivieren</button>`}
          <button class="chip" data-action="tr-edit" data-id="${pl.id}">${icon('edit')} Bearbeiten</button></div>`).join('')}</div>` : ''}
      <h2>Neuer Plan</h2>
      <div class="ft-grid tr-tpls">${TEMPLATES.map((t) => `<button class="tr-tpl" data-action="tr-new" data-tpl="${t.id}"><b>${t.name}</b><span>${t.desc}</span><small>${t.days.map((d) => d.name).join(' · ')}${t.level === p.level ? ' · passt zu dir' : ''}</small></button>`).join('')}
        <button class="tr-tpl" data-action="tr-new" data-tpl=""><b>${icon('add')} Eigener Plan</b><span>Übungen selbst zusammenstellen</span><small>Melody prüft den Plan für dich</small></button></div>
      <p class="ft-sub tr-disclaimer">Die Tipps ersetzen keine ärztliche Beratung. Bei Schmerzen, Vorerkrankungen oder nach Verletzungen vorher ärztlich abklären.</p>
    </div>`;
}

function editHTML() {
  const pl = F.edit;
  const s = store();
  return `${head(icon('edit'), 'Plan bearbeiten', 'tr-plans')}
    <div class="ft-pick tr-editor">
      <label class="tr-field">Name<input class="input plain" id="pe-name" value="${esc(pl.name)}" maxlength="40"></label>
      <div class="tr-field">Trainings pro Woche<div class="tr-stepper"><button class="chip" data-action="pe-week" data-d="-1" aria-label="Weniger">−</button><b id="pe-week">${pl.perWeek}</b><button class="chip" data-action="pe-week" data-d="1" aria-label="Mehr">+</button></div></div>
      ${pl.days.map((d, di) => `<section class="tr-day">
        <div class="tr-day-h"><input class="input plain" data-pe-day="${di}" value="${esc(d.name)}" maxlength="30" aria-label="Name des Tages">
          <button class="icon-btn" data-action="pe-del-day" data-d="${di}" aria-label="Tag löschen">${icon('delete')}</button></div>
        ${d.items.map((it, ii) => {
          const ex = exInfo(it.ex, s.custom);
          const [lo, hi] = repRange(null, ex, s.profile.goal);
          return `<div class="tr-row"><span class="tr-row-n"><b>${esc(ex.name)}</b><small>${MUSCLES[ex.muscle] || ''}</small></span>
            <span class="tr-stepper"><button class="chip" data-action="pe-sets" data-d="${di}" data-i="${ii}" data-v="-1" aria-label="Weniger Sätze">−</button><b>${it.sets}</b><button class="chip" data-action="pe-sets" data-d="${di}" data-i="${ii}" data-v="1" aria-label="Mehr Sätze">+</button><small>Sätze</small></span>
            <span class="tr-reps"><input inputmode="numeric" data-pe-lo="${di}.${ii}" value="${it.reps?.[0] ?? ''}" placeholder="${lo}" aria-label="Wiederholungen von">–<input inputmode="numeric" data-pe-hi="${di}.${ii}" value="${it.reps?.[1] ?? ''}" placeholder="${hi}" aria-label="Wiederholungen bis"><small>${unitLabel(ex)}</small></span>
            <span class="tr-row-b"><button class="icon-btn" data-action="pe-up" data-d="${di}" data-i="${ii}" ${ii ? '' : 'disabled'} aria-label="Nach oben">↑</button>
            <button class="icon-btn" data-action="pe-del" data-d="${di}" data-i="${ii}" aria-label="Entfernen">${icon('close')}</button></span></div>`;
        }).join('')}
        <label class="tr-add">${icon('add')}<select data-pe-add="${di}" aria-label="Übung hinzufügen">${exOptions(s.custom, 'Übung hinzufügen …')}</select></label>
      </section>`).join('')}
      <button class="chip" data-action="pe-add-day">${icon('add')} Trainingstag hinzufügen</button>
      <details class="tr-custom"><summary>Eigene Übung anlegen</summary>
        <div class="row"><input class="input plain" id="pe-cx-name" placeholder="z. B. Kabelzug-Crossover" maxlength="40">
        <select class="input" id="pe-cx-m">${Object.entries(MUSCLES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select class="input" id="pe-cx-k"><option value="c">Grundübung</option><option value="i">Isolationsübung</option><option value="bw">Körpergewicht</option></select>
        <button class="btn" data-action="pe-cx">Anlegen</button></div></details>
      <h2>Trainer-Check</h2>
      <div class="tr-check" id="pe-check">${checkHTML()}</div>
      <div class="row tr-edit-b">
        ${s.plans.some((p) => p.id === pl.id) ? `<button class="btn" data-action="pe-delete" style="color:#fca5a5">${icon('delete')} Plan löschen</button>` : ''}
        <button class="btn btn-primary" data-action="pe-save">${icon('check')} Plan speichern</button></div>
    </div>`;
}

function checkHTML() {
  const s = store();
  const vol = weeklySets(F.edit, s.custom);
  const list = checkPlan(F.edit, { level: s.profile.level, custom: s.custom });
  return `${Object.keys(vol).length ? `<div class="tr-vol">${Object.entries(vol).map(([m, v]) => `<span>${MUSCLES[m]} <b>${fmtKg(v)}</b></span>`).join('')}<small>Sätze pro Woche</small></div>` : ''}
    ${list.map((m) => `<p class="fb-${m.t}">${esc(m.text)}</p>`).join('')}`;
}

function readyHTML() {
  const s = store();
  const plan = activePlan(s);
  const r = F.ready;
  const day = plan.days[r.dayIdx];
  const log = trLog();
  const warns = readinessWarnings(day, log, { custom: s.custom });
  const dl = deloadState(log);
  const items = buildItems(day, s, r.readiness, r.deload);
  const moods = [['top', '💪', 'Topfit'], ['ok', '🙂', 'Normal'], ['muede', '😴', 'Müde'], ['schmerz', '🤕', 'Schmerzen']];
  return `${head(icon('fitness'), esc(plan.name))}
    <div class="ft-pick tr-ready">
      <div class="seg ft-seg tr-days">${plan.days.map((d, i) => `<label><input type="radio" name="tr-day" value="${i}" ${i === r.dayIdx ? 'checked' : ''}><span>${esc(d.name)}</span></label>`).join('')}</div>
      <h2>Wie fühlst du dich heute?</h2>
      <div class="tr-moods">${moods.map(([k, e, l]) => `<button class="tr-mood${r.readiness === k ? ' on' : ''}" data-action="tr-mood" data-m="${k}" aria-pressed="${r.readiness === k}"><span>${e}</span>${l}</button>`).join('')}</div>
      ${r.readiness === 'schmerz' ? '<p class="fb-warn">Bei Schmerzen nicht durchziehen: Trainiere heute nur, was nicht weh tut, und deutlich leichter. Ein stechender Schmerz heißt sofort aufhören. Halten Schmerzen an, ärztlich abklären lassen.</p>' : ''}
      ${r.readiness === 'muede' ? '<p class="fb-tip">Kein Problem – heute gibt es etwas weniger Sätze und Gewicht. Auch ein lockeres Training zählt.</p>' : ''}
      ${warns.map((w) => `<p class="fb-warn">${esc(w)}</p>`).join('')}
      ${dl.due || r.deload ? `<label class="ft-toggle tr-deload"><input type="checkbox" id="tr-deload" ${r.deload ? 'checked' : ''}><span>Leichte Woche (Deload)${dl.due ? ` – ${esc(dl.reason)}` : ''}</span></label>` : ''}
      <h2>Heute dran</h2>
      <ol class="tr-preview">${items.map((it) => {
        const ex = exInfo(it.ex, s.custom);
        return `<li><b>${esc(ex.name)}</b><span>${it.sug.sets} × ${it.sug.reps[0]}–${it.sug.reps[1]}${it.sug.kg ? ` · ${fmtKg(it.sug.kg)} kg` : ''}</span><small class="t-${it.sug.trend}">${esc(it.sug.note)}</small></li>`;
      }).join('')}</ol>
      <button class="ft-big tr-go" data-action="tr-go">${icon('play')} Los geht's</button>
      <button class="chip tr-free" data-action="tr-free">Ohne Plan trainieren</button>
    </div>`;
}

function sparkline(series) {
  if (series.length < 2) return '';
  const vals = series.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = series.map((p, i) => `${(i / (series.length - 1)) * 100},${28 - ((p.value - min) / span) * 24}`).join(' ');
  return `<svg class="tr-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
}

function progressHTML() {
  const s = store();
  const log = trLog();
  const ids = [...new Set(log.flatMap((x) => x.entries.map((e) => e.ex)))];
  const rows = ids.map((id) => {
    const ser = progressSeries(id, log, s.custom);
    const first = ser[0], last = ser[ser.length - 1];
    const pct = first && first.value ? Math.round((last.value / first.value - 1) * 100) : 0;
    return { id, ser, last, pct };
  }).sort((a, b) => b.ser.length - a.ser.length);
  const week = log.filter((x) => x.at > now() - 7 * 86400000);
  const vol = {};
  for (const x of week) for (const e of x.entries) { const m = exInfo(e.ex, s.custom).muscle; vol[m] = (vol[m] || 0) + e.sets.length; }
  const dl = deloadState(log);
  return `${head(icon('chart'), 'Fortschritt')}
    <div class="ft-pick">
      ${!log.length ? '<p class="ft-sub">Noch keine Trainings mit Trainer. Nach deinem ersten Training siehst du hier, wie du stärker wirst.</p>' : `
      <div class="tr-stats"><div><b>${log.length}</b><span>Trainings</span></div><div><b>${log.reduce((a, x) => a + sessionStats(x).sets, 0)}</b><span>Sätze</span></div>
        <div><b>${fmtKg(Math.round(log.reduce((a, x) => a + sessionStats(x).volume, 0) / 1000))} t</b><span>bewegt</span></div><div><b>${weekStreak(log.map((x) => x.at))}</b><span>Wochen in Folge</span></div></div>
      ${dl.due ? `<p class="fb-tip">🌿 ${esc(dl.reason)} Beim nächsten Start kannst du eine leichte Woche wählen.</p>` : ''}
      ${Object.keys(vol).length ? `<h2>Letzte 7 Tage</h2><div class="tr-vol">${Object.entries(vol).map(([m, v]) => `<span>${MUSCLES[m]} <b>${v}</b></span>`).join('')}<small>Sätze</small></div>` : ''}
      <h2>Übungen</h2>
      <div class="tr-prog">${rows.map((r) => `<div><div><b>${esc(exName(r.id, s.custom))}</b><span>${r.last.kg ? `Max. ca. ${fmtKg(Math.round(r.last.value * 2) / 2)} kg` : `${r.last.value} ${r.last.unit}`} · ${plural(r.ser.length, 'Training', 'Trainings')}${r.ser.length > 1 ? ` · <em class="${r.pct >= 0 ? 'up' : 'down'}">${r.pct >= 0 ? '+' : ''}${r.pct} %</em>` : ''}</span></div>${sparkline(r.ser)}</div>`).join('')}</div>
      <h2>Verlauf</h2>
      <div class="ft-hist">${log.slice(0, 30).map((x) => { const st = sessionStats(x); return `<div class="tr-hist"><div><b>${esc(x.dayName || 'Training')}${x.deload ? ' · leicht' : ''}</b><span>${fmtDay(x.at)} · ${plural(st.sets, 'Satz', 'Sätze')}${st.volume ? ` · ${fmtKg(st.volume)} kg` : ''} · ${esc(x.entries.map((e) => exName(e.ex, s.custom)).join(', '))}</span></div>
        <button class="icon-btn" data-action="tr-del-log" data-id="${x.id}" aria-label="Training löschen">${icon('delete')}</button></div>`; }).join('')}</div>`}
    </div>`;
}

function summaryHTML() {
  const r = F.summary;
  const s = store();
  const st = r.stats;
  return `${head('🎉', 'Geschafft')}
    <div class="ft-pick tr-sum">
      <h1>Stark gemacht!</h1>
      <div class="tr-stats"><div><b>${Math.round(r.session.secs / 60)}</b><span>Min.</span></div><div><b>${st.sets}</b><span>Sätze</span></div><div><b>${fmtKg(st.volume)}</b><span>kg bewegt</span></div></div>
      ${r.prs.length ? `<p class="fb-pr">🏆 Neue Rekorde: ${esc(r.prs.join(', '))}</p>` : ''}
      ${r.skipped.length ? `<p class="fb-tip">Nicht ganz fertig: ${esc(r.skipped.join(', '))}. Kein Problem – lieber sauber als erzwungen.</p>` : ''}
      <h2>Beim nächsten Mal</h2>
      <ol class="tr-preview">${r.nextUp.map((x) => `<li><b>${esc(exName(x.ex, s.custom))}</b><span>heute ${x.sets.map((q) => (q.kg ? `${fmtKg(q.kg)}×${q.reps}` : q.reps)).join(', ')}</span><small class="t-${x.sug.trend}">${esc(x.sug.note)}</small></li>`).join('')}</ol>
      <p class="fb-ok">Gönn den trainierten Muskeln jetzt etwa 48 Stunden Erholung: genug schlafen, trinken und eiweißreich essen.${r.nextDay ? ` Nächstes Training: <b>${esc(r.nextDay)}</b>.` : ''}</p>
      <button class="ft-big" data-action="fit-home">${icon('check')} Fertig</button>
    </div>`;
}

function intervalSetupHTML() {
  const w = F.w;
  const row = (k, label, step, unit) => `<div class="tr-field">${label}<div class="tr-stepper"><button class="chip" data-action="iv-set" data-k="${k}" data-d="${-step}" aria-label="Weniger">−</button><b>${w[k]}${unit}</b><button class="chip" data-action="iv-set" data-k="${k}" data-d="${step}" aria-label="Mehr">+</button></div></div>`;
  return `<div class="ft-iv">${row('work', 'Belastung', 5, ' s')}${row('rest', 'Pause', 5, ' s')}${row('rounds', 'Runden', 1, '')}
    <small>${fmtClock(w.rounds * (w.work + w.rest) - w.rest)} Minuten</small></div>`;
}

function sessionHTML() {
  const w = F.w;
  const trainer = w.timer === 'rest';
  return `<header class="ft-head">${badge(w.emoji, F.tr?.dayName ? esc(F.tr.dayName) : w.name)}
      <span class="ft-elapsed" id="ft-elapsed">0:00</span>
      ${trainer ? `<button class="btn ft-finish" data-action="fit-stop">${icon('check')} Beenden</button>` : `<button class="icon-btn" data-action="fit-stop" aria-label="Training beenden">${icon('close')}</button>`}</header>
    <div class="ft-status" id="ft-status" hidden></div>
    <div class="ft-main${trainer ? ' ft-tr' : ''}">
      <div class="ft-ring" id="ft-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" class="ft-ring-bg"/><circle cx="60" cy="60" r="54" class="ft-ring-fg" id="ft-ring-fg" pathLength="100"/></svg>
        <div class="ft-ring-text" aria-live="polite"><div class="ft-phase" id="ft-phase"></div><div class="ft-time" id="ft-time"></div><div class="ft-count" id="ft-count"></div></div>
      </div>
      ${trainer ? `<div class="tr-restbar" id="tr-restbar" hidden><button class="chip" data-action="tr-rest-add">+30 s</button><button class="chip" data-action="tr-rest-skip">${icon('next')} Pause beenden</button></div>
        <div class="ft-trainer" id="ft-trainer"></div>` : ''}
      ${w.timer === 'interval' && F.phase === 'idle' ? `${intervalSetupHTML()}<button class="ft-big" data-action="fit-go">${icon('play')} Intervall starten</button>` : ''}
      ${w.timer === 'interval' && /work|rest|prepare/.test(F.phase) ? `<div class="ft-ivbtns"><button class="chip" data-action="fit-pause" id="ft-pause">${icon(F.paused ? 'play' : 'pause')} ${F.paused ? 'Weiter' : 'Pause'}</button><button class="chip" data-action="fit-skip">${icon('next')} Überspringen</button></div>` : ''}
      ${w.timer === 'interval' && F.phase === 'done' ? `<button class="ft-big" data-action="fit-go">${icon('repeat')} Noch einmal</button>` : ''}
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
        <label class="ft-toggle"><input type="checkbox" id="ft-voice" ${F.mute ? '' : 'checked'}><span>Sprach-Coach</span></label>
        <button class="chip" data-action="fit-screen">${icon('grid')} Großbildschirm</button>
      </div>
    </div>`;
}

const VIEWS = { pick: pickerHTML, plans: plansHTML, edit: editHTML, ready: readyHTML, progress: progressHTML, summary: summaryHTML };

function render() {
  const el = $('#fitness');
  if (!F.open || !el) return;
  if (!F.w) {
    el.className = 'fitness';
    el.dataset.view = '';
    el.innerHTML = (VIEWS[F.view] || pickerHTML)();
  } else {
    const key = F.key + F.phase.replace(/work|rest|prepare|active|setrest/, 'x') + (F.w.timer === 'interval' ? F.phase.replace(/work|rest|prepare/, 'x') + !!F.paused : '');
    if (!el.querySelector('.ft-main') || el.dataset.view !== key) {
      el.innerHTML = sessionHTML();
      el.dataset.view = key;
      renderTrainer();
    }
    el.className = `fitness phase-${F.phase}${F.w.timer === 'rest' ? ' trainer' : ''}${F.paused ? ' paused' : ''}`;
    renderPlayer();
    renderTime();
  }
  hydrateIcons(el);
}

// Re-render a picker-type view and keep the scroll position.
function show(view) {
  const el = $('#fitness');
  const top = F.view === view ? el?.scrollTop : 0;
  F.view = view;
  render();
  if (el) el.scrollTop = top || 0;
}

function renderTime() {
  if (!F.w) return;
  const w = F.w;
  const el = $('#ft-elapsed');
  if (el) el.textContent = fmtClock((now() - F.started) / 1000);
  const left = F.paused ? F.paused / 1000 : F.phaseEnd ? Math.max(0, (F.phaseEnd - now()) / 1000) : 0;
  const it = currentItem();
  const labels = { idle: 'Bereit', prepare: 'Gleich geht\'s los', work: 'LOS!', rest: 'PAUSE', active: w.timer === 'rest' ? (F.tr?.items.length && F.tr.items.every((x) => x.done.length >= x.sug.sets) ? 'Alles geschafft!' : it ? `Satz ${it.done.length + 1}` : 'Training') : 'Training', setrest: 'SATZPAUSE', done: 'Geschafft! 🎉' };
  const ph = $('#ft-phase'), tm = $('#ft-time'), ct = $('#ft-count'), fg = $('#ft-ring-fg');
  if (!ph) return;
  ph.textContent = F.paused ? 'PAUSIERT' : labels[F.phase] || '';
  tm.textContent = F.phaseEnd || F.paused ? fmtClock(Math.ceil(left)) : fmtClock((now() - F.started) / 1000);
  ct.textContent = w.timer === 'interval' ? `Runde ${Math.max(1, F.round)} / ${w.rounds}` : w.timer === 'rest' ? (it ? `${it.done.length} / ${it.sug.sets} Sätze` : `${F.sets} ${F.sets === 1 ? 'Satz' : 'Sätze'}`) : F.matchTempo && F.targetBpm ? `${F.targetBpm} BPM` : '';
  fg.style.strokeDashoffset = (F.phaseEnd || F.paused) && F.phaseLen ? String(100 - (left / F.phaseLen) * 100) : '0';
  const cad = $('#ft-cad');
  if (cad) cad.textContent = F.cadence || '–';
  const rb = $('#tr-restbar');
  if (rb) rb.hidden = F.phase !== 'setrest';
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
  F.view = 'pick';
  const el = $('#fitness');
  el.hidden = false;
  el.className = 'fitness';
  document.body.classList.add('fit-open');
  render();
}

async function start(key, tr = null, started = 0) {
  const base = WORKOUTS[key];
  const w = base.timer === 'interval' ? { ...base, ...prefs()[key] } : base;
  Object.assign(F, { w, key, started: started || now(), phase: 'idle', phaseEnd: 0, round: 0, sets: 0, songs: new Set(), cadence: 0, steps: [], paused: 0, tr: null });
  if (key === 'kraft') {
    F.tr = tr || { dayName: 'Freies Training', readiness: 'ok', items: [], cur: 0 };
    F.sets = F.tr.items.reduce((a, x) => a + x.done.length, 0);
    saveDraft();
  }
  F.saved = { preset: player.settings.preset, eq: [...player.settings.eq], dj: { ...player.settings.dj }, rate: player.settings.rate, eqOn: player.settings.eqOn, fx: player.settings.fx };
  F.targetBpm = key === 'laufen' ? 160 : 0;
  F.matchTempo = key === 'laufen';
  render();
  $('#fitness').scrollTop = 0;
  player.applySound(w.sound);
  player.setDj({ crossfade: key === 'yoga' ? 8 : 4 });
  try { F.wake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  if (key === 'kraft') { setPhase('active', 0); }
  if (w.timer === 'interval') say(`${w.name}. ${w.rounds} Runden. Tippe auf Start, wenn du bereit bist.`);
  else if (key === 'kraft') say(F.tr.items.length ? `${F.tr.dayName}. Los geht's mit ${exName(F.tr.items[F.tr.cur].ex)}.` : 'Krafttraining. Wähle deine erste Übung.');
  else { say(`${w.name}. Viel Spaß!`); setPhase('active', 0); }
  F.tick = setInterval(tick, 250);
  const ids = await pickSongs(w);
  if (!F.w || F.w !== w) return; // stopped while songs were measured
  if (ids.length) {
    player.setShuffle(false);
    await player.playList(ids, 0);
  } else {
    toast('Keine passende Musik gefunden – importiere Songs oder lade den Katalog.');
  }
  render();
}

async function stop({ keepDraft = false } = {}) {
  clearInterval(F.tick);
  window.removeEventListener('devicemotion', onMotion);
  F.motion = false;
  player.duck(false);
  F.wake?.release?.().catch(() => {});
  F.wake = null;
  const secs = Math.round((now() - F.started) / 1000);
  if (keepDraft) saveDraft();
  const summary = F.key === 'kraft' && !keepDraft ? finishTrainer() : null;
  if (F.w && !keepDraft && (secs > 30 || summary)) {
    const h = history();
    h.unshift({ name: summary ? `${F.w.name} · ${summary.session.dayName}` : F.w.name, at: now(), secs, songs: F.songs.size, rounds: F.w.timer === 'interval' ? F.round : 0, sets: F.sets, vol: summary?.stats.volume || 0 });
    save(HIST_KEY, h.slice(0, 100));
    if (!summary) toast(`Training gespeichert: ${Math.round(secs / 60)} Min. · ${plural(F.songs.size, 'Song', 'Songs')} 💪`);
  }
  const s = F.saved;
  if (s) {
    player.setEq(s.eq, s.preset);
    player.setDj(s.dj);
    player.setRate(s.rate);
    if (!s.eqOn) player.setEqOn(false);
    player.returnFx(s.fx);
    F.saved = null;
  }
  F.w = null;
  F.tr = null;
  F.phase = 'idle';
  F.paused = 0;
  F.summary = summary;
  F.view = summary ? 'summary' : 'pick';
}

export async function closeFitness() {
  if (F.w) {
    // Strength sessions stay as a draft when the screen is closed by accident.
    const keepDraft = !!F.tr?.items.some((x) => x.done.length);
    await stop({ keepDraft });
    if (keepDraft) toast('Training pausiert – du kannst es im Fitness-Modus fortsetzen.');
  }
  F.open = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('fit-open');
  $('#fitness').hidden = true;
  $('#fitness').innerHTML = '';
}

export const isFitnessOpen = () => F.open;

player.addEventListener('track', () => { if (F.open && F.w) { renderPlayer(); applyTempo(); } });
player.addEventListener('state', () => { if (F.open && F.w) renderPlayer(); });

// Enter in the set form saves the set.
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'tr-form') return;
  e.preventDefault();
  saveSet();
});

const parseIdx = (el, k = 'i') => Number(el.dataset[k]);
function editPlanChanged(full = true) {
  if (full) return show('edit');
  const box = $('#pe-check');
  if (box) box.innerHTML = checkHTML();
}

export const fitnessActions = {
  fitness: () => openFitness(),
  'fit-close': () => closeFitness(),
  'fit-home': () => { F.summary = null; show('pick'); },
  'fit-start': (el) => {
    if (el.dataset.w === 'kraft' && activePlan()) return fitnessActions['tr-ready']();
    start(el.dataset.w);
  },
  'fit-stop': async () => {
    if (F.tr?.items.some((x) => x.done.length) && F.tr.items.some((x) => x.done.length < x.sug.sets)) {
      if (!(await confirmSheet('Training jetzt beenden? Noch nicht alle Sätze sind gemacht.', 'Beenden'))) return;
    }
    await stop();
    render();
  },
  'fit-go': () => { F.round = 0; say('Mach dich bereit'); setPhase('prepare', 5); },
  'fit-pause': () => {
    if (F.paused) {
      F.phaseEnd = now() + F.paused;
      F.paused = 0;
      if (F.duckRest) player.duck(F.phase === 'rest');
      say('Weiter');
    } else {
      F.paused = Math.max(1, F.phaseEnd - now());
      F.phaseEnd = 0;
      player.duck(true);
    }
    render();
  },
  'fit-skip': () => { if (F.paused) fitnessActions['fit-pause'](); F.phaseEnd = now(); tick(); },
  'iv-set': (el) => {
    const k = el.dataset.k;
    const lim = { work: [5, 300], rest: [5, 300], rounds: [1, 50] }[k];
    F.w[k] = Math.max(lim[0], Math.min(lim[1], F.w[k] + Number(el.dataset.d)));
    const p = prefs();
    p[F.key] = { work: F.w.work, rest: F.w.rest, rounds: F.w.rounds };
    save(PREFS_KEY, p);
    $('#fitness').dataset.view = '';
    render();
  },
  'fit-power': async () => {
    // Jump to the fastest fitting song in the queue (or library) right now.
    const ids = player.queue.slice(player.index + 1).map(getTrack).filter(Boolean);
    const pool = ids.length ? ids : state.tracks.filter(playable);
    const best = [...pool].sort((a, b) => bpmOf(b) - bpmOf(a))[0];
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

  // Trainer: plans & profile
  'tr-plans': () => show('plans'),
  'tr-progress': () => show('progress'),
  'tr-new': (el) => {
    const tpl = TEMPLATES.find((t) => t.id === el.dataset.tpl);
    F.edit = tpl ? newPlanFrom(tpl) : { id: 'p' + now().toString(36), name: 'Mein Plan', perWeek: 3, days: [{ name: 'Tag A', items: [] }] };
    show('edit');
  },
  'tr-edit': (el) => { F.edit = structuredClone(store().plans.find((p) => p.id === el.dataset.id)); if (F.edit) show('edit'); },
  'tr-activate': (el) => { const s = store(); s.active = el.dataset.id; saveStore(s); show('plans'); },
  'pe-week': (el) => { F.edit.perWeek = Math.max(1, Math.min(7, F.edit.perWeek + Number(el.dataset.d))); editPlanChanged(); },
  'pe-sets': (el) => { const it = F.edit.days[parseIdx(el, 'd')].items[parseIdx(el)]; it.sets = Math.max(1, Math.min(10, it.sets + Number(el.dataset.v))); editPlanChanged(); },
  'pe-del': (el) => { F.edit.days[parseIdx(el, 'd')].items.splice(parseIdx(el), 1); editPlanChanged(); },
  'pe-up': (el) => { const list = F.edit.days[parseIdx(el, 'd')].items, i = parseIdx(el); [list[i - 1], list[i]] = [list[i], list[i - 1]]; editPlanChanged(); },
  'pe-add-day': () => { F.edit.days.push({ name: `Tag ${String.fromCharCode(65 + F.edit.days.length)}`, items: [] }); editPlanChanged(); },
  'pe-del-day': (el) => { F.edit.days.splice(parseIdx(el, 'd'), 1); editPlanChanged(); },
  'pe-cx': () => {
    const name = $('#pe-cx-name').value.trim();
    if (!name) { toast('Gib der Übung einen Namen.'); return; }
    const kind = $('#pe-cx-k').value;
    const s = store();
    const id = 'c-' + name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').slice(0, 30) + '-' + now().toString(36).slice(-3);
    s.custom[id] = { name, muscle: $('#pe-cx-m').value, kind: kind === 'i' ? 'i' : 'c', step: kind === 'bw' ? 0 : kind === 'i' ? 1 : 2.5, bw: kind === 'bw', cues: [], custom: true };
    saveStore(s);
    toast(`„${name}“ angelegt – jetzt im Menü „Übung hinzufügen“.`);
    editPlanChanged();
  },
  'pe-save': () => {
    const pl = F.edit;
    pl.name = pl.name.trim() || 'Mein Plan';
    pl.days = pl.days.filter((d) => d.items.length || pl.days.length === 1);
    if (!pl.days.some((d) => d.items.length)) { toast('Füge mindestens eine Übung hinzu.'); return; }
    const s = store();
    const i = s.plans.findIndex((p) => p.id === pl.id);
    if (i >= 0) s.plans[i] = pl; else s.plans.push(pl);
    if (!s.active || i < 0) s.active = pl.id;
    saveStore(s);
    toast(`Plan „${pl.name}“ gespeichert`);
    F.edit = null;
    show('pick');
  },
  'pe-delete': async () => {
    if (!(await confirmSheet(`Plan „${F.edit.name}“ löschen? Deine Trainings bleiben erhalten.`))) return;
    const s = store();
    s.plans = s.plans.filter((p) => p.id !== F.edit.id);
    if (s.active === F.edit.id) s.active = s.plans[0]?.id || null;
    saveStore(s);
    F.edit = null;
    show('plans');
  },
  'tr-del-log': async (el) => {
    if (!(await confirmSheet('Dieses Training aus dem Verlauf löschen?'))) return;
    save(LOG_KEY, trLog().filter((x) => x.id !== el.dataset.id));
    show('progress');
  },

  // Trainer: before & during a workout
  'tr-ready': () => {
    const plan = activePlan();
    if (!plan) return show('plans');
    F.ready = { dayIdx: nextDay(plan, trLog()), readiness: 'ok', deload: deloadState(trLog()).due };
    show('ready');
  },
  'tr-mood': (el) => { F.ready.readiness = el.dataset.m; show('ready'); },
  'tr-go': () => {
    const s = store();
    const plan = activePlan(s);
    const r = F.ready;
    const day = plan.days[r.dayIdx];
    start('kraft', { planId: plan.id, dayIdx: r.dayIdx, dayName: day.name, readiness: r.readiness, deload: r.deload, items: buildItems(day, s, r.readiness, r.deload), cur: 0 });
  },
  'tr-free': () => start('kraft'),
  'tr-resume': () => { const d = load(DRAFT_KEY, null); if (d?.tr) start('kraft', d.tr, d.started); },
  'tr-discard': async () => {
    if (!(await confirmSheet('Unterbrochenes Training verwerfen? Die Sätze gehen verloren.', 'Verwerfen'))) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    show('pick');
  },
  'tr-ex': (el) => {
    const i = parseIdx(el);
    if (!F.tr || i < 0 || i >= F.tr.items.length) return;
    F.tr.cur = i;
    F.tr.pending = null;
    renderTrainer();
    renderTime();
  },
  'tr-cues': () => { F.tr.cues = !F.tr.cues; renderTrainer(); },
  'tr-step': (el) => {
    const it = currentItem();
    const ex = exInfo(it.ex, store().custom);
    const input = $(el.dataset.f === 'kg' ? '#tr-kg' : '#tr-reps');
    const step = el.dataset.f === 'kg' ? ex.step || 2.5 : ex.unit === 's' ? 5 : 1;
    const v = Math.max(0, (parseNum(input.value) || 0) + Number(el.dataset.d) * step);
    input.value = el.dataset.f === 'kg' ? fmtKg(v) : String(v);
  },
  'tr-fix': () => {
    const f = F.tr.pending?.fix;
    if (!f) return;
    $('#tr-kg').value = fmtKg(f.kg);
    $('#tr-reps').value = f.reps;
    saveSet();
  },
  'tr-force': () => saveSet(true),
  'tr-del': (el) => {
    const it = currentItem();
    it.done.splice(parseIdx(el, 's'), 1);
    it.next = null;
    it.fb = null;
    F.sets = Math.max(0, F.sets - 1);
    saveDraft();
    renderTrainer();
    renderTime();
  },
  'tr-rest-add': () => { if (F.phase === 'setrest') { F.phaseEnd += 30000; F.phaseLen += 30; renderTime(); } },
  'tr-rest-skip': () => { if (F.phase === 'setrest') { F.phaseEnd = now(); tick(); } },
};

// Inputs inside the fitness screen. Returns true when handled.
export function onFitnessInput(el) {
  if (!el.closest?.('#fitness')) return false;
  if (el.id === 'ft-target') {
    F.targetBpm = +el.value;
    $('#ft-target-v').textContent = `${F.targetBpm} BPM`;
    applyTempo();
    return true;
  }
  if (el.id === 'ft-match') { F.matchTempo = el.checked; if (F.matchTempo && !F.targetBpm) F.targetBpm = bpmOf(player.track || {}) || 128; applyTempo(); renderTime(); return true; }
  if (el.id === 'ft-duck') { F.duckRest = el.checked; if (!el.checked) player.duck(false); return true; }
  if (el.id === 'ft-voice') { F.mute = !el.checked; if (F.mute) speechSynthesis?.cancel(); return true; }
  if (el.id === 'tr-add' && el.value) {
    const s = store();
    const id = el.value;
    F.tr.items.push({ ex: id, sets: 3, sug: suggest(id, { sets: 3 }, trLog(), { goal: s.profile.goal, custom: s.custom, readiness: F.tr.readiness, deload: F.tr.deload }), done: [] });
    F.tr.cur = F.tr.items.length - 1;
    saveDraft();
    renderTrainer();
    renderTime();
    return true;
  }
  if (el.name === 'tr-goal' || el.name === 'tr-level' || el.name === 'tr-wgoal') {
    const s = store();
    if (el.name === 'tr-goal') s.profile.goal = el.value;
    else if (el.name === 'tr-level') s.profile.level = el.value;
    else s.profile.weekGoal = +el.value;
    saveStore(s);
    return true;
  }
  if (el.name === 'tr-day') { F.ready.dayIdx = +el.value; show('ready'); return true; }
  if (el.id === 'tr-deload') { F.ready.deload = el.checked; show('ready'); return true; }
  if (F.edit) {
    if (el.id === 'pe-name') { F.edit.name = el.value; return true; }
    if (el.dataset.peDay !== undefined) { F.edit.days[+el.dataset.peDay].name = el.value; editPlanChanged(false); return true; }
    const range = el.dataset.peLo ?? el.dataset.peHi;
    if (range !== undefined) {
      const [d, i] = range.split('.').map(Number);
      const it = F.edit.days[d].items[i];
      const lo = parseInt(document.querySelector(`[data-pe-lo="${range}"]`).value, 10), hi = parseInt(document.querySelector(`[data-pe-hi="${range}"]`).value, 10);
      if (lo > 0 && hi >= lo && hi <= 100) it.reps = [lo, hi]; else delete it.reps;
      return true;
    }
    if (el.dataset.peAdd !== undefined && el.value) {
      F.edit.days[+el.dataset.peAdd].items.push({ ex: el.value, sets: 3 });
      editPlanChanged();
      return true;
    }
  }
  return el.closest('#fitness') && el.id?.startsWith('tr-');
}

// Test hook
window.__melodyFit = { state: F, tick, fits };
