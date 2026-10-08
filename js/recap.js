// "Dein Rückblick": listening statistics as a story, any time (week / month / year), shareable as an image.
// Listening time is measured on the device only and never leaves it.
import { player } from './player.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, hooks, getTrack, coverHTML, plural, hue, openSheet } from './core.js';

const KEY = 'melody.stats';
const MAX_DAYS = 400;

let data = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '') || { days: {} }; } catch { return { days: {} }; } })();
let dirty = false;
const save = () => {
  if (!dirty) return;
  const keys = Object.keys(data.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete data.days[k];
  try { localStorage.setItem(KEY, JSON.stringify(data)); dirty = false; } catch { /* storage full */ }
};

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function today() {
  const k = dayKey();
  return (data.days[k] ||= { music: 0, podcast: 0, radio: 0, hours: Array(24).fill(0), tracks: {}, artists: {}, genres: {}, pods: {}, stations: {}, names: {} });
}
const bump = (obj, key, v) => { if (key) obj[key] = (obj[key] || 0) + v; };

// Count wall-clock time while something plays (robust against background-tab timer throttling).
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const sec = Math.min(60, (now - lastTick) / 1000);
  lastTick = now;
  if (!player.playing || sec <= 0) return;
  const d = today();
  d.hours[new Date().getHours()] += sec;
  if (player.mode === 'library' && player.track) {
    const t = player.track;
    d.music += sec;
    bump(d.tracks, t.id, sec);
    bump(d.artists, t.artist, sec);
    bump(d.genres, t.genre, sec);
    d.names[t.id] = `${t.title}\u0001${t.artist}`;
  } else if (player.mode === 'podcast' && player.episode) {
    d.podcast += sec;
    bump(d.pods, player.episode.pod.title, sec);
  } else if (player.mode === 'radio' && player.station) {
    d.radio += sec;
    bump(d.stations, player.station.name, sec);
  }
  dirty = true;
}, 1000);
setInterval(save, 15000);
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

// ---------- Aggregation ----------
const PERIODS = {
  week: { label: 'Diese Woche', days: 7 },
  month: { label: 'Dieser Monat', days: 0 },
  year: { label: 'Dieses Jahr', days: -1 },
};

function inPeriod(key, period) {
  const now = new Date();
  if (period === 'week') return key >= dayKey(new Date(now - 6 * 86400000));
  if (period === 'month') return key.startsWith(dayKey(now).slice(0, 7));
  return key.startsWith(String(now.getFullYear()));
}

function periodTitle(period) {
  const now = new Date();
  if (period === 'week') return 'Deine Woche';
  if (period === 'month') return now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  return `Dein Jahr ${now.getFullYear()}`;
}

const TYPES = [
  { id: 'early', name: 'Frühaufsteher:in', from: 5, to: 10, emoji: '🌅', text: 'Dein Tag startet mit Musik – am meisten hörst du morgens.' },
  { id: 'day', name: 'Tagträumer:in', from: 10, to: 17, emoji: '☀️', text: 'Musik begleitet dich durch den Tag – bei der Arbeit, beim Lernen, unterwegs.' },
  { id: 'evening', name: 'Feierabend-Fan', from: 17, to: 22, emoji: '🌆', text: 'Wenn der Tag geschafft ist, drehst du auf.' },
  { id: 'night', name: 'Nachteule', from: 22, to: 29, emoji: '🌙', text: 'Die besten Songs hörst du, wenn andere schlafen.' },
];

