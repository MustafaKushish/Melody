import { db, uid } from './db.js';
import { readTags, readDuration } from './tags.js';
import { player, shuffled, isIOS } from './player.js';
import { icon, hydrateIcons, setIcon } from './icons.js';
import { ensureAccess, renderAccountChip, viewPremium, viewAccount, afterAccountRender, accountActions, accountForms } from './account.js';
import { lyricsActions, lyricsForms, onLyricsInput, onTrackChange, updateSingState, onNowPlayingOpen, closeSing, isSingOpen, attachLrcFiles, editLyricsSheet, openSing } from './lyrics.js';
import { viewForYou, forYouActions, forYouForms, MOODS } from './foryou.js';
import { viewDiscover, catalogActions, loadCatalog, statusBadge, isCatalog, isStream, keepTrack, playable, download, removeDownload, downloadedBytes, mb, catalogCards } from './catalog.js';
import { viewShared, shareActions } from './share.js';
import { driveActions, driveForms, closeDrive, isDriveOpen } from './drive.js';
import { partyActions, closeParty, isPartyOpen } from './party.js';
import { fitnessActions, closeFitness, isFitnessOpen, onFitnessInput, openFitness } from './fitness.js';
import { viewRecognize, recognizeActions, onRecognizeChange, listen as recognizeListen } from './recognize.js';
import { openDrive } from './drive.js';
import { viewRecap, recapActions, homeTeaser } from './recap.js';
import { startConnect, stopConnect, connectActions, onConnectInput, onConnectChange, onSheetClosed } from './connect.js';
import { viewSearch, afterSearchRender, onSearchInput, openSearch, searchActions, searchForms } from './search.js';
import { viewPodcasts, viewPodcast, podcastActions, podcastForms, homeSection as podHome, refreshSubscriptions, fmtTime as podTime } from './podcasts.js';
import { DEMO } from './api.js';
import { viewAudius, afterAudiusRender, audiusActions, audiusForms, onAudiusInput, homeSection as audiusHome, fillHome as fillAudiusHome } from './audius.js';
import { editTrackSheet, metaActions, metaForms, onMetaChange } from './meta.js';
import { a11y, applyA11y, setA11y, TEXT_SIZES, trapTab, dragKey, registerSorter } from './a11y.js';
import { kidsActions, kidsForms, kidsActive, kidsAllows, kidsKey, onKidsInput, initKids, refreshKids } from './kids.js';
import { viewStudio, afterStudioRender, studioActions, onStudioInput, reportPreset } from './studio.js';
import {
  $, esc, fmt, fmtLong, hue, plural, byText, toast, state, hooks, getTrack, go,
  coverUrl, coverHTML, groupCover, setRangeP, openSheet, closeSheet, promptSheet, confirmSheet,
} from './core.js';

const VERSION = '3.3.0';

const UI_KEY = 'melody.ui';
const ui = (() => {
  try {
    return { theme: 'dark', accent: '#8b5cf6', ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') };
  } catch {
    return { theme: 'dark', accent: '#8b5cf6' };
  }
})();
const saveUi = () => localStorage.setItem(UI_KEY, JSON.stringify(ui));

const RADIO_FAV_KEY = 'melody.radioFavs';
let radioFavs = (() => {
  try { return JSON.parse(localStorage.getItem(RADIO_FAV_KEY) || '[]'); } catch { return []; }
})();
const saveRadioFavs = () => localStorage.setItem(RADIO_FAV_KEY, JSON.stringify(radioFavs));

// ---------- Data ----------
async function loadAll() {
  const [tracks, playlists] = await Promise.all([db.all('tracks'), db.all('playlists')]);
  state.tracks = tracks;
  state.playlists = playlists.sort((a, b) => a.createdAt - b.createdAt);
  state.map = new Map(tracks.map((t) => [t.id, t]));
}


function albums() {
  const m = new Map();
  for (const t of state.tracks) {
    const artist = t.albumArtist || t.artist;
    const key = artist + '\u0001' + t.album;
    if (!m.has(key)) m.set(key, { key, album: t.album, artist, year: t.year, tracks: [] });
    m.get(key).tracks.push(t);
  }
  for (const a of m.values()) a.tracks.sort((x, y) => (x.trackNo || 999) - (y.trackNo || 999) || byText(x.title, y.title));
  return [...m.values()].sort((a, b) => byText(a.album, b.album));
}

function artists() {
  const m = new Map();
  for (const t of state.tracks) {
    if (!m.has(t.artist)) m.set(t.artist, { name: t.artist, tracks: [] });
    m.get(t.artist).tracks.push(t);
  }
  return [...m.values()].sort((a, b) => byText(a.name, b.name));
}

const DAY = 86400000;
const MIXES = [
  { id: 'random', title: 'Zufallsmix', desc: 'Quer durch deine Bibliothek', icon: 'shuffle', c: ['#8b5cf6', '#3b82f6'],
    ids: () => shuffled(state.tracks).slice(0, 150).map((t) => t.id) },
  { id: 'favs', title: 'Lieblingssongs', desc: 'Alles, was du liebst', icon: 'heart', c: ['#ec4899', '#f97316'],
    ids: () => shuffled(state.tracks.filter((t) => t.favorite)).map((t) => t.id) },
  { id: 'top', title: 'Deine Top-Hits', desc: 'Am häufigsten gehört', icon: 'sparkle', c: ['#f59e0b', '#ef4444'],
    ids: () => state.tracks.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 50).map((t) => t.id) },
  { id: 'forgotten', title: 'Wiederentdecken', desc: 'Seit 30 Tagen nicht gehört', icon: 'album', c: ['#14b8a6', '#3b82f6'],
    ids: () => shuffled(state.tracks.filter((t) => !t.lastPlayed || t.lastPlayed < Date.now() - 30 * DAY)).slice(0, 60).map((t) => t.id) },
  { id: 'new', title: 'Frisch importiert', desc: 'Die letzten 14 Tage', icon: 'download', c: ['#22c55e', '#14b8a6'],
    ids: () => state.tracks.filter((t) => t.addedAt > Date.now() - 14 * DAY).sort((a, b) => b.addedAt - a.addedAt).map((t) => t.id) },
  { id: 'short', title: 'Schnelle Runde', desc: 'Nur Titel unter 3 Minuten', icon: 'timer', c: ['#6366f1', '#ec4899'],
    ids: () => shuffled(state.tracks.filter((t) => t.duration > 0 && t.duration < 180)).map((t) => t.id) },
];

// ---------- Navigation ----------
const NAV = [
  { id: 'home', label: 'Start', icon: 'home', mobile: true },
  { id: 'search', label: 'Suchen', icon: 'search', mobile: true },
  { id: 'discover', label: 'Entdecken', icon: 'explore' },
  { id: 'audius', label: 'Freie Musik', icon: 'globe' },
  { id: 'podcasts', label: 'Podcasts', icon: 'podcast', mobile: true },
  { id: 'foryou', label: 'Für dich', icon: 'sparkle' },
  { id: 'library', label: 'Bibliothek', icon: 'library', mobile: true },
  { id: 'playlists', label: 'Playlists', icon: 'playlist' },
  { id: 'recap', label: 'Rückblick', icon: 'chart' },
  { id: 'radio', label: 'Radio', icon: 'radio' },
  { id: 'studio', label: 'Sound-Studio', icon: 'tune' },
  { id: 'drive', label: 'Fahrermodus', icon: 'car', action: 'drive' },
  { id: 'fitness', label: 'Fitness', icon: 'fitness', action: 'fitness' },
  { id: 'kids', label: 'Kinder-Modus', icon: 'kids', action: 'kids' },
  { id: 'recognize', label: 'Song erkennen', icon: 'waves' },
  { id: 'devices', label: 'Geräte', icon: 'devices', action: 'connect' },
  { id: 'account', label: 'Konto & Abo', icon: 'account' },
  { id: 'settings', label: 'Einstellungen', icon: 'settings' },
];

function renderNav() {
  const item = (n) => `<button class="nav-item" data-action="${n.action || 'nav'}" data-view="${n.id}">${icon(n.icon)}<span>${n.label}</span></button>`;
  $('#side-nav').innerHTML = NAV.map(item).join('');
  $('#bottom-nav').innerHTML = NAV.filter((n) => n.mobile).map(item).join('') + item({ id: 'more', label: 'Mehr', icon: 'grid' });
}

function viewMore() {
  return `<h1>Mehr</h1><div class="more-list">${NAV.filter((n) => !n.mobile).map((n) =>
    `<button class="sheet-item" data-action="${n.action || 'nav'}" data-view="${n.id}">${icon(n.icon)}${n.label}</button>`).join('')}</div>`;
}

function parseRoute() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [view, ...rest] = path.split('/');
  state.route = { view: view || 'home', param: decodeURIComponent(rest.join('/') || ''), query: new URLSearchParams(query) };
}

const VIEWS = {
  home: viewHome,
  audius: viewAudius,
  library: viewLibrary,
  album: viewAlbum,
  artist: viewArtist,
  playlists: viewPlaylists,
  playlist: viewPlaylist,
  radio: viewRadio,
  settings: viewSettings,
  foryou: viewForYou,
  studio: viewStudio,
  premium: viewPremium,
  account: viewAccount,
  more: viewMore,
  discover: viewDiscover,
  recognize: viewRecognize,
  podcasts: viewPodcasts,
  search: viewSearch,
  recap: viewRecap,
  podcast: viewPodcast,
  shared: viewShared,
};

