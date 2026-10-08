// Shared state and helpers used by every view module.
import { hydrateIcons, icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (sec) => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
export const fmtLong = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} Std. ${m} Min.` : `${m} Min.`;
};
export const fmtDate = (ms) => new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
export const hue = (str) => {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const byText = (a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' });

let toastTimer;
export function toast(msg, sticky = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

export const state = {
  tracks: [],
  playlists: [],
  map: new Map(),
  covers: new Map(),
  lists: {},
  route: { view: 'home', param: '', query: new URLSearchParams() },
  libQuery: '',
  libSort: 'title',
  radio: { results: [], loading: false, query: '', tag: '', error: '', loaded: false },
  stations: new Map(),
  menu: null,
  installPrompt: null,
  account: null,
  pricing: null,
};

export const hooks = { render: () => {} };
export const getTrack = (id) => state.map.get(id);

export function go(view, param = '') {
  const hash = `#/${view}${param ? '/' + encodeURIComponent(param) : ''}`;
  if (location.hash !== hash) location.hash = hash;
  else hooks.render();
}

export function coverUrl(t) {
  if (!t || !t.cover) return null;
  let u = state.covers.get(t.id);
  if (!u) {
    u = URL.createObjectURL(t.cover);
    state.covers.set(t.id, u);
  }
  return u;
}

export function coverHTML(t, size = '', seed) {
  const u = coverUrl(t);
  if (u) return `<div class="cover ${size}"><img src="${u}" alt="" loading="lazy" decoding="async"></div>`;
  return `<div class="cover ${size}" style="--h:${hue(seed ?? t?.album ?? '')}">${icon('note')}</div>`;
}

export function groupCover(tracks, size, seed, ico = 'note', round = false) {
  const withCover = tracks.find((t) => t.cover);
  if (withCover) return coverHTML(withCover, size + (round ? ' round' : ''));
  return `<div class="cover ${size}${round ? ' round' : ''}" style="--h:${hue(seed)}">${icon(ico)}</div>`;
}

export function setRangeP(input) {
  const min = +input.min || 0, max = +input.max || 100;
  input.style.setProperty('--p', ((input.value - min) / (max - min)) * 100 + '%');
}

// ---------- Sheets (menus & dialogs) ----------
let sheetResolve = null;
export function openSheet(html) {
  const sheet = $('#sheet');
  sheet.innerHTML = html;
  hydrateIcons(sheet);
  sheet.hidden = false;
  $('#sheet-backdrop').hidden = false;
  const first = sheet.querySelector('input:not([type=checkbox]), textarea');
  if (first) setTimeout(() => first.focus(), 50);
}
export function closeSheet(result = null) {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  state.menu = null;
  if (sheetResolve) {
    const r = sheetResolve;
    sheetResolve = null;
    r(result);
  }
}
export function promptSheet(title, value = '', ok = 'Speichern') {
  openSheet(`<h3>${esc(title)}</h3><form data-form="prompt">
    <input class="input" name="v" value="${esc(value)}" maxlength="100" required autocomplete="off">
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
    <button class="btn btn-primary">${esc(ok)}</button></div></form>`);
  return new Promise((res) => { sheetResolve = res; });
}
export function confirmSheet(text, ok = 'Löschen') {
  openSheet(`<h3>${esc(text)}</h3><form data-form="confirm"><div class="row" style="justify-content:flex-end">
    <button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
    <button class="btn btn-primary" style="background:var(--danger)">${esc(ok)}</button></div></form>`);
  return new Promise((res) => { sheetResolve = res; });
}
