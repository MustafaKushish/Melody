// Podcasts (and audiobooks published as podcast feeds): search, subscribe, resume, download for offline.
import { api, DEMO } from './api.js';
import { db } from './db.js';
import { player } from './player.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, hooks, go, openSheet, closeSheet, hue, plural } from './core.js';

export const MELODY_FEED = 'podcasts/melody-insider/feed.xml';
const PODS_KEY = 'melody.pods';
const PROG_KEY = 'melody.podprogress';
const DL_KEY = 'melody.poddl';
const GENRES = ['Nachrichten', 'Wissen', 'Comedy', 'Sport', 'Musik', 'Geschichte', 'True Crime', 'Kinder', 'Hörbuch'];

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Speicher voll – bitte alte Downloads löschen.'); } };

const P = {
  pods: read(PODS_KEY, {}),        // feedUrl -> { feed, title, author, image, description, episodes, subscribed, fetchedAt }
  progress: read(PROG_KEY, {}),    // guid -> { pos, dur, done, at, feed }
  downloads: read(DL_KEY, {}),     // guid -> { size, at, feed }
  search: { q: '', results: null, loading: false, error: '' },
  loading: new Set(),
  active: new Map(),               // guid -> download progress
};
const savePods = () => write(PODS_KEY, P.pods);
const saveProgress = () => write(PROG_KEY, P.progress);
const saveDownloads = () => write(DL_KEY, P.downloads);

// ---------- Feed parsing (RSS 2.0 + iTunes tags) ----------
const kids = (el, name) => [...(el?.children || [])].filter((c) => c.nodeName === name);
const first = (el, ...names) => { for (const n of names) { const c = kids(el, n)[0]; if (c) return c; } return null; };
const text = (el, ...names) => (first(el, ...names)?.textContent || '').trim();
// Show notes are HTML – turn them into plain text in an inert document (nothing runs, nothing loads).
const plain = (html) => {
  const doc = new DOMParser().parseFromString(String(html || '').replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, ' $&'), 'text/html');
  doc.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
};

export function parseDuration(v) {
  v = String(v || '').trim();
  if (!v) return 0;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(':').map(Number).reduce((s, x) => s * 60 + (x || 0), 0);
}

export function parseFeed(xml, base) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const ch = doc.querySelector('channel');
  if (!ch || doc.querySelector('parsererror')) throw new Error('Feed konnte nicht gelesen werden.');
  const abs = (u) => { try { return u ? new URL(u, base).href : ''; } catch { return ''; } };
  const img = first(ch, 'itunes:image')?.getAttribute('href') || text(first(ch, 'image'), 'url');
  const episodes = [...ch.querySelectorAll('item')].slice(0, 200).map((it) => {
    const enc = first(it, 'enclosure');
    const url = abs(enc?.getAttribute('url'));
    if (!url) return null;
    const date = Date.parse(text(it, 'pubDate')) || 0;
    return {
      guid: text(it, 'guid') || url,
      title: plain(text(it, 'title')) || 'Ohne Titel',
      date,
      desc: plain(text(it, 'content:encoded', 'description', 'itunes:summary')).slice(0, 1200),
      url,
      type: enc.getAttribute('type') || 'audio/mpeg',
      size: Number(enc.getAttribute('length')) || 0,
      duration: parseDuration(text(it, 'itunes:duration')),
      image: abs(first(it, 'itunes:image')?.getAttribute('href') || ''),
    };
  }).filter(Boolean).sort((a, b) => b.date - a.date);
  return {
    title: plain(text(ch, 'title')) || 'Podcast',
    author: plain(text(ch, 'itunes:author', 'author', 'managingEditor')),
    description: plain(text(ch, 'description', 'itunes:summary')).slice(0, 800),
    image: abs(img),
    episodes,
  };
}

