// Lyrics (synced LRC or plain), the lyrics panel in the player and the full-screen sing-along mode.
import { api } from './api.js';
import { db } from './db.js';
import { player, isIOS } from './player.js';
import { icon, hydrateIcons, setIcon } from './icons.js';
import { $, esc, toast, getTrack, openSheet, closeSheet, hue, setRangeP, state } from './core.js';

const DAY = 86400000;
const parsed = new Map(); // track id -> { lines, plain }

export function parseLRC(text) {
  const lines = [];
  let offset = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: Number(m[1]) * 60 + parseFloat(m[2].replace(':', '.')) - offset, text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

const hasStamps = (text) => /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text);

function lyricsOf(t) {
  if (!t?.lyrics || t.lyrics.none) return null;
  let p = parsed.get(t.id);
  if (!p || p.src !== t.lyrics) {
    const lines = t.lyrics.synced ? parseLRC(t.lyrics.synced) : [];
    p = { src: t.lyrics, lines: lines.length ? lines : null, plain: t.lyrics.plain || '' };
    parsed.set(t.id, p);
  }
  return p.lines || p.plain ? p : null;
}

const UNKNOWN = /^Unbekannte[rs]? /;

// Looks up lyrics online (once per week if nothing was found) and stores them with the track.
export async function ensureLyrics(t, force = false) {
  if (!t) return null;
  const have = lyricsOf(t);
  if (have && !force) return have;
  if (!force && t.lyrics?.none && t.lyrics.checkedAt > Date.now() - 7 * DAY) return null;
  if (UNKNOWN.test(t.artist)) return null;
  try {
    const q = new URLSearchParams({ artist: t.artist, title: t.title, album: UNKNOWN.test(t.album) ? '' : t.album, duration: String(Math.round(t.duration || 0)) });
    const r = await api('/lyrics?' + q);
    t.lyrics = r.found ? { synced: r.synced || '', plain: r.plain || '', source: 'lrclib' } : { none: true, checkedAt: Date.now() };
    await db.put('tracks', t);
  } catch (e) {
    if (force) toast(e.message);
    return null;
  }
  return lyricsOf(t);
}

export async function saveLyrics(t, text) {
  text = String(text || '').trim();
  t.lyrics = !text ? { none: true, checkedAt: Date.now() }
    : hasStamps(text) ? { synced: text, plain: '', source: 'eigene' } : { synced: '', plain: text, source: 'eigene' };
  await db.put('tracks', t);
  parsed.delete(t.id);
}

// .lrc files dropped in with the music are matched to tracks by file name.
export async function attachLrcFiles(files, tracks) {
  let n = 0;
  const base = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();
  for (const f of files) {
    const t = tracks.find((x) => base(x.fileName || '') === base(f.name));
    if (!t) continue;
    await saveLyrics(t, await f.text());
    t.lyrics.source = 'datei';
    await db.put('tracks', t);
    n++;
  }
  return n;
}

export function editLyricsSheet(t) {
  state.menu = { id: t.id };
  const cur = t.lyrics && !t.lyrics.none ? t.lyrics.synced || t.lyrics.plain : '';
  openSheet(`<h3>Lyrics bearbeiten</h3><form class="stack" data-form="lyrics" style="padding:10px">
    <p class="muted small">Einfacher Text oder LRC mit Zeitmarken, z. B. <code>[00:12.50] Erste Zeile</code>. Mit Zeitmarken läuft der Text beim Mitsingen synchron.</p>
    <textarea class="input plain" name="text" rows="12" placeholder="Songtext hier einfügen …">${esc(cur)}</textarea>
    <div class="row" style="justify-content:space-between">
      <button type="button" class="btn" data-action="lyrics-search">${icon('search')}Online suchen</button>
      <span class="row"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
      <button class="btn btn-primary">Speichern</button></span>
    </div></form>`);
}

// ---------- Rendering ----------
function linesHTML(p) {
  if (p.lines) {
    return p.lines.map((l, i) => `<p class="ly${l.text ? '' : ' gap'}" data-action="ly-seek" data-i="${i}">${esc(l.text) || '♪'}</p>`).join('');
  }
  return `<div class="ly-plain">${esc(p.plain)}</div><p class="muted small center">Ohne Zeitmarken – der Text scrollt nicht automatisch mit.</p>`;
}

function noLyricsHTML(t) {
  return `<div class="ly-empty">${icon('lyrics')}<p>Für „${esc(t.title)}“ wurden keine Lyrics gefunden.</p>
    <button class="btn" data-action="lyrics-edit" data-id="${t.id}">${icon('edit')}Lyrics hinzufügen</button></div>`;
}

let npLyricsOpen = false;
let lastIdx = -1;

