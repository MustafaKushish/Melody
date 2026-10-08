// Sound-Studio: Melody sound profiles (recommended), community ranking, DJ desk and equalizer.
import { api } from './api.js';
import { player, BANDS, EQ_PRESETS, MELODY_SOUNDS, DEFAULT_SOUND, DJ_DEFAULTS, isIOS } from './player.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, hooks, setRangeP } from './core.js';

let popular = null;

// Tell the server which sound this listener uses (anonymous aggregate for the ranking).
let reportTimer;
export function reportPreset() {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    if (!state.account || state.account.offline) return;
    api('/presets/choice', { method: 'POST', body: { preset: player.settings.preset } }).catch(() => {});
  }, 1500);
}

async function loadPopular() {
  try {
    popular = await api('/presets/popular');
  } catch {
    popular = null;
  }
  const el = $('#popular');
  if (el) {
    el.innerHTML = popularHTML();
    hydrateIcons(el);
  }
}

function popularHTML() {
  if (!popular) return '<p class="muted">Wird geladen …</p>';
  if (!popular.total) return '<p class="muted">Noch keine Daten – sei der Erste!</p>';
  return popular.presets.slice(0, 6).map((p, i) => {
    const pct = Math.round(p.share * 100);
    const ours = popular.melody.includes(p.preset);
    return `<div class="rank${player.settings.preset === p.preset ? ' mine' : ''}">
      <span class="rank-n">${i + 1}</span>
      <span class="rank-name">${esc(p.preset)}${ours ? ` <span class="tag">${icon('star')}Melody</span>` : ''}</span>
      <span class="rank-bar"><i style="width:${Math.max(pct, 2)}%"></i></span>
      <span class="rank-pct">${pct} %</span></div>`;
  }).join('') + `<p class="muted small">Basierend auf ${popular.total} Hörer${popular.total === 1 ? '' : 'n'}.</p>`;
}