export function compute(period, src = data) {
  const r = { music: 0, podcast: 0, radio: 0, hours: Array(24).fill(0), tracks: {}, artists: {}, genres: {}, pods: {}, stations: {}, names: {}, days: {} };
  for (const [k, d] of Object.entries(src.days)) {
    if (!inPeriod(k, period)) continue;
    r.music += d.music; r.podcast += d.podcast; r.radio += d.radio;
    d.hours.forEach((v, h) => { r.hours[h] += v; });
    for (const f of ['tracks', 'artists', 'genres', 'pods', 'stations']) for (const [n, v] of Object.entries(d[f] || {})) bump(r[f], n, v);
    Object.assign(r.names, d.names);
    r.days[k] = d.music + d.podcast + d.radio;
  }
  const top = (obj, n = 5) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  const total = r.music + r.podcast + r.radio;
  const typeScore = TYPES.map((t) => {
    let s = 0;
    for (let h = t.from; h < t.to; h++) s += r.hours[h % 24];
    return { t, s };
  }).sort((a, b) => b.s - a.s);
  const bestDay = top(r.days, 1)[0];
  const activeDays = Object.values(r.days).filter((v) => v > 60).length;
  return {
    total, music: r.music, podcast: r.podcast, radio: r.radio, hours: r.hours,
    topTracks: top(r.tracks).map(([id, secs]) => {
      const t = getTrack(id);
      const [title, artist] = (r.names[id] || '\u0001').split('\u0001');
      return { id, t, title: t?.title || title || 'Gelöschter Titel', artist: t?.artist || artist || '', secs };
    }),
    topArtists: top(r.artists),
    topGenres: top(r.genres, 3),
    topPods: top(r.pods, 3),
    topStations: top(r.stations, 3),
    type: total > 0 ? typeScore[0].t : null,
    bestDay: bestDay ? { day: bestDay[0], secs: bestDay[1] } : null,
    activeDays,
    songs: Object.keys(r.tracks).length,
  };
}

function extras(period) {
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const from = period === 'week' ? Date.now() - 7 * 86400000 : period === 'month' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : new Date(new Date().getFullYear(), 0, 1).getTime();
  const workouts = read('melody.workouts').filter((w) => w.at >= from);
  const recognized = read('melody.recognized').filter((x) => x.at >= from);
  return {
    workouts: workouts.length,
    workoutMin: Math.round(workouts.reduce((s, w) => s + w.secs, 0) / 60),
    recognized: recognized.length,
    sound: player.settings.preset,
  };
}

// Sample data so the page can be explored before there is real listening history.
function sampleData() {
  const days = {};
  const now = Date.now();
  const titles = ['Sommerwind\u0001Die Wellen', 'Nachtfahrt\u0001Neon Boulevard', 'Energie\u0001Puls 128', 'Sonnenaufgang\u0001Lina Morgen', 'Regentropfen\u0001Kaffee & Vinyl'];
  for (let i = 0; i < 28; i++) {
    const d = new Date(now - i * 86400000);
    const hours = Array(24).fill(0);
    for (const h of [7, 8, 18, 19, 20, 21, 22, 23]) hours[h] = 300 + ((i * 37 + h * 13) % 600);
    const music = hours.reduce((a, b) => a + b, 0);
    const tracks = {}, names = {};
    titles.forEach((n, j) => { tracks['sample' + j] = music * [0.34, 0.24, 0.18, 0.14, 0.1][j]; names['sample' + j] = n; });
    days[dayKey(d)] = {
      music, podcast: 900 + (i % 5) * 300, radio: (i % 3) * 400, hours, tracks, names,
      artists: { 'Die Wellen': music * 0.34, 'Neon Boulevard': music * 0.24, 'Puls 128': music * 0.18, 'Lina Morgen': music * 0.14, 'Kaffee & Vinyl': music * 0.1 },
      genres: { Pop: music * 0.48, Electronic: music * 0.24, Dance: music * 0.18 }, pods: { 'Melody Insider': 900 }, stations: {},
    };
  }
  return { days };
}

// ---------- View ----------
const R = { period: 'month', sample: false };
const mins = (s) => Math.round(s / 60).toLocaleString('de-DE');
const hrs = (s) => (s >= 3600 ? `${(s / 3600).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Std.` : `${mins(s)} Min.`);

function hourChart(hours) {
  const max = Math.max(1, ...hours);
  return `<div class="rc-hours" role="img" aria-label="Hörzeit nach Uhrzeit">${hours.map((v, h) => `<i style="height:${Math.max(3, (v / max) * 100)}%" title="${h} Uhr: ${mins(v)} Min."></i>`).join('')}</div>
    <div class="rc-hours-x"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 Uhr</span></div>`;
}

