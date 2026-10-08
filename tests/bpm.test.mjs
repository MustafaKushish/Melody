import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { detectBpm } from '../js/bpm.js';

const dir = new URL('../catalog/', import.meta.url).pathname;
const cat = JSON.parse(fs.readFileSync(dir + 'catalog.json', 'utf8')).tracks;

test('Tempo der Katalog-Songs wird erkannt (±3 BPM)', () => {
  for (const t of cat) {
    const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', dir + t.audio, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 27 });
    const bpm = detectBpm(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), 22050);
    console.log(`  ${t.title}: erkannt ${bpm}, tatsächlich ${t.bpm}`);
    assert.ok(Math.abs(bpm - t.bpm) <= 3, `${t.title}: ${bpm} statt ${t.bpm}`);
  }
});
