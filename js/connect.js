// Melody Connect: see your other devices, control them like a remote, move playback between them.
import { api, DEMO } from './api.js';
import { player } from './player.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, hooks, openSheet, closeSheet, fmt, setRangeP } from './core.js';
import { loadCatalog, ensureTrack, playable } from './catalog.js';
import { playEp } from './podcasts.js';

const C = { es: null, devices: [], me: null, remote: null, lastFrom: 0, sendTimer: 0, lastSent: 0 };

// ---------- This device ----------
function guessDevice() {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  if (/iPhone/.test(ua)) return { name: 'iPhone', type: 'phone' };
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return { name: 'iPad', type: 'tablet' };
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? { name: 'Android-Handy', type: 'phone' } : { name: 'Android-Tablet', type: 'tablet' };
  if (/SmartTV|Tizen|Web0S|Android TV|CrKey/.test(ua)) return { name: 'Fernseher', type: 'tv' };
  if (/Windows/.test(ua)) return { name: 'Windows-PC', type: 'computer' };
  if (/Macintosh/.test(ua)) return { name: 'Mac', type: 'computer' };
  return { name: 'Computer', type: 'computer' };
}

export function thisDevice() {
  if (C.me) return C.me;
  try { C.me = JSON.parse(localStorage.getItem('melody.device') || 'null'); } catch { C.me = null; }
  if (!C.me?.id) {
    const rnd = crypto.getRandomValues(new Uint8Array(12));
    C.me = { id: 'dev-' + Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join(''), ...guessDevice() };
    try { localStorage.setItem('melody.device', JSON.stringify(C.me)); } catch { /* ignore */ }
  }
  return C.me;
}

const TYPE_ICON = { phone: 'phone', tablet: 'tablet', computer: 'laptop', tv: 'tv', car: 'car', speaker: 'speaker' };

// ---------- What this device plays, in a form other devices can take over ----------
function currentItem() {
  if (player.mode === 'podcast' && player.episode) return { kind: 'podcast', feed: player.episode.ep.feed || player.episode.pod.feed, guid: player.episode.ep.guid };
  if (player.mode === 'radio' && player.station) return { kind: 'radio', station: player.station };
  const t = player.track;
  if (!t) return null;
  return t.catalogId ? { kind: 'catalog', id: t.catalogId } : { kind: 'local', title: t.title, artist: t.artist };
}

function snapshot() {
  const info = player.nowInfo();
  const m = player.media;
  let image = info.image || '';
  if (!image && player.mode === 'library' && player.track?.catalogId) image = `catalog/${player.track.catalogId}.jpg`;
  return {
    title: info.title || '', artist: info.artist || '', image, mode: player.mode, playing: player.playing,
    position: m.currentTime || 0, duration: m.duration || 0, volume: player.settings.volume, item: currentItem(),
    kids: document.body.classList.contains('kids-on'),
  };
}

function publish(important = false) {
  if (!C.es || DEMO) return;
  clearTimeout(C.sendTimer);
  const go = () => {
    C.lastSent = Date.now();
    api('/connect/state', { method: 'POST', body: { device: thisDevice().id, state: snapshot(), important } }).catch(() => {});
  };
  if (important || Date.now() - C.lastSent > 4000) go();
  else C.sendTimer = setTimeout(go, 4000 - (Date.now() - C.lastSent));
}

// ---------- Live connection ----------
export function startConnect() {
  if (DEMO || C.es || !window.EventSource) return;
  const me = thisDevice();
  const q = new URLSearchParams({ device: me.id, name: me.name, type: me.type });
  const es = new EventSource('api/connect/stream?' + q);
  C.es = es;
  es.addEventListener('open', () => publish(true));
  es.addEventListener('devices', (e) => {
    C.devices = JSON.parse(e.data).devices.filter((d) => d.id !== me.id);
    renderBadge();
    renderStrip();
    if (C.remote) renderRemote();
    else if (!$('#sheet').hidden && $('#sheet .cn-list')) renderList();
  });
  es.addEventListener('command', (e) => runCommand(JSON.parse(e.data)));
  es.addEventListener('error', () => {
    // 401 (logged out) closes the stream for good; network errors reconnect automatically.
    if (es.readyState === EventSource.CLOSED) { C.es = null; C.devices = []; renderBadge(); renderStrip(); }
  });
}

export function stopConnect() {
  C.es?.close();
  C.es = null;
  C.devices = [];
  renderBadge();
  renderStrip();
}

for (const ev of ['track', 'state']) player.addEventListener(ev, () => { publish(true); renderStrip(); });
player.addEventListener('time', () => publish(false));

// ---------- Commands from other devices ----------
async function playItem(item, position = 0) {
  if (!item) return false;
  if (item.kind === 'catalog') {
    const c = (await loadCatalog()).find((x) => x.id === item.id);
    if (!c) return false;
    const t = await ensureTrack(c);
    if (!playable(t)) { toast('Offline – dieser Song ist auf diesem Gerät nicht geladen.'); return false; }
    await player.playList([t.id], 0, position);
    return true;
  }
  if (item.kind === 'local') {
    const t = state.tracks.find((x) => x.title === item.title && x.artist === item.artist);
    if (!t) { toast(`„${item.title}“ ist auf diesem Gerät nicht vorhanden.`); return false; }
    await player.playList([t.id], 0, position);
    return true;
  }
  if (item.kind === 'podcast') { await playEp(item.feed, item.guid, position); return true; }
  if (item.kind === 'radio') { player.playRadio(item.station); return true; }
  return false;
}

