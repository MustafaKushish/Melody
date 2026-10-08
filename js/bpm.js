// Tempo detection (beats per minute) for the fitness mode – works in the browser and in Node.
// Onset envelope (rises in loudness, 100 frames/s) → autocorrelation → strongest beat period.
export function detectBpm(pcm, sr) {
  const hop = Math.round(sr / 100);
  const frames = Math.floor(pcm.length / hop);
  if (frames < 400) return 0;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop, end = i + hop; i < end; i++) e += pcm[i] * pcm[i];
    env[f] = Math.log(1e-9 + e);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);
  // Remove slow loudness changes so only beats remain.
  const W = 50;
  let acc = 0;
  const flat = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    acc += onset[f];
    if (f >= W) acc -= onset[f - W];
    flat[f] = Math.max(0, onset[f] - acc / Math.min(f + 1, W));
  }
  const minLag = Math.floor(6000 / 190), maxLag = Math.ceil(6000 / 60);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += flat[f] * flat[f - lag];
    ac[lag] = s / (frames - lag);
  }
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 6000 / lag;
    // Prefer typical song tempi (gentle bias around 120 BPM) and reward a matching double period.
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * prior;
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!bestLag) return 0;
  // Parabolic refinement between neighbouring lags.
  const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
  const shift = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return Math.round(6000 / (bestLag + Math.max(-0.5, Math.min(0.5, shift))));
}

// Browser helper: decode a Blob and measure the middle 40 s.
export async function bpmOfBlob(blob) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buf = await blob.arrayBuffer();
  const ctx = new AC(1, 1, 22050);
  const audio = await ctx.decodeAudioData(buf);
  const sr = audio.sampleRate;
  const ch = audio.getChannelData(0);
  const start = Math.max(0, Math.floor(ch.length / 2 - 20 * sr));
  return detectBpm(ch.subarray(start, Math.min(ch.length, start + 40 * sr)), sr);
}
