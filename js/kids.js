// Kinder-Modus: a simple, colourful player for children. Parents lock it with a PIN and decide how long,
// until when, how loud and what may be played. Everything else in Melody stays locked until the PIN is entered.
import { player } from './player.js';
import { icon, hydrateIcons, setIcon } from './icons.js';
import { $, esc, toast, state, getTrack, coverHTML, hue, openSheet, closeSheet, hooks, setRangeP } from './core.js';
import { loadCatalog, ensureTracks, playable } from './catalog.js';
import { closeSing, isSingOpen } from './lyrics.js';

const KEY = 'melody.kids';
const DEFAULTS = {
  active: false, name: '', pin: '', salt: '', limit: 60, bedtime: '', volCap: 0.7, source: 'catalog',
  day: '', usedMs: 0, extraMs: 0, lateUntil: 0, prevVol: null, fails: 0, lockUntil: 0,
};
const LIMITS = [0, 15, 30, 45, 60, 90, 120];
const BEDTIMES = ['', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'];
const CAPS = [0.5, 0.6, 0.7, 0.8, 1];
const MORNING = 6; // bedtime lasts until 6:00
const K = { cfg: null, tick: null, items: [], pin: '', panel: '', fading: false, warned: false, dirty: 0, block: '' };

function cfg() {
  if (!K.cfg) {
    try { K.cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { K.cfg = { ...DEFAULTS }; }
  }
  return K.cfg;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg())); } catch { /* storage full or blocked */ } }
export const kidsActive = () => !!cfg().active;

