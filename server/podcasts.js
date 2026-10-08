// Podcasts: directory search (Apple Podcasts directory) and a safe proxy for RSS feeds and episode downloads.
import dns from 'node:dns/promises';
import net from 'node:net';
import { Readable } from 'node:stream';
import { HttpError } from './auth.js';

const ALLOW_PRIVATE = process.env.MELODY_ALLOW_PRIVATE_FETCH === '1'; // tests only
const UA = 'Melody/2.0 Podcast (+https://github.com/MustafaKushish/Melody)';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// Only public http(s) addresses – the server must never be tricked into calling internal services.
async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Ungültige Adresse.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Nur http(s)-Adressen.');
  if (u.username || u.password) throw new HttpError(400, 'Ungültige Adresse.');
  if (u.port && !['80', '443', '8080'].includes(u.port) && !ALLOW_PRIVATE) throw new HttpError(400, 'Port nicht erlaubt.');
  if (!ALLOW_PRIVATE) {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new HttpError(400, 'Adresse nicht gefunden.');
    if (addrs.some((a) => privateIp(a.address))) throw new HttpError(400, 'Diese Adresse ist nicht erlaubt.');
  }
  return u;
}

async function safeFetch(raw, opts = {}) {
  let url = raw;
  for (let i = 0; i < 5; i++) {
    const u = await checkUrl(url);
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 15000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location'), u).toString();
      continue;
    }
    return { r, finalUrl: u.toString() };
  }
  throw new HttpError(502, 'Zu viele Weiterleitungen.');
}

async function readLimited(r, max) {
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel(); throw new HttpError(413, 'Feed ist zu groß.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function searchPodcasts(q) {
  q = String(q || '').trim().slice(0, 100);
  if (q.length < 2) throw new HttpError(400, 'Suchbegriff zu kurz.');
  const u = `https://itunes.apple.com/search?${new URLSearchParams({ media: 'podcast', term: q, country: 'DE', limit: '25' })}`;
  let data;
  try {
    data = await (await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })).json();
  } catch {
    throw new HttpError(502, 'Podcast-Verzeichnis nicht erreichbar.');
  }
  return {
    results: (data.results || []).filter((x) => x.feedUrl).map((x) => ({
      feed: x.feedUrl, title: x.collectionName, author: x.artistName, image: x.artworkUrl600 || x.artworkUrl100 || '',
      genre: x.primaryGenreName || '', episodes: x.trackCount || 0,
    })),
  };
}

export async function proxyFeed(url) {
  const { r, finalUrl } = await safeFetch(url);
  if (!r.ok) throw new HttpError(502, `Feed nicht erreichbar (${r.status}).`);
  const xml = (await readLimited(r, 8 * 1024 * 1024)).toString('utf8');
  if (!/<rss|<feed/i.test(xml.slice(0, 2000))) throw new HttpError(422, 'Das ist kein Podcast-Feed.');
  return { xml, finalUrl };
}

// Streams an episode to the client so it can be saved for offline listening.
export async function proxyMedia(url, res, range) {
  const { r } = await safeFetch(url, { timeout: 60000, headers: range ? { Range: range } : {} });
  if (!r.ok && r.status !== 206) throw new HttpError(502, `Folge nicht erreichbar (${r.status}).`);
  const type = r.headers.get('content-type') || 'audio/mpeg';
  if (!/^(audio|video)\/|application\/octet-stream/.test(type)) throw new HttpError(415, 'Keine Audio- oder Videodatei.');
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  for (const h of ['content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) headers[h] = r.headers.get(h);
  res.writeHead(r.status, headers);
  Readable.fromWeb(r.body).pipe(res);
}

export { checkUrl, privateIp };
