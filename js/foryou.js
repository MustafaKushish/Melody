// "Für dich": AI mixes from the user's library, with a built-in engine as offline fallback.
import { api } from './api.js';
import { player, shuffled, MELODY_SOUNDS } from './player.js';
import { icon, hydrateIcons } from './icons.js';
import { $, esc, toast, state, go, hooks, getTrack, plural } from './core.js';

export const MOODS = {
  'Gute Laune': { emoji: '☀️', words: ['laune', 'happy', 'fröhlich', 'glücklich', 'sonne', 'sommer', 'gut drauf'], genres: ['pop', 'dance', 'funk', 'disco', 'reggae', 'schlager', 'indie', 'soul'], preset: 'Melody Signature', radio: ['pop', 'feelgood'], title: 'Gute-Laune-Mix', msg: 'Sonne im Ohr – diese Songs heben deine Stimmung.' },
  Workout: { emoji: '💪', words: ['sport', 'workout', 'training', 'laufen', 'joggen', 'gym', 'power', 'fitness'], genres: ['electronic', 'edm', 'dance', 'hip hop', 'hip-hop', 'rap', 'rock', 'metal', 'techno', 'house'], preset: 'Melody Bass', radio: ['workout', 'dance'], title: 'Power-Workout', msg: 'Volle Energie: Beats, die dich antreiben.' },
  Fokus: { emoji: '🎯', words: ['fokus', 'konzentr', 'arbeit', 'lernen', 'study', 'focus', 'büro'], genres: ['classical', 'klassik', 'ambient', 'instrumental', 'lofi', 'jazz', 'piano', 'soundtrack'], preset: 'Melody Klar', radio: ['lofi', 'ambient'], title: 'Fokus-Modus', msg: 'Ruhig und klar – perfekt zum Konzentrieren.' },
  Entspannen: { emoji: '🌙', words: ['entspann', 'chill', 'ruhig', 'relax', 'abend', 'schlaf', 'müde', 'runterkommen'], genres: ['chill', 'ambient', 'acoustic', 'jazz', 'soul', 'lofi', 'folk', 'klassik', 'classical'], preset: 'Melody Chill', radio: ['chillout', 'ambient'], title: 'Zeit zum Durchatmen', msg: 'Lehn dich zurück – sanfte Klänge für den Feierabend.' },
  Party: { emoji: '🎉', words: ['party', 'feiern', 'tanzen', 'club', 'wochenende', 'disco'], genres: ['dance', 'house', 'edm', 'electronic', 'hip hop', 'pop', 'disco', 'techno', 'latin', 'reggaeton'], preset: 'Melody Party', radio: ['dance', 'party'], title: 'Party-Start', msg: 'Lauter machen! Die Tanzfläche gehört dir.' },
  Mitsingen: { emoji: '🎤', words: ['singen', 'mitsingen', 'karaoke', 'hits', 'klassiker', 'hymne'], genres: ['pop', 'schlager', 'rock', 'musical', 'soul'], preset: 'Melody Klar', radio: ['hits', 'pop'], title: 'Mitsing-Hits', msg: 'Deine Lieblingssongs zum Lautmitsingen – Lyrics sind dabei.' },
  Roadtrip: { emoji: '🚗', words: ['auto', 'fahrt', 'roadtrip', 'reise', 'urlaub', 'unterwegs'], genres: ['rock', 'pop', 'indie', 'country', 'alternative', 'classic rock'], preset: 'Melody Live', radio: ['rock', 'classic rock'], title: 'Roadtrip', msg: 'Fenster runter, Musik an – ab auf die Straße.' },
  Regentag: { emoji: '🌧️', words: ['regen', 'traurig', 'melanchol', 'herbst', 'nachdenk', 'grau'], genres: ['indie', 'acoustic', 'singer', 'folk', 'soul', 'blues', 'piano'], preset: 'Melody Chill', radio: ['acoustic', 'indie'], title: 'Regentag', msg: 'Für graue Tage: ehrlich, warm, ein bisschen nachdenklich.' },
};

const ai = { prompt: '', mood: '', loading: false, result: null };

function detectMood(prompt) {
  const p = prompt.toLowerCase();
  return Object.keys(MOODS).find((m) => m.toLowerCase() === p) ||
    Object.entries(MOODS).find(([, m]) => m.words.some((w) => p.includes(w)))?.[0] || '';
}

