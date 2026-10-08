import { db, now } from './db.js';
import { HttpError } from './auth.js';

// Synced lyrics from LRCLIB (free, open database). Results are cached for 30 days.
const TTL = 30 * 86400000;
const UA = 'Melody/2.0 (https://github.com/MustafaKushish/Melody)';

export async function findLyrics(q) {
  const artist = String(q.artist || '').trim().slice(0, 100);
  const title = String(q.title || '').trim().slice(0, 150);
  if (!artist || !title) throw new HttpError(400, 'Künstler und Titel fehlen.');
  const key = `${artist}\u0001${title}`.toLowerCase();
  const cached = db.prepare('SELECT json, fetched_at FROM lyrics_cache WHERE key = ?').get(key);
  if (cached && cached.fetched_at > now() - TTL) return JSON.parse(cached.json);

  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  if (q.album) params.set('album_name', String(q.album).slice(0, 150));
  if (q.duration) params.set('duration', String(Math.round(Number(q.duration)) || ''));

  let result = { found: false };
  try {
    let r = await fetch(`https://lrclib.net/api/get?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    let data = r.ok ? await r.json() : null;
    if (!data) {
      // Fuzzy fallback: search by artist + title.
      const s = new URLSearchParams({ artist_name: artist, track_name: title });
      r = await fetch(`https://lrclib.net/api/search?${s}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      const list = r.ok ? await r.json() : [];
      data = list.find((x) => x.syncedLyrics) || list[0] || null;
    }
    if (data && (data.syncedLyrics || data.plainLyrics)) {
      result = { found: true, synced: data.syncedLyrics || '', plain: data.plainLyrics || '', instrumental: !!data.instrumental };
    }
  } catch (e) {
    throw new HttpError(502, 'Lyrics-Dienst nicht erreichbar.');
  }
  db.prepare('INSERT OR REPLACE INTO lyrics_cache (key, json, fetched_at) VALUES (?, ?, ?)').run(key, JSON.stringify(result), now());
  return result;
}
