// Recognition must survive what a phone microphone hears: noise, room echo, tinny speakers, compression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hashes, buildIndex, match, SR } from '../js/fingerprint.js';

const dir = new URL('../catalog/', import.meta.url).pathname;
const cat = JSON.parse(fs.readFileSync(dir + 'catalog.json', 'utf8')).tracks;
const fp = JSON.parse(fs.readFileSync(dir + 'fingerprints.json', 'utf8'));
const songs = fp.songs.map((s) => ({ id: s.id, hashes: Array.from({ length: s.hashes.length / 2 }, (_, i) => [s.hashes[2 * i], s.hashes[2 * i + 1]]) }));
const index = buildIndex(songs);

// "Phone recording": cut, band-limit like a small speaker, add echo + noise, squash to 32 kbit/s.
function record(file, start, secs, noise) {
  const filters = `highpass=f=250,lowpass=f=3800,aecho=0.8:0.6:40:0.3,volume=0.6`;
  const raw = execFileSync('sh', ['-c',
    `ffmpeg -loglevel error -ss ${start} -t ${secs} -i "${file}" -f lavfi -t ${secs} -i "anoisesrc=color=pink:amplitude=${noise}" ` +
    `-filter_complex "[0:a]${filters}[a];[a][1:a]amix=inputs=2:duration=shortest:normalize=0" -c:a libmp3lame -b:a 32k -f mp3 - | ` +
    `ffmpeg -loglevel error -i - -ac 1 -ar ${SR} -f f32le -`], { maxBuffer: 1 << 26 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('erkennt jeden Katalog-Song aus 7 s Handy-Aufnahme mit Rauschen', () => {
  let ok = 0, total = 0;
  for (const t of cat) {
    for (let k = 0; k < 3; k++) {
      const start = (5 + rnd() * (t.duration - 15)).toFixed(2);
      const pcm = record(dir + t.audio, start, 7, 0.08);
      const m = match(index, songs, hashes(pcm));
      total++;
      if (m?.id === t.id) {
        ok++;
        assert.ok(Math.abs(m.offsetSec - start) < 0.6, `Position ${m.offsetSec} statt ${start}`);
      } else {
        console.log('  verfehlt:', t.id, 'ab', start, 's →', m?.id ?? 'nichts');
      }
    }
  }
  console.log(`  Trefferquote: ${ok}/${total}`);
  assert.ok(ok / total >= 0.9, `nur ${ok}/${total}`);
});

test('reines Rauschen wird nicht als Song erkannt', () => {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-t', '7', '-i', 'anoisesrc=color=pink:amplitude=0.3', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  const m = match(index, songs, hashes(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)));
  assert.equal(m, null);
});

test('fremde Musik (nicht im Katalog) wird nicht falsch erkannt', () => {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-t', '7', '-i',
    'sine=frequency=330:beep_factor=4,aeval=val(0)*0.5', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  const m = match(index, songs, hashes(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)));
  assert.equal(m, null);
});
