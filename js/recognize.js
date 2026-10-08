// "Welcher Song ist das?" – Melody's own recognition for the Melody catalog (works offline),
// plus world-wide recognition through the server (AudD), like Shazam.
import { api, DEMO } from './api.js';
import { player } from './player.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, hooks, getTrack, go } from './core.js';
import { loadCatalog, ensureTrack, catalogEntry, download, catalogId } from './catalog.js';
import { hashes, buildIndex, match, toMono11k, SR } from './fingerprint.js';

const HIST_KEY = 'melody.recognized';
const R = { busy: false, stage: '', level: 0, result: null, stop: null };

let fpIndex = null;
async function catalogIndex() {
  if (fpIndex) return fpIndex;
  const r = await fetch('catalog/fingerprints.json');
  if (!r.ok) throw new Error('Fingerabdrücke nicht verfügbar');
  const data = await r.json();
  const songs = data.songs.map((s) => ({ id: s.id, hashes: Array.from({ length: s.hashes.length / 2 }, (_, i) => [s.hashes[2 * i], s.hashes[2 * i + 1]]) }));
  fpIndex = { songs, index: buildIndex(songs) };
  return fpIndex;
}

function history() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function remember(item) {
  const h = history().filter((x) => !(x.title === item.title && x.artist === item.artist));
  h.unshift({ ...item, at: Date.now() });
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 50))); } catch { /* ignore */ }
}

// 16-bit mono WAV for the world-wide lookup.
function wav(pcm) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}

async function tryCatalog(pcm) {
  const { songs, index } = await catalogIndex();
  const m = match(index, songs, hashes(pcm));
  if (!m) return null;
  const c = catalogEntry(m.id) || (await loadCatalog()).find((x) => x.id === m.id);
  if (!c) return null;
  return { source: 'melody', catalogId: c.id, title: c.title, artist: c.artist, album: c.album, cover: 'catalog/' + c.cover, offset: Math.max(0, m.offsetSec), confidence: m.confidence, offsetSure: m.offsetSure };
}

async function tryWorld(pcm) {
  if (DEMO) return { error: 'Die weltweite Erkennung ist in der Demo nicht verbunden.' };
  try {
    const res = await fetch('api/recognize', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(pcm), credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || 'Erkennung nicht erreichbar.' };
    return data.found ? { source: 'world', ...data } : null;
  } catch {
    return { error: 'Keine Verbindung – offline erkennt Melody nur Songs aus dem Melody-Katalog.' };
  }
}

async function identify(pcm) {
  R.stage = 'Wird erkannt …';
  render();
  let result = await tryCatalog(pcm).catch(() => null);
  if (!result) {
    const w = await tryWorld(pcm);
    if (w?.error) result = { none: true, note: w.error };
    else result = w || { none: true };
  }
  R.result = result;
  if (!result.none) {
    toast(`🎵 ${result.title} – ${result.artist}`);
    remember({ title: result.title, artist: result.artist, cover: result.cover, source: result.source, catalogId: result.catalogId, links: result.links });
    if ('vibrate' in navigator) navigator.vibrate(80);
  }
  R.busy = false;
  R.stage = '';
  render();
}