let lastViewKey = '';
function render() {
  parseRoute();
  const { view } = state.route;
  const fn = VIEWS[view] || viewHome;
  state.lists = {};
  const main = $('#main');
  main.innerHTML = fn();
  hydrateIcons(main);
  // A new page fades in; re-renders of the same page (e.g. after a like) stay still.
  const key = `${view}/${state.route.param}`;
  if (key !== lastViewKey) { main.classList.remove('view-enter'); void main.offsetWidth; main.classList.add('view-enter'); lastViewKey = key; }
  const fab = $('#rc-fab');
  if (fab) { fab.hidden = view === 'recognize'; fab.classList.remove('away'); }
  const navView = { album: 'library', artist: 'library', playlist: 'playlists', premium: 'account', shared: 'playlists', podcast: 'podcasts' }[view] || view;
  document.querySelectorAll('.nav-item').forEach((el) => {
    const on = el.dataset.view === navView;
    el.classList.toggle('active', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const h1 = main.querySelector('h1')?.textContent.trim();
  document.title = h1 && h1 !== 'Melody' ? `${h1} · Melody` : 'Melody';
  afterRender(view);
}

function afterRender(view) {
  document.querySelectorAll('#main input[type=range]').forEach(setRangeP);
  if (view === 'radio') {
    if (!state.radio.loaded && !state.radio.loading) searchRadio();
    else renderRadioList();
  }
  if (view === 'settings') updateStorageInfo();
  if (view === 'account') afterAccountRender();
  if (view === 'search') afterSearchRender();
  const q = state.route.query;
  if (q.get('mode') === 'drive') { history.replaceState(null, '', '#/home'); openDrive(); }
  if (q.get('mode') === 'fitness') { history.replaceState(null, '', '#/home'); openFitness(); }
  if (view === 'recognize' && q.get('auto') === '1') { history.replaceState(null, '', '#/recognize'); recognizeListen(); }
  if (view === 'home' || (view === 'library' && !state.tracks.length)) fillHomeCatalog();
  if (view === 'home') fillAudiusHome();
  if (view === 'audius') afterAudiusRender();
  if (view === 'studio') afterStudioRender();
}

// ---------- Shared fragments ----------
function registerList(ids) {
  const key = 'l' + Object.keys(state.lists).length;
  state.lists[key] = ids;
  return key;
}

function trackRows(tracks, opts = {}) {
  if (!tracks.length) return `<div class="empty">${icon('note')}<div>${opts.empty || 'Keine Titel'}</div></div>`;
  const key = registerList(tracks.map((t) => t.id));
  const cur = player.mode === 'library' ? player.currentId : null;
  const sort = opts.sortable && tracks.length > 1;
  return `<div class="tracks${sort ? ' sortable' : ''}"${sort ? ` data-sort="${esc(opts.sortable)}"` : ''}>${tracks.map((t, i) => `
    <div class="track${t.id === cur ? ' current' : ''}${playable(t) ? '' : ' unavailable'}" data-action="play-in" data-list="${key}" data-index="${i}" data-id="${t.id}"${sort ? ' data-sort-item' : ''}>
      ${sort ? `<button class="num drag-handle" data-drag data-action="drag-noop" aria-label="${esc(t.title)} verschieben (Pfeiltasten hoch/runter)" title="Ziehen zum Verschieben">${icon('drag')}</button>`
        : `<span class="num">${opts.trackNo ? t.trackNo || i + 1 : i + 1}</span>`}
      ${coverHTML(t, 'sm')}
      <div class="meta">
        <div class="t">${esc(t.title)}</div>
        <div class="a">${t.favorite ? `<span class="heart">♥</span> ` : ''}${esc(t.artist)}${opts.noAlbum ? '' : ' · ' + esc(t.album)}</div>
      </div>
      <span class="dur"><span class="dl-slot">${statusBadge(t)}</span> ${fmt(t.duration)}</span>
      <button class="icon-btn" data-action="track-menu" data-id="${t.id}" data-pl="${esc(opts.playlistId || '')}" data-index="${i}" aria-label="Optionen">${icon('more')}</button>
    </div>`).join('')}</div>`;
}

function trackCards(tracks) {
  const key = registerList(tracks.map((t) => t.id));
  return `<div class="scroller">${tracks.map((t, i) => `
    <button class="card" data-action="play-in" data-list="${key}" data-index="${i}">
      ${coverHTML(t, 'md')}
      <div class="t">${esc(t.title)}</div>
      <div class="a">${esc(t.artist)}</div>
    </button>`).join('')}</div>`;
}

function albumCards(list, scroller = false) {
  return `<div class="${scroller ? 'scroller' : 'grid'}">${list.map((a) => `
    <button class="card" data-action="nav" data-view="album" data-param="${esc(a.key)}">
      ${groupCover(a.tracks, 'md', a.album)}
      <div class="t">${esc(a.album)}</div>
      <div class="a">${esc(a.artist)}${a.year ? ' · ' + esc(a.year) : ''}</div>
    </button>`).join('')}</div>`;
}

function playlistCards(list, withNew = false) {
  return `<div class="grid">
    ${withNew ? `<button class="card" data-action="new-playlist"><div class="cover md" style="--h:200">${icon('add')}</div><div class="t">Neue Playlist</div><div class="a">Erstellen</div></button>` : ''}
    ${withNew ? `<button class="card" data-action="nav" data-view="library" data-param="favs"><div class="cover md" style="--h:320">${icon('heart')}</div><div class="t">Lieblingssongs</div><div class="a">${plural(state.tracks.filter((t) => t.favorite).length, 'Titel', 'Titel')}</div></button>` : ''}
    ${list.map((p) => `
    <button class="card" data-action="nav" data-view="playlist" data-param="${esc(p.id)}">
      ${groupCover(p.trackIds.map(getTrack).filter(Boolean), 'md', p.name, 'playlist')}
      <div class="t">${esc(p.name)}</div>
      <div class="a">${plural(p.trackIds.length, 'Titel', 'Titel')}</div>
    </button>`).join('')}</div>`;
}

function emptyLibrary() {
  return `<div class="empty">${icon('library')}
    <p>Deine Bibliothek ist noch leer.</p>
    <div class="row" style="justify-content:center">
      <button class="btn btn-primary" data-action="import">${icon('upload')}Dateien wählen</button>
      <button class="btn hide-sm" data-action="import-folder">${icon('folder')}Ordner wählen</button>
    </div></div>`;
}

// ---------- Views ----------

const MODES_HTML = () => `<div class="modes">
  <button class="mode drive-m" data-action="drive">${icon('car')}<b>Fahren</b><span>Karte, Navigation & Sprachsteuerung</span></button>
  <button class="mode party-m" data-action="party">${icon('party')}<b>Party</b><span>Lichtshow & DJ-Übergänge</span></button>
  <button class="mode fit-m" data-action="fitness">${icon('fitness')}<b>Fitness</b><span>Musik im Trainings-Tempo, Timer & Coach</span></button>
  <button class="mode kids-m" data-action="kids">${icon('kids')}<b>Kinder</b><span>Bunt, sicher, mit Eltern-PIN & Zeitlimit</span></button>
  <button class="mode chill-m" data-action="chill">${icon('moon')}<b>Entspannen</b><span>Weicher Klang, endet nach 30 Min.</span></button>
</div>`;

async function fillHomeCatalog() {
  const list = await loadCatalog();
  const el = $('#home-catalog');
  if (!el || !list.length) return;
  el.innerHTML = `<h2>Neu im Melody-Katalog <button class="chip" data-action="nav" data-view="discover">Alle anzeigen</button></h2>${catalogCards(list, 'all')}`;
  hydrateIcons(el);
}

function viewHome() {
  if (!state.tracks.length) {
    return `<section class="welcome">
      <h1>Willkommen bei Melody</h1>
      <p class="sub">Deine Musik. Werbefrei. Auf jedem Gerät – auch offline.</p>
      <div class="row">
        <button class="btn btn-primary" data-action="import">${icon('upload')}Musik importieren</button>
        <button class="btn hide-sm" data-action="import-folder">${icon('folder')}Ordner importieren</button>
        <button class="btn" data-action="nav" data-view="discover">${icon('explore')}Songs entdecken</button>
        <button class="btn" data-action="nav" data-view="audius">${icon('globe')}Freie Musik hören</button>
      </div>
      ${DEMO ? '<p class="demo-note" style="margin-top:16px">Demo-Version: Tippe auf „Songs entdecken“ und spiele die Melody-Songs ab – mit Lyrics zum Mitsingen. Du kannst auch eigene Musikdateien importieren.</p>' : ''}
      <div id="home-catalog"></div>
      ${audiusHome()}
      ${podHome()}
      ${MODES_HTML()}
      <div class="features">
        <div class="feature">${icon('heartOutline')}<b>100 % werbefrei</b><span>Keine Werbung, kein Tracking, keine Datenweitergabe.</span></div>
        <div class="feature">${icon('download')}<b>Herunterladen & offline</b><span>Songs laden und überall ohne Internet hören.</span></div>
        <div class="feature">${icon('share')}<b>Playlists teilen</b><span>Per Link an Freunde – WhatsApp, Telegram, E-Mail.</span></div>
        <div class="feature">${icon('eq')}<b>10-Band-Equalizer</b><span>12 Presets oder dein eigener Sound.</span></div>
        <div class="feature">${icon('sparkle')}<b>Smart-Mixe</b><span>Top-Hits, Wiederentdecken, Schnelle Runde & mehr.</span></div>
        <div class="feature">${icon('radio')}<b>30.000+ Radiosender</b><span>Weltweit live, kostenlos.</span></div>
        <div class="feature">${icon('timer')}<b>Sleep-Timer & Tempo</b><span>Sanftes Ausblenden, 0,5× bis 2× Geschwindigkeit.</span></div>
      </div>
    </section>`;
  }
  const h = new Date().getHours();
  const greet = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
  const total = state.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const plays = state.tracks.reduce((s, t) => s + (t.plays || 0), 0);
  const recent = state.tracks.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 15);
  const added = [...state.tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 15);
  const albs = albums();
  return `
    <h1>${greet}</h1>
    <div class="stats">
      <div class="stat"><b>${state.tracks.length}</b><span>Titel</span></div>
      <div class="stat"><b>${albs.length}</b><span>Alben</span></div>
      <div class="stat"><b>${artists().length}</b><span>Künstler</span></div>
      <div class="stat"><b>${fmtLong(total)}</b><span>Musik</span></div>
      <div class="stat"><b>${plays}</b><span>Wiedergaben</span></div>
    </div>
    ${MODES_HTML()}
    <section class="ai-banner">
      <div><span class="ai-badge">${icon('sparkle')} KI</span><h2>Wonach ist dir gerade?</h2>
        <p>Melody kennt deinen Geschmack und stellt dir in Sekunden den passenden Mix zusammen.</p></div>
      <div class="tabs">${Object.entries(MOODS).slice(0, 6).map(([name, m]) => `<button class="chip" data-action="ai-mood" data-mood="${name}">${m.emoji} ${name}</button>`).join('')}</div>
    </section>
    <div id="home-catalog"></div>
    ${audiusHome()}
    ${homeTeaser()}
    ${podHome()}
    <h2>Smart-Mixe</h2>
    <div class="grid">${MIXES.map((m) => {
      const n = m.ids().length;
      return `<button class="mix" style="--c1:${m.c[0]};--c2:${m.c[1]}" data-action="mix" data-mix="${m.id}" ${n ? '' : 'disabled'}>
        ${icon(m.icon)}<div><div class="t">${m.title}</div><div class="a">${n ? m.desc : 'Noch leer'}</div></div></button>`;
    }).join('')}</div>
    ${recent.length ? `<h2>Zuletzt gehört</h2>${trackCards(recent)}` : ''}
    <h2>Neu in deiner Bibliothek</h2>${trackCards(added)}
    <h2>Alben <button class="chip" data-action="nav" data-view="library" data-param="albums">Alle anzeigen</button></h2>
    ${albumCards(albs.slice(0, 15), true)}
    ${state.playlists.length ? `<h2>Deine Playlists</h2>${playlistCards(state.playlists.slice(0, 12))}` : ''}`;
}

function sortedTracks(list) {
  const s = state.libSort;
  const a = [...list];
  if (s === 'title') a.sort((x, y) => byText(x.title, y.title));
  else if (s === 'artist') a.sort((x, y) => byText(x.artist, y.artist) || byText(x.album, y.album) || (x.trackNo || 0) - (y.trackNo || 0));
  else if (s === 'added') a.sort((x, y) => y.addedAt - x.addedAt);
  else if (s === 'plays') a.sort((x, y) => (y.plays || 0) - (x.plays || 0));
  else if (s === 'duration') a.sort((x, y) => (y.duration || 0) - (x.duration || 0));
  return a;
}

function matches(t, q) {
  if (!q) return true;
  return `${t.title} ${t.artist} ${t.album} ${t.genre || ''}`.toLowerCase().includes(q);
}

function libraryList() {
  const tab = state.route.param || 'songs';
  const q = state.libQuery.trim().toLowerCase();
  if (tab === 'albums') {
    const list = albums().filter((a) => !q || `${a.album} ${a.artist}`.toLowerCase().includes(q));
    return list.length ? albumCards(list) : '<div class="empty">Keine Alben gefunden</div>';
  }
  if (tab === 'artists') {
    const list = artists().filter((a) => !q || a.name.toLowerCase().includes(q));
    if (!list.length) return '<div class="empty">Keine Künstler gefunden</div>';
    return `<div class="grid">${list.map((a) => `
      <button class="card" data-action="nav" data-view="artist" data-param="${esc(a.name)}">
        ${groupCover(a.tracks, 'md', a.name, 'person', true)}
        <div class="t" style="text-align:center">${esc(a.name)}</div>
        <div class="a" style="text-align:center">${plural(a.tracks.length, 'Titel', 'Titel')}</div>
      </button>`).join('')}</div>`;
  }
  let list = state.tracks.filter((t) => matches(t, q));
  if (tab === 'favs') list = list.filter((t) => t.favorite);
  if (tab === 'offline') {
    list = list.filter((t) => !isStream(t) || t.downloaded);
    const dl = downloadedBytes();
    return `<p class="muted small offline-note">${icon('downloadDone')} ${plural(list.length, 'Titel', 'Titel')} ohne Internet hörbar · eigene Dateien sind immer offline${dl ? ` · Downloads: ${mb(dl)}` : ''}</p>` +
      trackRows(sortedTracks(list), { empty: 'Noch nichts offline. Lade Songs unter „Entdecken“ herunter.' });
  }
  return trackRows(sortedTracks(list), { empty: tab === 'favs' ? 'Noch keine Lieblingssongs – tippe auf ♡ beim Abspielen.' : 'Nichts gefunden' });
}

function viewLibrary() {
  if (!state.tracks.length) return `<h1>Bibliothek</h1>${emptyLibrary()}<p class="center"><button class="btn" data-action="nav" data-view="discover">${icon('explore')}Oder Songs im Katalog entdecken</button></p>`;
  const tab = state.route.param || 'songs';
  const tabs = [['songs', 'Titel'], ['albums', 'Alben'], ['artists', 'Künstler'], ['favs', 'Lieblingssongs'], ['offline', 'Offline']];
  const showSort = tab === 'songs' || tab === 'favs' || tab === 'offline';
  return `
    <div class="row" style="margin-bottom:14px"><h1 style="margin:0">Bibliothek</h1><span class="spacer"></span>
      <button class="btn" data-action="import">${icon('add')}<span class="hide-sm">Hinzufügen</span></button></div>
    <div class="tabs">${tabs.map(([id, l]) => `<button class="chip${tab === id ? ' on' : ''}" data-action="nav" data-view="library" data-param="${id}">${l}</button>`).join('')}</div>
    <div class="row" style="margin-bottom:16px">
      <label class="search">${icon('search')}<input class="input" id="lib-search" type="search" placeholder="Titel, Künstler, Alben, Genres …" value="${esc(state.libQuery)}" autocomplete="off"></label>
      ${showSort ? `<div class="row nowrap"><select class="input" id="lib-sort" aria-label="Sortierung">
        ${[['title', 'Titel A–Z'], ['artist', 'Künstler'], ['added', 'Zuletzt hinzugefügt'], ['plays', 'Meistgehört'], ['duration', 'Länge']]
          .map(([v, l]) => `<option value="${v}"${state.libSort === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="btn" data-action="play-visible">${icon('play')}Alle</button>
      <button class="btn" data-action="shuffle-visible" aria-label="Zufällig abspielen">${icon('shuffle')}</button></div>` : ''}
    </div>
    <div id="lib-list">${libraryList()}</div>`;
}

function heroActions(listKey, extra = '') {
  return `<div class="hero-actions">
    <button class="btn btn-primary" data-action="play-in" data-list="${listKey}" data-index="0">${icon('play')}Abspielen</button>
    <button class="btn" data-action="shuffle-list" data-list="${listKey}">${icon('shuffle')}Zufall</button>
    ${extra}</div>`;
}

function viewAlbum() {
  const a = albums().find((x) => x.key === state.route.param);
  if (!a) return `<button class="chip back" data-action="back">${icon('back')}Zurück</button><div class="empty">Album nicht gefunden</div>`;
  const total = a.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const rows = trackRows(a.tracks, { noAlbum: true, trackNo: true });
  return `<button class="chip back" data-action="back">${icon('back')}Zurück</button>
    <div class="hero">${groupCover(a.tracks, 'lg', a.album)}
      <div><div class="kind">Album</div><h1>${esc(a.album)}</h1>
        <div class="muted"><a href="#/artist/${encodeURIComponent(a.artist)}" style="color:var(--text);font-weight:700;text-decoration:none">${esc(a.artist)}</a>
        ${a.year ? ' · ' + esc(a.year) : ''} · ${plural(a.tracks.length, 'Titel', 'Titel')} · ${fmtLong(total)}</div>
        ${heroActions('l0')}</div></div>${rows}`;
}

function viewArtist() {
  const a = artists().find((x) => x.name === state.route.param);
  if (!a) return `<button class="chip back" data-action="back">${icon('back')}Zurück</button><div class="empty">Künstler nicht gefunden</div>`;
  const top = [...a.tracks].sort((x, y) => (y.plays || 0) - (x.plays || 0) || byText(x.title, y.title));
  const rows = trackRows(top);
  const albs = albums().filter((al) => al.tracks.some((t) => t.artist === a.name));
  return `<button class="chip back" data-action="back">${icon('back')}Zurück</button>
    <div class="hero">${groupCover(a.tracks, 'lg', a.name, 'person', true)}
      <div><div class="kind">Künstler</div><h1>${esc(a.name)}</h1>
      <div class="muted">${plural(a.tracks.length, 'Titel', 'Titel')} · ${plural(albs.length, 'Album', 'Alben')}</div>
      ${heroActions('l0')}</div></div>
    <h2>Titel</h2>${rows}
    <h2>Alben</h2>${albumCards(albs)}`;
}

function viewPlaylists() {
  return `<div class="row" style="margin-bottom:18px"><h1 style="margin:0">Playlists</h1></div>${playlistCards(state.playlists, true)}`;
}

function viewPlaylist() {
  const p = state.playlists.find((x) => x.id === state.route.param);
  if (!p) return `<button class="chip back" data-action="back">${icon('back')}Zurück</button><div class="empty">Playlist nicht gefunden</div>`;
  const tracks = p.trackIds.map(getTrack).filter(Boolean);
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const rows = trackRows(tracks, { playlistId: p.id, sortable: 'pl:' + p.id, empty: 'Diese Playlist ist leer. Füge Titel über das ⋮-Menü hinzu.' });
  return `<button class="chip back" data-action="back">${icon('back')}Zurück</button>
    <div class="hero">${groupCover(tracks, 'lg', p.name, 'playlist')}
      <div><div class="kind">Playlist</div><h1>${esc(p.name)}</h1>
      <div class="muted">${plural(tracks.length, 'Titel', 'Titel')} · ${fmtLong(total)}</div>
      ${tracks.length ? heroActions('l0', `<button class="btn" data-action="share-playlist" data-id="${esc(p.id)}">${icon('share')}Teilen</button><button class="icon-btn" data-action="playlist-menu" data-id="${esc(p.id)}" aria-label="Playlist-Optionen">${icon('more')}</button>`)
        : `<div class="hero-actions"><button class="icon-btn" data-action="playlist-menu" data-id="${esc(p.id)}" aria-label="Playlist-Optionen">${icon('more')}</button></div>`}
      </div></div>${rows}`;
}

// ---------- Radio ----------
const RADIO_TAGS = ['Pop', 'Rock', 'Hip-Hop', 'Electronic', 'Jazz', 'Klassik', 'Chillout', 'Schlager', 'Dance', 'News', '80s', 'Lofi'];
const TAG_QUERY = { Klassik: 'classical', 'Hip-Hop': 'hiphop', Electronic: 'electronic', News: 'news', Chillout: 'chillout', Lofi: 'lofi' };

async function radioApi(path) {
  for (const host of ['de1', 'nl1', 'at1']) {
    try {
      const r = await fetch(`https://${host}.api.radio-browser.info/json/${path}`);
      if (r.ok) return await r.json();
    } catch { /* try next mirror */ }
  }
  throw new Error('Radio-Verzeichnis nicht erreichbar');
}

function toStation(s) {
  return {
    id: s.stationuuid,
    name: (s.name || 'Unbekannter Sender').trim(),
    url: s.url_resolved || s.url,
    favicon: /^https:\/\//.test(s.favicon || '') ? s.favicon : '',
    tags: (s.tags || '').split(',').slice(0, 3).join(', '),
    country: s.countrycode || '',
    codec: s.codec || '',
    bitrate: s.bitrate || 0,
  };
}

async function searchRadio() {
  const r = state.radio;
  r.loading = true;
  r.error = '';
  if (state.route.view === 'radio') renderRadioList();
  const params = new URLSearchParams({ limit: '60', hidebroken: 'true', order: 'clickcount', reverse: 'true' });
  if (r.query) params.set('name', r.query);
  if (r.tag) params.set('tag', TAG_QUERY[r.tag] || r.tag.toLowerCase());
  if (!r.query && !r.tag) params.set('countrycode', 'DE');
  try {
    const list = await radioApi('stations/search?' + params);
    const secure = location.protocol === 'https:';
    r.results = list.map(toStation).filter((s) => /^https?:\/\//.test(s.url) && (!secure || s.url.startsWith('https://')));
    const seen = new Set();
    r.results = r.results.filter((s) => (seen.has(s.name.toLowerCase()) ? false : seen.add(s.name.toLowerCase())));
    r.loaded = true;
  } catch (e) {
    r.error = e.message;
  }
  r.loading = false;
  if (state.route.view === 'radio') renderRadioList();
}

function stationRows(list) {
  return `<div class="tracks">${list.map((s) => {
    state.stations.set(s.id, s);
    const fav = radioFavs.some((f) => f.id === s.id);
    const playing = player.mode === 'radio' && player.station?.id === s.id;
    return `<div class="track station${playing ? ' current' : ''}" data-action="play-station" data-sid="${esc(s.id)}" data-id="${esc(s.id)}">
      <div class="cover sm">${s.favicon ? `<img src="${esc(s.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${icon('radio')}</div>
      <div class="meta"><div class="t">${esc(s.name)}</div>
        <div class="a">${esc([s.country, s.tags, s.bitrate ? s.bitrate + ' kbps' : ''].filter(Boolean).join(' · '))}</div></div>
      <button class="icon-btn${fav ? ' fav' : ''}" data-action="radio-fav" data-sid="${esc(s.id)}" aria-label="Favorit">${icon(fav ? 'heart' : 'heartOutline')}</button>
    </div>`;
  }).join('')}</div>`;
}

function renderRadioList() {
  const el = $('#radio-list');
  if (!el) return;
  const r = state.radio;
  if (r.loading) el.innerHTML = '<div class="empty">Sender werden geladen …</div>';
  else if (r.error) el.innerHTML = `<div class="empty">${esc(r.error)}<br><br><button class="btn" data-action="radio-retry">Erneut versuchen</button></div>`;
  else if (!r.results.length) el.innerHTML = '<div class="empty">Keine Sender gefunden</div>';
  else el.innerHTML = stationRows(r.results);
}

function viewRadio() {
  const r = state.radio;
  const title = r.query ? `Ergebnisse für „${esc(r.query)}“` : r.tag ? esc(r.tag) : 'Beliebt in Deutschland';
  return `<h1>Radio</h1><p class="sub">Tausende Live-Sender weltweit – kostenlos und ohne Anmeldung.</p>
    <form class="row" data-form="radio-search" style="margin-bottom:12px">
      <label class="search">${icon('search')}<input class="input" id="radio-q" type="search" placeholder="Sender suchen …" value="${esc(r.query)}"></label>
    </form>
    <div class="tabs">${RADIO_TAGS.map((t) => `<button class="chip${r.tag === t ? ' on' : ''}" data-action="radio-tag" data-tag="${t}">${t}</button>`).join('')}</div>
    ${radioFavs.length ? `<h2>Deine Sender</h2>${stationRows(radioFavs)}` : ''}
    <h2>${title}</h2><div id="radio-list"></div>`;
}

// ---------- Settings ----------
const ACCENTS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899'];

function viewSettings() {
  const s = player.settings;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let install = '';
  if (!standalone) {
    if (state.installPrompt) install = `<button class="btn btn-primary" data-action="install">${icon('download')}Melody installieren</button>`;
    else if (isIOS) install = '<p>Auf dem iPhone/iPad: In Safari auf <b>Teilen</b> tippen und <b>„Zum Home-Bildschirm“</b> wählen.</p>';
    else install = '<p>Im Browser-Menü <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen.</p>';
  }
  return `<h1>Einstellungen</h1><p class="sub">Melody ${VERSION} · werbefrei · kein Tracking</p>
    ${install ? `<div class="panel"><h3>Als App installieren</h3><p>Melody läuft auf Smartphone, Tablet und Computer – wie eine native App, mit Offline-Modus.</p>${install}</div>` : ''}
    <div class="panel"><h3>Darstellung</h3>
      <div class="setting"><span>Design</span><div class="row">
        ${[['dark', 'Dunkel'], ['light', 'Hell'], ['auto', 'System']].map(([v, l]) => `<button class="chip${ui.theme === v ? ' on' : ''}" data-action="theme" data-theme="${v}">${l}</button>`).join('')}
      </div></div>
      <div class="setting"><span>Akzentfarbe</span><div class="swatches">
        ${ACCENTS.map((c) => `<button class="swatch${ui.accent === c ? ' on' : ''}" style="--c:${c}" data-action="accent" data-color="${c}" aria-label="Farbe ${c}"></button>`).join('')}
      </div></div>
    </div>
    <div class="panel" id="a11y-panel"><h3>${icon('accessibility')} Barrierefreiheit</h3>
      <div class="setting"><span>Schriftgröße</span><div class="row" role="group" aria-label="Schriftgröße">
        ${TEXT_SIZES.map(([v, l]) => `<button class="chip${a11y.text === v ? ' on' : ''}" data-action="a11y-text" data-v="${v}" aria-pressed="${a11y.text === v}">${l}</button>`).join('')}
      </div></div>
      ${[['contrast', 'Hoher Kontrast', 'Kräftigere Schrift, Rahmen und Fokus-Markierung'],
    ['calm', 'Weniger Bewegung', 'Keine Animationen, ruhige Party-Lichter'],
    ['speak', 'Titel ansagen', 'Melody sagt bei jedem neuen Lied Titel und Künstler an']].map(([k, l, d]) => `
      <div class="setting"><div><div id="a11y-${k}">${l}</div><div class="muted" style="font-size:13px">${d}</div></div>
        <label class="switch"><input type="checkbox" data-a11y="${k}" aria-labelledby="a11y-${k}" ${a11y[k] ? 'checked' : ''}><span></span></label></div>`).join('')}
      <p class="muted" style="font-size:13px;margin:8px 0 0">Playlists und Warteschlange lassen sich am Griff ${icon('drag')} verschieben – mit Maus, Finger oder Pfeiltasten. Auf dem Handy wischst du über den Mini-Player zum nächsten Lied. Taste <b>?</b> zeigt alle Tastenkürzel.</p>
    </div>
    <div class="panel"><h3>Wiedergabe</h3>
      <div class="setting"${isIOS ? ' hidden' : ''}><div><div>Audio-Effekte</div><div class="muted" style="font-size:13px">Equalizer & Visualizer</div></div>
        <label class="switch"><input type="checkbox" data-setting="fx" ${s.fx ? 'checked' : ''}><span></span></label></div>
      <div class="setting"><span>Geschwindigkeit</span><select class="input" data-setting="rate">
        ${[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((r) => `<option value="${r}"${s.rate === r ? ' selected' : ''}>${String(r).replace('.', ',')}×</option>`).join('')}
      </select></div>
    </div>
    <div class="panel"><h3>Sound-Studio</h3><p>Melody-Sound, Equalizer, DJ-Effekte und Übergänge zwischen Songs.</p>
      <button class="btn" data-action="nav" data-view="studio">${icon('tune')}Sound-Studio öffnen</button></div>
    <div class="panel"><h3>Konto & Abo</h3><p>${esc(state.account?.email || '')}</p>
      <button class="btn" data-action="nav" data-view="account">${icon('account')}Konto verwalten</button></div>
    <div class="panel"><h3>Bibliothek & Speicher</h3>
      <p id="storage-info">${plural(state.tracks.length, 'Titel', 'Titel')} gespeichert.</p>
      <div class="row">
        <button class="btn" data-action="import">${icon('upload')}Dateien importieren</button>
        <button class="btn hide-sm" data-action="import-folder">${icon('folder')}Ordner importieren</button>
        <button class="btn btn-danger" data-action="clear-library">${icon('delete')}Bibliothek leeren</button>
      </div>
    </div>
    <div class="panel"><h3>Tastenkürzel</h3>
      <p>Leertaste: Play/Pause · ←/→: 10 s spulen · Umschalt + ←/→: Titel zurück/vor · F: Favorit · ↑/↓: Lautstärke · / oder Strg+K: Suchen · S: Song erkennen · ?: Alle Kürzel</p></div>
    <div class="panel"><h3>Über Melody</h3>
      <p>Deine Musik bleibt auf deinem Gerät. Melody sammelt keine Daten und zeigt niemals Werbung. Radiosender stammen aus dem freien Verzeichnis radio-browser.info.</p></div>`;
}

async function updateStorageInfo() {
  const el = $('#storage-info');
  if (!el || !navigator.storage?.estimate) return;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const mb = (b) => (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 0 });
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  if ($('#storage-info') === el) {
    el.textContent = `${plural(state.tracks.length, 'Titel', 'Titel')} · ${mb(usage)} MB von ${mb(quota)} MB belegt${persisted ? ' · dauerhaft gespeichert' : ''}.`;
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = ui.theme;
  document.documentElement.style.setProperty('--accent', ui.accent);
  const dark = ui.theme === 'dark' || (ui.theme === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  $('meta[name=theme-color]').content = dark ? '#0f0f14' : '#f6f6fa';
}

function sheetHead(t) {
  return `<div class="sheet-head">${coverHTML(t, 'sm')}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)} · ${esc(t.album)}</div></div></div>`;
}

function trackMenu(id, playlistId, index) {
  const t = getTrack(id);
  if (!t) return;
  state.menu = { id, playlistId, index };
  const item = (action, ico, label, cls = '') => `<button class="sheet-item ${cls}" data-action="${action}">${icon(ico)}${label}</button>`;
  openSheet(`${sheetHead(t)}
    ${item('m-next', 'playNext', 'Als Nächstes abspielen')}
    ${item('m-queue', 'queue', 'Zur Warteschlange hinzufügen')}
    ${item('m-sing', 'mic', 'Mitsingen')}
    ${item('m-add-pl', 'add', 'Zu Playlist hinzufügen')}
    ${isStream(t) ? item('dl-track', t.downloaded ? 'delete' : 'download', t.downloaded ? 'Download entfernen' : 'Herunterladen (offline hören)') : ''}
    ${item('m-fav', t.favorite ? 'heart' : 'heartOutline', t.favorite ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs', t.favorite ? 'on' : '')}
    ${t.source === 'audius' ? (t.permalink ? `<a class="sheet-item" href="${esc(t.permalink)}" target="_blank" rel="noopener">${icon('globe')}Bei Audius öffnen (Künstler unterstützen)</a>` : '') : item('m-album', 'album', 'Zum Album')}
    ${item('m-artist', 'person', 'Zum Künstler')}
    ${item('m-edit', t.cover ? 'edit' : 'image', t.cover ? 'Infos & Cover bearbeiten' : 'Infos & Cover ergänzen')}
    ${item('m-lyrics', 'lyrics', 'Lyrics bearbeiten')}
    ${playlistId ? item('m-remove-pl', 'close', 'Aus dieser Playlist entfernen') : ''}
    ${t.temp ? '' : item('m-delete', 'delete', isStream(t) ? 'Aus Bibliothek entfernen' : 'Vom Gerät löschen', 'danger')}`);
}

function addToPlaylistSheet(ids) {
  state.menu = { ...(state.menu || {}), addIds: ids };
  openSheet(`<h3>Zu Playlist hinzufügen</h3>
    <button class="sheet-item" data-action="pl-add-new">${icon('add')}Neue Playlist …</button>
    ${state.playlists.map((p) => `<button class="sheet-item" data-action="pl-add" data-id="${esc(p.id)}">${icon('playlist')}${esc(p.name)}<span class="spacer"></span><span class="muted">${p.trackIds.length}</span></button>`).join('')}`);
}

function queueSheet() {
  if (player.mode === 'radio') {
    openSheet(`<h3>Live-Radio</h3><p class="muted" style="padding:0 8px">${esc(player.station?.name || '')}</p>`);
    return;
  }
  const q = player.queue;
  const cur = getTrack(player.currentId);
  const upcoming = q.slice(player.index + 1, player.index + 101);
  openSheet(`<h3>Wird gespielt</h3>${cur ? sheetHead(cur) : '<p class="muted">Nichts</p>'}
    <h3 style="margin-top:14px">Als Nächstes${player.shuffle ? ' (Zufall)' : ''}</h3>
    ${upcoming.length ? `<div data-sort="queue" data-base="${player.index + 1}">${upcoming.map((id, k) => {
      const t = getTrack(id);
      const i = player.index + 1 + k;
      if (!t) return `<div data-sort-item hidden></div>`;
      return `<div class="track q" data-action="q-jump" data-index="${i}" data-sort-item>
        <button class="drag-handle" data-drag data-action="drag-noop" aria-label="${esc(t.title)} verschieben (Pfeiltasten hoch/runter)">${icon('drag')}</button>${coverHTML(t, 'sm')}
        <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>
        <button class="icon-btn" data-action="q-remove" data-index="${i}" aria-label="${esc(t.title)} entfernen">${icon('close')}</button></div>`;
    }).join('')}</div>` : '<p class="muted" style="padding:0 8px">Die Warteschlange ist leer.</p>'}
    ${q.length - player.index - 1 > 100 ? `<p class="muted" style="padding:0 8px">… und ${q.length - player.index - 101} weitere</p>` : ''}`);
}

function shortcutsSheet() {
  const keys = [['Leertaste', 'Abspielen / Pause'], ['← / →', '10 Sekunden zurück / vor (Podcasts: 15 / 30)'],
    ['Umschalt + ← / →', 'Vorheriger / nächster Titel'], ['↑ / ↓', 'Lauter / leiser'], ['F', 'Lieblingssong an / aus'],
    ['/ oder Strg + K', 'Suchen'], ['S', 'Song erkennen'], ['Esc', 'Schließen'], ['Tab / Umschalt + Tab', 'Zum nächsten / vorigen Bedienelement'],
    ['↑ / ↓ am Griff', 'Titel in Playlist oder Warteschlange verschieben'], ['?', 'Diese Übersicht']];
  openSheet(`<h3>Tastenkürzel</h3><dl class="keys">${keys.map(([k, d]) => `<div><dt><kbd>${k}</kbd></dt><dd>${d}</dd></div>`).join('')}</dl>`);
}

registerSorter('pl', (from, to, id) => {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return;
  p.trackIds = p.trackIds.filter((x) => getTrack(x));
  const [moved] = p.trackIds.splice(from, 1);
  p.trackIds.splice(to, 0, moved);
  rerenderKeepScroll();
  db.put('playlists', p).catch(() => toast('Reihenfolge konnte nicht gespeichert werden.'));
});
registerSorter('queue', (from, to, _arg, list) => {
  const base = +list.dataset.base;
  player.moveInQueue(base + from, base + to);
  queueSheet();
});

function sleepSheet() {
  const active = player.sleepUntil ? `Endet in ${Math.ceil((player.sleepUntil - Date.now()) / 60000)} Min.` : player.sleepAtEnd ? 'Endet nach diesem Titel' : '';
  openSheet(`<h3>Sleep-Timer</h3>${active ? `<p class="muted" style="padding:0 8px">${active}</p>` : ''}
    ${[5, 15, 30, 45, 60, 90].map((m) => `<button class="sheet-item" data-action="sleep" data-min="${m}">${icon('timer')}${m} Minuten</button>`).join('')}
    <button class="sheet-item" data-action="sleep" data-min="end">${icon('note')}${player.mode === 'podcast' ? 'Ende der Folge' : 'Ende des Titels'}</button>
    ${active ? `<button class="sheet-item danger" data-action="sleep" data-min="0">${icon('close')}Timer ausschalten</button>` : ''}`);
}

function speedSheet() {
  const pod = player.mode === 'podcast';
  const cur = pod ? player.settings.podRate || 1 : player.settings.rate;
  const rates = pod ? [0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5] : [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  openSheet(`<h3>${pod ? 'Podcast-Geschwindigkeit' : 'Wiedergabegeschwindigkeit'}</h3>
    ${rates.map((r) => `<button class="sheet-item${cur === r ? ' on' : ''}" data-action="rate" data-rate="${r}">${icon('speed')}${String(r).replace('.', ',')}×${r === 1 ? ' (Normal)' : ''}</button>`).join('')}`);
}

// ---------- Library mutations ----------
async function toggleFav(t) {
  if (!t) return;
  t.favorite = !t.favorite;
  if (t.temp) await keepTrack(t);
  else await db.put('tracks', t);
  toast(t.favorite ? 'Zu Lieblingssongs hinzugefügt' : 'Aus Lieblingssongs entfernt');
  updatePlayerUI();
  rerenderKeepScroll();
}

async function createPlaylist(name, ids = []) {
  for (const id of ids) await keepTrack(getTrack(id));
  const p = { id: uid(), name: name.trim(), trackIds: [...ids], createdAt: Date.now() };
  await db.put('playlists', p);
  state.playlists.push(p);
  return p;
}

async function addToPlaylist(p, ids) {
  const fresh = ids.filter((id) => !p.trackIds.includes(id));
  for (const id of fresh) await keepTrack(getTrack(id));
  p.trackIds.push(...fresh);
  await db.put('playlists', p);
  toast(fresh.length ? `Zu „${p.name}“ hinzugefügt` : 'Bereits in der Playlist');
}

async function deleteTrack(id) {
  await db.deleteTrack(id);
  const u = state.covers.get(id);
  if (u) URL.revokeObjectURL(u);
  state.covers.delete(id);
  state.tracks = state.tracks.filter((t) => t.id !== id);
  state.map.delete(id);
  for (const p of state.playlists) {
    if (p.trackIds.includes(id)) {
      p.trackIds = p.trackIds.filter((x) => x !== id);
      await db.put('playlists', p);
    }
  }
  player.forget(id);
}

function rerenderKeepScroll() {
  const main = $('#main');
  const top = main.scrollTop;
  if (state.route.view === 'library' && $('#lib-list')) {
    const keep = state.lists;
    state.lists = {};
    $('#lib-list').innerHTML = libraryList();
    if (!Object.keys(state.lists).length) state.lists = keep;
  } else {
    render();
  }
  main.scrollTop = top;
}

// ---------- Import ----------
const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|webm|weba|aiff?|caf)$/i;
const isAudio = (f) => (f.type && f.type.startsWith('audio/')) || AUDIO_EXT.test(f.name);

async function importFiles(fileList) {
  const all = [...fileList];
  const lrc = all.filter((f) => /\.lrc$/i.test(f.name));
  const files = all.filter(isAudio);
  if (!files.length && lrc.length) {
    const n = await attachLrcFiles(lrc, state.tracks);
    toast(n ? `${plural(n, 'Songtext', 'Songtexte')} zugeordnet` : 'Keine passenden Titel für die .lrc-Dateien gefunden');
    return;
  }
  if (!files.length) {
    toast('Keine Audiodateien gefunden');
    return;
  }
  const existing = new Set(state.tracks.map((t) => `${t.fileName}|${t.size}`));
  let added = 0, skipped = 0, failed = 0;
  for (const [i, f] of files.entries()) {
    toast(`Importiere ${i + 1} von ${files.length} …`, true);
    if (existing.has(`${f.name}|${f.size}`)) { skipped++; continue; }
    try {
      const duration = await readDuration(f);
      if (duration < 0) { failed++; continue; }
      const tags = await readTags(f);
      const t = {
        id: uid(), title: tags.title, artist: tags.artist, albumArtist: tags.albumArtist || '', album: tags.album,
        year: tags.year || '', trackNo: tags.trackNo || 0, genre: tags.genre || '', cover: tags.cover || null,
        duration, fileName: f.name, size: f.size, type: f.type, addedAt: Date.now() + i, favorite: false, plays: 0,
      };
      await db.addTrack(t, f);
      state.tracks.push(t);
      state.map.set(t.id, t);
      existing.add(`${f.name}|${f.size}`);
      added++;
    } catch (e) {
      console.error(e);
      failed++;
      if (e && e.name === 'QuotaExceededError') { toast('Speicher voll – Import abgebrochen'); break; }
    }
  }
  const lyricsAdded = lrc.length ? await attachLrcFiles(lrc, state.tracks) : 0;
  const parts = [`${plural(added, 'Titel', 'Titel')} importiert`];
  if (lyricsAdded) parts.push(`${plural(lyricsAdded, 'Songtext', 'Songtexte')}`);
  if (skipped) parts.push(`${skipped} bereits vorhanden`);
  if (failed) parts.push(`${failed} nicht unterstützt`);
  toast(parts.join(' · '));
  if (added && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  render();
}

// ---------- Player UI ----------
let seeking = false;

function updatePlayerUI() {
  if (player.mode === 'podcast') return updatePodcastUI();
  const radio = player.mode === 'radio';
  const t = radio ? null : player.track;
  const bar = $('#player-bar');
  bar.hidden = !radio && !t;
  if (bar.hidden) {
    if (!$('#now-playing').hidden) closeNowPlaying();
    return;
  }
  const title = radio ? player.station.name : t.title;
  const artist = radio ? 'Live-Radio' + (player.station.tags ? ' · ' + player.station.tags : '') : t.artist;
  $('#pb-title').textContent = $('#np-title').textContent = title;
  $('#pb-artist').textContent = $('#np-artist').textContent = artist;
  const coverHtml = radio
    ? `<div class="cover" style="--h:${hue(title)}">${player.station.favicon ? `<img src="${esc(player.station.favicon)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${icon('radio')}</div>`
    : coverHTML(t);
  for (const [sel, size] of [['#pb-cover', 'sm'], ['#np-cover', 'xl']]) {
    const tmp = document.createElement('div');
    tmp.innerHTML = coverHtml;
    const c = tmp.firstElementChild;
    c.classList.add(size);
    c.id = sel.slice(1);
    // Own songs without a picture: offer to add one right on the big cover.
    if (size === 'xl' && !radio && !t.cover && !isStream(t)) c.insertAdjacentHTML('beforeend', `<button class="np-addcover" data-action="edit-current">${icon('image')}Cover hinzufügen</button>`);
    $(sel).replaceWith(c);
  }
  $('#np-bg').style.setProperty('--h', hue(radio ? title : t.album));
  $('#np-context').textContent = radio ? 'Live-Radio' : t.album;
  const fav = !radio && t.favorite;
  const npFav = $('#np-fav');
  npFav.hidden = radio;
  npFav.classList.toggle('fav', fav);
  setIcon(npFav, fav ? 'heart' : 'heartOutline');
  document.querySelectorAll('[data-action=shuffle], [data-action=repeat], [data-action=prev], [data-action=next], #np-seek, .np-extra [data-action=speed-menu]')
    .forEach((el) => { el.disabled = radio; el.style.opacity = radio ? '.35' : ''; });
  updateState();
  updateTime();
  markCurrent();
}

function setCovers(html) {
  for (const [sel, size] of [['#pb-cover', 'sm'], ['#np-cover', 'xl']]) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const c = tmp.firstElementChild;
    c.classList.add(size);
    c.id = sel.slice(1);
    $(sel).replaceWith(c);
  }
}

function updatePodcastUI() {
  const { ep, pod } = player.episode;
  $('#player-bar').hidden = false;
  $('#pb-title').textContent = $('#np-title').textContent = ep.title;
  $('#pb-artist').textContent = $('#np-artist').textContent = pod.title;
  const img = ep.image || pod.image;
  setCovers(`<div class="cover" style="--h:${hue(pod.title)}">${img ? `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : icon('mic')}</div>`);
  $('#np-bg').style.setProperty('--h', hue(pod.title));
  $('#np-context').textContent = 'Podcast';
  $('#np-fav').hidden = true;
  document.querySelectorAll('[data-action=shuffle], [data-action=repeat]').forEach((el) => { el.disabled = true; el.style.opacity = '.35'; });
  document.querySelectorAll('[data-action=prev], [data-action=next], #np-seek, .np-extra [data-action=speed-menu]').forEach((el) => { el.disabled = false; el.style.opacity = ''; });
  updateState();
  updateTime();
}

function updateState() {
  const playing = player.playing;
  $('#now-playing').classList.toggle('is-playing', playing); // paused: the cover steps back a little
  for (const id of ['#pb-play', '#np-play']) {
    const b = $(id);
    setIcon(b, playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
  }
  for (const id of ['#pb-shuffle', '#np-shuffle']) $(id).classList.toggle('on', player.shuffle);
  for (const id of ['#pb-repeat', '#np-repeat']) {
    const b = $(id);
    b.classList.toggle('on', player.repeat !== 'off');
    setIcon(b, player.repeat === 'one' ? 'repeatOne' : 'repeat');
  }
  $('#np-speed').textContent = String(player.mode === 'podcast' ? player.settings.podRate || 1 : player.settings.rate).replace('.', ',') + '×';
  $('#np-sleep').textContent = player.sleepUntil ? `${Math.ceil((player.sleepUntil - Date.now()) / 60000)} Min.` : player.sleepAtEnd ? 'Titelende' : 'Sleep';
  if (playing) startViz();
}

function updateTime() {
  if (player.mode === 'radio') {
    $('#pb-fill').style.width = '100%';
    $('#pb-time').innerHTML = '<span class="live">Live</span>';
    $('#np-cur').innerHTML = '<span class="live">Live</span>';
    $('#np-dur').textContent = '';
    const s = $('#np-seek');
    s.value = 1000;
    setRangeP(s);
    return;
  }
  const el = player.media;
  const d = el.duration || (player.mode === 'podcast' ? player.episode?.ep.duration : player.track?.duration) || 0;
  const c = el.currentTime || 0;
  const pct = d ? (c / d) * 100 : 0;
  $('#pb-fill').style.width = pct + '%';
  $('#pb-time').textContent = `${fmt(c)} / ${fmt(d)}`;
  if (!seeking) {
    const s = $('#np-seek');
    s.value = d ? Math.round((c / d) * 1000) : 0;
    setRangeP(s);
    $('#np-cur').textContent = fmt(c);
  }
  $('#np-dur').textContent = fmt(d);
}

function markCurrent() {
  const id = player.mode === 'radio' ? player.station?.id : player.mode === 'podcast' ? null : player.currentId;
  document.querySelectorAll('.track[data-id]').forEach((el) => el.classList.toggle('current', el.dataset.id === id));
}

// The full-screen player slides up like a sheet and back down when closed.
let npTimer = 0;
function openNowPlaying() {
  if ($('#player-bar').hidden) return;
  const np = $('#now-playing');
  clearTimeout(npTimer);
  np.classList.remove('np-closing');
  np.style.transform = '';
  np.hidden = false;
  void np.offsetWidth; // start from the closed position, then animate
  np.classList.add('np-shown');
  startViz();
  onNowPlayingOpen();
}
function closeNowPlaying() {
  const np = $('#now-playing');
  if (np.hidden) return;
  if (!np.classList.contains('np-shown')) { np.hidden = true; return; }
  np.classList.remove('np-shown');
  np.classList.add('np-closing');
  np.style.transform = '';
  clearTimeout(npTimer);
  npTimer = setTimeout(() => { np.hidden = true; np.classList.remove('np-closing'); }, 320);
}

// Visualizer: frequency bars drawn while the now-playing screen is open.
let vizRunning = false;
function startViz() {
  const canvas = $('#np-viz');
  if (canvas.hidden) return;
  const ok = player.analyser && player.mode === 'library';
  canvas.closest('.np-art').classList.toggle('no-viz', !ok); // without effects there is nothing to draw: give the cover the room
  if (!ok || vizRunning) return;
  vizRunning = true;
  const g = canvas.getContext('2d');
  const data = new Uint8Array(player.analyser.frequencyBinCount);
  const draw = () => {
    if ($('#now-playing').hidden || !player.playing || player.mode !== 'library' || !player.analyser) {
      vizRunning = false;
      canvas.closest('.np-art')?.classList.toggle('no-viz', !player.analyser);
      g.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    player.analyser.getByteFrequencyData(data);
    const W = canvas.width, H = canvas.height, n = 48;
    g.clearRect(0, 0, W, H);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, '#ec4899');
    g.fillStyle = grad;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = data[Math.floor((i / n) ** 1.6 * data.length * 0.85)] / 255;
      const h = Math.max(3, v * H);
      g.beginPath();
      g.roundRect ? g.roundRect(i * bw + 2, H - h, bw - 4, h, 3) : g.rect(i * bw + 2, H - h, bw - 4, h);
      g.fill();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ---------- Actions ----------
function listFromVisible() {
  const tab = state.route.param || 'songs';
  const q = state.libQuery.trim().toLowerCase();
  let list = state.tracks.filter((t) => matches(t, q));
  if (tab === 'favs') list = list.filter((t) => t.favorite);
  if (tab === 'offline') list = list.filter((t) => !isStream(t) || t.downloaded);
  return sortedTracks(list).map((t) => t.id);
}

const ACTIONS = {
  nav: (el) => { closeSheet(); closeNowPlaying(); go(el.dataset.view, el.dataset.param || ''); $('#main').scrollTop = 0; },
  back: () => history.back(),
  import: () => $('#file-input').click(),
  'import-folder': () => $('#folder-input').click(),
  'play-in': (el) => {
    const ids = state.lists[el.dataset.list];
    if (!ids) return;
    const start = ids[+el.dataset.index || 0];
    if (!playable(getTrack(start))) { toast('Offline – dieser Titel ist nicht heruntergeladen.'); return; }
    const ok = ids.filter((id) => playable(getTrack(id)));
    player.playList(ok, Math.max(0, ok.indexOf(start)));
  },
  'shuffle-list': (el) => {
    const ids = state.lists[el.dataset.list];
    if (ids) player.playShuffled(ids);
  },
  'play-visible': () => { player.setShuffle(false); player.playList(listFromVisible(), 0); },
  'shuffle-visible': () => player.playShuffled(listFromVisible()),
  mix: (el) => {
    const m = MIXES.find((x) => x.id === el.dataset.mix);
    const ids = m?.ids() || [];
    if (ids.length) { player.setShuffle(false); player.playList(ids, 0); toast(`${m.title} · ${plural(ids.length, 'Titel', 'Titel')}`); }
  },
  toggle: () => player.toggle(),
  next: () => player.next(),
  prev: () => player.prev(),
  shuffle: () => player.setShuffle(!player.shuffle),
  repeat: () => {
    player.cycleRepeat();
    toast({ off: 'Wiederholen aus', all: 'Alle wiederholen', one: 'Titel wiederholen' }[player.repeat]);
  },
  'open-np': () => openNowPlaying(),
  'close-np': () => closeNowPlaying(),
  'fav-current': () => toggleFav(player.track),
  'np-menu': () => { if (player.mode === 'library' && player.track) trackMenu(player.track.id, '', -1); },
  queue: () => queueSheet(),
  'q-jump': (el) => { player.jump(+el.dataset.index); closeSheet(); },
  'q-remove': (el) => { player.removeAt(+el.dataset.index); queueSheet(); },
  'sleep-menu': () => sleepSheet(),
  sleep: (el) => {
    const v = el.dataset.min;
    player.setSleep(v === 'end' ? 'end' : +v);
    closeSheet();
    toast(v === '0' ? 'Sleep-Timer aus' : v === 'end' ? 'Stoppt nach diesem Titel' : `Musik stoppt in ${v} Minuten`);
  },
  'speed-menu': () => speedSheet(),
  rate: (el) => { player.mode === 'podcast' ? player.setPodRate(+el.dataset.rate) : player.setRate(+el.dataset.rate); closeSheet(); },
  'goto-studio': () => { closeNowPlaying(); go('studio'); },
  'close-sheet': () => closeSheet(),
  'track-menu': (el) => trackMenu(el.dataset.id, el.dataset.pl, +el.dataset.index),
  'm-next': () => { player.addNext([state.menu.id]); closeSheet(); toast('Wird als Nächstes gespielt'); },
  'm-queue': () => { player.addEnd([state.menu.id]); closeSheet(); toast('Zur Warteschlange hinzugefügt'); },
  'm-add-pl': () => addToPlaylistSheet([state.menu.id]),
  'm-fav': () => { const t = getTrack(state.menu.id); closeSheet(); toggleFav(t); },
  'm-album': () => {
    const t = getTrack(state.menu.id);
    closeSheet(); closeNowPlaying();
    go('album', (t.albumArtist || t.artist) + '\u0001' + t.album);
  },
  'm-artist': () => { const t = getTrack(state.menu.id); closeSheet(); closeNowPlaying(); go('artist', t.artist); },
  'm-edit': () => editTrackSheet(getTrack(state.menu.id)),
  'm-lyrics': () => editLyricsSheet(getTrack(state.menu.id)),
  'm-sing': async () => {
    const id = state.menu.id;
    closeSheet();
    if (player.currentId !== id || player.mode !== 'library') await player.playList([id], 0);
    openSing();
  },
  'm-remove-pl': async () => {
    const p = state.playlists.find((x) => x.id === state.menu.playlistId);
    if (!p) return;
    p.trackIds.splice(state.menu.index, 1);
    await db.put('playlists', p);
    closeSheet();
    rerenderKeepScroll();
    toast('Aus Playlist entfernt');
  },
  'm-delete': async () => {
    const t = getTrack(state.menu.id);
    if (!(await confirmSheet(`„${t.title}“ vom Gerät löschen?`))) return;
    await deleteTrack(t.id);
    rerenderKeepScroll();
    toast('Titel gelöscht');
  },
  'pl-add': async (el) => {
    const p = state.playlists.find((x) => x.id === el.dataset.id);
    const ids = state.menu?.addIds || [];
    closeSheet();
    if (p) { await addToPlaylist(p, ids); rerenderKeepScroll(); }
  },
  'pl-add-new': async () => {
    const ids = state.menu?.addIds || [];
    const name = await promptSheet('Neue Playlist', '', 'Erstellen');
    if (!name) return;
    const p = await createPlaylist(name, ids);
    toast(`Playlist „${p.name}“ erstellt`);
    rerenderKeepScroll();
  },
  'new-playlist': async () => {
    const name = await promptSheet('Neue Playlist', '', 'Erstellen');
    if (!name) return;
    const p = await createPlaylist(name);
    go('playlist', p.id);
  },
  'playlist-menu': (el) => {
    state.menu = { playlistId: el.dataset.id };
    openSheet(`<h3>Playlist</h3>
      <button class="sheet-item" data-action="share-playlist">${icon('share')}Playlist teilen</button>
      <button class="sheet-item" data-action="pl-download">${icon('download')}Playlist herunterladen</button>
      <button class="sheet-item" data-action="pl-queue">${icon('queue')}Zur Warteschlange hinzufügen</button>
      <button class="sheet-item" data-action="pl-rename">${icon('edit')}Umbenennen</button>
      <button class="sheet-item danger" data-action="pl-delete">${icon('delete')}Playlist löschen</button>`);
  },
  'pl-download': () => {
    const p = state.playlists.find((x) => x.id === state.menu.playlistId);
    closeSheet();
    const tracks = (p?.trackIds || []).map(getTrack).filter(Boolean);
    if (!tracks.some(isStream)) { toast('Alle Titel sind bereits auf deinem Gerät.'); return; }
    download(tracks);
  },
  'pl-queue': () => {
    const p = state.playlists.find((x) => x.id === state.menu.playlistId);
    closeSheet();
    if (p?.trackIds.length) { player.addEnd(p.trackIds.filter(getTrack)); toast('Zur Warteschlange hinzugefügt'); }
  },
  'pl-rename': async () => {
    const p = state.playlists.find((x) => x.id === state.menu.playlistId);
    const name = await promptSheet('Playlist umbenennen', p.name);
    if (!name) return;
    p.name = name.trim();
    await db.put('playlists', p);
    render();
  },
  'pl-delete': async () => {
    const p = state.playlists.find((x) => x.id === state.menu.playlistId);
    if (!(await confirmSheet(`Playlist „${p.name}“ löschen?`))) return;
    await db.del('playlists', p.id);
    state.playlists = state.playlists.filter((x) => x.id !== p.id);
    toast('Playlist gelöscht');
    go('playlists');
  },
  'play-station': (el) => {
    const s = state.stations.get(el.dataset.sid);
    if (s) { player.playRadio(s); toast(`Radio: ${s.name}`); }
  },
  'radio-fav': (el) => {
    const s = state.stations.get(el.dataset.sid);
    if (!s) return;
    const had = radioFavs.some((f) => f.id === s.id);
    radioFavs = had ? radioFavs.filter((f) => f.id !== s.id) : [...radioFavs, s];
    saveRadioFavs();
    toast(had ? 'Sender entfernt' : 'Sender gespeichert');
    const top = $('#main').scrollTop;
    render();
    $('#main').scrollTop = top;
  },
  'radio-tag': (el) => {
    state.radio.tag = state.radio.tag === el.dataset.tag ? '' : el.dataset.tag;
    state.radio.query = '';
    render();
    searchRadio();
  },
  'radio-retry': () => searchRadio(),
  theme: (el) => { ui.theme = el.dataset.theme; saveUi(); applyTheme(); render(); },
  'a11y-text': (el) => { setA11y('text', +el.dataset.v); rerenderKeepScroll(); },
  'skip-main': () => { const m = $('#main'); m.focus(); m.scrollTop = 0; },
  'drag-noop': () => {},
  'app-reload': () => location.reload(),
  'update-later': () => $('#update-bar')?.remove(),
  shortcuts: () => shortcutsSheet(),
  accent: (el) => { ui.accent = el.dataset.color; saveUi(); applyTheme(); render(); },
  install: async () => {
    const p = state.installPrompt;
    if (!p) return;
    p.prompt();
    await p.userChoice.catch(() => {});
    state.installPrompt = null;
    render();
  },
  'clear-library': async () => {
    if (!(await confirmSheet('Alle Titel und Playlists vom Gerät löschen?', 'Alles löschen'))) return;
    for (const t of [...state.tracks]) player.forget(t.id);
    await Promise.all([db.clear('tracks'), db.clear('files'), db.clear('playlists')]);
    for (const u of state.covers.values()) URL.revokeObjectURL(u);
    state.covers.clear();
    await loadAll();
    toast('Bibliothek geleert');
    render();
  },
};

Object.assign(ACTIONS, accountActions, lyricsActions, forYouActions, studioActions, catalogActions, shareActions, driveActions, partyActions, fitnessActions, recognizeActions, podcastActions, searchActions, recapActions, connectActions, kidsActions, metaActions, audiusActions);
const FORMS = { ...accountForms, ...lyricsForms, ...forYouForms, ...driveForms, ...podcastForms, ...searchForms, ...kidsForms, ...metaForms, ...audiusForms };

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  if (kidsActive() && !kidsAllows(el)) return;
  fn(el, e);
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  if (kidsActive() && !kidsAllows(form)) return;
  if (FORMS[kind]) return FORMS[kind](form);
  if (kind === 'prompt') closeSheet(form.v.value.trim() || null);
  else if (kind === 'confirm') closeSheet(true);
  else if (kind === 'radio-search') {
    state.radio.query = $('#radio-q').value.trim();
    state.radio.tag = '';
    render();
    searchRadio();
    $('#radio-q')?.blur();
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (onKidsInput(el) || onAudiusInput(el) || onConnectInput(el) || onSearchInput(el) || onLyricsInput(el) || onStudioInput(el) || onFitnessInput(el)) return;
  if (el.id === 'lib-search') {
    state.libQuery = el.value;
    rerenderKeepScroll();
  } else if (el.dataset.band !== undefined) {
    const gains = [...player.settings.eq];
    gains[+el.dataset.band] = +el.value;
    player.setEq(gains, 'Eigene');
    reportPreset();
    document.querySelectorAll('.sound.on').forEach((b) => b.classList.remove('on'));
    el.previousElementSibling.textContent = (el.value > 0 ? '+' : '') + el.value;
    document.querySelectorAll('#eq [data-action=sound]').forEach((c) => c.classList.remove('on'));
    setRangeP(el);
  } else if (el.id === 'pb-volume') {
    player.setVolume(+el.value);
    setRangeP(el);
  } else if (el.id === 'np-seek') {
    seeking = true;
    const d = player.media.duration || 0;
    $('#np-cur').textContent = fmt((el.value / 1000) * d);
    setRangeP(el);
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (onRecognizeChange(el) || onConnectChange(el) || onMetaChange(el)) return;
  if (el.dataset.a11y) { setA11y(el.dataset.a11y, el.checked); return; }
  if (el.id === 'np-seek') {
    player.seek((el.value / 1000) * (player.media.duration || 0));
    seeking = false;
  } else if (el.id === 'lib-sort') {
    state.libSort = el.value;
    rerenderKeepScroll();
  } else if (el.dataset.setting === 'fx') {
    player.setFx(el.checked);
    if (!el.checked && player.settings.eqOn) player.setEqOn(false);

    rerenderKeepScroll();
  } else if (el.dataset.setting === 'eqOn') {
    player.setEqOn(el.checked);
    rerenderKeepScroll();
  } else if (el.dataset.setting === 'rate') {
    player.setRate(+el.value);
  } else if (el.id === 'file-input' || el.id === 'folder-input') {
    importFiles(el.files).finally(() => { el.value = ''; });
  }
});

document.addEventListener('keydown', (e) => {
  if (kidsActive()) return kidsKey(e);
  if (trapTab(e) || dragKey(e)) return;
  if (e.key === 'Escape') {
    if (!$('#sheet').hidden) closeSheet();
    else if (isSingOpen()) closeSing();
    else if (isPartyOpen()) closeParty();
    else if (isFitnessOpen()) closeFitness();
    else if (isDriveOpen()) closeDrive();
    else closeNowPlaying();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); openSearch(); return; }
  if (e.key === '?') { e.preventDefault(); shortcutsSheet(); return; }
  if (e.target.closest('button, a, [role=slider]') && (e.key === ' ' || e.key === 'Enter')) return; // native activation
  const radio = player.mode === 'radio';
  if (e.key === ' ') { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? player.next() : !radio && player.seek(player.media.currentTime + (player.mode === 'podcast' ? 30 : 10)); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? player.prev() : !radio && player.seek(player.media.currentTime - (player.mode === 'podcast' ? 15 : 10)); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const v = Math.min(1, Math.max(0, player.settings.volume + (e.key === 'ArrowUp' ? 0.05 : -0.05)));
    player.setVolume(v);
    const vol = $('#pb-volume');
    vol.value = v;
    setRangeP(vol);
    toast(`Lautstärke ${Math.round(v * 100)} %`);
  } else if (e.key.toLowerCase() === 'f' && !radio) toggleFav(player.track);
  else if (e.key.toLowerCase() === 's') recognizeListen();
});

// The floating "Erkennen" button gets out of the way while scrolling down through a list.
let lastScroll = 0;
$('#main').addEventListener('scroll', (e) => {
  const y = e.target.scrollTop;
  const fab = $('#rc-fab');
  if (Math.abs(y - lastScroll) < 6) return;
  fab?.classList.toggle('away', y > lastScroll && y > 80);
  lastScroll = y;
}, { passive: true });

// Drag & drop import (desktop).
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files') || kidsActive()) return;
  dragDepth++;
  $('#drop-hint').hidden = false;
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; $('#drop-hint').hidden = true; }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-hint').hidden = true;
  if (e.dataTransfer?.files?.length && !kidsActive()) importFiles(e.dataTransfer.files);
});

window.addEventListener('hashchange', () => { closeSheet(); render(); });
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
  if (state.route.view === 'settings') render();
});
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);

// ---------- Player events ----------
player.lookup = getTrack;
player.coverUrl = coverUrl;
player.addEventListener('track', () => { updatePlayerUI(); onTrackChange(); });
player.addEventListener('state', () => { updateState(); updateSingState(); });
player.addEventListener('time', updateTime);
player.addEventListener('queue', () => { if (!$('#sheet').hidden && $('#sheet h3')?.textContent === 'Wird gespielt') queueSheet(); });
player.addEventListener('sleep', (e) => { updateState(); if (e.detail === 'done') toast('Gute Nacht – Sleep-Timer beendet'); });
player.addEventListener('error', (e) => toast(e.detail));
player.addEventListener('played', () => { if (state.route.view === 'home') rerenderKeepScroll(); });
setInterval(() => { if (player.sleepUntil) updateState(); }, 30000);

// ---------- Boot ----------
hooks.render = render;
hooks.rerender = rerenderKeepScroll;
hooks.trackRows = trackRows;
hooks.registerList = registerList;
hooks.createPlaylist = createPlaylist;
hooks.reportPreset = reportPreset;
hooks.play = (ids, i) => player.playList(ids, i);
hooks.toggleFav = toggleFav;
hooks.prompt = promptSheet;
hooks.sheetClosed = onSheetClosed;
hooks.syncVolume = () => { const v = $('#pb-volume'); if (v) { v.value = player.settings.volume; setRangeP(v); } };
hooks.accountChanged = (a) => (a?.access && !a.offline ? startConnect() : stopConnect());
hooks.sing = openSing;
hooks.recognize = () => recognizeListen();
hooks.closeSheet = closeSheet;
hooks.go = go;
hooks.currentTrack = () => (player.mode === 'library' ? player.track : null);
hooks.trackChanged = (t) => {
  if (player.track?.id === t.id) { player.updateMetadata(); updatePlayerUI(); }
  rerenderKeepScroll();
};
hooks.closeOverlays = () => {
  if (isSingOpen()) closeSing();
  if (isPartyOpen()) closeParty();
  if (isFitnessOpen()) closeFitness();
  if (isDriveOpen()) closeDrive();
  closeNowPlaying();
};
window.addEventListener('online', () => { toast('Wieder online'); rerenderKeepScroll(); });
window.addEventListener('offline', () => { toast('Offline – heruntergeladene Musik läuft weiter'); rerenderKeepScroll(); });

function showUpdateBar() {
  if ($('#update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `${icon('sparkle')}<span>Neue Melody-Version ist da</span><button class="btn btn-primary" data-action="app-reload">Jetzt laden</button><button class="icon-btn" data-action="update-later" aria-label="Später">${icon('close')}</button>`;
  document.body.append(bar);
}

async function boot() {
  applyTheme();
  applyA11y();
  renderNav();
  hydrateIcons(document);
  initKids();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Home-screen apps often just resume instead of reloading: look for a new version whenever Melody comes
    // back to the front, and offer to load it (never reload by itself – music might be playing).
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch((e) => console.warn('SW', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBar(); });
  }
  await ensureAccess();
  renderAccountChip();
  reportPreset();
  const vol = $('#pb-volume');
  vol.value = player.settings.volume;
  setRangeP(vol);
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    toast('Speicher nicht verfügbar – privater Modus?');
  }
  render();
  await player.restore();
  updatePlayerUI();
  refreshKids();
  refreshSubscriptions().catch(() => {});
}

boot();