async function runCommand({ cmd, arg, from }) {
  if (from && Date.now() - C.lastFrom > 60000) toast(`Gesteuert von ${from.name}`);
  C.lastFrom = Date.now();
  switch (cmd) {
    case 'play': player.play(); break;
    case 'pause': player.pause(); break;
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'prev': player.prev(); break;
    case 'seek': player.seek(arg); break;
    case 'volume': player.setVolume(Math.max(0, Math.min(1, arg))); hooks.syncVolume?.(); break;
    case 'play-item': await playItem(arg?.item, arg?.position); break;
  }
  publish(true);
}

const send = (to, cmd, arg) => api('/connect/command', { method: 'POST', body: { from: thisDevice().id, to, cmd, arg } }).catch((e) => toast(e.message));

// Position of a remote device, extrapolated from its last report.
const livePos = (st) => (st ? Math.min(st.duration || Infinity, st.position + (st.playing ? (Date.now() - st.ts) / 1000 : 0)) : 0);

// ---------- UI ----------
function renderBadge() {
  const n = C.devices.length;
  document.querySelectorAll('[data-action=connect]').forEach((b) => {
    b.classList.toggle('on', n > 0);
    b.dataset.count = n || '';
    b.title = n ? `${n} weitere${n === 1 ? 's' : ''} Gerät${n === 1 ? '' : 'e'} verbunden` : 'Melody Connect';
  });
}

// "Läuft auf …": while this device is silent, show what another device of the account plays.
function renderStrip() {
  let el = document.getElementById('cn-strip');
  const other = !player.playing && C.devices.find((d) => d.state?.playing && d.state.title);
  document.body.classList.toggle('cn-strip-on', !!other);
  if (!other) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'cn-strip';
    el.className = 'cn-strip';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  const st = other.state;
  el.hidden = false;
  el.innerHTML = `<button class="cn-strip-main" data-action="cn-remote" data-id="${esc(other.id)}">${icon(TYPE_ICON[other.type] || 'devices')}
      <span><b>Läuft auf ${esc(other.name)}</b><small>${esc(st.title)}${st.artist ? ' · ' + esc(st.artist) : ''}</small></span></button>
    <button class="icon-btn" data-action="cn-cmd" data-cmd="pause" data-id="${esc(other.id)}" aria-label="Dort pausieren">${icon('pause')}</button>
    <button class="chip" data-action="cn-pull" data-id="${esc(other.id)}">${icon('download')}Hierher</button>`;
}

function devRow(d) {
  const st = d.state;
  return `<div class="cn-dev">
    <span class="cn-ico">${icon(TYPE_ICON[d.type] || 'laptop')}</span>
    <div class="meta"><b>${esc(d.name)}${st?.kids ? ' <small class="cn-kids">Kinder-Modus</small>' : ''}</b>
      <span>${st?.title ? `${st.playing ? '▶ ' : '❚❚ '}${esc(st.title)}${st.artist ? ' · ' + esc(st.artist) : ''}` : 'Spielt gerade nichts'}</span></div>
    <div class="cn-acts">
      <button class="chip" data-action="cn-remote" data-id="${esc(d.id)}">${icon('tune')}Steuern</button>
      ${st?.item ? `<button class="chip" data-action="cn-pull" data-id="${esc(d.id)}">${icon('download')}Hierher holen</button>` : ''}
      ${currentItem() ? `<button class="chip" data-action="cn-push" data-id="${esc(d.id)}">${icon('share')}Dort abspielen</button>` : ''}
    </div></div>`;
}

function listHTML() {
  const me = thisDevice();
  if (DEMO) {
    return `<h3>${icon('devices')} Melody Connect</h3><div class="cn-list">
      <p class="muted" style="padding:0 8px">Mit dem Melody-Server siehst du hier alle deine Geräte – Handy, Laptop, Tablet, Fernseher. Du kannst sie fernsteuern und die Musik mit einem Tipp von einem Gerät aufs andere holen, an genau derselben Stelle.</p>
      <p class="small muted" style="padding:0 8px">In dieser Demo gibt es keinen Server, daher ist nur dieses Gerät sichtbar.</p></div>`;
  }
  return `<h3>${icon('devices')} Melody Connect</h3><div class="cn-list">
    <div class="cn-dev me"><span class="cn-ico">${icon(TYPE_ICON[me.type] || 'laptop')}</span>
      <div class="meta"><b>${esc(me.name)} <small>(dieses Gerät)</small></b><span>${C.es ? 'Verbunden' : 'Nicht verbunden'}</span></div>
      <div class="cn-acts"><button class="chip" data-action="cn-rename">${icon('edit')}Umbenennen</button></div></div>
    ${C.devices.length ? C.devices.map(devRow).join('') : `<p class="muted" style="padding:6px 8px">Öffne Melody auf einem anderen Gerät mit demselben Konto – es erscheint dann hier.</p>`}
  </div>`;
}

