// Melody catalog: songs streamed from the server, downloadable for offline listening.
import { db } from './db.js';
import { icon } from './icons.js';
import { $, esc, toast, state, hooks, getTrack, plural, fmt } from './core.js';

const CACHE_KEY = 'melody.catalog';
let catalog = null;

export const catalogId = (id) => 'cat:' + id;
export const isCatalog = (t) => t?.source === 'catalog';
export const isOffline = (t) => !isCatalog(t) || !!t.downloaded;
export const playable = (t) => isOffline(t) || navigator.onLine;

export async function loadCatalog() {
  if (catalog) return catalog;
  try {
    const r = await fetch('catalog/catalog.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    catalog = (await r.json()).tracks;
    localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
  } catch {
    try { catalog = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch { catalog = []; }
  }
  return catalog;
}

export const catalogEntry = (id) => catalog?.find((c) => c.id === id);

async function fetchBlob(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.blob();
}

// Makes a catalog song a normal library track (metadata, cover, lyrics). Audio stays streamed until downloaded.
export async function ensureTrack(c) {
  const id = catalogId(c.id);
  const have = getTrack(id);
  if (have) return have;
  const [cover, lrc] = await Promise.all([
    fetchBlob('catalog/' + c.cover).catch(() => null),
    c.lyrics ? fetch('catalog/' + c.lyrics).then((r) => (r.ok ? r.text() : '')).catch(() => '') : '',
  ]);
  const t = {
    id, source: 'catalog', catalogId: c.id, url: 'catalog/' + c.audio,
    title: c.title, artist: c.artist, albumArtist: '', album: c.album, year: c.year || '', genre: c.genre || '',
    trackNo: 0, duration: c.duration, bpm: c.bpm || 0, cover, size: c.size || 0, fileName: c.audio, type: 'audio/mpeg',
    addedAt: Date.now(), favorite: false, plays: 0, downloaded: false,
    lyrics: lrc ? { synced: lrc, plain: '', source: 'katalog' } : undefined,
  };
  await db.put('tracks', t);
  state.tracks.push(t);
  state.map.set(id, t);
  return t;
}

export async function ensureTracks(entries) {
  const out = [];
  for (const c of entries) out.push(await ensureTrack(c));
  return out;
}

// ---------- Downloads ----------
const active = new Map(); // id -> progress 0..1

async function downloadOne(t, onProgress) {
  const r = await fetch(t.url);
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || t.size || 0;
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const blob = new Blob(chunks, { type: r.headers.get('content-type') || 'audio/mpeg' });
  await db.put('files', blob, t.id);
  t.downloaded = true;
  t.size = blob.size;
  await db.put('tracks', t);
}

export async function download(tracks) {
  const todo = tracks.filter((t) => isCatalog(t) && !t.downloaded && !active.has(t.id));
  if (!todo.length) {
    toast(tracks.length > 1 ? 'Schon alles offline verfügbar' : 'Schon heruntergeladen');
    return;
  }
  if (!navigator.onLine) {
    toast('Zum Herunterladen brauchst du Internet.');
    return;
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  let ok = 0;
  for (const [i, t] of todo.entries()) {
    active.set(t.id, 0);
    try {
      await downloadOne(t, (p) => {
        active.set(t.id, p);
        toast(`Lade herunter ${todo.length > 1 ? `${i + 1}/${todo.length} ` : ''}· ${esc(t.title)} ${Math.round(p * 100)} %`, true);
        updateRow(t.id);
      });
      ok++;
    } catch (e) {
      toast(`Download fehlgeschlagen: ${t.title}`);
      console.warn(e);
    } finally {
      active.delete(t.id);
      updateRow(t.id);
    }
  }
  if (ok) toast(`${plural(ok, 'Titel', 'Titel')} offline verfügbar ✓`);
  hooks.rerender();
}

export async function removeDownload(t) {
  if (!isCatalog(t) || !t.downloaded) return;
  await db.del('files', t.id);
  t.downloaded = false;
  await db.put('tracks', t);
  toast('Download entfernt – der Titel wird wieder gestreamt.');
  hooks.rerender();
}

export function downloadedBytes() {
  return state.tracks.filter((t) => isCatalog(t) && t.downloaded).reduce((s, t) => s + (t.size || 0), 0);
}

export const mb = (b) => (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';

// Small status icon in track rows.
export function statusBadge(t) {
  if (!isCatalog(t)) return '';
  if (active.has(t.id)) return `<span class="dl-badge busy" title="Wird geladen">${Math.round(active.get(t.id) * 100)}%</span>`;
  return t.downloaded
    ? `<span class="dl-badge ok" title="Offline verfügbar">${icon('downloadDone')}</span>`
    : `<span class="dl-badge" title="Wird gestreamt">${icon('cloud')}</span>`;
}

function updateRow(id) {
  const t = getTrack(id);
  document.querySelectorAll(`.track[data-id="${CSS.escape(id)}"] .dl-slot`).forEach((el) => { el.innerHTML = statusBadge(t); });
}

// ---------- View: Entdecken ----------
export function catalogCards(list, key) {
  return `<div class="scroller">${list.map((c, i) => `
    <button class="card" data-action="cat-play" data-index="${i}" data-key="${key}">
      <div class="cover md"><img src="catalog/${esc(c.cover)}" alt="" loading="lazy"></div>
      <div class="t">${esc(c.title)}</div><div class="a">${esc(c.artist)}</div>
    </button>`).join('')}</div>`;
}

export function viewDiscover() {
  if (!catalog) {
    loadCatalog().then(() => { if (state.route.view === 'discover') hooks.render(); });
    return '<h1>Entdecken</h1><div class="empty">Katalog wird geladen …</div>';
  }
  if (!catalog.length) return `<h1>Entdecken</h1><div class="empty">Der Katalog ist gerade nicht erreichbar${navigator.onLine ? '' : ' (offline)'}.</div>`;
  const rows = catalog.map((c, i) => {
    const t = getTrack(catalogId(c.id));
    return `<div class="track${t && !playable(t) ? ' unavailable' : ''}" data-action="cat-play" data-key="all" data-index="${i}" data-id="${catalogId(c.id)}">
      <span class="num">${i + 1}</span>
      <div class="cover sm"><img src="catalog/${esc(c.cover)}" alt="" loading="lazy"></div>
      <div class="meta"><div class="t">${esc(c.title)}</div><div class="a">${esc(c.artist)} · ${esc(c.genre)}</div></div>
      <span class="dur"><span class="dl-slot">${t ? statusBadge(t) : ''}</span> ${fmt(c.duration)}</span>
      <button class="icon-btn" data-action="cat-download" data-index="${i}" aria-label="Herunterladen">${icon(t?.downloaded ? 'downloadDone' : 'download')}</button>
    </div>`;
  }).join('');
  const total = catalog.reduce((s, c) => s + (c.size || 0), 0);
  return `<section class="hero discover-hero">
      <div><div class="kind">Melody Katalog</div><h1>Entdecken</h1>
      <p class="sub">Streamen oder herunterladen und offline hören – im Flugzeug, in der U-Bahn, überall.</p>
      <div class="hero-actions">
        <button class="btn btn-primary" data-action="cat-play" data-key="all" data-index="0">${icon('play')}Alle abspielen</button>
        <button class="btn" data-action="cat-download-all">${icon('download')}Alle herunterladen (${mb(total)})</button>
      </div></div></section>
    ${catalogCards(catalog, 'all')}
    <h2>Alle Songs</h2><div class="tracks">${rows}</div>
    <p class="muted small">Demo-Katalog: Diese Songs wurden eigens für Melody komponiert. Lyrics zum Mitsingen sind dabei 🎤</p>`;
}

export const catalogActions = {
  'cat-play': async (el) => {
    const list = await loadCatalog();
    const tracks = await ensureTracks(list);
    const t = tracks[+el.dataset.index || 0];
    if (t && !playable(t)) { toast('Offline – dieser Titel ist nicht heruntergeladen.'); return; }
    const ids = tracks.filter(playable).map((x) => x.id);
    hooks.play(ids, Math.max(0, ids.indexOf(t?.id)));
  },
  'cat-download': async (el) => {
    const c = (await loadCatalog())[+el.dataset.index];
    const t = await ensureTrack(c);
    if (t.downloaded) removeDownload(t);
    else download([t]);
  },
  'cat-download-all': async () => download(await ensureTracks(await loadCatalog())),
  'dl-track': async () => {
    const t = getTrack(state.menu?.id);
    hooks.closeSheet();
    if (t?.downloaded) removeDownload(t);
    else if (t) download([t]);
  },
};
