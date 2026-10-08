// Audio fingerprinting ("which song is this?") – works in the browser and in Node.
// Landmark method: strongest spectral peaks → pairs of peaks (f1, f2, Δt) → hashes.
// A recording matches a song when many hashes line up at the same time offset.

export const SR = 11025;
const N = 1024;
const HOP = 512;
// ~300 Hz – 3.4 kHz: the range phone microphones and small speakers reproduce reliably.
const BANDS = [[28, 38], [38, 50], [50, 66], [66, 86], [86, 112], [112, 146], [146, 190], [190, 246], [246, 320]];
const FAN_OUT = 5;
const MAX_DT = 40;

let win, cos, sin, rev;
function setup() {
  if (win) return;
  win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  cos = new Float64Array(N / 2);
  sin = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / N);
    sin[i] = Math.sin((-2 * Math.PI * i) / N);
  }
  rev = new Uint32Array(N);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    rev[i] = r;
  }
}

function fft(re, im) {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step], s = sin[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// Peaks: strongest bin per frequency band per frame, kept only if clearly above that frame's level.
function peaks(pcm) {
  setup();
  const out = [];
  const re = new Float64Array(N), im = new Float64Array(N);
  const frames = Math.floor((pcm.length - N) / HOP);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = pcm[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const band = [];
    let sum = 0;
    for (const [lo, hi] of BANDS) {
      let best = -Infinity, bin = lo;
      for (let k = lo; k < hi; k++) {
        const m = Math.log(1e-9 + re[k] * re[k] + im[k] * im[k]);
        if (m > best) { best = m; bin = k; }
      }
      band.push([bin, best]);
      sum += best;
    }
    const mean = sum / BANDS.length;
    for (const [bin, mag] of band) if (mag > mean && mag > -12) out.push([f, bin]);
  }
  return out;
}

export function hashes(pcm) {
  const p = peaks(pcm);
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const [t1, f1] = p[i];
    let n = 0;
    for (let j = i + 1; j < p.length && n < FAN_OUT; j++) {
      const [t2, f2] = p[j];
      const dt = t2 - t1;
      if (dt < 1) continue;
      if (dt > MAX_DT) break;
      if (Math.abs(f2 - f1) < 3) continue; // sustained tones carry little identity

      out.push([(f1 << 15) | (f2 << 6) | dt, t1]);
      n++;
    }
  }
  return out;
}

// Index: hash → list of [songIndex, time]. Input: [{ id, hashes: [[hash, t], …] }].
export function buildIndex(songs) {
  const idx = new Map();
  songs.forEach((s, si) => {
    for (const [h, t] of s.hashes) {
      let arr = idx.get(h);
      if (!arr) idx.set(h, (arr = []));
      arr.push(si, t);
    }
  });
  return idx;
}

// Returns { index, score, offsetSec, confidence } or null when nothing lines up.
export function match(index, songs, queryHashes) {
  const votes = new Map();
  for (const [h, tq] of queryHashes) {
    const arr = index.get(h);
    if (!arr) continue;
    for (let i = 0; i < arr.length; i += 2) {
      const key = arr[i] * 1e6 + (arr[i + 1] - tq + 5e5);
      votes.set(key, (votes.get(key) || 0) + 1);
    }
  }
  // Best and runner-up offset per song (allow ±1 frame jitter).
  const perSong = new Map();
  for (const [key, n] of votes) {
    const song = Math.floor(key / 1e6), off = key % 1e6;
    const score = n + (votes.get(key - 1) || 0) + (votes.get(key + 1) || 0);
    const cur = perSong.get(song) || { score: 0, off: 0, runnerUp: 0 };
    if (score > cur.score) {
      if (Math.abs(off - cur.off) > 3) cur.runnerUp = Math.max(cur.runnerUp, cur.score);
      cur.score = score;
      cur.off = off;
    } else if (Math.abs(off - cur.off) > 3) {
      cur.runnerUp = Math.max(cur.runnerUp, score);
    }
    perSong.set(song, cur);
  }
  const ranked = [...perSong.entries()].sort((a, b) => b[1].score - a[1].score);
  if (!ranked.length) return null;
  const [song, best] = ranked[0];
  const second = ranked[1]?.[1].score || 0;
  // Share of the recording's hashes that line up with the song at one offset.
  const share = best.score / Math.max(1, queryHashes.length);
  if (best.score < 20 || share < 0.15 || best.score < second * 1.5) return null;
  const confidence = Math.min(1, share * 2);
  // Repeating music (loops, choruses) can line up at several places – then the position is not certain yet.
  const offsetSure = best.score >= best.runnerUp * 1.4;
  return { index: song, id: songs[song].id, score: best.score, offsetSec: ((best.off - 5e5) * HOP) / SR, confidence, offsetSure };
}

// Downmix + resample to 11025 Hz (linear interpolation after a simple box low-pass).
export function toMono11k(channels, rate) {
  const len = channels[0].length;
  const mono = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) mono[i] += ch[i] / channels.length;
  if (rate === SR) return mono;
  const ratio = rate / SR;
  const k = Math.max(1, Math.round(ratio));
  const smooth = new Float32Array(len);
  let acc = 0;
  for (let i = 0; i < len; i++) {
    acc += mono[i];
    if (i >= k) acc -= mono[i - k];
    smooth[i] = acc / Math.min(i + 1, k);
  }
  const outLen = Math.floor(len / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio, x0 = Math.floor(x), fr = x - x0;
    out[i] = smooth[x0] * (1 - fr) + (smooth[x0 + 1] ?? smooth[x0]) * fr;
  }
  return out;
}
