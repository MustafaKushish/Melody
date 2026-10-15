// Jamendo Music API Integration (jamendo.com)
// Over 600,000 free royalty-free tracks for streaming.
import { icon, hydrateIcons } from './icons.js';
import { $, esc, state, hooks, coverHTML } from './core.js';
import { player } from './player.js';

// Default public client ID for Jamendo REST API v3.0 (users can also provide their own client ID)
const DEFAULT_CLIENT_ID = 'c7e871bf';
export const JAMENDO_PREFIX = 'jam:';

export const JAMENDO_GENRES = [
  ['', 'Alle'], ['pop', 'Pop'], ['rock', 'Rock'], ['electronic', 'Electronic'], ['hiphop', 'Hip-Hop'],
  ['indie', 'Indie'], ['jazz', 'Jazz'], ['classical', 'Klassik'], ['ambient', 'Ambient'],
  ['metal', 'Metal'], ['latin', 'Latin'], ['reggae', 'Reggae'], ['folk', 'Folk'],
];

const J = {
  clientId: localStorage.getItem('melody.jamendo_client_id') || DEFAULT_CLIENT_ID,
  genre: '',
  list: null,
  error: '',
  loading: false,
  req: 0,
  cache: new Map(),
};

async function get(path, params = {}) {
  const u = new URL('https://api.jamendo.com/v3.0' + path);
  u.searchParams.set('client_id', J.clientId);
  u.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) u.searchParams.set(k, v);

  const key = u.toString();
  const hit = J.cache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60000) return hit.data;
  if (!navigator.onLine) throw new Error('Keine Internetverbindung.');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(key, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Jamendo antwortet nicht (${r.status}).`);
    const res = await r.json();
    if (res.headers && res.headers.status !== 'success') {
      throw new Error(res.headers.error_message || 'Jamendo API Fehler');
    }
    const data = res.results;
    J.cache.set(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Jamendo antwortet gerade nicht.' : e.message === 'Failed to fetch' ? 'Jamendo ist gerade nicht erreichbar.' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

export function toTrack(x) {
  const id = JAMENDO_PREFIX + x.id;
  const have = state.map.get(id);
  if (have) return have;

  const t = {
    id, source: 'jamendo', jamendoId: String(x.id), temp: true,
    url: x.audio || x.audiodownload || '',
    title: x.name || 'Ohne Titel',
    artist: x.artist_name || 'Jamendo Artist',
    albumArtist: '',
    album: x.album_name || 'Jamendo',
    year: String(x.releasedate || '').slice(0, 4),
    genre: J.genre || 'Jamendo',
    mood: '',
    trackNo: 0,
    duration: Number(x.duration) || 0,
    cover: null,
    artwork: x.image || x.album_image || '',
    permalink: x.shareurl || x.shorturl || 'https://www.jamendo.com',
    plays: 0,
    favorite: false,
    downloaded: false,
    addedAt: Date.now(),
    size: 0,
    fileName: '',
    type: 'audio/mpeg',
  };
  state.map.set(id, t);
  return t;
}

export async function getPopular(genre = '', limit = 30) {
  const params = {
    limit,
    order: 'popularity_week',
    include: 'musicinfo',
    audioformat: 'mp32',
  };
  if (genre) params.fuzzytags = genre;
  const list = await get('/tracks/', params);
  return (list || []).map(toTrack);
}

export async function search(q, limit = 20) {
  const params = {
    namesearch: q,
    limit,
    order: 'relevance',
    include: 'musicinfo',
    audioformat: 'mp32',
  };
  const list = await get('/tracks/', params);
  return (list || []).map(toTrack);
}

const note = `<p class="aud-note">${icon('waves')}<span>Musik von <a href="https://www.jamendo.com" target="_blank" rel="noopener">Jamendo</a> – über 600.000+ lizenzfreie Songs von unabhängigen Künstler:innen.</span></p>`;

export function viewJamendo() {
  return `<div class="aud-hero">
      <div class="kind">${icon('waves')} Jamendo Musik</div>
      <h1>Jamendo Katalog</h1>
      <p class="sub">Entdecke über 600.000 freie, lizenzfreie Tracks für Streaming & Inspiration.</p>
      <form data-form="jamendo-search" role="search"><label class="search">${icon('search')}<input class="input" id="jam-q" type="search" placeholder="Song, Artist oder Stimmung auf Jamendo suchen …" autocomplete="off" enterkeyhint="search"></label></form>
    </div>
    <div id="jam-search"></div>
    <div class="tabs aud-genres">${JAMENDO_GENRES.map(([g, l]) => `<button class="chip${J.genre === g ? ' on' : ''}" data-action="jam-genre" data-genre="${esc(g)}">${esc(l)}</button>`).join('')}</div>
    <h2>Beliebt auf Jamendo${J.genre ? ` · ${esc(JAMENDO_GENRES.find((g) => g[0] === J.genre)?.[1] || J.genre)}` : ''}
      <button class="chip" data-action="jam-play-all">${icon('play')}Alle abspielen</button></h2>
    <div id="jam-list">${listHTML()}</div>
    ${note}`;
}

function listHTML() {
  if (J.error) return `<div class="empty">${icon('cloud')}<div>${esc(J.error)}</div><button class="btn" data-action="jam-retry">Erneut versuchen</button></div>`;
  if (!J.list) return `<div class="aud-loading">${Array.from({ length: 6 }, () => '<div class="aud-skel"></div>').join('')}</div>`;
  if (!J.list.length) return '<div class="empty">In diesem Genre wurden keine Titel gefunden.</div>';
  return hooks.trackRows(J.list, { noAlbum: false, jamendo: true });
}

async function loadList() {
  const my = ++J.req;
  J.error = '';
  J.list = null;
  const box = $('#jam-list');
  if (box) { box.innerHTML = listHTML(); hydrateIcons(box); }
  try {
    const list = await getPopular(J.genre);
    if (my !== J.req) return;
    J.list = list;
  } catch (e) {
    if (my !== J.req) return;
    J.error = e.message;
  }
  const b = $('#jam-list');
  if (b) { b.innerHTML = listHTML(); hydrateIcons(b); }
}

export function afterJamendoRender() {
  if (!J.list || J.error) loadList();
}

let searchTimer = 0, searchReq = 0;
export function searchInto(q, el) {
  clearTimeout(searchTimer);
  if (!el) return;
  if (!q || q.length < 2 || !navigator.onLine) { el.innerHTML = ''; return; }
  el.innerHTML = `<section class="sr-sec"><h2>Jamendo Musik</h2><div class="aud-loading small">${Array.from({ length: 3 }, () => '<div class="aud-skel"></div>').join('')}</div></section>`;
  const my = ++searchReq;
  searchTimer = setTimeout(async () => {
    try {
      const list = await search(q, 12);
      if (my !== searchReq || !el.isConnected) return;
      el.innerHTML = list.length ? `<section class="sr-sec"><h2>Jamendo Musik</h2>${hooks.trackRows(list, { noAlbum: false, jamendo: true })}</section>` : '';
    } catch (e) {
      if (my !== searchReq || !el.isConnected) return;
      el.innerHTML = `<section class="sr-sec"><h2>Jamendo Musik</h2><p class="muted small">${esc(e.message)}</p></section>`;
    }
    hydrateIcons(el);
  }, 350);
}

export const jamendoActions = {
  'jam-genre': (el) => { J.genre = el.dataset.genre; hooks.render(); loadList(); },
  'jam-retry': () => loadList(),
  'jam-play-all': () => {
    if (!J.list?.length) return;
    player.playList(J.list.map((t) => t.id), 0);
  },
};

export const jamendoForms = {
  'jamendo-search': (form) => {
    const q = form.querySelector('#jam-q').value.trim();
    const box = $('#jam-search');
    searchInto(q, box);
    form.querySelector('#jam-q').blur();
  },
};

export function onJamendoInput(el) {
  if (el.id !== 'jam-q') return false;
  searchInto(el.value.trim(), $('#jam-search'));
  return true;
}
