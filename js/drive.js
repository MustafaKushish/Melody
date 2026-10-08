// Fahrermodus: big controls, map with turn-by-turn guidance, voice control.
// Safety: while the car moves, typing and browsing are locked – voice or the passenger unlock them.
import { player } from './player.js';
import { icon, hydrateIcons, setIcon } from './icons.js';
import { $, esc, toast, state, getTrack, coverHTML, hooks, hue } from './core.js';
import { loadCatalog, ensureTracks, playable } from './catalog.js';
import { MOODS, localMix } from './foryou.js';

const DEFAULT_GEO = {
  // Free OpenStreetMap services – for many users switch to a paid provider (MapTiler, Stadia, own OSRM).
  tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  search: 'https://nominatim.openstreetmap.org/search',
  route: 'https://router.project-osrm.org/route/v1/driving',
};
const geo = () => ({ ...DEFAULT_GEO, ...(window.MELODY_GEO || {}) });

const MOVING_KMH = 10;
const PASSENGER_MIN = 15;

const D = {
  open: false, map: null, marker: null, line: null, watch: null, pos: null, speed: 0, moving: false,
  passengerUntil: 0, route: null, step: 1, announced: {}, offCount: 0, lastReroute: 0, follow: true,
  wake: null, clock: null, results: [], listening: false,
};