// Built-in engine: scores tracks by genre fit, taste (favourites, plays) and freshness, then spaces out artists.
export function localMix(prompt, moodName = detectMood(prompt)) {
  const mood = MOODS[moodName];
  const now = Date.now();
  const scored = state.tracks.map((t) => {
    const genre = `${t.genre || ''}`.toLowerCase();
    let s = Math.random() * 1.5;
    s += Math.log1p(t.plays || 0) * (mood ? 0.4 : 0.8);
    if (t.favorite) s += mood?.title === 'Mitsing-Hits' ? 3 : 1.5;
    if (mood && genre && mood.genres.some((g) => genre.includes(g))) s += 4;
    if (t.lastPlayed && t.lastPlayed > now - 3 * 3600000) s -= 1.5;
    if (prompt) {
      const words = prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hay = `${t.title} ${t.artist} ${t.album} ${genre}`.toLowerCase();
      if (words.some((w) => hay.includes(w))) s += 3;
    }
    return { t, s };
  }).sort((a, b) => b.s - a.s).slice(0, 30);

  // Avoid the same artist twice in a row.
  const out = [];
  const pool = scored.map((x) => x.t);
  while (pool.length) {
    const i = pool.findIndex((t) => t.artist !== out[out.length - 1]?.artist);
    out.push(pool.splice(i >= 0 ? i : 0, 1)[0]);
  }
  return {
    title: mood?.title || 'Dein Mix',
    message: mood?.msg || 'Zusammengestellt aus deinen Favoriten und Lieblingskünstlern.',
    ids: out.map((t) => t.id),
    preset: mood?.preset || 'Melody Signature',
    radioTags: mood?.radio || [],
    discover: [],
    source: 'engine',
  };
}

function librarySummary() {
  let tracks = state.tracks;
  if (tracks.length > 800) {
    const keep = new Set([...tracks].sort((a, b) => (b.favorite - a.favorite) || (b.plays || 0) - (a.plays || 0)).slice(0, 500));
    tracks = [...keep, ...shuffled(tracks.filter((t) => !keep.has(t))).slice(0, 300)];
  }
  const index = new Map(tracks.map((t, i) => [t.id, i]));
  const recent = state.tracks.filter((t) => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 15)
    .map((t) => index.get(t.id)).filter((i) => i !== undefined);
  return {
    ids: tracks.map((t) => t.id),
    library: tracks.map((t) => ({ t: t.title, a: t.artist, g: t.genre || '', y: t.year || '', p: t.plays || 0, f: t.favorite ? 1 : 0 })),
    recent,
  };
}

export async function runMix(prompt, mood = '') {
  if (!state.tracks.length) {
    toast('Importiere zuerst Musik – dann kann Melody dir Mixe empfehlen.');
    return;
  }
  ai.prompt = prompt;
  ai.mood = mood;
  ai.loading = true;
  ai.result = null;
  renderResult();
  const wish = mood ? `${mood}${prompt && prompt !== mood ? ': ' + prompt : ''}` : prompt;
  try {
    const sum = librarySummary();
    const r = await api('/ai/recommend', { method: 'POST', body: { prompt: wish, library: sum.library, recent: sum.recent, hour: new Date().getHours() } });
    ai.result = { ...r, ids: r.trackIndexes.map((i) => sum.ids[i]).filter(Boolean) };
    if (!ai.result.ids.length) ai.result = { ...localMix(wish, mood || detectMood(wish)), discover: r.discover, message: r.message };
  } catch (e) {
    ai.result = localMix(wish, mood || detectMood(wish));
    if (e.status === 429 || e.status === 422) ai.result.note = e.message;
    else if (e.status !== 503 && e.status !== 0) ai.result.note = 'Die KI war nicht erreichbar – hier ist die Empfehlung der Melody-Engine.';
  }
  ai.loading = false;
  renderResult();
}

