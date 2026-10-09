// One search for everything: songs, artists, albums, playlists, Melody catalog, podcasts, radio –
// and song lyrics ("I only remember one line…"), with a jump straight to that line.
import { player } from './player.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, state, hooks, go, getTrack, coverHTML, groupCover, plural, fmt } from './core.js';
import { loadCatalog, ensureTrack, catalogId, playable } from './catalog.js';
import { podIndex, podCover, searchPods } from './podcasts.js';
import { parseLRC } from './lyrics.js';
import { MOODS } from './foryou.js';
import { searchInto as audiusSearch } from './audius.js';

const RECENT_KEY = 'melody.searches';
const S = { q: '', catalogLyrics: null, timer: 0 };

// "Für Elise" ≈ "fur elise" ≈ "fuer elise": accents, umlauts and ß don't matter.
export function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const tokensOf = (q) => norm(q).split(' ').filter(Boolean);
const alt = (s) => norm(String(s || '').replace(/[äöü]/gi, (c) => ({ ä: 'a', ö: 'o', ü: 'u', Ä: 'a', Ö: 'o', Ü: 'u' }[c])));

// Every query word must appear; matches at the start of a word count more.
export function score(hay, tokens) {
  if (!tokens.length) return 0;
  const h = ` ${norm(hay)} `, h2 = ` ${alt(hay)} `;
  let s = 0;
  for (const t of tokens) {
    const i = Math.max(h.indexOf(t), -1), j = h2.indexOf(t);
    if (i < 0 && j < 0) return 0;
    const at = i >= 0 ? i : j;
    const hs = i >= 0 ? h : h2;
    s += hs[at - 1] === ' ' ? 3 : 1;
    if (hs.startsWith(` ${t}`)) s += 2;
  }
  return s;
}

const lyricText = (t) => (t?.lyrics?.synced ? parseLRC(t.lyrics.synced) : (t?.lyrics?.plain || '').split(/\n+/).map((text) => ({ t: null, text })));

function lyricHit(lines, tokens) {
  let best = null;
  for (const l of lines) {
    if (!l.text) continue;
    const sc = score(l.text, tokens);
    if (sc && (!best || sc > best.sc)) best = { sc, line: l };
  }
  return best;
}

async function loadCatalogLyrics() {
  if (S.catalogLyrics) return S.catalogLyrics;
  const cat = await loadCatalog();
  S.catalogLyrics = new Map();
  await Promise.all(cat.filter((c) => c.lyrics).map(async (c) => {
    try {
      const r = await fetch('catalog/' + c.lyrics);
      if (r.ok) S.catalogLyrics.set(c.id, parseLRC(await r.text()));
    } catch { /* offline */ }
  }));
  return S.catalogLyrics;
}

export function searchAll(q, catalog = [], catLyrics = new Map()) {
  const tokens = tokensOf(q);
  if (!tokens.length) return null;
  const rank = (arr) => arr.filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  const tracks = rank(state.tracks.map((t) => ({ t, s: score(t.title, tokens) * 3 + score(`${t.title} ${t.artist} ${t.album} ${t.genre || ''}`, tokens) })));
  const inLib = new Set(state.tracks.map((t) => t.catalogId).filter(Boolean));
  const catalogHits = rank(catalog.filter((c) => !inLib.has(c.id)).map((c) => ({ c, s: score(`${c.title} ${c.artist} ${c.album} ${c.genre}`, tokens) })));

  const artistMap = new Map();
  for (const t of state.tracks) {
    if (!artistMap.has(t.artist)) artistMap.set(t.artist, []);
    artistMap.get(t.artist).push(t);
  }
  const artists = rank([...artistMap].map(([name, ts]) => ({ name, tracks: ts, s: score(name, tokens) })));
  const albumMap = new Map();
  for (const t of state.tracks) {
    const key = (t.albumArtist || t.artist) + '\u0001' + t.album;
    if (!albumMap.has(key)) albumMap.set(key, { key, album: t.album, artist: t.albumArtist || t.artist, tracks: [] });
    albumMap.get(key).tracks.push(t);
  }
  const albums = rank([...albumMap.values()].map((a) => ({ ...a, s: score(`${a.album} ${a.artist}`, tokens) })));
  const playlists = rank(state.playlists.map((p) => ({ p, s: score(p.name, tokens) })));

  // Lyrics: only for longer queries, so single letters don't match every song.
  const lyrics = [];
  if (norm(q).length >= 4) {
    for (const t of state.tracks) {
      const hit = lyricHit(lyricText(t), tokens);
      if (hit) lyrics.push({ t, line: hit.line, s: hit.sc });
    }
    for (const c of catalog) {
      if (inLib.has(c.id)) continue;
      const hit = lyricHit(catLyrics.get(c.id) || [], tokens);
      if (hit) lyrics.push({ c, line: hit.line, s: hit.sc });
    }
    lyrics.sort((a, b) => b.s - a.s);
  }

  const pods = podIndex();
  const podcasts = rank(pods.map((p) => ({ p, s: score(`${p.title} ${p.author}`, tokens) })));
  const episodes = rank(pods.flatMap((p) => p.episodes.map((ep) => ({ p, ep, s: score(ep.title, tokens) * 2 + score(ep.desc, tokens) * 0.5 })))).slice(0, 6);

  const total = tracks.length + catalogHits.length + artists.length + albums.length + playlists.length + lyrics.length + podcasts.length + episodes.length;
  return { tracks, catalogHits, artists, albums, playlists, lyrics, podcasts, episodes, total };
}