export async function renderNpLyrics() {
  const box = $('#np-lyrics');
  const t = player.mode === 'library' ? player.track : null;
  $('#np-cover').hidden = npLyricsOpen;
  $('#np-viz').hidden = npLyricsOpen;
  box.hidden = !npLyricsOpen;
  document.querySelectorAll('[data-action=np-lyrics]').forEach((b) => b.classList.toggle('on', npLyricsOpen));
  if (!npLyricsOpen) return;
  if (!t) { box.innerHTML = '<div class="ly-empty">Beim Radio gibt es keine Lyrics.</div>'; return; }
  box.dataset.id = t.id;
  box.innerHTML = '<div class="ly-empty">Lyrics werden gesucht …</div>';
  const p = await ensureLyrics(t);
  if (box.dataset.id !== t.id) return;
  box.innerHTML = p ? linesHTML(p) : noLyricsHTML(t);
  hydrateIcons(box);
  lastIdx = -1;
  startLoop();
}

export function toggleNpLyrics() {
  npLyricsOpen = !npLyricsOpen;
  renderNpLyrics();
}

// ---------- Sing-along mode ----------
const sing = { open: false, vocals: 30, sung: new Set(), lastLine: -1 };

export async function openSing() {
  if (player.mode !== 'library' || !player.track) {
    toast('Spiele zuerst einen Titel aus deiner Bibliothek ab.');
    return;
  }
  sing.open = true;
  const el = $('#sing');
  el.hidden = false;
  sing.fxBefore = player.borrowFx();
  player.setVocal(100 - sing.vocals);
  await renderSing();
}

export function closeSing() {
  sing.open = false;
  $('#sing').hidden = true;
  player.setVocal(0);
  player.disableMic();
  player.returnFx(sing.fxBefore); // e.g. on the iPhone: no effects = music keeps playing with the screen locked
  sing.fxBefore = undefined;
}

export async function renderSing() {
  const el = $('#sing');
  const t = player.track;
  if (!sing.open || !t) return;
  sing.sung = new Set();
  sing.lastLine = -1;
  el.style.setProperty('--h', hue(t.album));
  el.dataset.id = t.id;
  el.innerHTML = `
    <header class="sing-head">
      <button class="icon-btn" data-action="sing-close" aria-label="Schließen">${icon('down')}</button>
      <div class="meta center"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>
      <button class="icon-btn" data-action="lyrics-edit" data-id="${t.id}" aria-label="Lyrics bearbeiten">${icon('edit')}</button>
    </header>
    <div class="sing-stage" id="sing-stage"><div class="ly-empty">Lyrics werden gesucht …</div></div>
    <div class="sing-bar"><div id="sing-progress"></div></div>
    <div class="sing-controls">
      <button class="icon-btn lg" data-action="prev" aria-label="Zurück">${icon('prev')}</button>
      <button class="icon-btn play xl" data-action="toggle" id="sing-play" aria-label="Abspielen">${icon(player.playing ? 'pause' : 'play')}</button>
      <button class="icon-btn lg" data-action="next" aria-label="Weiter">${icon('next')}</button>
    </div>
    <div class="sing-tools">
      ${isIOS ? '' : `<label class="sing-slider"><span>${icon('person')} Originalstimme <b id="sing-vocal-val">${sing.vocals} %</b></span>
        <input type="range" id="sing-vocals" min="0" max="100" step="5" value="${sing.vocals}"></label>
      <button class="chip${player.mic ? ' on' : ''}" data-action="sing-mic">${icon('mic')}<span>${player.mic ? 'Mikro an' : 'Mikrofon'}</span></button>`}
      <div class="mic-meter" ${player.mic ? '' : 'hidden'}><i id="mic-level"></i></div>
      <div class="sing-score" id="sing-score">${player.mic ? 'Sing los! 🎤' : ''}</div>
    </div>
    <p class="muted small center">Tipp: Kopfhörer auf, Originalstimme runter – und du bist der Star.${player.analyser ? '' : ' Die Stimmentfernung braucht aktivierte Audio-Effekte.'}</p>`;
  hydrateIcons(el);
  if ($('#sing-vocals')) setRangeP($('#sing-vocals'));
  const p = await ensureLyrics(t);
  if (!sing.open || el.dataset.id !== t.id) return;
  const stage = $('#sing-stage');
  if (!p) {
    stage.innerHTML = noLyricsHTML(t);
    hydrateIcons(stage);
  } else if (!p.lines) {
    stage.innerHTML = `<div class="ly-plain big">${esc(p.plain)}</div>`;
  } else {
    stage.innerHTML = `<div class="sing-line prev" id="sl-prev"></div>
      <div class="sing-line cur" id="sl-cur"></div>
      <div class="sing-line next" id="sl-next"></div>
      <div class="sing-line next2" id="sl-next2"></div>`;
  }
  lastIdx = -1;
  startLoop();
}

export function updateSingState() {
  if (!sing.open) return;
  const b = $('#sing-play');
  if (b) setIcon(b, player.playing ? 'pause' : 'play');
  if (player.playing) startLoop();
}