function resultHTML() {
  if (ai.loading) {
    return `<div class="ai-card loading"><div class="ai-orb"></div><div><b>Deine KI hört sich deine Bibliothek an …</b><p class="muted">Das dauert nur einen Moment.</p></div></div>`;
  }
  const r = ai.result;
  if (!r) return '';
  const tracks = r.ids.map(getTrack).filter(Boolean);
  const listKey = hooks.registerList(tracks.map((t) => t.id));
  const sound = MELODY_SOUNDS[r.preset] && player.settings.preset !== r.preset;
  return `<div class="ai-card">
      <div class="ai-head"><span class="ai-badge">${r.source === 'ki' ? `${icon('sparkle')} KI-Mix` : `${icon('sparkle')} Melody-Engine`}</span>
        <h2>${esc(r.title)}</h2><p>${esc(r.message)}</p>
        ${r.note ? `<p class="muted small">${esc(r.note)}</p>` : ''}</div>
      <div class="row">
        <button class="btn btn-primary" data-action="play-in" data-list="${listKey}" data-index="0">${icon('play')}Abspielen</button>
        <button class="btn" data-action="shuffle-list" data-list="${listKey}">${icon('shuffle')}Zufall</button>
        <button class="btn" data-action="ai-save">${icon('add')}Als Playlist speichern</button>
        ${sound ? `<button class="btn" data-action="ai-sound" data-preset="${esc(r.preset)}">${icon('eq')}Klang: ${esc(r.preset)}</button>` : ''}
      </div>
    </div>
    ${hooks.trackRows(tracks, { empty: 'Keine passenden Titel gefunden.' })}
    ${r.discover?.length ? `<h2>Neu für dich entdecken</h2><div class="discover">${r.discover.map((d) => `
      <div class="discover-item"><div class="cover sm" style="--h:${(d.artist.length * 37) % 360}">${icon('sparkle')}</div>
        <div class="meta"><b>${esc(d.song)}</b><span>${esc(d.artist)}</span><small>${esc(d.why)}</small></div>
        <button class="chip" data-action="ai-radio-search" data-q="${esc(d.artist)}">${icon('radio')}Radio</button></div>`).join('')}</div>` : ''}
    ${r.radioTags?.length ? `<h2>Passende Radiosender</h2><div class="tabs">${r.radioTags.map((t) => `<button class="chip" data-action="ai-radio-tag" data-tag="${esc(t)}">${icon('radio')}${esc(t)}</button>`).join('')}</div>` : ''}`;
}

function renderResult() {
  const el = $('#ai-result');
  if (!el) return;
  el.innerHTML = resultHTML();
  hydrateIcons(el);
}

export function viewForYou() {
  const h = new Date().getHours();
  const suggestion = h < 10 ? 'Gute Laune' : h < 17 ? 'Fokus' : h < 21 ? 'Roadtrip' : 'Entspannen';
  return `<h1>Für dich</h1>
    <p class="sub">Sag Melody, wonach dir ist – die KI stellt aus deiner Musik den perfekten Mix zusammen und empfiehlt dir Neues.</p>
    <form class="ai-ask" data-form="ai">
      ${icon('sparkle')}
      <input class="input plain" name="prompt" placeholder="z. B. „Etwas für einen sonnigen Sonntagmorgen“" value="${esc(ai.prompt)}" maxlength="300" autocomplete="off">
      <button class="btn btn-primary">Mix erstellen</button>
    </form>
    <div class="tabs moods">${Object.entries(MOODS).map(([name, m]) => `<button class="chip${ai.mood === name ? ' on' : ''}${!ai.result && name === suggestion ? ' suggest' : ''}" data-action="ai-mood" data-mood="${name}">${m.emoji} ${name}</button>`).join('')}</div>
    <div id="ai-result">${state.tracks.length ? resultHTML() : '<div class="empty">Importiere zuerst Musik, damit Melody deinen Geschmack kennenlernt.</div>'}</div>`;
}

export const forYouActions = {
  'ai-mood': (el) => {
    if (state.route.view !== 'foryou') go('foryou');
    runMix('', el.dataset.mood);
    document.querySelectorAll('[data-action=ai-mood]').forEach((c) => c.classList.toggle('on', c.dataset.mood === el.dataset.mood));
  },
  'ai-save': async () => {
    const r = ai.result;
    if (!r?.ids.length) return;
    const p = await hooks.createPlaylist(r.title, r.ids);
    toast(`Playlist „${p.name}“ gespeichert · ${plural(r.ids.length, 'Titel', 'Titel')}`);
  },
  'ai-sound': (el) => {
    player.applySound(el.dataset.preset);
    hooks.reportPreset?.();
    toast(`Klang: ${el.dataset.preset}`);
    renderResult();
  },
  'ai-radio-tag': (el) => {
    Object.assign(state.radio, { tag: el.dataset.tag, query: '', loaded: false });
    go('radio');
  },
  'ai-radio-search': (el) => {
    Object.assign(state.radio, { tag: '', query: el.dataset.q, loaded: false });
    go('radio');
  },
};

export const forYouForms = {
  ai: (form) => {
    const prompt = form.prompt.value.trim();
    document.querySelectorAll('[data-action=ai-mood]').forEach((c) => c.classList.remove('on'));
    runMix(prompt, '');
  },
};
