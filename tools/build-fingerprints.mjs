// Builds catalog/fingerprints.json from the catalog MP3s (needs ffmpeg).
// Usage: node tools/build-fingerprints.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { hashes, SR } from '../js/fingerprint.js';

export function decode(file) {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dir = new URL('../catalog/', import.meta.url).pathname;
  const cat = JSON.parse(fs.readFileSync(dir + 'catalog.json', 'utf8'));
  const songs = cat.tracks.map((t) => {
    const h = hashes(decode(dir + t.audio));
    return { id: t.id, hashes: h.flat() };
  });
  fs.writeFileSync(dir + 'fingerprints.json', JSON.stringify({ version: 1, sr: SR, songs }));
  console.log(songs.map((s) => `${s.id}: ${s.hashes.length / 2} Hashes`).join('\n'));
  console.log('Größe:', Math.round(fs.statSync(dir + 'fingerprints.json').size / 1024), 'KB');
}