// ---------- Geometry ----------
const rad = (d) => (d * Math.PI) / 180;
export function distance(a, b) {
  const R = 6371000;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function distToSegment(p, a, b) {
  const k = Math.cos(rad(p.lat)) * 111320, m = 110540;
  const ax = (a.lng - p.lng) * k, ay = (a.lat - p.lat) * m, bx = (b.lng - p.lng) * k, by = (b.lat - p.lat) * m;
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function distToRoute(p, coords) {
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) best = Math.min(best, distToSegment(p, coords[i - 1], coords[i]));
  return best;
}

// ---------- Instructions (German) ----------
const DIR = { left: 'links', right: 'rechts', 'slight left': 'leicht links', 'slight right': 'leicht rechts', 'sharp left': 'scharf links', 'sharp right': 'scharf rechts', straight: 'geradeaus', uturn: 'wenden' };
const ARROW = { left: '←', right: '→', 'slight left': '↖', 'slight right': '↗', 'sharp left': '↙', 'sharp right': '↘', straight: '↑', uturn: '↶' };

export function instruction(s) {
  const on = s.name ? ` auf ${s.name}` : '';
  const d = DIR[s.modifier] || 'geradeaus';
  switch (s.type) {
    case 'depart': return `Losfahren${on}`;
    case 'arrive': return 'Ziel erreicht';
    case 'roundabout': case 'rotary': case 'roundabout turn': return `Im Kreisverkehr die ${s.exit || 1}. Ausfahrt nehmen${on}`;
    case 'merge': return `Einfädeln${on}`;
    case 'on ramp': return `Auffahrt ${d} nehmen${on}`;
    case 'off ramp': return `Ausfahrt ${d} nehmen${on}`;
    case 'fork': return `An der Gabelung ${d} halten${on}`;
    case 'continue': case 'new name': return s.modifier && s.modifier !== 'straight' ? `${cap(d)} halten${on}` : `Weiter geradeaus${on}`;
    default:
      if (s.modifier === 'uturn') return `Wenden${on}`;
      if (s.modifier === 'straight') return `Geradeaus weiterfahren${on}`;
      return `${cap(d)} abbiegen${on}`;
  }
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const arrowFor = (s) => (s.type === 'arrive' ? '⚑' : s.type?.includes('round') || s.type === 'rotary' ? '⟳' : ARROW[s.modifier] || '↑');

export function fmtDist(m) {
  if (m >= 1000) return `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}
const spokenDist = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Kilometern` : `${Math.round(m / 50) * 50 || 50} Metern`);
const fmtTime = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} Std. ${Math.round((s % 3600) / 60)} Min.` : `${Math.max(1, Math.round(s / 60))} Min.`);

// ---------- Voice ----------
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  player.duck(true);
  u.onend = u.onerror = () => player.duck(false);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Sprachsteuerung wird von diesem Browser nicht unterstützt (am besten Chrome oder Safari).'); return; }
  const r = new SR();
  r.lang = 'de-DE';
  r.interimResults = false;
  D.listening = true;
  renderListening();
  player.duck(true);
  r.onresult = (e) => handleCommand(e.results[0][0].transcript);
  r.onerror = (e) => { if (e.error === 'not-allowed') toast('Mikrofon-Zugriff wurde abgelehnt.'); };
  r.onend = () => { D.listening = false; renderListening(); player.duck(false); };
  try { r.start(); } catch { r.onend(); }
}

function renderListening() {
  const b = $('#dv-voice');
  if (b) b.classList.toggle('listening', D.listening);
}

function matchTracks(q) {
  const s = q.toLowerCase();
  const pl = state.playlists.find((p) => p.name.toLowerCase().includes(s));
  if (pl) return { ids: pl.trackIds, label: pl.name };
  const byArtist = state.tracks.filter((t) => t.artist.toLowerCase().includes(s));
  if (byArtist.length) return { ids: byArtist.map((t) => t.id), label: byArtist[0].artist };
  const byTitle = state.tracks.filter((t) => t.title.toLowerCase().includes(s));
  if (byTitle.length) return { ids: byTitle.map((t) => t.id), label: byTitle[0].title };
  const mood = Object.keys(MOODS).find((m) => s.includes(m.toLowerCase()) || MOODS[m].words.some((w) => s.includes(w)));
  if (mood) { const r = localMix(q, mood); return { ids: r.ids, label: r.title }; }
  return null;
}

async function playQuery(q) {
  q = q.replace(/\b(mir|bitte|etwas|was|musik|von|die|den|das|playlist)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!q) { player.play(); return; }
  let m = matchTracks(q);
  if (!m) {
    const cat = await loadCatalog();
    const c = cat.filter((x) => `${x.title} ${x.artist} ${x.genre}`.toLowerCase().includes(q.toLowerCase()));
    if (c.length) { const ts = await ensureTracks(c); m = { ids: ts.map((t) => t.id), label: c[0].title }; }
  }
  if (!m) { speak(`Ich habe ${q} nicht gefunden.`); toast(`„${q}“ nicht gefunden`); return; }
  const ids = m.ids.filter((id) => playable(getTrack(id)));
  if (!ids.length) { speak('Das ist offline nicht verfügbar.'); return; }
  player.playList(ids, 0);
  toast(`▶ ${m.label}`);
}

export function handleCommand(text) {
  const t = text.toLowerCase().trim();
  let m;
  toast(`🎙 „${text}“`);
  if ((m = t.match(/^(?:navigier\w*|fahr\w*|route|bring mich|navigation)\s+(?:nach|zu|zur|zum|bis)\s+(.+)$/))) return searchAndRoute(m[1]);
  if (/navigation (beenden|stoppen|abbrechen)|route (beenden|abbrechen)/.test(t)) { endRoute(); speak('Navigation beendet.'); return; }
  if (/(nächst|überspring|skip)/.test(t) || t === 'weiter') return player.next();
  if (/(zurück|vorherig)/.test(t)) return player.prev();
  if (/(pause|stopp|stop|anhalten|ruhe)/.test(t)) return player.pause();
  if (/lauter/.test(t)) return setVol(0.15);
  if (/leiser/.test(t)) return setVol(-0.15);
  if (/(gefällt mir|favorit|like)/.test(t)) { if (player.track) hooks.toggleFav(player.track); return; }
  if (/(wie lange|wann .*an|ankunft)/.test(t) && D.route) return speak(etaSpeech());
  if (/(welcher song|welches lied|was läuft|wie heißt (der|das) (song|lied))/.test(t)) return hooks.recognize?.();
  if ((m = t.match(/^(?:spiel\w*|hör\w*|play|leg)\s*(?:auf\s*)?(.*)$/))) return playQuery(m[1]);
  speak('Das habe ich nicht verstanden.');
}

function setVol(d) {
  player.setVolume(Math.min(1, Math.max(0, player.settings.volume + d)));
  toast(`Lautstärke ${Math.round(player.settings.volume * 100)} %`);
}

// ---------- Map & position ----------
let leafletP;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletP ||= new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => res(window.L);
    s.onerror = () => rej(new Error('Karte konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
  return leafletP;
}

async function initMap() {
  const L = await loadLeaflet().catch((e) => { toast(e.message); return null; });
  if (!L || !D.open) return;
  const g = geo();
  D.map = L.map('dv-map', { zoomControl: false, attributionControl: true }).setView([51.16, 10.45], 6);
  L.tileLayer(g.tiles, { maxZoom: 19, attribution: g.attribution }).addTo(D.map);
  D.map.on('dragstart', () => { D.follow = false; $('#dv-recenter').hidden = false; });
  if (D.pos) onPosition(D.pos, true);
}

function carIcon(heading) {
  return window.L.divIcon({
    className: 'dv-car',
    html: `<div class="dv-car-dot" style="transform:rotate(${heading || 0}deg)"><span></span></div>`,
    iconSize: [36, 36], iconAnchor: [18, 18],
  });
}

function startGeo() {
  if (!('geolocation' in navigator)) { setStatus('Standort wird nicht unterstützt'); return; }
  let last = null;
  D.watch = navigator.geolocation.watchPosition((p) => {
    const pos = { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading, t: p.timestamp };
    let speed = p.coords.speed;
    if ((speed == null || Number.isNaN(speed)) && last) {
      const dt = (pos.t - last.t) / 1000;
      speed = dt > 0 ? distance(last, pos) / dt : 0;
    }
    if (pos.heading == null && last && distance(last, pos) > 3) {
      pos.heading = (Math.atan2(pos.lng - last.lng, pos.lat - last.lat) * 180) / Math.PI;
    }
    last = pos;
    D.speed = Math.max(0, (speed || 0) * 3.6);
    onPosition(pos);
  }, (e) => setStatus(e.code === 1 ? 'Standortfreigabe fehlt – Karte ohne Position' : 'Kein GPS-Signal'), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}

// Exposed for tests and for a car head unit feeding positions.
export function onPosition(pos, initial = false) {
  D.pos = pos;
  const wasMoving = D.moving;
  D.moving = D.speed >= MOVING_KMH || (wasMoving && D.speed >= MOVING_KMH / 2);
  const sp = $('#dv-speed');
  if (sp) sp.textContent = Math.round(D.speed);
  setStatus('');
  if (wasMoving !== D.moving) renderLock();
  if (D.map) {
    const ll = [pos.lat, pos.lng];
    if (!D.marker) D.marker = window.L.marker(ll, { icon: carIcon(pos.heading), interactive: false }).addTo(D.map);
    else { D.marker.setLatLng(ll); D.marker.setIcon(carIcon(pos.heading)); }
    if (D.follow) D.map.setView(ll, initial || D.map.getZoom() < 14 ? 16 : D.map.getZoom(), { animate: !initial });
  }
  guide();
}

function setStatus(text) {
  const el = $('#dv-status');
  if (el) { el.textContent = text; el.hidden = !text; }
}

// ---------- Routing ----------
async function searchPlaces(q) {
  const g = geo();
  const u = new URLSearchParams({ q, format: 'json', limit: '5', 'accept-language': 'de', addressdetails: '0' });
  if (D.pos) u.set('viewbox', `${D.pos.lng - 1},${D.pos.lat + 1},${D.pos.lng + 1},${D.pos.lat - 1}`);
  const r = await fetch(`${g.search}?${u}`);
  if (!r.ok) throw new Error('Suche nicht erreichbar');
  return (await r.json()).map((x) => ({ name: x.display_name, lat: +x.lat, lng: +x.lon }));
}

async function searchAndRoute(q) {
  try {
    const res = await searchPlaces(q);
    if (!res.length) { speak(`Ich habe ${q} nicht gefunden.`); return; }
    await startRoute(res[0]);
  } catch (e) {
    toast(e.message);
    speak('Die Suche ist gerade nicht erreichbar.');
  }
}

async function fetchRoute(from, to) {
  const r = await fetch(`${geo().route}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`);
  if (!r.ok) throw new Error('Route nicht verfügbar');
  const data = await r.json();
  const rt = data.routes?.[0];
  if (!rt) throw new Error('Keine Route gefunden');
  return {
    coords: rt.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distance: rt.distance,
    duration: rt.duration,
    steps: rt.legs.flatMap((l) => l.steps).map((s) => ({
      type: s.maneuver.type, modifier: s.maneuver.modifier, exit: s.maneuver.exit, name: s.name,
      loc: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] }, distance: s.distance,
    })),
  };
}

async function startRoute(dest, quiet = false) {
  if (!D.pos) { toast('Warte auf deinen Standort …'); speak('Ich warte noch auf deinen Standort.'); return; }
  try {
    const rt = await fetchRoute(D.pos, dest);
    D.route = { ...rt, dest };
    D.step = Math.min(1, rt.steps.length - 1);
    D.announced = {};
    D.offCount = 0;
    D.follow = true;
    D.results = [];
    drawRoute();
    renderSearch();
    if (!quiet) speak(`Route nach ${dest.name.split(',')[0]} berechnet. Fahrzeit ${fmtTime(rt.duration).replace(/\.$/, "")}. ${instruction(rt.steps[D.step])}.`);
    guide();
  } catch (e) {
    toast(e.message);
    if (!quiet) speak('Ich konnte keine Route berechnen.');
  }
}

function drawRoute() {
  if (!D.map || !D.route) return;
  if (D.line) D.line.remove();
  D.line = window.L.polyline(D.route.coords.map((c) => [c.lat, c.lng]), { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cf6', weight: 7, opacity: 0.9 }).addTo(D.map);
}

function endRoute() {
  D.route = null;
  if (D.line) { D.line.remove(); D.line = null; }
  $('#dv-maneuver').hidden = true;
  $('#dv-eta').hidden = true;
  renderSearch();
}

function remaining() {
  const r = D.route;
  const next = r.steps[D.step];
  const toNext = distance(D.pos, next.loc);
  const rest = r.steps.slice(D.step).reduce((s, x) => s + x.distance, 0);
  const dist = toNext + rest;
  return { dist, secs: r.duration * (dist / Math.max(1, r.distance)) };
}

function etaSpeech() {
  const { dist, secs } = remaining();
  const at = new Date(Date.now() + secs * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `Noch ${fmtDist(dist).replace('km', 'Kilometer').replace(' m', ' Meter')}, Ankunft um ${at} Uhr.`;
}

function guide() {
  const r = D.route;
  if (!r || !D.pos) return;
  let next = r.steps[D.step];
  let dist = distance(D.pos, next.loc);
  // Advance when the maneuver is reached – or already passed (closer to the following one than the maneuver itself is).
  const passed = () => {
    const after = r.steps[D.step + 1];
    return after && distance(D.pos, after.loc) < distance(next.loc, after.loc) - 20 && dist < 80;
  };
  while ((dist < 25 || passed()) && D.step < r.steps.length - 1) {
    D.step++;
    D.announced = {};
    next = r.steps[D.step];
    dist = distance(D.pos, next.loc);
  }
  if (next.type === 'arrive' && dist < 35) {
    speak(`Du hast dein Ziel erreicht. ${r.dest.name.split(',')[0]}.`);
    endRoute();
    return;
  }
  const text = instruction(next);
  if (dist <= 800 && dist > 250 && !D.announced.far) { D.announced.far = true; speak(`In ${spokenDist(dist)} ${text.charAt(0).toLowerCase() + text.slice(1)}.`); }
  else if (dist <= 120 && !D.announced.near) { D.announced.near = true; D.announced.far = true; speak(`Jetzt ${text.charAt(0).toLowerCase() + text.slice(1)}.`); }

  const man = $('#dv-maneuver');
  if (man) {
    man.hidden = false;
    man.innerHTML = `<span class="dv-arrow">${arrowFor(next)}</span><div><b>${fmtDist(dist)}</b><span>${esc(text)}</span></div>`;
  }
  const { dist: left, secs } = remaining();
  const eta = $('#dv-eta');
  if (eta) {
    eta.hidden = false;
    const at = new Date(Date.now() + secs * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    eta.innerHTML = `<div><b>${at}</b><span>${fmtTime(secs)} · ${fmtDist(left)}</span></div>
      <button class="dv-end" data-action="dv-end-route">Beenden</button>`;
  }

  // Off-route → recalculate (at most every 15 s).
  if (distToRoute(D.pos, r.coords) > 70) {
    if (++D.offCount >= 3 && Date.now() - D.lastReroute > 15000) {
      D.lastReroute = Date.now();
      D.offCount = 0;
      speak('Route wird neu berechnet.');
      startRoute(r.dest, true);
    }
  } else {
    D.offCount = 0;
  }
}

// ---------- UI ----------
const locked = () => D.moving && Date.now() > D.passengerUntil;

function renderSearch() {
  const box = $('#dv-search');
  if (!box) return;
  if (D.route) { box.hidden = true; return; }
  box.hidden = false;
  if (locked()) {
    box.innerHTML = `<div class="dv-locked">${icon('mic')}<div><b>Während der Fahrt gesperrt</b><span>Sag „Navigiere nach …“ oder lass den Beifahrer tippen.</span></div></div>`;
  } else {
    box.innerHTML = `<form data-form="dv-search" class="dv-form">${icon('search')}<input id="dv-q" class="input plain" placeholder="Wohin geht's?" autocomplete="off" enterkeyhint="search"></form>
      ${D.results.length ? `<div class="dv-results">${D.results.map((x, i) => `<button class="dv-result" data-action="dv-go" data-i="${i}">${icon('explore')}<span>${esc(x.name)}</span></button>`).join('')}</div>` : ''}`;
  }
  hydrateIcons(box);
}

function renderLock() {
  renderSearch();
  const btn = $('#dv-passenger');
  if (btn) {
    btn.hidden = !D.moving;
    btn.classList.toggle('on', Date.now() < D.passengerUntil);
  }
  document.querySelector('.drive')?.classList.toggle('moving', locked());
}

function renderPlayer() {
  if (!D.open) return;
  const radio = player.mode === 'radio';
  const t = radio ? null : player.track;
  const title = radio ? player.station?.name : t?.title;
  const artist = radio ? 'Live-Radio' : t?.artist;
  $('#dv-title').textContent = title || 'Nichts ausgewählt';
  $('#dv-artist').textContent = artist || 'Tippe auf einen Mix';
  const c = $('#dv-cover');
  c.innerHTML = t ? coverHTML(t, 'dv') : `<div class="cover dv" style="--h:${hue(title || 'melody')}">${icon(radio ? 'radio' : 'note')}</div>`;
  setIcon($('#dv-play'), player.playing ? 'pause' : 'play');
  const fav = $('#dv-fav');
  fav.hidden = !t;
  fav.classList.toggle('fav', !!t?.favorite);
  setIcon(fav, t?.favorite ? 'heart' : 'heartOutline');
  renderProgress();
}

function renderProgress() {
  const bar = $('#dv-progress');
  if (!bar) return;
  const el = player.el;
  bar.style.width = player.mode === 'radio' ? '100%' : `${el.duration ? (el.currentTime / el.duration) * 100 : 0}%`;
}

function quickTiles() {
  const tiles = [
    ['dv-mix', 'Roadtrip', 'Roadtrip', 'explore', '#22c55e', '#0ea5e9'],
    ['dv-mix', 'Gute Laune', 'Gute Laune', 'sparkle', '#f59e0b', '#ef4444'],
    ['dv-favs', '', 'Lieblingssongs', 'heart', '#ec4899', '#8b5cf6'],
    ['dv-catalog', '', 'Katalog', 'cloud', '#6366f1', '#06b6d4'],
  ];
  return tiles.map(([a, mood, label, ic, c1, c2]) => `<button class="dv-tile" style="--c1:${c1};--c2:${c2}" data-action="${a}" data-mood="${mood}">${icon(ic)}<span>${label}</span></button>`).join('');
}

function shell() {
  return `<div class="drive">
    <header class="dv-top">
      <button class="dv-exit" data-action="drive-close" aria-label="Fahrermodus beenden">${icon('close')}<span>Beenden</span></button>
      <div class="dv-clock" id="dv-clock"></div>
      <div class="dv-speed"><b id="dv-speed">0</b><span>km/h</span></div>
      <button class="dv-pass" id="dv-passenger" data-action="dv-passenger" hidden>${icon('person')}<span>Beifahrer</span></button>
    </header>
    <div class="dv-map-wrap">
      <div id="dv-map"></div>
      <div class="dv-maneuver" id="dv-maneuver" hidden></div>
      <div class="dv-status" id="dv-status" hidden></div>
      <div class="dv-search" id="dv-search"></div>
      <div class="dv-eta" id="dv-eta" hidden></div>
      <button class="dv-recenter" id="dv-recenter" data-action="dv-recenter" hidden aria-label="Zentrieren">${icon('explore')}</button>
    </div>
    <div class="dv-player">
      <div class="dv-now">
        <div id="dv-cover"></div>
        <div class="dv-meta"><div class="dv-title" id="dv-title"></div><div class="dv-artist" id="dv-artist"></div>
          <div class="dv-bar"><i id="dv-progress"></i></div></div>
        <button class="dv-btn small" id="dv-fav" data-action="fav-current" aria-label="Favorit">${icon('heartOutline')}</button>
      </div>
      <div class="dv-controls">
        <button class="dv-btn" data-action="prev" aria-label="Zurück">${icon('prev')}</button>
        <button class="dv-btn play" id="dv-play" data-action="toggle" aria-label="Abspielen">${icon('play')}</button>
        <button class="dv-btn" data-action="next" aria-label="Weiter">${icon('next')}</button>
        <button class="dv-btn voice" id="dv-voice" data-action="dv-voice" aria-label="Sprachbefehl">${icon('mic')}</button>
      </div>
      <div class="dv-tiles">${quickTiles()}</div>
    </div>
  </div>`;
}

function tickClock() {
  const el = $('#dv-clock');
  if (el) el.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

async function keepAwake() {
  try { D.wake = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ }
}
const onVisible = () => { if (D.open && document.visibilityState === 'visible') keepAwake(); };

export async function openDrive() {
  if (D.open) return;
  D.open = true;
  const el = $('#drive');
  el.innerHTML = shell();
  el.hidden = false;
  hydrateIcons(el);
  tickClock();
  D.clock = setInterval(tickClock, 15000);
  renderPlayer();
  renderLock();
  keepAwake();
  document.addEventListener('visibilitychange', onVisible);
  startGeo();
  await initMap();
  if (!localStorage.getItem('melody.driveHint')) {
    try { localStorage.setItem('melody.driveHint', '1'); } catch { /* ignore */ }
    toast('Sicher fahren: Während der Fahrt bedienst du Melody per Sprache 🎙');
  }
}

export function closeDrive() {
  if (!D.open) return;
  D.open = false;
  if (D.watch != null) navigator.geolocation.clearWatch(D.watch);
  D.watch = null;
  clearInterval(D.clock);
  D.wake?.release?.().catch(() => {});
  D.wake = null;
  document.removeEventListener('visibilitychange', onVisible);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  player.duck(false);
  D.map?.remove();
  Object.assign(D, { map: null, marker: null, line: null, route: null, moving: false, pos: null, results: [] });
  $('#drive').hidden = true;
  $('#drive').innerHTML = '';
}

export const isDriveOpen = () => D.open;

player.addEventListener('track', renderPlayer);
player.addEventListener('state', renderPlayer);
player.addEventListener('time', () => { if (D.open) renderProgress(); });

async function playIds(ids) {
  const ok = ids.filter((id) => playable(getTrack(id)));
  if (!ok.length) { toast('Keine abspielbaren Titel.'); return; }
  player.playList(ok, 0);
}

export const driveActions = {
  drive: () => openDrive(),
  'drive-close': () => closeDrive(),
  'dv-voice': () => listen(),
  'dv-passenger': () => {
    D.passengerUntil = Date.now() + PASSENGER_MIN * 60000;
    toast(`Beifahrer-Bedienung für ${PASSENGER_MIN} Minuten freigeschaltet`);
    renderLock();
  },
  'dv-recenter': () => {
    D.follow = true;
    $('#dv-recenter').hidden = true;
    if (D.pos && D.map) D.map.setView([D.pos.lat, D.pos.lng], 16);
  },
  'dv-go': (el) => startRoute(D.results[+el.dataset.i]),
  'dv-end-route': () => { endRoute(); speak('Navigation beendet.'); },
  'dv-mix': (el) => playIds(localMix('', el.dataset.mood).ids),
  'dv-favs': () => {
    const ids = state.tracks.filter((t) => t.favorite).map((t) => t.id);
    if (!ids.length) { toast('Noch keine Lieblingssongs.'); return; }
    playIds(ids);
  },
  'dv-catalog': async () => playIds((await ensureTracks(await loadCatalog())).map((t) => t.id)),
};

export const driveForms = {
  'dv-search': async (form) => {
    if (locked()) return;
    const q = form.querySelector('#dv-q').value.trim();
    if (!q) return;
    try {
      D.results = await searchPlaces(q);
      if (!D.results.length) toast('Kein Ort gefunden');
    } catch (e) {
      toast(e.message);
    }
    renderSearch();
  },
};

// Test hook: simulate driving without GPS.
window.__melodyDrive = { onPosition: (p, kmh = 0) => { D.speed = kmh; onPosition(p); }, state: D, handleCommand };
