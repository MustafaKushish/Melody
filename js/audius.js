// Freie Musik von Audius (audius.co): an open network where independent artists publish their music.
// Its public API needs no account – Melody streams the songs directly, free and without ads.
import { icon, hydrateIcons } from './icons.js';
import { $, esc, state, hooks, coverHTML } from './core.js';
import { player } from './player.js';

const API = 'https://api.audius.co/v1';
const APP = 'Melody';
export const AUDIUS_PREFIX = 'aud:';

export const GENRES = [
  ['', 'Alle'], ['Electronic', 'Electronic'], ['Hip-Hop/Rap', 'Hip-Hop & Rap'], ['Pop', 'Pop'], ['R&B/Soul', 'R&B & Soul'],
  ['Lo-Fi', 'Lo-Fi'], ['House', 'House'], ['Dancehall', 'Dancehall'], ['Latin', 'Latin'], ['World', 'Weltmusik'],
  ['Rock', 'Rock'], ['Alternative', 'Alternative'], ['Jazz', 'Jazz'], ['Ambient', 'Ambient'], ['Classical', 'Klassik'],
  ['Techno', 'Techno'], ['Drum & Bass', 'Drum & Bass'], ['Acoustic', 'Akustik'],
];
const TIMES = [['week', 'Diese Woche'], ['month', 'Dieser Monat'], ['year', 'Dieses Jahr'], ['allTime', 'Alle Zeiten']];
const A = { genre: '', time: 'week', list: null, error: '', loading: false, req: 0, cache: new Map() };