export function viewRecap() {
  const st = compute(R.period, R.sample ? sampleData() : data);
  const ex = R.sample ? { workouts: 9, workoutMin: 310, recognized: 4, sound: 'Melody Signature' } : extras(R.period);
  const tabs = `<div class="tabs">${Object.entries(PERIODS).map(([k, p]) => `<button class="chip${R.period === k ? ' on' : ''}" data-action="recap-period" data-p="${k}">${p.label}</button>`).join('')}
    ${R.sample ? '<button class="chip on" data-action="recap-sample">Beispiel ✕</button>' : ''}</div>`;
  if (st.total < 60) {
    return `<h1>Dein Rückblick</h1>${tabs}
      <div class="empty">${icon('sparkle')}<p>Hier entsteht dein persönlicher Rückblick: Lieblingssongs, Hörzeiten, dein Hörtyp – jederzeit, nicht nur einmal im Jahr.</p>
      <p class="small muted">Hör ein bisschen Musik oder Podcasts – der Rückblick füllt sich automatisch. Alles bleibt auf deinem Gerät.</p>
      <button class="btn btn-primary" data-action="recap-sample">${icon('sparkle')}Beispiel ansehen</button></div>`;
  }
  const top = st.topTracks[0];
  const share = [['Musik', st.music, 'var(--accent)'], ['Podcasts', st.podcast, '#0ea5e9'], ['Radio', st.radio, '#f97316']].filter((x) => x[1] > 0);
  return `<h1>Dein Rückblick${R.sample ? ' <span class="badge-demo">Beispiel</span>' : ''}</h1>${tabs}
  <div class="story">
    <section class="slide s1">
      <span class="kind">${esc(periodTitle(R.period))}</span>
      <div class="big">${mins(st.total)}</div><div class="unit">Minuten mit Melody</div>
      <div class="split">${share.map(([l, v, c]) => `<i style="flex:${v};background:${c}" title="${l}"></i>`).join('')}</div>
      <div class="legend">${share.map(([l, v, c]) => `<span><b style="background:${c}"></b>${l} ${hrs(v)}</span>`).join('')}</div>
      <p>An ${plural(st.activeDays, 'Tag', 'Tagen')} gehört${st.songs ? ` · ${plural(st.songs, 'verschiedener Song', 'verschiedene Songs')}` : ''}.</p>
    </section>
    ${top ? `<section class="slide s2">
      <span class="kind">Dein Song Nr. 1</span>
      <div class="top-song">${top.t ? coverHTML(top.t, 'lg') : `<div class="cover lg" style="--h:${hue(top.title)}">${icon('note')}</div>`}
        <div><h2>${esc(top.title)}</h2><p>${esc(top.artist)}</p><p class="small">${mins(top.secs)} Minuten gehört</p></div></div>
      <ol class="rank-list">${st.topTracks.map((x) => `<li><span>${esc(x.title)}</span><small>${esc(x.artist)} · ${mins(x.secs)} Min.</small></li>`).join('')}</ol>
    </section>` : ''}
    ${st.topArtists.length ? `<section class="slide s3">
      <span class="kind">Deine Künstler</span>
      <ol class="rank-list big-list">${st.topArtists.map(([n, s]) => `<li><span>${esc(n)}</span><small>${mins(s)} Min.</small></li>`).join('')}</ol>
      ${st.topGenres.length ? `<p>Am liebsten: <b>${st.topGenres.map(([g]) => esc(g)).join(', ')}</b></p>` : ''}
    </section>` : ''}
    ${st.type ? `<section class="slide s4">
      <span class="kind">Dein Hörtyp</span>
      <div class="type"><span class="emoji">${st.type.emoji}</span><h2>${st.type.name}</h2><p>${st.type.text}</p></div>
      ${hourChart(st.hours)}
      ${st.bestDay ? `<p class="small">Rekordtag: <b>${new Date(st.bestDay.day).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</b> mit ${mins(st.bestDay.secs)} Minuten.</p>` : ''}
    </section>` : ''}
    <section class="slide s5">
      <span class="kind">Mehr als Musik</span>
      <div class="facts">
        ${st.podcast ? `<div><b>${hrs(st.podcast)}</b><span>Podcasts${st.topPods[0] ? ` – am meisten „${esc(st.topPods[0][0])}“` : ''}</span></div>` : ''}
        ${st.radio ? `<div><b>${hrs(st.radio)}</b><span>Radio${st.topStations[0] ? ` – vor allem ${esc(st.topStations[0][0])}` : ''}</span></div>` : ''}
        ${ex.workouts ? `<div><b>${ex.workouts}</b><span>Trainings mit ${ex.workoutMin} Minuten Musik 💪</span></div>` : ''}
        ${ex.recognized ? `<div><b>${ex.recognized}</b><span>Songs erkannt</span></div>` : ''}
        <div><b>${esc(ex.sound)}</b><span>dein Klang</span></div>
      </div>
    </section>
  </div>
  <div class="recap-share"><button class="btn btn-primary" data-action="recap-share">${icon('share')}Rückblick als Bild teilen</button>
    <span class="muted small">Deine Hördaten bleiben auf diesem Gerät.</span></div>`;
}

