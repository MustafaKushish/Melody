// Barrierefreiheit & Bedienkomfort: larger text, high contrast, calm mode, spoken song titles,
// screen-reader announcements, focus handling, drag-to-reorder (mouse, touch, keyboard) and swipes on the mini player.
import { player } from './player.js';
import { $ } from './core.js';

const KEY = 'melody.a11y';
const DEFAULTS = { text: 1, contrast: false, calm: false, speak: false };
export const a11y = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(a11y)); } catch { /* blocked */ } };
export const TEXT_SIZES = [[1, 'Normal'], [1.15, 'Groß'], [1.3, 'Sehr groß']];

export function applyA11y() {
  const r = document.documentElement;
  r.style.setProperty('--zoom', a11y.text);
  r.classList.toggle('big-text', a11y.text > 1);
  r.classList.toggle('hc', !!a11y.contrast);
  r.classList.toggle('calm', !!a11y.calm);
}
export const calm = () => !!a11y.calm || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function setA11y(key, value) {
  if (!(key in DEFAULTS)) return;
  a11y[key] = value;
  save();
  applyA11y();
}

// ---------- Announcements ----------
export function announce(msg) {
  const el = $('#sr-live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 60);
}

function speak(text) {
  if (!('speechSynthesis' in window) || !$('#drive')?.hidden) return; // the drive mode has its own voice
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  player.duck(true);
  u.onend = u.onerror = () => player.duck(false);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

let lastSaid = '';
function onPlayback() {
  if (!player.playing) return;
  const { title, artist } = player.nowInfo();
  if (!title) return;
  const key = `${player.mode}|${title}|${artist}`;
  if (key === lastSaid) return;
  lastSaid = key;
  const text = `Jetzt läuft: ${title}${artist ? ` von ${artist}` : ''}`;
  announce(text);
  if (a11y.speak) speak(text);
}
player.addEventListener('track', onPlayback);
player.addEventListener('state', onPlayback);

// ---------- Focus: keep keyboard users inside an open sheet ----------
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function trapTab(e) {
  if (e.key !== 'Tab') return false;
  const sheet = $('#sheet');
  if (!sheet || sheet.hidden) return false;
  const items = [...sheet.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (!items.length) return false;
  const first = items[0], last = items.at(-1);
  if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); return true; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); return true; }
  return false;
}

// ---------- Drag to reorder: lists marked data-sort="name[:arg]", rows data-sort-item, handles data-drag ----------
const SORTERS = {};
export function registerSorter(name, fn) { SORTERS[name] = fn; }
const rowsOf = (list) => [...list.querySelectorAll(':scope > [data-sort-item]')];

function commit(list, from, to) {
  const [name, ...rest] = list.dataset.sort.split(':');
  SORTERS[name]?.(from, to, rest.join(':'), list);
}

let drag = null;
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest?.('[data-drag]');
  if (!h || e.button !== 0) return;
  const row = h.closest('[data-sort-item]');
  const list = row?.closest('[data-sort]');
  if (!list) return;
  e.preventDefault();
  try { h.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
  drag = { h, row, list, from: rowsOf(list).indexOf(row), y0: e.clientY, moved: false, id: e.pointerId, scroller: list.closest('main, .sheet') };
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.abs(e.clientY - drag.y0) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.row.classList.add('dragging');
    drag.list.classList.add('sorting');
  }
  const others = rowsOf(drag.list).filter((r) => r !== drag.row);
  const before = others.find((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
  if (before) { if (drag.row.nextElementSibling !== before) drag.list.insertBefore(drag.row, before); }
  else if (others.length && others.at(-1).nextElementSibling !== drag.row) others.at(-1).after(drag.row);
  const sc = drag.scroller;
  if (sc) {
    const r = sc.getBoundingClientRect();
    if (e.clientY < r.top + 56) sc.scrollTop -= 14;
    else if (e.clientY > r.bottom - 56 - (sc.matches('main') ? 150 : 0)) sc.scrollTop += 14;
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  d.row.classList.remove('dragging');
  d.list.classList.remove('sorting');
  if (!d.moved) return;
  const all = rowsOf(d.list);
  const to = all.indexOf(d.row);
  if (to !== d.from) {
    commit(d.list, d.from, to);
    announce(`Verschoben auf Position ${to + 1} von ${all.length}`);
  }
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// Keyboard: arrow keys on a focused handle move the row by one.
export function dragKey(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  const h = e.target.closest?.('[data-drag]');
  const row = h?.closest('[data-sort-item]');
  const list = row?.closest('[data-sort]');
  if (!list) return false;
  e.preventDefault();
  const all = rowsOf(list);
  const from = all.indexOf(row);
  const to = from + (e.key === 'ArrowUp' ? -1 : 1);
  if (to < 0 || to >= all.length) return true;
  const sel = list.dataset.sort;
  commit(list, from, to);
  announce(`Verschoben auf Position ${to + 1} von ${all.length}`);
  setTimeout(() => {
    const nl = [...document.querySelectorAll('[data-sort]')].find((l) => l.dataset.sort === sel);
    nl && rowsOf(nl)[to]?.querySelector('[data-drag]')?.focus();
  }, 0);
  return true;
}

// ---------- Full-screen player: swipe down to close, swipe the cover for next / previous ----------
let npSwipe = null;
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !e.target.closest?.('#now-playing .np-head, #now-playing .np-art')) return;
  if (e.target.closest('#np-lyrics, button, input')) return;
  npSwipe = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now(), onCover: !!e.target.closest('#np-cover') };
});
document.addEventListener('pointerup', (e) => {
  if (!npSwipe || e.pointerId !== npSwipe.id) return;
  const s = npSwipe;
  npSwipe = null;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Date.now() - s.t > 800) return;
  if (dy > 90 && Math.abs(dx) < 60) $('#now-playing [data-action=close-np]')?.click();
  else if (s.onCover && Math.abs(dx) > 60 && Math.abs(dy) < 45 && player.mode === 'library') { if (dx < 0) player.next(); else player.prev(); }
});
document.addEventListener('pointercancel', () => { npSwipe = null; swipe = null; });

// ---------- Swipe left/right on the mini player: next / previous song ----------
let swipe = null;
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !e.target.closest?.('#player-bar .pb-left')) return;
  swipe = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now() };
});
document.addEventListener('pointerup', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe;
  swipe = null;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) < 60 || Math.abs(dy) > 45 || Date.now() - s.t > 700 || player.mode !== 'library') return;
  // The finger lifts on the bar: swallow the click that would open the full player.
  const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 400);
  if (dx < 0) player.next(); else player.prev();
});
