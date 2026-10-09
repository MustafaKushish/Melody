// Share playlists as a link. The playlist travels inside the link itself – no server needed.
// Catalog songs play for everyone; own files are matched by title + artist in the recipient's library.
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, hooks, getTrack, plural, groupCover, openSheet, coverHTML } from './core.js';
import { isCatalog, loadCatalog, ensureTracks, catalogId, catalogEntry } from './catalog.js';
import { stub as audiusStub } from './audius.js';

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodePlaylist(p) {
  const tracks = p.trackIds.map(getTrack).filter(Boolean);
  const data = {
    v: 1,
    n: p.name,
    by: state.account?.name || '',
    t: tracks.map((t) => (isCatalog(t) ? ['c', t.catalogId] : t.source === 'audius' ? ['a', t.audiusId, t.title, t.artist] : ['l', t.title, t.artist])),
  };
  const raw = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== 'undefined') {
    return 'z' + b64url(await pipe(raw, new CompressionStream('deflate-raw')));
  }
  return 'j' + b64url(raw);
}

export async function decodePlaylist(code) {
  const bytes = fromB64url(code.slice(1));
  const raw = code[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data.v !== 1 || !Array.isArray(data.t)) throw new Error('Unbekanntes Format');
  return data;
}

const shareUrl = (code) => `${location.origin}${location.pathname}#/shared/${code}`;

export async function sharePlaylist(p) {
  if (!p.trackIds.length) { toast('Die Playlist ist noch leer.'); return; }
  const url = shareUrl(await encodePlaylist(p));
  const text = `Hör dir meine Playlist „${p.name}“ auf Melody an 🎵`;
  const own = p.trackIds.map(getTrack).filter((t) => t && !isCatalog(t) && t.source !== 'audius').length;
  openSheet(`<div class="share-sheet">
    ${groupCover(p.trackIds.map(getTrack).filter(Boolean), 'lg', p.name, 'playlist')}
    <h3>„${esc(p.name)}“ teilen</h3>
    <p class="muted small">${plural(p.trackIds.length, 'Titel', 'Titel')}${own ? ` · ${own} eigene ${own === 1 ? 'Datei wird' : 'Dateien werden'} beim Empfänger in seiner Bibliothek gesucht` : ''}</p>
    <div class="share-link"><input class="input plain" readonly value="${esc(url)}" id="share-url"><button class="btn btn-primary" data-action="share-copy">${icon('copy')}Kopieren</button></div>
    <div class="share-targets">
      ${navigator.share ? `<button class="chip" data-action="share-native">${icon('share')}Teilen …</button>` : ''}
      <a class="chip" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}">WhatsApp</a>
      <a class="chip" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">Telegram</a>
      <a class="chip" href="mailto:?subject=${encodeURIComponent('Playlist: ' + p.name)}&body=${encodeURIComponent(text + '\n\n' + url)}">${icon('mail')}E-Mail</a>
    </div></div>`);
  state.menu = { shareUrl: url, shareText: text, shareTitle: p.name };
}

// ---------- Received playlist ----------
const received = { code: '', data: null, error: '' };

function resolve(data) {
  const byKey = new Map(state.tracks.map((t) => [`${t.title}\u0001${t.artist}`.toLowerCase(), t]));
  return data.t.map((e) => {
    if (e[0] === 'c') {
      const c = catalogEntry(e[1]);
      return { kind: 'catalog', id: e[1], t: getTrack(catalogId(e[1])), title: c?.title || 'Unbekannter Titel', artist: c?.artist || '', cover: c?.cover };
    }
    if (e[0] === 'a') return { kind: 'audius', title: e[2], artist: e[3], t: getTrack('aud:' + e[1]) || audiusStub(e[1], e[2], e[3]) };
    const t = byKey.get(`${e[1]}\u0001${e[2]}`.toLowerCase());
    return { kind: 'local', title: e[1], artist: e[2], t };
  });
}