// Record from the microphone; tries the Melody catalog after 3, 5 and 7 s and stops early on a hit.
export async function listen() {
  if (R.busy) { R.stop?.(); return; }
  if (state.route.view !== 'recognize' && !document.querySelector('#drive:not([hidden])')) go('recognize');
  R.busy = true;
  R.result = null;
  R.stage = 'Hört zu …';
  const recStart = Date.now();
  render();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    R.busy = false;
    R.stage = '';
    R.result = { none: true, note: e.name === 'NotAllowedError' ? 'Mikrofon-Zugriff wurde abgelehnt. Erlaube das Mikrofon oder wähle eine Aufnahme aus.' : 'Kein Mikrofon gefunden.' };
    render();
    return;
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let len = 0, finished = false;
  player.duck(true);
  const finish = async (pcm) => {
    if (finished) return;
    finished = true;
    proc.disconnect(); src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    player.duck(false);
    R.stop = null;
    if (pcm) await identify(pcm);
  };
  R.stop = () => { R.busy = false; R.stage = ''; finish(null); render(); };
  const collect = () => {
    const all = new Float32Array(len);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return toMono11k([all], ctx.sampleRate);
  };
  let nextCheck = 3;
  proc.onaudioprocess = async (e) => {
    if (finished) return;
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(d);
    len += d.length;
    let peak = 0;
    for (let i = 0; i < d.length; i += 16) peak = Math.max(peak, Math.abs(d[i]));
    R.level = R.level * 0.6 + peak * 0.4;
    const el = $('#rc-btn');
    if (el) el.style.setProperty('--lvl', Math.min(1, R.level * 4).toFixed(2));
    const secs = len / ctx.sampleRate;
    if (secs >= nextCheck && nextCheck < 9) {
      nextCheck += 2;
      const hit = await tryCatalog(collect()).catch(() => null);
      // Stop early only when song *and* position are certain; otherwise keep listening.
      if (hit && hit.offsetSure && !finished) {
        finished = true;
        proc.disconnect(); src.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        player.duck(false);
        R.result = { ...hit, recordedAt: recStart };
        remember({ title: hit.title, artist: hit.artist, cover: hit.cover, source: 'melody', catalogId: hit.catalogId });
        toast(`🎵 ${hit.title} – ${hit.artist}`);
        if ('vibrate' in navigator) navigator.vibrate(80);
        R.busy = false;
        render();
      }
    }
    if (secs >= 9) finish(collect()).then(() => { if (R.result && !R.result.none) R.result.recordedAt = recStart; });
  };
  src.connect(proc);
  proc.connect(ctx.destination);
}

// Recognise a recording file (no microphone needed).
async function fromFile(file) {
  R.busy = true;
  R.result = null;
  R.stage = 'Aufnahme wird gelesen …';
  render();
  try {
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const chans = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    let pcm = toMono11k(chans, audio.sampleRate);
    if (pcm.length > SR * 20) pcm = pcm.subarray(0, SR * 20);
    await identify(pcm);
  } catch {
    R.busy = false;
    R.result = { none: true, note: 'Diese Datei konnte nicht gelesen werden.' };
    render();
  }
}

// ---------- View ----------
function resultHTML() {
  const r = R.result;
  if (!r) return '';
  if (r.none) {
    return `<div class="rc-result none"><b>Kein Treffer</b><p>${esc(r.note || 'Diesen Song kennt Melody leider nicht. Halte das Handy näher an die Musik und versuche es noch einmal.')}</p></div>`;
  }
  const t = r.catalogId ? getTrack(catalogId(r.catalogId)) : null;
  const links = r.links || {};
  return `<div class="rc-result">
    <div class="rc-cover">${r.cover ? `<img src="${esc(r.cover)}" alt="">` : icon('note')}</div>
    <div class="rc-info">
      <span class="rc-src">${r.source === 'melody' ? `${icon('check')} Im Melody-Katalog` : `${icon('explore')} Erkannt`}</span>
      <h2>${esc(r.title)}</h2><p>${esc(r.artist)}${r.album ? ` · ${esc(r.album)}` : ''}</p>
      ${r.source === 'melody' ? `<p class="small muted">Gerade bei ${Math.floor(r.offset / 60)}:${String(Math.floor(r.offset % 60)).padStart(2, '0')}</p>` : ''}
      <div class="row">
        ${r.source === 'melody' ? `
          <button class="btn btn-primary" data-action="rc-play">${icon('play')}Hier weiterhören</button>
          <button class="btn" data-action="rc-download">${icon(t?.downloaded ? 'downloadDone' : 'download')}${t?.downloaded ? 'Offline verfügbar' : 'Herunterladen'}</button>
          <button class="btn" data-action="rc-sing">${icon('mic')}Mitsingen</button>`
        : `
          ${links.apple ? `<a class="btn" href="${esc(links.apple)}" target="_blank" rel="noopener">Apple Music</a>` : ''}
          ${links.spotify ? `<a class="btn" href="${esc(links.spotify)}" target="_blank" rel="noopener">Spotify</a>` : ''}
          ${links.deezer ? `<a class="btn" href="${esc(links.deezer)}" target="_blank" rel="noopener">Deezer</a>` : ''}
          <button class="btn" data-action="rc-wish">${icon('heartOutline')}Auf die Wunschliste</button>`}
      </div>
      ${r.source === 'world' ? '<p class="small muted">Dieser Song ist noch nicht im Melody-Katalog. Wünsch ihn dir – beliebte Wünsche nehmen wir zuerst auf.</p>' : ''}
    </div></div>`;
}