async function fetchFeed(feed) {
  const u = new URL(feed, location.href);
  if (u.origin === location.origin) {
    const r = await fetch(u, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Feed nicht erreichbar.');
    return parseFeed(await r.text(), u.href);
  }
  if (DEMO) throw new Error('In der Demo sind nur Melody-Podcasts verfügbar.');
  const r = await api('/podcasts/feed?url=' + encodeURIComponent(u.href));
  return parseFeed(r.xml, r.finalUrl);
}

export async function loadPod(feed, force = false) {
  const have = P.pods[feed];
  if (have && !force && Date.now() - have.fetchedAt < 30 * 60000) return have;
  if (!navigator.onLine && have) return have;
  P.loading.add(feed);
  try {
    const data = await fetchFeed(feed);
    P.pods[feed] = { ...have, ...data, feed, episodes: data.episodes.slice(0, 100), fetchedAt: Date.now(), subscribed: !!have?.subscribed };
    savePods();
  } finally {
    P.loading.delete(feed);
  }
  return P.pods[feed];
}

export async function refreshSubscriptions() {
  const subs = Object.values(P.pods).filter((p) => p.subscribed);
  await Promise.all(subs.map((p) => loadPod(p.feed).catch(() => null)));
}

// ---------- Playback & progress ----------
const findEp = (feed, guid) => P.pods[feed]?.episodes.find((e) => e.guid === guid);

export async function playEp(feed, guid) {
  const pod = P.pods[feed];
  const ep = findEp(feed, guid);
  if (!pod || !ep) return;
  if (ep.type.startsWith('video/')) return openVideo(pod, ep);
  const blob = P.downloads[guid] ? await db.get('files', 'pod:' + guid).catch(() => null) : null;
  if (!blob && !navigator.onLine) { toast('Offline – diese Folge ist nicht heruntergeladen.'); return; }
  if (P.url) URL.revokeObjectURL(P.url);
  P.url = blob ? URL.createObjectURL(blob) : null;
  const prog = P.progress[guid];
  const startAt = prog && !prog.done && prog.pos < (prog.dur || Infinity) - 10 ? prog.pos : 0;
  await player.playEpisode({ ...ep, feed }, { title: pod.title, image: pod.image, feed }, P.url || ep.url, startAt);
  if (startAt > 5) toast(`Weiter bei ${fmtTime(startAt)}`);
}

let lastSave = 0;
player.addEventListener('podprogress', () => {
  const e = player.episode;
  if (!e) return;
  const el = player.radioEl;
  const guid = e.ep.guid;
  const dur = el.duration || e.ep.duration || 0;
  const pos = el.currentTime || 0;
  // Counts as heard in the last 30 s (outro) – but at most the last 5 % for short episodes.
  const done = dur > 0 && pos > dur - Math.min(30, dur * 0.05);
  P.progress[guid] = { pos, dur, done: done || P.progress[guid]?.done || false, at: Date.now(), feed: e.ep.feed };
  if (Date.now() - lastSave > 5000 || done) { lastSave = Date.now(); saveProgress(); }
});
// Save the position right away when pausing or leaving the app.
const flush = () => { if (player.mode === 'podcast') { player.emit('podprogress'); saveProgress(); } };
player.addEventListener('state', () => { if (player.mode === 'podcast' && !player.playing) flush(); });
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

player.addEventListener('episode-ended', (ev) => {
  const e = ev.detail;
  if (!e) return;
  P.progress[e.ep.guid] = { ...(P.progress[e.ep.guid] || {}), done: true, at: Date.now(), feed: e.ep.feed };
  saveProgress();
  toast(`Folge zu Ende: ${e.ep.title}`);
  if (state.route.view.startsWith('podcast')) hooks.rerender();
});

// ---------- Downloads ----------
function mediaUrl(url) {
  const u = new URL(url, location.href);
  if (u.origin === location.origin || DEMO) return u.href;
  return 'api/podcasts/media?url=' + encodeURIComponent(u.href);
}

async function downloadEp(feed, guid) {
  const ep = findEp(feed, guid);
  if (!ep || P.downloads[guid] || P.active.has(guid)) return;
  if (!navigator.onLine) { toast('Zum Herunterladen brauchst du Internet.'); return; }
  P.active.set(guid, 0);
  updateEpRow(guid);
  try {
    const r = await fetch(mediaUrl(ep.url), { credentials: 'same-origin' });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length')) || ep.size || 0;
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) { P.active.set(guid, got / total); updateEpRow(guid); }
    }
    const blob = new Blob(chunks, { type: r.headers.get('content-type') || ep.type });
    await db.put('files', blob, 'pod:' + guid);
    P.downloads[guid] = { size: blob.size, at: Date.now(), feed };
    saveDownloads();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    toast(`Offline verfügbar: ${ep.title}`);
  } catch (e) {
    toast('Download fehlgeschlagen. Bitte später erneut versuchen.');
    console.warn(e);
  } finally {
    P.active.delete(guid);
    updateEpRow(guid);
  }
}

