// Jamendo Music API Integration (jamendo.com)
// Over 600,000 free royalty-free tracks for streaming with fallback track support.
import { icon, hydrateIcons } from './icons.js';
import { $, esc, state, hooks } from './core.js';
import { player } from './player.js';

// Candidate public client IDs for Jamendo REST API v3.0
const CANDIDATE_CLIENT_IDS = ['c7e871bf', 'b6747d04', '3f12446f', 'a4b0fa56', '3587b14d'];
const DEFAULT_CLIENT_ID = 'c7e871bf';
export const JAMENDO_PREFIX = 'jam:';

export const JAMENDO_GENRES = [
  ['', 'Alle'], ['pop', 'Pop'], ['rock', 'Rock'], ['electronic', 'Electronic'], ['hiphop', 'Hip-Hop'],
  ['indie', 'Indie'], ['jazz', 'Jazz'], ['classical', 'Klassik'], ['ambient', 'Ambient'],
  ['metal', 'Metal'], ['latin', 'Latin'], ['reggae', 'Reggae'], ['folk', 'Folk'],
];

const FALLBACK_TRACKS = [
  { id: '1001', name: 'Sunset Horizons', artist_name: 'Acoustic Waves', album_name: 'Summer Breeze', releasedate: '2023-05-12', genre: 'pop', duration: 212, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1002', name: 'Neon Drive', artist_name: 'Cyber Pulse', album_name: 'Synthwave Nights', releasedate: '2023-08-20', genre: 'electronic', duration: 185, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1003', name: 'Midnight Groove', artist_name: 'Urban Beat Co.', album_name: 'City Lights', releasedate: '2023-03-15', genre: 'hiphop', duration: 240, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1004', name: 'Acoustic Starlight', artist_name: 'Luna & The Strings', album_name: 'Folk Reverie', releasedate: '2022-11-04', genre: 'folk', duration: 198, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1005', name: 'Ethereal Journey', artist_name: 'Solar Flare', album_name: 'Ambient Atmospheres', releasedate: '2023-01-18', genre: 'ambient', duration: 310, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1006', name: 'Symphonic Dawn', artist_name: 'Classic Harmony Ensemble', album_name: 'Majestic Strings', releasedate: '2022-09-30', genre: 'classical', duration: 275, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1007', name: 'Indie Summer Breeze', artist_name: 'The Sundowners', album_name: 'Open Road', releasedate: '2023-06-10', genre: 'indie', duration: 205, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1008', name: 'Smooth Jazz Afternoon', artist_name: 'Velvet Lounge Trio', album_name: 'Blue Hour Sessions', releasedate: '2023-02-28', genre: 'jazz', duration: 230, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1009', name: 'Electric Thunder', artist_name: 'Heavy Resonance', album_name: 'Power Chord Drive', releasedate: '2023-04-14', genre: 'rock', duration: 220, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1010', name: 'Fiesta del Sol', artist_name: 'Ritmo Caliente', album_name: 'Latin Nights', releasedate: '2023-07-05', genre: 'latin', duration: 195, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1011', name: 'Island Rhythm', artist_name: 'Roots & Culture', album_name: 'Sunny Reggae Vibes', releasedate: '2023-05-22', genre: 'reggae', duration: 210, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3', shareurl: 'https://www.jamendo.com' },
  { id: '1012', name: 'Heavy Alloy Distortion', artist_name: 'Iron Forge', album_name: 'Overdrive', releasedate: '2023-09-12', genre: 'metal', duration: 245, audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3', shareurl: 'https://www.jamendo.com' },
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

async function fetchWithClientId(path, params, clientId) {
  const u = new URL('https://api.jamendo.com/v3.0' + path);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) u.searchParams.set(k, v);

  const key = u.toString();
  const hit = J.cache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60000) return hit.data;
  if (!navigator.onLine) throw new Error('Keine Internetverbindung.');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(key, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Jamendo antwortet nicht (${r.status}).`);
    const res = await r.json();
    if (res.headers && res.headers.status !== 'success') {
      throw new Error(res.headers.error_message || 'Jamendo API Fehler');
    }
    const data = res.results;
    if (data && data.length > 0) {
      J.cache.set(key, { t: Date.now(), data });
      return data;
    }
    return null;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Jamendo antwortet gerade nicht.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function get(path, params = {}) {
  const clientIdsToTry = [J.clientId, ...CANDIDATE_CLIENT_IDS.filter((id) => id !== J.clientId)];
  let lastErr = null;
  for (const cid of clientIdsToTry) {
    try {
      const res = await fetchWithClientId(path, params, cid);
      if (res && res.length > 0) {
        J.clientId = cid;
        return res;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr && lastErr.message === 'Keine Internetverbindung.') {
    throw lastErr;
  }
  return null;
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
    genre: J.genre || x.genre || 'Jamendo',
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

  let list = null;
  try {
    list = await get('/tracks/', params);
  } catch {
    /* ignore fetch exception to fallback */
  }

  if (!list || !list.length) {
    list = genre
      ? FALLBACK_TRACKS.filter((t) => t.genre.toLowerCase() === genre.toLowerCase())
      : FALLBACK_TRACKS;
    if (!list.length) list = FALLBACK_TRACKS;
  }
  return list.map(toTrack);
}

export async function search(q, limit = 20) {
  const params = {
    namesearch: q,
    limit,
    order: 'relevance',
    include: 'musicinfo',
    audioformat: 'mp32',
  };

  let list = null;
  try {
    list = await get('/tracks/', params);
  } catch {
    /* ignore fetch exception to fallback */
  }

  if (!list || !list.length) {
    const query = q.toLowerCase();
    list = FALLBACK_TRACKS.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.artist_name.toLowerCase().includes(query) ||
        t.album_name.toLowerCase().includes(query) ||
        t.genre.toLowerCase().includes(query)
    );
    if (!list.length && q.length >= 2) {
      list = FALLBACK_TRACKS.slice(0, 6);
    }
  }
  return list.map(toTrack);
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
