// Melody Connect: all devices of one account see each other and can control each other.
// Live channel: Server-Sent Events (one open HTTP response per device), commands via POST.
import crypto from 'node:crypto';
import { HttpError } from './auth.js';

const MAX_DEVICES = 10;
const COMMANDS = new Set(['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'play-item']);
const hubs = new Map(); // userId -> Map(deviceId -> device)

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const deviceId = (v) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(v)) ? String(v) : null);

function send(dev, event, data) {
  try { dev.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
}

function list(hub) {
  return [...hub.values()].map((d) => ({ id: d.id, name: d.name, type: d.type, state: d.state, since: d.since }));
}

function broadcast(userId) {
  const hub = hubs.get(userId);
  if (!hub) return;
  const devices = list(hub);
  for (const d of hub.values()) send(d, 'devices', { devices });
}

export function openStream(user, query, req, res) {
  const id = deviceId(query.get('device'));
  if (!id) throw new HttpError(400, 'Geräte-ID fehlt.');
  let hub = hubs.get(user.id);
  if (!hub) hubs.set(user.id, (hub = new Map()));
  const old = hub.get(id);
  if (old) { hub.delete(id); try { old.res.end(); } catch { /* ignore */ } }
  if (hub.size >= MAX_DEVICES) throw new HttpError(429, `Höchstens ${MAX_DEVICES} Geräte gleichzeitig.`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const dev = {
    id, res, since: Date.now(),
    session: user._token ? crypto.createHash('sha256').update(user._token).digest('hex') : '',
    name: clean(query.get('name'), 40) || 'Gerät',
    type: ['phone', 'tablet', 'computer', 'tv', 'car', 'speaker'].includes(query.get('type')) ? query.get('type') : 'computer',
    state: null,
  };
  hub.set(id, dev);
  broadcast(user.id);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
  dev.close = () => {
    clearInterval(ping);
    const h = hubs.get(user.id);
    if (h?.get(id) === dev) {
      h.delete(id);
      if (!h.size) hubs.delete(user.id);
      broadcast(user.id);
    }
  };
  req.on('close', dev.close);
  res.on('close', dev.close);
}

function sanitizeState(s) {
  if (!s || typeof s !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  let item = null;
  if (s.item && typeof s.item === 'object') {
    const k = s.item.kind;
    if (k === 'catalog') item = { kind: k, id: clean(s.item.id, 80) };
    else if (k === 'local') item = { kind: k, title: clean(s.item.title, 150), artist: clean(s.item.artist, 100) };
    else if (k === 'podcast') item = { kind: k, feed: clean(s.item.feed, 500), guid: clean(s.item.guid, 300) };
    else if (k === 'radio') item = { kind: k, station: { id: clean(s.item.station?.id, 80), name: clean(s.item.station?.name, 120), url: clean(s.item.station?.url, 500), favicon: clean(s.item.station?.favicon, 500), tags: clean(s.item.station?.tags, 120) } };
  }
  return {
    title: clean(s.title, 150), artist: clean(s.artist, 150), image: /^(https:\/\/|catalog\/|podcasts\/)/.test(String(s.image || '')) ? clean(s.image, 500) : '',
    mode: ['library', 'radio', 'podcast'].includes(s.mode) ? s.mode : 'library',
    playing: !!s.playing, position: num(s.position), duration: num(s.duration), volume: Math.max(0, Math.min(1, num(s.volume))),
    kids: !!s.kids, item, ts: Date.now(),
  };
}

const lastBroadcast = new Map();
export function updateState(user, body) {
  const dev = hubs.get(user.id)?.get(deviceId(body.device));
  if (!dev) throw new HttpError(404, 'Gerät ist nicht verbunden.');
  dev.state = sanitizeState(body.state);
  // At most ~4 updates per second per account reach the other devices.
  const now = Date.now();
  if (now - (lastBroadcast.get(user.id) || 0) > 250 || body.important) {
    lastBroadcast.set(user.id, now);
    broadcast(user.id);
  }
  return { ok: true };
}

export function command(user, body) {
  const hub = hubs.get(user.id);
  const target = hub?.get(deviceId(body.to));
  if (!target) throw new HttpError(404, 'Dieses Gerät ist nicht mehr verbunden.');
  const cmd = String(body.cmd || '');
  if (!COMMANDS.has(cmd)) throw new HttpError(400, 'Unbekannter Befehl.');
  const from = hub.get(deviceId(body.from));
  const arg = cmd === 'play-item' ? { item: sanitizeState({ item: body.arg?.item }).item, position: Number(body.arg?.position) || 0 }
    : cmd === 'seek' || cmd === 'volume' ? Number(body.arg) || 0 : null;
  send(target, 'command', { cmd, arg, from: from ? { id: from.id, name: from.name } : null });
  return { ok: true };
}

function end(d) {
  try { d.res.end(); } catch { /* ignore */ }
  d.close();
}

// Logout ends the live channel of exactly the devices that used this session; deleting the account ends all of them.
export function dropSession(userId, token) {
  const hub = hubs.get(userId);
  if (!hub || !token) return;
  const h = crypto.createHash('sha256').update(token).digest('hex');
  for (const d of [...hub.values()]) if (d.session === h) end(d);
}
export function dropUser(userId) {
  for (const d of [...(hubs.get(userId)?.values() || [])]) end(d);
}

export const connectedDevices = (userId) => (hubs.has(userId) ? list(hubs.get(userId)) : []);