function currentIndex(lines, time) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function tickSing(p, time) {
  const lines = p.lines;
  const i = currentIndex(lines, time + 0.1);
  const cur = lines[i];
  const next = lines[i + 1];
  const curEl = $('#sl-cur');
  if (!curEl) return;
  if (i !== sing.lastLine) {
    sing.lastLine = i;
    $('#sl-prev').textContent = lines[i - 1]?.text || '';
    $('#sl-next').textContent = next?.text || '';
    $('#sl-next2').textContent = lines[i + 2]?.text || '';
    curEl.innerHTML = cur?.text ? `<span class="fill">${esc(cur.text)}</span>` : '';
  }
  // Countdown dots before the next sung line.
  if ((!cur || !cur.text) && next && next.t - time < 4 && next.t - time > 0) {
    const n = Math.ceil(next.t - time);
    curEl.innerHTML = `<span class="countdown">${'●'.repeat(n)}${'○'.repeat(Math.max(0, 3 - n))}</span>`;
  }
  if (cur?.text) {
    const end = next ? next.t : cur.t + 4;
    const prog = Math.max(0, Math.min(1, (time - cur.t) / Math.max(0.5, end - cur.t)));
    curEl.querySelector('.fill')?.style.setProperty('--p', (prog * 100).toFixed(1) + '%');
    if (player.mic && player.micLevel() > 0.03) sing.sung.add(i);
  }
  if (player.mic) {
    const lvl = Math.min(1, player.micLevel() * 8);
    $('#mic-level')?.style.setProperty('width', (lvl * 100).toFixed(0) + '%');
    const passed = lines.filter((l, k) => l.text && k < i).length;
    if (passed > 0) {
      const sungPassed = [...sing.sung].filter((k) => k < i).length;
      const pct = Math.round((sungPassed / passed) * 100);
      $('#sing-score').textContent = `Mitsing-Quote ${pct} % ${pct >= 80 ? '🔥' : pct >= 50 ? '🎤' : '🎵'}`;
    }
  }
}

function tickPanel(p, time) {
  const box = $('#np-lyrics');
  if (!p.lines) return;
  const i = currentIndex(p.lines, time + 0.15);
  if (i === lastIdx) return;
  lastIdx = i;
  const els = box.querySelectorAll('.ly');
  els.forEach((e, k) => { e.classList.toggle('active', k === i); e.classList.toggle('past', k < i); });
  const line = els[i];
  if (line) box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' });
}

let looping = false;
function startLoop() {
  if (looping) return;
  looping = true;
  const frame = () => {
    const panel = npLyricsOpen && !$('#now-playing').hidden;
    if ((!sing.open && !panel) || player.mode !== 'library' || !player.track) { looping = false; return; }
    const p = lyricsOf(player.track);
    const time = player.el.currentTime;
    if (p) {
      if (sing.open && p.lines) tickSing(p, time);
      if (panel) tickPanel(p, time);
    }
    if (sing.open) {
      const d = player.el.duration;
      const bar = $('#sing-progress');
      if (bar && d) bar.style.width = (time / d) * 100 + '%';
    }
    if (player.el.paused && !player.mic) { looping = false; return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function onTrackChange() {
  if (sing.open) {
    if (player.mode !== 'library' || !player.track) closeSing();
    else renderSing();
  }
  if (npLyricsOpen) renderNpLyrics();
}

export function onNowPlayingOpen() {
  if (npLyricsOpen) renderNpLyrics();
}

// ---------- Actions ----------
export const lyricsActions = {
  'np-lyrics': () => toggleNpLyrics(),
  sing: () => openSing(),
  'sing-close': () => closeSing(),
  'ly-seek': (el) => {
    const p = lyricsOf(player.track);
    const l = p?.lines?.[+el.dataset.i];
    if (l) player.seek(l.t);
  },
  'lyrics-edit': (el) => editLyricsSheet(getTrack(el.dataset.id) || player.track),
  'lyrics-search': async () => {
    const t = getTrack(state.menu?.id);
    if (!t) return;
    toast('Suche Lyrics …', true);
    const p = await ensureLyrics(t, true);
    toast(p ? 'Lyrics gefunden!' : 'Leider nichts gefunden.');
    if (p) {
      closeSheet();
      onTrackChange();
    }
  },
  'sing-mic': async () => {
    try {
      if (player.mic) player.disableMic();
      else {
        await player.enableMic();
        toast('Mikrofon an – bitte Kopfhörer benutzen, sonst gibt es Rückkopplungen.');
      }
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Mikrofon-Zugriff wurde abgelehnt.' : e.message);
    }
    renderSing();
  },
};

export const lyricsForms = {
  lyrics: async (form) => {
    const t = getTrack(state.menu?.id);
    if (!t) return;
    await saveLyrics(t, form.text.value);
    closeSheet();
    toast('Lyrics gespeichert');
    onTrackChange();
  },
};

export function onLyricsInput(el) {
  if (el.id !== 'sing-vocals') return false;
  sing.vocals = +el.value;
  player.setVocal(100 - sing.vocals);
  $('#sing-vocal-val').textContent = `${sing.vocals} %`;
  setRangeP(el);
  return true;
}

export const isSingOpen = () => sing.open;