// ---------- Share image (1080×1350) ----------
async function shareImage() {
  const st = compute(R.period, R.sample ? sampleData() : data);
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, '#2e1065'); grad.addColorStop(0.55, '#7c3aed'); grad.addColorStop(1, '#db2777');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  g.globalAlpha = 0.12; g.fillStyle = '#fff';
  for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(880, 220, 60 + i * 55, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); }
  g.globalAlpha = 1;
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.fillStyle = '#fff';
  g.font = font(800, 44); g.fillText('MEIN MELODY-RÜCKBLICK', 80, 130);
  g.font = font(600, 40); g.globalAlpha = 0.85; g.fillText(periodTitle(R.period), 80, 190); g.globalAlpha = 1;
  g.font = font(900, 190); g.fillText(mins(st.total), 74, 410);
  g.font = font(600, 46); g.fillText('Minuten Musik & mehr', 80, 480);
  let y = 600;
  g.font = font(800, 34); g.globalAlpha = 0.8; g.fillText('TOP-SONGS', 80, y); g.globalAlpha = 1;
  st.topTracks.slice(0, 3).forEach((t, i) => {
    y += 70;
    g.font = font(800, 48); g.fillText(`${i + 1}  ${t.title}`.slice(0, 32), 80, y);
    g.font = font(500, 32); g.globalAlpha = 0.8; g.fillText(t.artist.slice(0, 40), 140, y + 40); g.globalAlpha = 1;
    y += 40;
  });
  y += 90;
  if (st.type) {
    g.font = font(800, 34); g.globalAlpha = 0.8; g.fillText('MEIN HÖRTYP', 80, y); g.globalAlpha = 1;
    g.font = font(900, 64); g.fillText(`${st.type.emoji} ${st.type.name}`, 80, y + 80);
  }
  g.font = font(700, 34); g.globalAlpha = 0.9; g.fillText('♪ Melody · Musik ohne Werbung', 80, 1280);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'melody-rueckblick.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Mein Melody-Rückblick' }); return; } catch { /* cancelled */ }
  }
  const url = URL.createObjectURL(blob);
  openSheet(`<div class="recap-img"><h3>Dein Rückblick-Bild</h3><img src="${url}" alt="Rückblick als Bild">
    <a class="btn btn-primary" href="${url}" download="melody-rueckblick.png">${icon('download')}Bild speichern</a></div>`);
}

export function homeTeaser() {
  const st = compute('month');
  if (st.total < 300) return '';
  const top = st.topTracks[0];
  return `<button class="recap-teaser" data-action="nav" data-view="recap">
    <span class="kind">${icon('sparkle')} Dein Monat</span>
    <b>${mins(st.total)} Minuten</b>
    <span>${top ? `Nr. 1: ${esc(top.title)}` : ''}${st.type ? ` · ${st.type.emoji} ${st.type.name}` : ''}</span>
    <span class="go">Rückblick ansehen →</span></button>`;
}

export const recapActions = {
  'recap-period': (el) => { R.period = el.dataset.p; hooks.render(); },
  'recap-sample': () => { R.sample = !R.sample; hooks.render(); },
  'recap-share': () => shareImage().catch(() => toast('Bild konnte nicht erstellt werden.')),
};

// Test hooks
window.__melodyStats = { get data() { return data; }, set data(v) { data = v; }, compute, save, sampleData };