function slider(key, label, min, max, step, value, fmt) {
  return `<label class="knob"><span>${label}<b id="v-${key}">${fmt(value)}</b></span>
    <input type="range" data-dj="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

const FMT = {
  filter: (v) => (v == 0 ? 'aus' : v < 0 ? `Tiefpass ${-v} %` : `Hochpass ${v} %`),
  echo: (v) => (v == 0 ? 'aus' : `${v} %`),
  reverb: (v) => (v == 0 ? 'aus' : `${v} %`),
  width: (v) => (v == 100 ? 'normal' : v < 100 ? `schmal ${v} %` : `breit ${v} %`),
  crossfade: (v) => (v == 0 ? 'aus' : `${v} s`),
  rate: (v) => `${Math.round(v * 100)} %`,
};

export function viewStudio() {
  const s = player.settings;
  const dj = s.dj;
  const isMelody = player.isMelodySound();
  return `<h1>Sound-Studio</h1>
    <p class="sub">Dreh an allen Reglern wie ein DJ – oder vertrau auf den Melody-Sound, den die meisten Hörer lieben.</p>
    ${!s.fx ? `<div class="panel warn"><h3>Audio-Effekte sind aus</h3>
      <p>${isIOS ? 'Auf iPhone/iPad stoppt die Musik mit Effekten bei gesperrtem Bildschirm. Für Kopfhörer-Sessions trotzdem aktivieren?' : 'Aktiviere die Effekte, um Equalizer und DJ-Pult zu nutzen.'}</p>
      <button class="btn btn-primary" data-action="fx-on">Effekte aktivieren</button></div>` : ''}
    <canvas id="studio-viz" width="900" height="90"></canvas>

    <div class="panel">
      <div class="row"><h3 style="margin:0">${icon('star')} Melody-Sound · Empfohlen</h3><span class="spacer"></span>
        ${!isMelody ? `<button class="btn btn-primary" data-action="sound" data-preset="${DEFAULT_SOUND}">Zurück zum Melody-Sound</button>` : ''}</div>
      <p>Von uns abgestimmt für Kopfhörer, Handy-Lautsprecher und Boxen.</p>
      <div class="sound-grid">${Object.entries(MELODY_SOUNDS).map(([name, x]) => `
        <button class="sound${s.preset === name && isMelody ? ' on' : ''}" data-action="sound" data-preset="${esc(name)}">
          ${name === DEFAULT_SOUND ? `<span class="badge">Standard</span>` : ''}
          <b>${esc(name.replace('Melody ', ''))}</b><small>${esc(x.desc)}</small>
          <span class="mini-eq">${x.eq.map((g) => `<i style="height:${30 + g * 5}%"></i>`).join('')}</span>
        </button>`).join('')}</div>
    </div>

    <div class="panel"><h3>Beliebt bei Melody-Hörern</h3><div id="popular">${popularHTML()}</div></div>

    <div class="panel dj">
      <div class="row"><h3 style="margin:0">${icon('tune')} DJ-Pult</h3><span class="spacer"></span>
        <button class="chip" data-action="dj-reset">Zurücksetzen</button></div>
      <div class="knobs">
        ${slider('filter', 'Filter', -100, 100, 1, dj.filter, FMT.filter)}
        ${slider('echo', 'Echo', 0, 100, 1, dj.echo, FMT.echo)}
        ${slider('reverb', 'Hall', 0, 100, 1, dj.reverb, FMT.reverb)}
        ${slider('width', 'Stereo-Breite', 0, 200, 5, dj.width, FMT.width)}
        ${slider('rate', 'Tempo', 0.8, 1.2, 0.01, s.rate, FMT.rate)}
        ${slider('crossfade', 'Übergang zwischen Songs', 0, 12, 1, dj.crossfade, FMT.crossfade)}
      </div>
      <label class="setting"><span>Tonhöhe beim Tempo beibehalten</span>
        <span class="switch"><input type="checkbox" data-dj="keepPitch" ${dj.keepPitch ? 'checked' : ''}><span></span></span></label>
      <div class="pads">
        <button class="pad" data-action="pad" data-pad="padEchoOut"><b>Echo-Out</b><small>ausklingen & weiter</small></button>
        <button class="pad" data-action="pad" data-pad="padSweep"><b>Filter-Sweep</b><small>Spannung aufbauen</small></button>
        <button class="pad" data-action="pad" data-pad="padBassKill"><b>Bass-Kill</b><small>Bass kurz weg</small></button>
        <button class="pad" data-action="pad" data-pad="padBrake"><b>Vinyl-Stopp</b><small>wie ein Plattenteller</small></button>
      </div>
    </div>

    <div class="panel" id="eq">
      <div class="row"><h3 style="margin:0">Equalizer</h3><span class="spacer"></span>
        <label class="switch"><input type="checkbox" data-setting="eqOn" ${s.eqOn ? 'checked' : ''}><span></span></label></div>
      <p>Weitere Presets</p>
      <div class="presets">${Object.keys(EQ_PRESETS).map((p) => `<button class="chip${s.preset === p ? ' on' : ''}" data-action="sound" data-preset="${p}">${p}</button>`).join('')}</div>
      <div class="eq${s.eqOn ? '' : ' off'}">${BANDS.map((f, i) => `
        <label class="eq-band"><span>${s.eq[i] > 0 ? '+' : ''}${s.eq[i]}</span>
          <input type="range" min="-12" max="12" step="1" value="${s.eq[i]}" data-band="${i}" aria-label="${f} Hz">
          <span>${f >= 1000 ? f / 1000 + 'k' : f}</span></label>`).join('')}</div>
    </div>`;
}

export function afterStudioRender() {
  loadPopular();
  startStudioViz();
}

let vizOn = false;
function startStudioViz() {
  const canvas = $('#studio-viz');
  if (!canvas || vizOn) return;
  vizOn = true;
  const g = canvas.getContext('2d');
  const draw = () => {
    const c = $('#studio-viz');
    if (!c) { vizOn = false; return; }
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    if (player.analyser && player.playing && player.mode === 'library') {
      const data = new Uint8Array(player.analyser.frequencyBinCount);
      player.analyser.getByteFrequencyData(data);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const n = 72, bw = W / n;
      g.fillStyle = accent;
      for (let i = 0; i < n; i++) {
        const v = data[Math.floor((i / n) ** 1.5 * data.length * 0.9)] / 255;
        const h = Math.max(2, v * H);
        g.fillRect(i * bw + 1, (H - h) / 2, bw - 2, h);
      }
    } else {
      g.fillStyle = 'rgba(128,128,160,.35)';
      g.fillRect(0, H / 2 - 1, W, 2);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

export const studioActions = {
  sound: (el) => {
    player.applySound(el.dataset.preset);
    reportPreset();
    toast(`Klang: ${el.dataset.preset}`);
    hooks.rerender();
  },
  'fx-on': () => { player.setFx(true); hooks.rerender(); },
  'dj-reset': () => {
    const sig = MELODY_SOUNDS[player.settings.preset] || MELODY_SOUNDS[DEFAULT_SOUND];
    player.setDj({ ...DJ_DEFAULTS, reverb: sig.reverb, width: sig.width });
    player.setRate(1);
    hooks.rerender();
  },
  pad: (el) => {
    if (!player.ctx && el.dataset.pad !== 'padBrake') { toast('Aktiviere zuerst die Audio-Effekte und starte einen Titel.'); return; }
    player[el.dataset.pad]();
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 400);
  },
};

// Range/checkbox input inside the studio. Returns true when handled.
export function onStudioInput(el) {
  const key = el.dataset.dj;
  if (!key) return false;
  if (key === 'keepPitch') {
    player.setDj({ keepPitch: el.checked });
    return true;
  }
  const v = Number(el.value);
  if (key === 'rate') player.setRate(v);
  else player.setDj({ [key]: v });
  if (!player.settings.fx && key !== 'rate' && key !== 'crossfade') player.setFx(true);
  const label = $(`#v-${key}`);
  if (label) label.textContent = FMT[key](v);
  setRangeP(el);
  if (key === 'reverb' || key === 'width') {
    document.querySelectorAll('.sound.on').forEach((b) => b.classList.remove('on'));
    reportPreset();
  }
  return true;
}