// A local child lock, not an account password: a salted hash just keeps the PIN out of plain sight.
function hashPin(pin, salt) {
  let h = 0x811c9dc5;
  const s = `${salt}:${pin}:melody-kids`;
  for (let r = 0; r < 500; r++) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + r; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ---------- Time budget & bedtime ----------
const today = () => new Date().toLocaleDateString('sv');
function rollDay() {
  const c = cfg();
  if (c.day !== today()) { c.day = today(); c.usedMs = 0; c.extraMs = 0; K.warned = false; save(); }
}
const leftMs = () => (cfg().limit ? cfg().limit * 60000 + cfg().extraMs - cfg().usedMs : Infinity);
function isBedtime() {
  const c = cfg();
  if (!c.bedtime || Date.now() < c.lateUntil) return false;
  const [h, m] = c.bedtime.split(':').map(Number);
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= h * 60 + m || d.getHours() < MORNING;
}
const blockReason = () => (isBedtime() ? 'bedtime' : leftMs() <= 0 ? 'timeup' : '');

function enforce() {
  const b = blockReason();
  if (b !== K.block) { K.block = b; renderNight(); }
  if (!b || !player.playing) return;
  if (!K.fading) {
    K.fading = true;
    player.fadeOutAndPause(true);
    setTimeout(() => { K.fading = false; if (blockReason() && player.playing) player.pause(); }, 6000);
  }
}

function tick() {
  rollDay();
  const c = cfg();
  if (player.playing && !K.fading) {
    c.usedMs += 1000;
    if (++K.dirty % 5 === 0) save();
  }
  const left = leftMs();
  if (left <= 120000 && left > 0 && !K.warned) { K.warned = true; toast('Noch 2 Minuten Musik für heute 🎵'); }
  renderTime();
  enforce();
}

// ---------- What the child may play ----------
async function loadItems() {
  const src = cfg().source;
  if (src === 'favs') return state.tracks.filter((t) => t.favorite).map((t) => ({ track: t }));
  if (src.startsWith('pl:')) {
    const p = state.playlists.find((x) => x.id === src.slice(3));
    return (p?.trackIds || []).map(getTrack).filter(Boolean).map((t) => ({ track: t }));
  }
  return (await loadCatalog()).slice(0, 60).map((c) => ({ entry: c, track: getTrack('cat:' + c.id) }));
}
const itemTitle = (it) => it.track?.title || it.entry.title;
const itemArtist = (it) => it.track?.artist || it.entry.artist;
const itemCover = (it) => (it.track ? coverHTML(it.track, 'kd')
  : `<div class="cover kd" style="--h:${hue(it.entry.title)}"><img src="catalog/${esc(it.entry.cover)}" alt="" onerror="this.remove()">${icon('note')}</div>`);

async function playFrom(i) {
  if (blockReason()) { renderNight(); return; }
  const tracks = [];
  for (const it of K.items) {
    if (!it.track && it.entry) [it.track] = await ensureTracks([it.entry]);
    tracks.push(it.track);
  }
  const ok = tracks.filter((t) => t && playable(t));
  const start = ok.indexOf(tracks[i]);
  if (start < 0) { toast('Dieses Lied geht gerade nicht – ohne Internet nur geladene Lieder.'); return; }
  await player.playList(ok.map((t) => t.id), start);
}

// ---------- Screen ----------
function shell() {
  const c = cfg();
  return `<div class="kd-sky" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <header class="kd-top">
      <div class="kd-hello">Hallo${c.name ? ' ' + esc(c.name) : ''}! <span aria-hidden="true">👋</span></div>
      <div class="kd-time" id="kd-time"></div>
      <button class="kd-lock" data-action="kids-parent" aria-label="Eltern-Bereich (PIN)">${icon('lock')}<span>Eltern</span></button>
    </header>
    <div class="kd-grid" id="kd-grid"><p class="kd-empty">Lieder werden geladen …</p></div>
    <footer class="kd-player" id="kd-player"></footer>
    <div class="kd-layer" id="kd-pin" hidden></div>
    <div class="kd-layer kd-night" id="kd-night" hidden></div>`;
}

function renderGrid() {
  const g = $('#kd-grid');
  if (!g) return;
  if (!K.items.length) {
    g.innerHTML = `<p class="kd-empty">Hier sind noch keine Lieder. Bitte frag Mama oder Papa! <span aria-hidden="true">🎈</span></p>`;
    return;
  }
  const cur = player.mode === 'library' ? player.track?.id : null;
  g.innerHTML = K.items.map((it, i) => `<button class="kd-tile${it.track && it.track.id === cur ? ' on' : ''}" data-action="kids-play" data-i="${i}" style="--h:${hue(itemTitle(it))}">
      ${itemCover(it)}<b>${esc(itemTitle(it))}</b><span>${esc(itemArtist(it))}</span></button>`).join('');
  hydrateIcons(g);
}

function renderPlayer() {
  const el = $('#kd-player');
  if (!el) return;
  const t = player.mode === 'library' ? player.track : null;
  const cap = cfg().volCap;
  el.innerHTML = `<div class="kd-now">${t ? coverHTML(t, 'sm') : `<div class="cover sm">${icon('note')}</div>`}
      <div><b>${t ? esc(t.title) : 'Tippe auf ein Lied!'}</b><span>${t ? esc(t.artist) : ''}</span></div></div>
    <div class="kd-ctrl">
      <button class="kd-btn" data-action="prev" aria-label="Zurück">${icon('prev')}</button>
      <button class="kd-btn big" data-action="toggle" id="kd-play" aria-label="${player.playing ? 'Pause' : 'Abspielen'}">${icon(player.playing ? 'pause' : 'play')}</button>
      <button class="kd-btn" data-action="next" aria-label="Weiter">${icon('next')}</button>
    </div>
    <div class="kd-extra">
      ${t?.lyrics ? `<button class="kd-sing" data-action="kids-sing">${icon('mic')}<span>Mitsingen</span></button>` : ''}
      <label class="kd-vol">${icon('volume')}<input type="range" id="kd-vol" min="0" max="${cap}" step="0.05" value="${Math.min(player.settings.volume, cap)}" aria-label="Lautstärke"></label>
    </div>`;
  hydrateIcons(el);
  setRangeP($('#kd-vol'));
  document.querySelectorAll('.kd-tile').forEach((b) => b.classList.toggle('on', !!t && K.items[+b.dataset.i]?.track?.id === t.id));
  $('#kids').classList.toggle('playing', player.playing);
}

function renderTime() {
  const el = $('#kd-time');
  if (!el) return;
  const c = cfg();
  const left = leftMs();
  const parts = [];
  if (left !== Infinity) parts.push(`<span aria-hidden="true">⏳</span> Noch ${Math.max(0, Math.ceil(left / 60000))} Min.`);
  if (c.bedtime) parts.push(`<span aria-hidden="true">🌙</span> ${c.bedtime} Uhr`);
  el.innerHTML = parts.join(' · ');
}

function renderNight() {
  const el = $('#kd-night');
  if (!el) return;
  const b = blockReason();
  el.hidden = !b;
  if (!b) return;
  if (isSingOpen()) closeSing();
  el.innerHTML = `<div class="kd-moon">${icon('moon')}</div>
    <h2>${b === 'bedtime' ? 'Schlafenszeit!' : 'Für heute ist Schluss!'}</h2>
    <p>${b === 'bedtime' ? 'Die Musik schläft jetzt auch. Gute Nacht und träum was Schönes!' : 'Du hast heute schon ganz viel Musik gehört. Morgen geht es weiter!'}</p>
    <button class="kd-lock" data-action="kids-parent">${icon('lock')}<span>Eltern</span></button>`;
  hydrateIcons(el);
}

// ---------- Parent PIN ----------
function renderPin(msg = '') {
  const el = $('#kd-pin');
  const c = cfg();
  const locked = Date.now() < c.lockUntil;
  if (K.panel === 'menu') {
    const b = blockReason();
    el.innerHTML = `<div class="kd-box">
      <h2>${icon('lock')} Eltern-Bereich</h2>
      <div class="kd-menu">
        ${cfg().limit ? `<button class="btn" data-action="kids-extra">${icon('timer')}+15 Minuten Musik</button>` : ''}
        ${b === 'bedtime' ? `<button class="btn" data-action="kids-late">${icon('moon')}Heute 30 Minuten länger</button>` : ''}
        <button class="btn btn-primary" data-action="kids-exit">${icon('kids')}Kinder-Modus beenden</button>
        <button class="btn" data-action="kids-pin-close">Zurück zum Kind</button>
      </div></div>`;
  } else {
    el.innerHTML = `<div class="kd-box">
      <h2>${icon('lock')} Eltern-Bereich</h2>
      <p>${locked ? `Zu viele Versuche. Bitte warte ${Math.ceil((c.lockUntil - Date.now()) / 1000)} Sekunden.` : 'Bitte gib die Eltern-PIN ein.'}</p>
      <div class="kd-dots${msg ? ' bad' : ''}" aria-live="polite" aria-label="${K.pin.length} von 4 Ziffern">${[0, 1, 2, 3].map((i) => `<i class="${i < K.pin.length ? 'on' : ''}"></i>`).join('')}</div>
      <p class="kd-msg">${esc(msg)}</p>
      <div class="kd-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-action="kids-key" data-k="${d}"${locked ? ' disabled' : ''}>${d}</button>`).join('')}
        <button data-action="kids-pin-close" aria-label="Abbrechen">✕</button>
        <button data-action="kids-key" data-k="0"${locked ? ' disabled' : ''}>0</button>
        <button data-action="kids-key" data-k="back" aria-label="Löschen">${icon('backspace')}</button></div></div>`;
  }
  el.hidden = false;
  hydrateIcons(el);
}

function pinDigit(k) {
  const c = cfg();
  if (Date.now() < c.lockUntil) return renderPin();
  if (k === 'back') K.pin = K.pin.slice(0, -1);
  else if (K.pin.length < 4) K.pin += k;
  if (K.pin.length < 4) return renderPin();
  const ok = hashPin(K.pin, c.salt) === c.pin;
  K.pin = '';
  if (ok) {
    c.fails = 0;
    save();
    K.panel = 'menu';
    return renderPin();
  }
  c.fails++;
  if (c.fails >= 5) { c.fails = 0; c.lockUntil = Date.now() + 60000; setTimeout(() => K.panel === 'pin' && !$('#kd-pin').hidden && renderPin(), 60500); }
  save();
  renderPin('Falsche PIN');
}

// ---------- Enter / leave ----------
async function openKids() {
  let el = $('#kids');
  if (!el) {
    el = document.createElement('section');
    el.id = 'kids';
    el.className = 'kids';
    el.setAttribute('aria-label', 'Kinder-Modus');
    document.body.append(el);
  }
  el.innerHTML = shell();
  el.hidden = false;
  hydrateIcons(el);
  document.body.classList.add('kids-on');
  player.volumeCap = cfg().volCap;
  if (player.settings.volume > cfg().volCap) { player.setVolume(cfg().volCap); hooks.syncVolume?.(); }
  rollDay();
  renderTime();
  renderPlayer();
  K.block = null;
  enforce();
  clearInterval(K.tick);
  K.tick = setInterval(tick, 1000);
  K.items = await loadItems();
  renderGrid();
}

async function enterKids() {
  const c = cfg();
  if (player.playing) player.pause();
  closeSheet();
  hooks.closeOverlays?.();
  c.active = true;
  c.prevVol = player.settings.volume;
  c.fails = 0;
  save();
  await openKids();
}

function exitKids() {
  const c = cfg();
  c.active = false;
  save();
  clearInterval(K.tick);
  K.tick = null;
  K.panel = '';
  player.volumeCap = null;
  if (c.prevVol != null) { player.setVolume(c.prevVol); hooks.syncVolume?.(); }
  document.body.classList.remove('kids-on');
  if (isSingOpen()) closeSing();
  const el = $('#kids');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  toast('Kinder-Modus beendet');
}

// Called once at start-up: a reload must not get a child out of the Kinder-Modus.
export function initKids() {
  if (kidsActive()) openKids();
}
// After the library has loaded (favourites and playlists are known).
export async function refreshKids() {
  if (!kidsActive() || !$('#kids') || $('#kids').hidden) return;
  K.items = await loadItems();
  renderGrid();
  renderPlayer();
}

// ---------- Setup (by a parent, outside the Kinder-Modus) ----------
function setupSheet() {
  const c = cfg();
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  const sources = [['catalog', 'Melody-Katalog'], ['favs', 'Meine Lieblingssongs'], ...state.playlists.map((p) => ['pl:' + p.id, 'Playlist: ' + p.name])];
  openSheet(`<h3>${icon('kids')} Kinder-Modus</h3>
    <form class="stack kd-setup" data-form="kids-setup" style="padding:4px 10px 10px">
      <p class="muted small">Eine einfache, bunte Ansicht für Kinder: große Bilder statt Menüs, keine Käufe, kein Radio, keine KI, keine Einstellungen. Raus geht es nur mit deiner PIN.</p>
      <label>Name des Kindes (freiwillig)<input class="input plain" name="name" maxlength="20" value="${esc(c.name)}" autocomplete="off"></label>
      <div class="row nowrap">
        <label style="flex:1">${c.pin ? 'Neue PIN (leer = bleibt)' : 'Eltern-PIN (4 Ziffern)'}<input class="input plain" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" ${c.pin ? '' : 'required'} type="password"></label>
        <label style="flex:1">PIN wiederholen<input class="input plain" name="pin2" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" type="password"></label>
      </div>
      <label>Musik pro Tag<select class="input plain" name="limit">${LIMITS.map((m) => opt(m, m ? `${m} Minuten` : 'Unbegrenzt', c.limit)).join('')}</select></label>
      <label>Schlafenszeit (bis 6 Uhr keine Musik)<select class="input plain" name="bedtime">${BEDTIMES.map((b) => opt(b, b ? `ab ${b} Uhr` : 'Keine', c.bedtime)).join('')}</select></label>
      <label>Gehörschutz: Lautstärke höchstens<select class="input plain" name="volCap">${CAPS.map((v) => opt(v, `${Math.round(v * 100)} %`, c.volCap)).join('')}</select></label>
      <label>Welche Musik?<select class="input plain" name="source">${sources.map(([v, l]) => opt(v, l, c.source)).join('')}</select></label>
      <p class="kd-err small" hidden></p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="close-sheet">Abbrechen</button>
        <button class="btn btn-primary">${icon('kids')}Kinder-Modus starten</button></div>
    </form>`);
}

export const kidsForms = {
  'kids-setup': async (form) => {
    const c = cfg();
    const err = (m) => { const e = form.querySelector('.kd-err'); e.textContent = m; e.hidden = false; };
    const pin = form.pin.value.trim();
    if (pin || !c.pin) {
      if (!/^\d{4}$/.test(pin)) return err('Die PIN muss aus genau 4 Ziffern bestehen.');
      if (pin !== form.pin2.value.trim()) return err('Die beiden PINs sind nicht gleich.');
      if (/^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return err('Bitte keine leicht zu ratende PIN wie 1111 oder 1234.');
      c.salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
      c.pin = hashPin(pin, c.salt);
    }
    c.name = form.name.value.trim().slice(0, 20);
    c.limit = Number(form.limit.value) || 0;
    c.bedtime = BEDTIMES.includes(form.bedtime.value) ? form.bedtime.value : '';
    c.volCap = CAPS.includes(Number(form.volCap.value)) ? Number(form.volCap.value) : 0.7;
    c.source = form.source.value;
    await enterKids();
  },
};

export const kidsActions = {
  kids: () => (kidsActive() ? openKids() : setupSheet()),
  'kids-play': (el) => playFrom(+el.dataset.i),
  'kids-sing': () => { if (!blockReason()) hooks.sing?.(); },
  'kids-parent': () => { K.pin = ''; K.panel = 'pin'; renderPin(); },
  'kids-key': (el) => pinDigit(el.dataset.k),
  'kids-pin-close': () => { K.pin = ''; K.panel = ''; $('#kd-pin').hidden = true; },
  'kids-exit': () => { if (K.panel === 'menu') exitKids(); },
  'kids-extra': () => {
    if (K.panel !== 'menu') return;
    rollDay();
    cfg().extraMs += 15 * 60000;
    K.warned = false;
    save();
    kidsActions['kids-pin-close']();
    tick();
    toast('15 Minuten mehr Musik 🎉');
  },
  'kids-late': () => {
    if (K.panel !== 'menu') return;
    cfg().lateUntil = Date.now() + 30 * 60000;
    save();
    kidsActions['kids-pin-close']();
    tick();
    toast('Heute 30 Minuten länger wach 🌙');
  },
};

// In the Kinder-Modus only these actions work (plus everything inside the login/paywall gate).
const ALLOWED = new Set(['toggle', 'next', 'prev', 'sing-close', 'sing-mic', 'close-sheet']);
export function kidsAllows(el) {
  const a = el.dataset.action || el.dataset.form || '';
  return a.startsWith('kids') || ALLOWED.has(a) || !!el.closest('#gate');
}

// Keyboard inside the Kinder-Modus: play/pause, PIN digits, Escape closes the PIN pad or sing-along.
export function kidsKey(e) {
  if (e.target.closest('input, select, textarea')) return;
  const pinOpen = !$('#kd-pin')?.hidden && K.panel === 'pin';
  if (pinOpen && /^\d$/.test(e.key)) { e.preventDefault(); pinDigit(e.key); return; }
  if (pinOpen && e.key === 'Backspace') { e.preventDefault(); pinDigit('back'); return; }
  if (e.key === 'Escape') {
    if (isSingOpen()) closeSing();
    else if (!$('#kd-pin')?.hidden) kidsActions['kids-pin-close']();
    return;
  }
  if (e.key === ' ') { e.preventDefault(); if (!blockReason()) player.toggle(); }
}

export function onKidsInput(el) {
  if (el.id !== 'kd-vol') return false;
  player.setVolume(Math.min(+el.value, cfg().volCap));
  hooks.syncVolume?.();
  setRangeP(el);
  return true;
}

for (const ev of ['track', 'state']) {
  player.addEventListener(ev, () => {
    if (!kidsActive() || !$('#kids') || $('#kids').hidden) return;
    if (ev === 'state' && player.playing && blockReason()) enforce();
    renderPlayer();
  });
}

// Test hook
window.__melodyKids = { K, cfg, hashPin, today };