async function removeDownload(guid) {
  await db.del('files', 'pod:' + guid);
  delete P.downloads[guid];
  saveDownloads();
  updateEpRow(guid);
  toast('Download entfernt');
}

export const podDownloadBytes = () => Object.values(P.downloads).reduce((s, d) => s + (d.size || 0), 0);

// ---------- Video podcasts ----------
function openVideo(pod, ep) {
  player.pause();
  const prog = P.progress[ep.guid];
  openSheet(`<div class="pod-video"><h3>${esc(ep.title)}</h3><p class="muted small">${esc(pod.title)}</p>
    <video id="pod-video" controls playsinline preload="metadata" src="${esc(ep.url)}"></video></div>`);
  const v = $('#pod-video');
  if (prog?.pos && !prog.done) v.currentTime = prog.pos;
  v.play().catch(() => {});
  v.addEventListener('timeupdate', () => {
    P.progress[ep.guid] = { pos: v.currentTime, dur: v.duration || 0, done: v.duration && v.currentTime > v.duration - Math.min(30, v.duration * 0.05), at: Date.now(), feed: pod.feed };
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveProgress(); }
  });
}

// ---------- Views ----------
export const fmtTime = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
const fmtDur = (s) => (!s ? '' : s >= 3600 ? `${Math.floor(s / 3600)} Std. ${Math.round((s % 3600) / 60)} Min.` : `${Math.max(1, Math.round(s / 60))} Min.`);
const fmtDay = (ms) => {
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return 'Heute';
  if (d === 1) return 'Gestern';
  if (d < 7) return `Vor ${d} Tagen`;
  return new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
};

function podCover(pod, size = 'md') {
  if (pod?.image) return `<div class="cover ${size}" style="--h:${hue(pod.title || 'pod')}"><img src="${esc(pod.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">${icon('mic')}</div>`;
  return `<div class="cover ${size}" style="--h:${hue(pod?.title || 'pod')}">${icon('mic')}</div>`;
}
export { podCover };