// ---------- API ----------
async function get(path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) u.searchParams.set(k, v);
  u.searchParams.set('app_name', APP);
  const key = u.toString();
  const hit = A.cache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60000) return hit.data;
  if (!navigator.onLine) throw new Error('Keine Internetverbindung.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(key, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Audius antwortet nicht (${r.status}).`);
    const data = (await r.json()).data;
    A.cache.set(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Audius antwortet gerade nicht.' : e.message === 'Failed to fetch' ? 'Audius ist gerade nicht erreichbar.' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// Only songs everybody may stream (no paid or gated tracks).
const streamable = (x) => x && x.id && x.is_streamable !== false && x.access?.stream !== false && !x.is_stream_gated && !x.is_delete;

// Audius songs become normal Melody tracks that stream. They live only in memory ("temp") until
// they are liked, put in a playlist or downloaded – then they are kept in the library.
export function toTrack(x) {
  const id = AUDIUS_PREFIX + x.id;
  const have = state.map.get(id);
  if (have) return have;
  const art = x.artwork || {};
  const t = {
    id, source: 'audius', audiusId: String(x.id), temp: true,
    url: `${API}/tracks/${encodeURIComponent(x.id)}/stream?app_name=${APP}`,
    title: x.title || 'Ohne Titel', artist: x.user?.name || x.user?.handle || 'Audius', albumArtist: '', album: 'Audius',
    year: String(x.release_date || '').slice(0, 4), genre: x.genre || '', mood: x.mood || '', trackNo: 0, duration: Number(x.duration) || 0,
    cover: null, artwork: art['480x480'] || art['1000x1000'] || art['150x150'] || '',
    permalink: x.permalink ? `https://audius.co${x.permalink}` : '', plays: 0, favorite: false, downloaded: false,
    addedAt: Date.now(), size: 0, fileName: '', type: 'audio/mpeg',
  };
  state.map.set(id, t);
  return t;
}

export async function trending(genre = '', time = 'week', limit = 40) {
  const list = await get('/tracks/trending', { genre, time, limit });
  return (list || []).filter(streamable).map(toTrack);
}
export async function search(q, limit = 20) {
  const list = await get('/tracks/search', { query: q, limit });
  return (list || []).filter(streamable).map(toTrack);
}
// Used by Melody Connect and shared playlists: one song by its Audius id.
export async function trackById(audiusId) {
  const x = await get(`/tracks/${encodeURIComponent(audiusId)}`);
  return streamable(x) ? toTrack(x) : null;
}
// A shared playlist only carries id, title and artist; the cover is filled in once it is played.
export function stub(audiusId, title, artist) {
  return toTrack({ id: audiusId, title, user: { name: artist } });
}

// ---------- Views ----------
const note = `<p class="aud-note">${icon('waves')}<span>Musik von <a href="https://audius.co" target="_blank" rel="noopener">Audius</a> – einem offenen Netzwerk, in dem Künstler:innen ihre Songs selbst veröffentlichen. Gefällt dir ein Song, folge der Künstlerin oder dem Künstler auf Audius.</span></p>`;

export function viewAudius() {
  return `<div class="aud-hero">
      <div class="kind">${icon('waves')} Neu in Melody</div>
      <h1>Freie Musik</h1>
      <p class="sub">Tausende Songs unabhängiger Künstler:innen – kostenlos und werbefrei gestreamt über Audius.</p>
      <form data-form="audius-search" role="search"><label class="search">${icon('search')}<input class="input" id="aud-q" type="search" placeholder="Song oder Künstler auf Audius suchen …" autocomplete="off" enterkeyhint="search"></label></form>
    </div>
    <div id="aud-search"></div>
    <div class="tabs aud-genres">${GENRES.map(([g, l]) => `<button class="chip${A.genre === g ? ' on' : ''}" data-action="aud-genre" data-genre="${esc(g)}">${esc(l)}</button>`).join('')}</div>
    <div class="tabs aud-times">${TIMES.map(([t, l]) => `<button class="chip${A.time === t ? ' on' : ''}" data-action="aud-time" data-time="${t}">${l}</button>`).join('')}</div>
    <h2>Angesagt${A.genre ? ` · ${esc(GENRES.find((g) => g[0] === A.genre)?.[1] || A.genre)}` : ''}
      <button class="chip" data-action="aud-play-all">${icon('play')}Alle abspielen</button></h2>
    <div id="aud-list">${listHTML()}</div>
    ${note}`;
}

function listHTML() {
  if (A.error) return `<div class="empty">${icon('cloud')}<div>${esc(A.error)}</div><button class="btn" data-action="aud-retry">Erneut versuchen</button></div>`;
  if (!A.list) return `<div class="aud-loading">${Array.from({ length: 6 }, () => '<div class="aud-skel"></div>').join('')}</div>`;
  if (!A.list.length) return '<div class="empty">In diesem Genre gibt es gerade keine Trends.</div>';
  return hooks.trackRows(A.list, { noAlbum: true, audius: true });
}

async function loadList() {
  const my = ++A.req;
  A.error = '';
  A.list = null;
  const box = $('#aud-list');
  if (box) { box.innerHTML = listHTML(); hydrateIcons(box); }
  try {
    const list = await trending(A.genre, A.time);
    if (my !== A.req) return;
    A.list = list;
  } catch (e) {
    if (my !== A.req) return;
    A.error = e.message;
  }
  const b = $('#aud-list');
  if (b) { b.innerHTML = listHTML(); hydrateIcons(b); }
}

export function afterAudiusRender() {
  if (!A.list || A.error) loadList();
}

// Home: a row of what is trending right now.
export function homeSection() {
  return '<section id="home-audius" class="home-audius"></section>';
}
export async function fillHome() {
  const el = $('#home-audius');
  if (!el || !navigator.onLine) return;
  try {
    const list = (await trending('', 'week', 12)).slice(0, 12);
    if (!list.length || !$('#home-audius')) return;
    const key = hooks.registerList(list.map((t) => t.id));
    el.innerHTML = `<h2>Freie Musik: angesagt auf Audius <button class="chip" data-action="nav" data-view="audius">Alle anzeigen</button></h2>
      <div class="scroller">${list.map((t, i) => `<button class="card" data-action="play-in" data-list="${key}" data-index="${i}">
        ${coverHTML(t, 'md')}<div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></button>`).join('')}</div>`;
    hydrateIcons(el);
  } catch { /* offline or Audius unreachable: the row simply stays away */ }
}

// Search page: Audius results below the own results.
let searchTimer = 0, searchReq = 0;
export function searchInto(q, el) {
  clearTimeout(searchTimer);
  if (!el) return;
  if (!q || q.length < 2 || !navigator.onLine) { el.innerHTML = ''; return; }
  el.innerHTML = `<section class="sr-sec"><h2>Freie Musik (Audius)</h2><div class="aud-loading small">${Array.from({ length: 3 }, () => '<div class="aud-skel"></div>').join('')}</div></section>`;
  const my = ++searchReq;
  searchTimer = setTimeout(async () => {
    try {
      const list = await search(q, 12);
      if (my !== searchReq || !el.isConnected) return;
      el.innerHTML = list.length ? `<section class="sr-sec"><h2>Freie Musik (Audius)</h2>${hooks.trackRows(list, { noAlbum: true, audius: true })}</section>` : '';
      // Found on Audius: the big "nothing found" of the own library would only confuse.
      if (list.length) el.parentElement?.querySelector('.sr-none')?.remove();
    } catch (e) {
      if (my !== searchReq || !el.isConnected) return;
      el.innerHTML = `<section class="sr-sec"><h2>Freie Musik (Audius)</h2><p class="muted small">${esc(e.message)}</p></section>`;
    }
    hydrateIcons(el);
  }, 350);
}

export const audiusActions = {
  'aud-genre': (el) => { A.genre = el.dataset.genre; hooks.render(); loadList(); },
  'aud-time': (el) => { A.time = el.dataset.time; hooks.render(); loadList(); },
  'aud-retry': () => loadList(),
  'aud-play-all': () => {
    if (!A.list?.length) return;
    player.playList(A.list.map((t) => t.id), 0);
  },
  'aud-open': (el) => { const t = state.map.get(el.dataset.id); if (t?.permalink) window.open(t.permalink, '_blank', 'noopener'); },
};

export const audiusForms = {
  'audius-search': (form) => {
    const q = form.querySelector('#aud-q').value.trim();
    const box = $('#aud-search');
    searchInto(q, box);
    form.querySelector('#aud-q').blur();
  },
};

export function onAudiusInput(el) {
  if (el.id !== 'aud-q') return false;
  searchInto(el.value.trim(), $('#aud-search'));
  return true;
}
