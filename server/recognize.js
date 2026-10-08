import { db, now } from './db.js';
import { HttpError } from './auth.js';
import { AUDD_API_TOKEN, AUDD_URL } from './config.js';

db.exec(`CREATE TABLE IF NOT EXISTS wishes (
  title TEXT NOT NULL, artist TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL, PRIMARY KEY (title, artist, user_id)
)`);

export const recognitionEnabled = () => !!AUDD_API_TOKEN;

// World-wide song recognition through AudD (https://audd.io). The recording never gets stored.
export async function recognize(wavBuffer) {
  if (!AUDD_API_TOKEN) throw new HttpError(503, 'Die weltweite Erkennung ist noch nicht eingerichtet.');
  if (!wavBuffer?.length || wavBuffer.length < 44 + 11025 * 2 * 2) throw new HttpError(400, 'Die Aufnahme ist zu kurz.');
  const form = new FormData();
  form.set('api_token', AUDD_API_TOKEN);
  form.set('return', 'apple_music,spotify,deezer');
  form.set('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'aufnahme.wav');
  let data;
  try {
    const r = await fetch(AUDD_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) });
    data = await r.json();
  } catch {
    throw new HttpError(502, 'Der Erkennungsdienst ist gerade nicht erreichbar.');
  }
  if (data.status !== 'success') throw new HttpError(502, 'Der Erkennungsdienst meldet einen Fehler.');
  const s = data.result;
  if (!s) return { found: false };
  const cover = s.apple_music?.artwork?.url?.replace('{w}', '600').replace('{h}', '600') ||
    s.spotify?.album?.images?.[0]?.url || s.deezer?.album?.cover_big || '';
  return {
    found: true,
    title: s.title, artist: s.artist, album: s.album || '', released: s.release_date || '', cover,
    links: {
      apple: s.apple_music?.url || '',
      spotify: s.spotify?.external_urls?.spotify || '',
      deezer: s.deezer?.link || '',
    },
  };
}

export function addWish(userId, body) {
  const title = String(body.title || '').trim().slice(0, 150);
  const artist = String(body.artist || '').trim().slice(0, 100);
  if (!title || !artist) throw new HttpError(400, 'Titel und Künstler fehlen.');
  db.prepare('INSERT OR IGNORE INTO wishes (title, artist, user_id, at) VALUES (?, ?, ?, ?)').run(title, artist, userId, now());
}

// For the catalog team: most wished songs first.
export function topWishes() {
  return db.prepare(`SELECT title, artist, COUNT(*) AS users, MAX(at) AS last FROM wishes
                     GROUP BY lower(title), lower(artist) ORDER BY users DESC, last DESC LIMIT 100`).all();
}