function epRow(pod, ep, showPod = false) {
  const prog = P.progress[ep.guid];
  const pct = prog?.done ? 100 : prog?.dur ? Math.min(100, (prog.pos / prog.dur) * 100) : 0;
  const playing = player.mode === 'podcast' && player.episode?.ep.guid === ep.guid;
  const dl = P.downloads[ep.guid];
  const busy = P.active.has(ep.guid);
  const left = prog && !prog.done && prog.dur ? `noch ${fmtDur(prog.dur - prog.pos)}` : fmtDur(ep.duration);
  return `<div class="ep${playing ? ' current' : ''}${prog?.done ? ' done' : ''}" data-guid="${esc(ep.guid)}">
    ${showPod ? podCover(pod, 'sm') : ''}
    <button class="ep-play" data-action="pod-play" data-feed="${esc(pod.feed)}" data-guid="${esc(ep.guid)}" aria-label="Abspielen">${icon(playing && player.playing ? 'pause' : 'play')}</button>
    <div class="ep-meta">
      <div class="ep-sub">${showPod ? `${esc(pod.title)} · ` : ''}${fmtDay(ep.date)}${ep.type.startsWith('video/') ? ' · Video' : ''}</div>
      <div class="ep-title">${esc(ep.title)}</div>
      ${ep.desc && !showPod ? `<div class="ep-desc">${esc(ep.desc)}</div>` : ''}
      <div class="ep-foot">${prog?.done ? `<span class="ok">${icon('check')} Gehört</span>` : `<span>${left}</span>`}
        ${pct > 0 && !prog?.done ? `<span class="ep-bar"><i style="width:${pct.toFixed(1)}%"></i></span>` : ''}
        ${dl ? `<span class="ok">${icon('downloadDone')} Offline</span>` : ''}</div>
    </div>
    <button class="icon-btn" data-action="${dl ? 'pod-undl' : 'pod-dl'}" data-feed="${esc(pod.feed)}" data-guid="${esc(ep.guid)}" aria-label="${dl ? 'Download entfernen' : 'Herunterladen'}">
      ${busy ? `<span class="dl-badge busy">${Math.round((P.active.get(ep.guid) || 0) * 100)}%</span>` : icon(dl ? 'downloadDone' : 'download')}</button>
    <button class="icon-btn" data-action="pod-mark" data-guid="${esc(ep.guid)}" data-feed="${esc(pod.feed)}" aria-label="${prog?.done ? 'Als ungehört markieren' : 'Als gehört markieren'}">${icon(prog?.done ? 'close' : 'check')}</button>
  </div>`;
}

function updateEpRow(guid) {
  const el = document.querySelector(`.ep[data-guid="${CSS.escape(guid)}"]`);
  if (!el) return;
  const feed = el.querySelector('[data-feed]')?.dataset.feed;
  const pod = P.pods[feed];
  const ep = findEp(feed, guid);
  if (!pod || !ep) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = epRow(pod, ep, !!el.querySelector('.cover'));
  hydrateIcons(tmp);
  el.replaceWith(tmp.firstElementChild);
}

function continueList() {
  return Object.entries(P.progress)
    .filter(([, p]) => !p.done && p.pos > 10 && P.pods[p.feed])
    .sort((a, b) => b[1].at - a[1].at)
    .map(([guid, p]) => ({ pod: P.pods[p.feed], ep: findEp(p.feed, guid) }))
    .filter((x) => x.ep)
    .slice(0, 5);
}

function newEpisodes() {
  return Object.values(P.pods).filter((p) => p.subscribed)
    .flatMap((pod) => pod.episodes.slice(0, 5).map((ep) => ({ pod, ep })))
    .filter(({ ep }) => !P.progress[ep.guid]?.done && ep.date > Date.now() - 45 * 86400000)
    .sort((a, b) => b.ep.date - a.ep.date).slice(0, 12);
}

export function homeSection() {
  const c = continueList();
  if (!c.length) return '';
  return `<h2>Podcasts weiterhören <button class="chip" data-action="nav" data-view="podcasts">Alle Podcasts</button></h2><div class="eps">${c.map(({ pod, ep }) => epRow(pod, ep, true)).join('')}</div>`;
}