export function viewShared() {
  const code = state.route.param;
  if (received.code !== code) {
    received.code = code;
    received.data = null;
    received.error = '';
    Promise.all([decodePlaylist(code), loadCatalog()])
      .then(([d]) => { received.data = d; })
      .catch(() => { received.error = 'Dieser Link ist ungültig oder unvollständig.'; })
      .finally(() => { if (state.route.view === 'shared') hooks.render(); });
  }
  if (received.error) return `<h1>Geteilte Playlist</h1><div class="empty">${esc(received.error)}</div>`;
  if (!received.data) return '<h1>Geteilte Playlist</h1><div class="empty">Wird geöffnet …</div>';
  const d = received.data;
  const items = resolve(d);
  const ok = items.filter((x) => x.kind === 'catalog' || x.t).length;
  const rows = items.map((x, i) => {
    const t = x.t;
    const title = t?.title || x.title;
    const artist = t?.artist || x.artist;
    const avail = x.kind === 'catalog' || t;
    return `<div class="track${avail ? '' : ' unavailable'}">
      <span class="num">${i + 1}</span>
      ${t ? coverHTML(t, 'sm') : x.cover ? `<div class="cover sm"><img src="catalog/${esc(x.cover)}" alt=""></div>` : coverHTML(null, 'sm', title)}
      <div class="meta"><div class="t">${esc(title)}</div><div class="a">${esc(artist)}${avail ? '' : ' · nicht in deiner Bibliothek'}</div></div>
      <span class="dur">${x.kind === 'catalog' || x.kind === 'audius' ? icon('cloud') : avail ? icon('check') : ''}</span><span></span></div>`;
  }).join('');
  const firstCover = items.find((x) => x.cover && !x.t?.cover)?.cover;
  const heroCover = items.some((x) => x.t?.cover) || !firstCover
    ? groupCover(items.map((x) => x.t).filter(Boolean), 'lg', d.n, 'playlist')
    : `<div class="cover lg"><img src="catalog/${esc(firstCover)}" alt=""></div>`;
  return `<div class="hero">${heroCover}
      <div><div class="kind">Geteilte Playlist${d.by ? ` von ${esc(d.by)}` : ''}</div><h1>${esc(d.n)}</h1>
      <div class="muted">${ok} von ${plural(items.length, 'Titel', 'Titeln')} verfügbar</div>
      <div class="hero-actions">
        <button class="btn btn-primary" data-action="shared-play" ${ok ? '' : 'disabled'}>${icon('play')}Abspielen</button>
        <button class="btn" data-action="shared-save" ${ok ? '' : 'disabled'}>${icon('add')}In meine Playlists</button>
      </div></div></div>
    <div class="tracks">${rows}</div>
    ${ok < items.length ? '<p class="muted small">Eigene Musikdateien werden nicht mitgeschickt. Hast du dieselben Songs importiert, erkennt Melody sie automatisch.</p>' : ''}`;
}

async function resolvedIds() {
  const items = resolve(received.data);
  const cat = await loadCatalog();
  const need = items.filter((x) => x.kind === 'catalog' && !x.t).map((x) => cat.find((c) => c.id === x.id)).filter(Boolean);
  await ensureTracks(need);
  return resolve(received.data).map((x) => x.t?.id).filter(Boolean);
}

export const shareActions = {
  'share-playlist': (el) => {
    const p = state.playlists.find((x) => x.id === (el.dataset.id || state.menu?.playlistId));
    if (p) sharePlaylist(p);
  },
  'share-copy': async () => {
    const input = $('#share-url');
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
    toast('Link kopiert – jetzt einfach verschicken');
  },
  'share-native': () => {
    const m = state.menu;
    navigator.share({ title: m.shareTitle, text: m.shareText, url: m.shareUrl }).catch(() => {});
  },
  'shared-play': async () => {
    const ids = await resolvedIds();
    if (ids.length) hooks.play(ids, 0);
  },
  'shared-save': async () => {
    const ids = await resolvedIds();
    const p = await hooks.createPlaylist(received.data.n, ids);
    toast(`„${p.name}“ gespeichert`);
    hooks.go('playlist', p.id);
  },
};

export { hydrateIcons };