// ---------- Rendering ----------
function mark(text, q) {
  const safe = esc(text);
  const words = [...new Set([...tokensOf(q), ...String(q).toLowerCase().split(/\s+/)])].filter((w) => w.length > 2);
  if (!words.length) return safe;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

function section(title, body, more = '') {
  return body ? `<section class="sr-sec"><h2>${title}${more}</h2>${body}</section>` : '';
}

function resultsHTML(res, q) {
  if (!res) return browseHTML();
  if (!res.total) {
    return `<div class="empty sr-none">${icon('search')}<p>Nichts gefunden für „${esc(q)}“.</p></div>${externalHTML(q)}`;
  }
  const top = res.tracks.slice(0, 6).map((x) => x.t);
  const tracksHTML = top.length ? hooks.trackRows(top) : '';
  const catHTML = res.catalogHits.length ? `<div class="tracks">${res.catalogHits.slice(0, 6).map(({ c }) => `
      <div class="track sr-cat" data-action="sr-cat" data-id="${esc(c.id)}">
        <div class="cover sm"><img src="catalog/${esc(c.cover)}" alt=""></div>
        <div class="meta"><div class="t">${mark(c.title, q)}</div><div class="a">${esc(c.artist)} · Melody-Katalog</div></div>
        <span class="dur">${fmt(c.duration)}</span></div>`).join('')}</div>` : '';
  const lyricHTML = res.lyrics.length ? `<div class="sr-lyrics">${res.lyrics.slice(0, 5).map((x) => {
    const title = x.t ? x.t.title : x.c.title;
    const artist = x.t ? x.t.artist : x.c.artist;
    const at = x.line.t != null ? Math.max(0, x.line.t - 1.5) : 0;
    return `<button class="sr-lyric" data-action="sr-lyric" data-${x.t ? 'track' : 'cat'}="${esc(x.t ? x.t.id : x.c.id)}" data-at="${at}">
      <span class="q">„${mark(x.line.text, q)}“</span>
      <span class="who">${esc(title)} · ${esc(artist)}${x.line.t != null ? ` · ab ${fmt(x.line.t)}` : ''}</span>
      <span class="go">${icon('play')}${x.line.t != null ? 'Ab dieser Zeile' : 'Abspielen'}</span></button>`;
  }).join('')}</div>` : '';
  const artistHTML = res.artists.length ? `<div class="scroller">${res.artists.slice(0, 10).map((a) => `
      <button class="card" data-action="nav" data-view="artist" data-param="${esc(a.name)}">${groupCover(a.tracks, 'md', a.name, 'person', true)}
        <div class="t center">${mark(a.name, q)}</div><div class="a center">${plural(a.tracks.length, 'Titel', 'Titel')}</div></button>`).join('')}</div>` : '';
  const albumHTML = res.albums.length ? `<div class="scroller">${res.albums.slice(0, 10).map((a) => `
      <button class="card" data-action="nav" data-view="album" data-param="${esc(a.key)}">${groupCover(a.tracks, 'md', a.album)}
        <div class="t">${mark(a.album, q)}</div><div class="a">${esc(a.artist)}</div></button>`).join('')}</div>` : '';
  const plHTML = res.playlists.length ? `<div class="scroller">${res.playlists.slice(0, 10).map(({ p }) => `
      <button class="card" data-action="nav" data-view="playlist" data-param="${esc(p.id)}">${groupCover(p.trackIds.map(getTrack).filter(Boolean), 'md', p.name, 'playlist')}
        <div class="t">${mark(p.name, q)}</div><div class="a">${plural(p.trackIds.length, 'Titel', 'Titel')}</div></button>`).join('')}</div>` : '';
  const podHTML = res.podcasts.length ? `<div class="scroller">${res.podcasts.slice(0, 10).map(({ p }) => `
      <button class="card" data-action="nav" data-view="podcast" data-param="${esc(p.feed)}">${podCover(p)}
        <div class="t">${mark(p.title, q)}</div><div class="a">${esc(p.author || 'Podcast')}</div></button>`).join('')}</div>` : '';
  const epHTML = res.episodes.length ? `<div class="tracks">${res.episodes.map(({ p, ep }) => `
      <div class="track sr-ep" data-action="pod-play" data-feed="${esc(p.feed)}" data-guid="${esc(ep.guid)}">
        ${podCover(p, 'sm')}<div class="meta"><div class="t">${mark(ep.title, q)}</div><div class="a">${esc(p.title)} · Folge</div></div>
        <span class="dur">${icon('play')}</span></div>`).join('')}</div>` : '';
  const best = res.tracks[0]?.t;
  return `${best ? `<div class="sr-best"><span class="kind">Bester Treffer</span>
      <div class="sr-best-row">${coverHTML(best, 'lg')}<div><h2>${mark(best.title, q)}</h2><p>${esc(best.artist)} · ${esc(best.album)}</p>
      <button class="btn btn-primary" data-action="sr-play-best" data-id="${esc(best.id)}">${icon('play')}Abspielen</button></div></div></div>` : ''}
    ${section('Songs', tracksHTML, res.tracks.length > 6 ? ` <button class="chip" data-action="sr-all-songs">Alle ${res.tracks.length}</button>` : '')}
    ${section(`${icon('lyrics')} In Songtexten`, lyricHTML)}
    ${section('Aus dem Melody-Katalog', catHTML)}
    ${section('Künstler', artistHTML)}
    ${section('Alben', albumHTML)}
    ${section('Playlists', plHTML)}
    ${section('Podcasts', podHTML)}
    ${section('Podcast-Folgen', epHTML)}
    ${externalHTML(q)}`;
}

function externalHTML(q) {
  return `<div class="sr-more">
    <button class="chip" data-action="sr-radio" data-q="${esc(q)}">${icon('radio')}Radiosender „${esc(q)}“</button>
    <button class="chip" data-action="sr-pods" data-q="${esc(q)}">${icon('podcast')}Im Podcast-Verzeichnis suchen</button>
  </div>`;
}

function recent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function remember(q) {
  q = q.trim();
  if (q.length < 2) return;
  const r = [q, ...recent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

function browseHTML() {
  const genres = [...new Set(state.tracks.map((t) => t.genre).filter(Boolean))].slice(0, 8);
  const tiles = [
    ['nav', 'discover', 'Melody-Katalog', 'explore', '#7c3aed', '#db2777'],
    ['nav', 'podcasts', 'Podcasts', 'podcast', '#0891b2', '#1d4ed8'],
    ['nav', 'radio', 'Radio', 'radio', '#ea580c', '#b91c1c'],
    ['nav', 'recognize', 'Song erkennen', 'waves', '#9333ea', '#4f46e5'],
    ['nav', 'foryou', 'Für dich', 'sparkle', '#d97706', '#be185d'],
    ['fitness', '', 'Fitness', 'fitness', '#dc2626', '#9a3412'],
    ['drive', '', 'Fahrermodus', 'car', '#0f766e', '#0369a1'],
    ['party', '', 'Party', 'party', '#c026d3', '#6d28d9'],
  ];
  const r = recent();
  return `${r.length ? `<h2>Zuletzt gesucht <button class="chip" data-action="sr-clear-recent">Leeren</button></h2>
      <div class="tabs">${r.map((x) => `<button class="chip" data-action="sr-recent" data-q="${esc(x)}">${icon('search')}${esc(x)}</button>`).join('')}</div>` : ''}
    <p class="muted small">Tipp: Du weißt nur noch eine Textzeile? Tipp sie einfach ein – Melody findet den Song und spielt ihn ab genau dieser Stelle.</p>
    <h2>Alles entdecken</h2>
    <div class="browse">${tiles.map(([a, v, l, ic, c1, c2]) => `<button class="browse-tile" style="--c1:${c1};--c2:${c2}" data-action="${a}"${v ? ` data-view="${v}"` : ''}><b>${l}</b>${icon(ic)}</button>`).join('')}</div>
    <h2>Stimmungen</h2>
    <div class="tabs">${Object.entries(MOODS).map(([n, m]) => `<button class="chip" data-action="ai-mood" data-mood="${n}">${m.emoji} ${n}</button>`).join('')}</div>
    ${genres.length ? `<h2>Deine Genres</h2><div class="tabs">${genres.map((g) => `<button class="chip" data-action="sr-recent" data-q="${esc(g)}">${esc(g)}</button>`).join('')}</div>` : ''}`;
}

export function viewSearch() {
  return `<div class="sr">
    <h1>Suchen</h1>
    <form data-form="search" role="search"><label class="search sr-box">${icon('search')}<input class="input" id="search-q" type="search" placeholder="Songs, Künstler, Podcasts, Textzeilen …" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search" aria-label="Suchen"></label></form>
    <div id="sr-results" aria-live="polite">${resultsHTML(null, '')}</div>
  </div>`;
}

let lastRes = null;
async function update() {
  const box = $('#sr-results');
  if (!box) return;
  const q = S.q.trim();
  if (!q) {
    lastRes = null;
    box.innerHTML = browseHTML();
  } else {
    const [cat, lyr] = await Promise.all([loadCatalog().catch(() => []), loadCatalogLyrics().catch(() => new Map())]);
    if (S.q.trim() !== q || !$('#sr-results')) return;
    lastRes = searchAll(q, cat, lyr);
    box.innerHTML = resultsHTML(lastRes, q) + '<div id="sr-audius"></div>';
    audiusSearch(q, $('#sr-audius'));
  }
  hydrateIcons(box);
}

export function afterSearchRender() {
  const input = $('#search-q');
  if (!input) return;
  update();
  if (matchMedia('(pointer: fine)').matches || state.route.query.get('focus')) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

export function openSearch() {
  if (state.route.view === 'search') { $('#search-q')?.focus(); return; }
  go('search');
}

// Input from the search box. Returns true when handled.
export function onSearchInput(el) {
  if (el.id !== 'search-q') return false;
  S.q = el.value;
  clearTimeout(S.timer);
  S.timer = setTimeout(update, 120);
  return true;
}

export const searchActions = {
  search: () => openSearch(),
  'sr-recent': (el) => { S.q = el.dataset.q; const i = $('#search-q'); if (i) i.value = S.q; update(); },
  'sr-clear-recent': () => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } update(); },
  'sr-play-best': (el) => { remember(S.q); player.playList([el.dataset.id], 0); },
  'sr-all-songs': () => { state.libQuery = S.q; remember(S.q); go('library', 'songs'); },
  'sr-cat': async (el) => {
    remember(S.q);
    const c = (await loadCatalog()).find((x) => x.id === el.dataset.id);
    if (!c) return;
    const t = await ensureTrack(c);
    if (playable(t)) player.playList([t.id], 0);
  },
  'sr-lyric': async (el) => {
    remember(S.q);
    let id = el.dataset.track;
    if (!id) {
      const c = (await loadCatalog()).find((x) => x.id === el.dataset.cat);
      id = (await ensureTrack(c)).id;
    }
    const t = getTrack(id);
    if (!t || !playable(t)) return;
    await player.playList([id], 0, Number(el.dataset.at) || 0);
  },
  'sr-radio': (el) => { remember(el.dataset.q); Object.assign(state.radio, { query: el.dataset.q, tag: '', loaded: false }); go('radio'); },
  'sr-pods': (el) => { remember(el.dataset.q); go('podcasts'); searchPods(el.dataset.q); },
};

export const searchForms = {
  search: () => { remember(S.q); update(); },
};

export { catalogId };