export function viewPodcasts() {
  const subs = Object.values(P.pods).filter((p) => p.subscribed);
  const s = P.search;
  const cont = continueList();
  const fresh = newEpisodes();
  const melody = P.pods[MELODY_FEED];
  if (!melody && !P.loading.has(MELODY_FEED)) loadPod(MELODY_FEED).then(() => { if (state.route.view === 'podcasts') hooks.rerender(); }).catch(() => {});
  const dl = podDownloadBytes();
  return `<h1>Podcasts</h1>
    <p class="sub">Alle Podcasts der Welt – abonnieren, herunterladen, offline hören. Melody merkt sich, wo du warst.</p>
    <form class="row nowrap" data-form="pod-search" style="margin-bottom:12px">
      <label class="search">${icon('search')}<input class="input" id="pod-q" type="search" placeholder="Podcast suchen …" value="${esc(s.q)}" autocomplete="off"></label>
    </form>
    <div class="tabs">${GENRES.map((g) => `<button class="chip${s.q === g ? ' on' : ''}" data-action="pod-genre" data-q="${g}">${g}</button>`).join('')}</div>
    ${s.loading ? '<div class="empty">Suche läuft …</div>' : s.error ? `<div class="empty">${esc(s.error)}</div>` : s.results ? `
      <h2>Ergebnisse für „${esc(s.q)}“ <button class="chip" data-action="pod-clear">Schließen</button></h2>
      ${s.results.length ? `<div class="grid">${s.results.map((r, i) => `
        <button class="card" data-action="pod-open-result" data-i="${i}">${podCover(r)}<div class="t">${esc(r.title)}</div><div class="a">${esc(r.author)}</div></button>`).join('')}</div>` : '<div class="empty">Nichts gefunden.</div>'}` : ''}
    ${cont.length ? `<h2>Weiterhören</h2><div class="eps">${cont.map(({ pod, ep }) => epRow(pod, ep, true)).join('')}</div>` : ''}
    ${fresh.length ? `<h2>Neue Folgen</h2><div class="eps">${fresh.map(({ pod, ep }) => epRow(pod, ep, true)).join('')}</div>` : ''}
    ${subs.length ? `<h2>Deine Podcasts</h2><div class="grid">${subs.map((p) => `
      <button class="card" data-action="nav" data-view="podcast" data-param="${esc(p.feed)}">${podCover(p)}<div class="t">${esc(p.title)}</div><div class="a">${esc(p.author)}</div></button>`).join('')}</div>` : ''}
    <h2>Empfohlen von Melody</h2>
    <div class="grid">
      <button class="card" data-action="nav" data-view="podcast" data-param="${MELODY_FEED}">${podCover(melody || { title: 'Melody Insider', image: 'podcasts/melody-insider/cover.jpg' })}
        <div class="t">Melody Insider</div><div class="a">Lea &amp; Max · ${melody ? plural(melody.episodes.length, 'Folge', 'Folgen') : '3 Folgen'}</div></button>
    </div>
    <div class="panel pod-info">
      <h3>${icon('download')} Downloads</h3>
      <p>${Object.keys(P.downloads).length ? `${plural(Object.keys(P.downloads).length, 'Folge', 'Folgen')} offline · ${(dl / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : 'Noch keine Folgen heruntergeladen.'}
      Tipp: Für Hörbücher nach „Hörbuch“ oder „LibriVox“ suchen – viele Klassiker sind gemeinfrei und kostenlos.</p>
    </div>`;
}

export function viewPodcast() {
  const feed = state.route.param;
  const pod = P.pods[feed];
  if (!P.loading.has(feed) && (!pod || Date.now() - pod.fetchedAt > 30 * 60000)) {
    loadPod(feed, true).then(() => { if (state.route.param === feed) hooks.rerender(); })
      .catch((e) => { P.error = e.message; if (state.route.param === feed) hooks.rerender(); });
  }
  const back = `<button class="chip back" data-action="nav" data-view="podcasts">${icon('back')}Podcasts</button>`;
  if (!pod) return `${back}<div class="empty">${P.error && !P.loading.has(feed) ? esc(P.error) : 'Podcast wird geladen …'}</div>`;
  const notDl = pod.episodes.slice(0, 10).filter((e) => !P.downloads[e.guid]).length;
  return `${back}
    <div class="hero">${podCover(pod, 'lg')}
      <div style="min-width:0"><div class="kind">Podcast</div><h1>${esc(pod.title)}</h1>
        <div class="muted">${esc(pod.author)}${pod.author ? ' · ' : ''}${plural(pod.episodes.length, 'Folge', 'Folgen')}</div>
        <div class="hero-actions">
          ${pod.episodes[0] ? `<button class="btn btn-primary" data-action="pod-play" data-feed="${esc(feed)}" data-guid="${esc(pod.episodes[0].guid)}">${icon('play')}Neueste Folge</button>` : ''}
          <button class="btn${pod.subscribed ? ' on' : ''}" data-action="pod-sub" data-feed="${esc(feed)}">${icon(pod.subscribed ? 'check' : 'add')}${pod.subscribed ? 'Abonniert' : 'Abonnieren'}</button>
          ${notDl ? `<button class="btn" data-action="pod-dl-all" data-feed="${esc(feed)}">${icon('download')}Neueste ${Math.min(notDl, 10)} laden</button>` : ''}
        </div></div></div>
    ${pod.description ? `<p class="pod-desc">${esc(pod.description)}</p>` : ''}
    <div class="eps">${pod.episodes.map((ep) => epRow(pod, ep)).join('')}</div>`;
}

export const podcastActions = {
  'pod-play': (el) => {
    if (player.mode === 'podcast' && player.episode?.ep.guid === el.dataset.guid) { player.toggle(); return; }
    playEp(el.dataset.feed, el.dataset.guid);
  },
  'pod-sub': async (el) => {
    const pod = P.pods[el.dataset.feed];
    if (!pod) return;
    pod.subscribed = !pod.subscribed;
    savePods();
    toast(pod.subscribed ? `„${pod.title}“ abonniert – neue Folgen erscheinen unter Podcasts` : 'Abo beendet');
    hooks.rerender();
  },
  'pod-dl': (el) => downloadEp(el.dataset.feed, el.dataset.guid),
  'pod-undl': (el) => removeDownload(el.dataset.guid),
  'pod-dl-all': async (el) => {
    const pod = P.pods[el.dataset.feed];
    for (const ep of pod.episodes.slice(0, 10)) await downloadEp(pod.feed, ep.guid);
    hooks.rerender();
  },
  'pod-mark': (el) => {
    const g = el.dataset.guid;
    const p = P.progress[g] || { pos: 0, dur: 0, feed: el.dataset.feed };
    p.done = !p.done;
    if (!p.done) p.pos = 0;
    p.at = Date.now();
    P.progress[g] = p;
    saveProgress();
    updateEpRow(g);
  },
  'pod-genre': (el) => searchPods(el.dataset.q),
  'pod-clear': () => { Object.assign(P.search, { q: '', results: null, error: '' }); hooks.rerender(); },
  'pod-open-result': async (el) => {
    const r = P.search.results[+el.dataset.i];
    if (!r) return;
    P.pods[r.feed] = P.pods[r.feed] || { feed: r.feed, title: r.title, author: r.author, image: r.image, episodes: [], fetchedAt: 0, subscribed: false };
    go('podcast', r.feed);
  },
};

async function searchPods(q) {
  q = q.trim();
  if (!q) return;
  Object.assign(P.search, { q, loading: true, results: null, error: '' });
  hooks.rerender();
  try {
    if (DEMO) throw new Error('Die Podcast-Suche braucht den Melody-Server. In der Demo gibt es den Melody Insider.');
    P.search.results = (await api('/podcasts/search?q=' + encodeURIComponent(q))).results;
  } catch (e) {
    P.search.error = e.message;
  }
  P.search.loading = false;
  hooks.rerender();
}

export const podcastForms = {
  'pod-search': (form) => searchPods(form.querySelector('#pod-q').value),
};

player.addEventListener('state', () => {
  if (player.mode === 'podcast' && player.episode) updateEpRow(player.episode.ep.guid);
});

// Test hook
window.__melodyPods = P;