export function viewRecognize() {
  const h = history();
  return `<div class="rc">
    <h1>Welcher Song ist das?</h1>
    <p class="sub">Halte dein Handy in Richtung Musik. Songs aus dem Melody-Katalog erkennt Melody sogar offline.</p>
    <button class="rc-btn${R.busy ? ' busy' : ''}" id="rc-btn" data-action="recognize" aria-label="Song erkennen">
      <span class="rc-wave">${icon('waves')}</span><span class="rc-label">${R.busy ? esc(R.stage) : 'Tippen zum Erkennen'}</span>
    </button>
    <label class="rc-file">${icon('upload')} Oder eine Aufnahme auswählen<input type="file" id="rc-file" accept="audio/*,video/*" hidden></label>
    <div id="rc-result">${resultHTML()}</div>
    ${h.length ? `<h2>Zuletzt erkannt <button class="chip" data-action="rc-clear">Leeren</button></h2><div class="tracks">${h.map((x, i) => `
      <div class="track rc-hist" data-action="rc-open" data-i="${i}">
        <div class="cover sm">${x.cover ? `<img src="${esc(x.cover)}" alt="">` : icon('note')}</div>
        <div class="meta"><div class="t">${esc(x.title)}</div><div class="a">${esc(x.artist)} · ${new Date(x.at).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${x.wish ? ' · ♡ gewünscht' : ''}</div></div>
        <span class="dur">${x.source === 'melody' ? icon('check') : ''}</span></div>`).join('')}</div>` : ''}
  </div>`;
}

function render() {
  if (state.route.view === 'recognize' && $('.rc')) {
    const main = $('#main');
    const top = main.scrollTop;
    hooks.render();
    main.scrollTop = top;
  }
  const fab = $('#rc-fab');
  if (fab) fab.classList.toggle('busy', R.busy);
}

export const recognizeActions = {
  recognize: () => listen(),
  'rc-play': async () => {
    const c = catalogEntry(R.result.catalogId) || (await loadCatalog()).find((x) => x.id === R.result.catalogId);
    const t = await ensureTrack(c);
    // The song kept playing since the recording started – continue where it is *now*.
    const pos = R.result.offset + (Date.now() - (R.result.recordedAt || Date.now())) / 1000;
    await player.playList([t.id], 0, pos);
  },
  'rc-download': async () => {
    const c = catalogEntry(R.result.catalogId) || (await loadCatalog()).find((x) => x.id === R.result.catalogId);
    await download([await ensureTrack(c)]);
    render();
  },
  'rc-sing': async () => {
    await recognizeActions['rc-play']();
    hooks.sing?.();
  },
  'rc-wish': () => {
    const h = history();
    const item = h.find((x) => x.title === R.result.title && x.artist === R.result.artist);
    if (item) item.wish = true;
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch { /* ignore */ }
    if (!DEMO) api('/wishes', { method: 'POST', body: { title: R.result.title, artist: R.result.artist } }).catch(() => {});
    toast('Auf deiner Wunschliste ♡');
    render();
  },
  'rc-open': (el) => {
    const x = history()[+el.dataset.i];
    if (x) { R.result = { ...x, offset: 0 }; render(); }
  },
  'rc-clear': () => { try { localStorage.removeItem(HIST_KEY); } catch { /* ignore */ } R.result = null; render(); },
};

export function onRecognizeChange(el) {
  if (el.id !== 'rc-file' || !el.files?.[0]) return false;
  fromFile(el.files[0]).finally(() => { el.value = ''; });
  return true;
}

export const isRecognizing = () => R.busy;