function renderList() { openSheet(listHTML()); }

function renderRemote() {
  const d = C.devices.find((x) => x.id === C.remote);
  if (!d) {
    C.remote = null;
    toast('Das Gerät ist nicht mehr verbunden.');
    closeSheet();
    return;
  }
  const st = d.state || {};
  const pos = livePos(d.state);
  const html = `<div class="cn-remote">
    <div class="cn-head">${icon(TYPE_ICON[d.type] || 'laptop')}<span>Fernbedienung · <b>${esc(d.name)}</b></span></div>
    <div class="cn-now">${st.image ? `<img src="${esc(st.image)}" alt="" referrerpolicy="no-referrer">` : `<div class="cn-art">${icon('note')}</div>`}
      <div><div class="t">${esc(st.title || 'Spielt gerade nichts')}</div><div class="a">${esc(st.artist || '')}</div></div></div>
    ${st.duration ? `<input type="range" id="cn-seek" min="0" max="${Math.round(st.duration)}" value="${Math.round(pos)}" aria-label="Position">
      <div class="np-times"><span id="cn-pos">${fmt(pos)}</span><span>${fmt(st.duration)}</span></div>` : ''}
    <div class="cn-ctrl">
      <button class="icon-btn lg" data-action="cn-cmd" data-cmd="prev" aria-label="Zurück">${icon('prev')}</button>
      <button class="icon-btn play xl" data-action="cn-cmd" data-cmd="toggle" aria-label="${st.playing ? 'Pause' : 'Abspielen'}">${icon(st.playing ? 'pause' : 'play')}</button>
      <button class="icon-btn lg" data-action="cn-cmd" data-cmd="next" aria-label="Weiter">${icon('next')}</button>
    </div>
    <label class="cn-vol">${icon('volume')}<input type="range" id="cn-vol" min="0" max="1" step="0.05" value="${st.volume ?? 1}" aria-label="Lautstärke"></label>
    <div class="row" style="justify-content:center">
      ${st.item ? `<button class="btn" data-action="cn-pull" data-id="${esc(d.id)}">${icon('download')}Hierher holen</button>` : ''}
      <button class="btn" data-action="connect">${icon('back')}Alle Geräte</button>
    </div></div>`;
  const sheet = $('#sheet');
  if (sheet.hidden || !sheet.querySelector('.cn-remote')) openSheet(html);
  else if (!C.dragging) { sheet.innerHTML = html; hydrateIcons(sheet); }
  sheet.querySelectorAll('input[type=range]').forEach(setRangeP);
}

// Keep the remote's progress bar moving between reports.
setInterval(() => {
  if (!C.remote || C.dragging) return;
  const d = C.devices.find((x) => x.id === C.remote);
  const s = $('#cn-seek');
  if (d?.state && s) { s.value = Math.round(livePos(d.state)); setRangeP(s); $('#cn-pos').textContent = fmt(livePos(d.state)); }
}, 1000);

export const connectActions = {
  connect: () => { C.remote = null; renderList(); },
  'cn-remote': (el) => { C.remote = el.dataset.id; renderRemote(); },
  'cn-cmd': (el) => send(el.dataset.id || C.remote, el.dataset.cmd),
  'cn-pull': async (el) => {
    const d = C.devices.find((x) => x.id === el.dataset.id);
    if (!d?.state?.item) return;
    const ok = await playItem(d.state.item, livePos(d.state));
    if (ok) { send(d.id, 'pause'); toast(`Weiter auf diesem Gerät – ${d.name} pausiert`); closeSheet(); C.remote = null; }
  },
  'cn-push': async (el) => {
    const d = C.devices.find((x) => x.id === el.dataset.id);
    const item = currentItem();
    if (!d || !item) return;
    await send(d.id, 'play-item', { item, position: player.media.currentTime || 0 });
    player.pause();
    toast(`Läuft jetzt auf ${d.name}`);
    C.remote = d.id;
    renderRemote();
  },
  'cn-rename': async () => {
    const me = thisDevice();
    const name = await hooks.prompt('Gerät umbenennen', me.name);
    if (!name) return;
    me.name = name.trim().slice(0, 40);
    try { localStorage.setItem('melody.device', JSON.stringify(me)); } catch { /* ignore */ }
    stopConnect();
    startConnect();
    renderList();
  },
};

export function onConnectInput(el) {
  if (el.id === 'cn-seek') { C.dragging = true; $('#cn-pos').textContent = fmt(+el.value); setRangeP(el); return true; }
  if (el.id === 'cn-vol') { setRangeP(el); return true; }
  return false;
}
export function onConnectChange(el) {
  if (el.id === 'cn-seek') { C.dragging = false; send(C.remote, 'seek', +el.value); return true; }
  if (el.id === 'cn-vol') { send(C.remote, 'volume', +el.value); return true; }
  return false;
}
export function onSheetClosed() { C.remote = null; }

// Test hook
window.__melodyConnect = C;
