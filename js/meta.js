// Song-Infos & Cover: edit title/artist/album, pick a cover from the photo library,
// or look the song up in the free MusicBrainz database (cover from the Cover Art Archive).
import { db } from './db.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, hooks, openSheet, closeSheet, coverUrl, hue } from './core.js';

const M = { id: null, cover: undefined, preview: null }; // cover: undefined = unchanged, Blob = new, null = removed
const MB = 'https://musicbrainz.org/ws/2/recording';
const CAA = 'https://coverartarchive.org/release';

// Photos straight from the phone are huge: store a 600 px JPEG instead.
async function shrink(blob, size = 600) {
  const img = await createImageBitmap(blob);
  const s = Math.min(1, size / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht verkleinert werden'))), 'image/jpeg', 0.86));
}

function setPreview(blob) {
  if (M.preview) URL.revokeObjectURL(M.preview);
  M.preview = blob ? URL.createObjectURL(blob) : null;
  const t = state.map.get(M.id);
  const box = $('#me-cover');
  if (!box) return;
  const url = M.cover === undefined ? coverUrl(t) : M.preview;
  box.innerHTML = url ? `<img src="${esc(url)}" alt="">` : icon('note');
  box.style.setProperty('--h', hue(t?.album || t?.title || ''));
  $('#me-remove').hidden = !url;
}

export function editTrackSheet(t) {
  if (!t) return;
  state.menu = { id: t.id };
  M.id = t.id;
  M.cover = undefined;
  openSheet(`<h3>Infos & Cover</h3>
    <form data-form="edit" class="stack me-form" style="padding:4px 8px 8px">
      <div class="me-top">
        <div class="cover me-cover" id="me-cover"></div>
        <div class="me-cover-actions">
          <label class="btn">${icon('image')}Foto wählen<input type="file" id="me-file" accept="image/*" hidden></label>
          <button type="button" class="btn" data-action="me-search">${icon('search')}Online suchen</button>
          <button type="button" class="btn ghost" id="me-remove" data-action="me-remove">${icon('delete')}Cover entfernen</button>
        </div>
      </div>
      <div id="me-results" class="me-results" hidden></div>
      <label>Titel<input class="input plain" name="title" value="${esc(t.title)}" required dir="auto"></label>
      <label>Künstler<input class="input plain" name="artist" value="${esc(t.artist)}" required dir="auto"></label>
      <div class="row nowrap">
        <label style="flex:2">Album<input class="input plain" name="album" value="${esc(t.album)}" required dir="auto"></label>
        <label style="flex:1">Jahr<input class="input plain" name="year" value="${esc(t.year || '')}" inputmode="numeric" maxlength="4"></label>
      </div>
      <label>Genre<input class="input plain" name="genre" value="${esc(t.genre || '')}" dir="auto"></label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
        <button class="btn btn-primary">Speichern</button></div>
    </form>`);
  setPreview(null);
}

// ---------- Online lookup (MusicBrainz) ----------
const clean = (s) => String(s || '').replace(/["\\]/g, ' ').replace(/\b(official|video|audio|lyrics?|remix\s*\d{4}|hd|hq|mp3)\b/gi, ' ').replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();

async function lookup(title, artist) {
  const parts = [`recording:"${clean(title)}"`];
  if (artist && !/^unbekannt/i.test(artist)) parts.push(`artist:"${clean(artist)}"`);
  const r = await fetch(`${MB}?query=${encodeURIComponent(parts.join(' AND '))}&fmt=json&limit=8`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('MusicBrainz antwortet nicht (' + r.status + ')');
  const data = await r.json();
  return (data.recordings || []).map((rec) => {
    const rel = (rec.releases || []).find((x) => x.status === 'Official') || rec.releases?.[0];
    return {
      title: rec.title,
      artist: (rec['artist-credit'] || []).map((a) => a.name + (a.joinphrase || '')).join('') || '',
      album: rel?.title || '',
      year: (rel?.date || rec['first-release-date'] || '').slice(0, 4),
      release: rel?.id || '',
    };
  }).filter((x) => x.title);
}

function renderResults(list) {
  const box = $('#me-results');
  box.hidden = false;
  if (!list.length) {
    box.innerHTML = `<p class="muted small">Nichts gefunden. Tipp: Titel und Künstler unten verbessern und noch einmal suchen – oder ein Foto als Cover wählen.</p>`;
    return;
  }
  box.innerHTML = `<p class="muted small">Treffer aus MusicBrainz – tippe auf den passenden:</p>` + list.map((x, i) => `
    <button type="button" class="me-hit" data-action="me-pick" data-i="${i}">
      <span class="cover sm" style="--h:${hue(x.album || x.title)}">${x.release ? `<img src="${CAA}/${esc(x.release)}/front-250" alt="" loading="lazy" onerror="this.remove()">` : ''}${icon('note')}</span>
      <span class="me-hit-meta"><b dir="auto">${esc(x.title)}</b><small dir="auto">${esc(x.artist)}${x.album ? ' · ' + esc(x.album) : ''}${x.year ? ' · ' + esc(x.year) : ''}</small></span>
    </button>`).join('');
  hydrateIcons(box);
  M.results = list;
}

export const metaActions = {
  'edit-current': () => hooks.currentTrack && editTrackSheet(hooks.currentTrack()),
  'me-remove': () => { M.cover = null; setPreview(null); },
  'me-search': async (el) => {
    const form = el.closest('form');
    if (!navigator.onLine) { toast('Für die Online-Suche brauchst du Internet.'); return; }
    el.disabled = true;
    const box = $('#me-results');
    box.hidden = false;
    box.innerHTML = '<p class="muted small">Suche läuft …</p>';
    try { renderResults(await lookup(form.title.value, form.artist.value)); }
    catch (e) { box.innerHTML = `<p class="muted small">Online-Suche gerade nicht möglich: ${esc(e.message)}</p>`; }
    finally { el.disabled = false; }
  },
  'me-pick': async (el) => {
    const x = M.results?.[+el.dataset.i];
    const form = el.closest('form');
    if (!x || !form) return;
    form.title.value = x.title;
    form.artist.value = x.artist || form.artist.value;
    if (x.album) form.album.value = x.album;
    if (x.year) form.year.value = x.year;
    $('#me-results').hidden = true;
    if (!x.release) { toast('Infos übernommen – zu diesem Treffer gibt es kein Cover.'); return; }
    toast('Cover wird geladen …', true);
    try {
      const r = await fetch(`${CAA}/${x.release}/front-500`);
      if (!r.ok) throw new Error(r.status);
      M.cover = await shrink(await r.blob());
      setPreview(M.cover);
      toast('Infos und Cover übernommen – jetzt speichern.');
    } catch {
      toast('Infos übernommen – ein Cover gibt es dazu leider nicht.');
    }
  },
};

async function useFile(f) {
  try {
    M.cover = await shrink(f);
    setPreview(M.cover);
  } catch {
    toast('Dieses Bild kann nicht geöffnet werden.');
  }
}
export function onMetaChange(el) {
  if (el.id !== 'me-file') return false;
  if (el.files?.[0]) useFile(el.files[0]);
  return true;
}

export const metaForms = {
  edit: async (form) => {
    const t = state.map.get(M.id);
    if (!t) return;
    for (const k of ['title', 'artist', 'album', 'year', 'genre']) t[k] = form[k].value.trim();
    t.albumArtist = '';
    if (M.cover !== undefined) {
      t.cover = M.cover;
      const old = state.covers.get(t.id);
      if (old) URL.revokeObjectURL(old);
      state.covers.delete(t.id);
    }
    await db.put('tracks', t);
    closeSheet();
    hooks.trackChanged?.(t);
    toast('Gespeichert');
  },
};
