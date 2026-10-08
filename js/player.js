import { db } from './db.js';

export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  'Flach': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass-Boost': [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  'Höhen-Boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  'Gesang': [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  'Rock': [5, 4, 2, -1, -2, -1, 2, 3, 4, 5],
  'Pop': [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1],
  'Hip-Hop': [6, 5, 2, 3, -1, -1, 1, 0, 2, 3],
  'Jazz': [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  'Klassik': [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  'Elektronisch': [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
  'Kopfhörer': [3, 2, 0, -1, -1, 0, 1, 2, 3, 2],
  'Nachtmodus': [-3, -2, 0, 1, 2, 2, 1, 0, -2, -4],
};

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const SETTINGS_KEY = 'melody.settings';
const STATE_KEY = 'melody.state';

function loadSettings() {
  const defaults = {
    volume: 1,
    rate: 1,
    // On iOS the Web Audio graph pauses with the screen locked, so effects are opt-in there.
    fx: !isIOS,
    eqOn: false,
    eq: [...EQ_PRESETS['Flach']],
    preset: 'Flach',
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Player extends EventTarget {
  constructor() {
    super();
    this.el = new Audio();
    this.el.preload = 'auto';
    this.radioEl = new Audio();
    this.radioEl.preload = 'none';
    this.mode = 'library'; // 'library' | 'radio'
    this.queue = [];
    this.original = null; // order before shuffle
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this.track = null;
    this.station = null;
    this.url = null;
    this.loadToken = 0;
    this.ctx = null;
    this.filters = [];
    this.analyser = null;
    this.sleepTimer = null;
    this.sleepUntil = 0;
    this.sleepAtEnd = false;
    this.lookup = () => null; // set by app: id -> track
    this.coverUrl = () => null; // set by app: track -> object URL
    this.settings = loadSettings();
    this.el.volume = this.radioEl.volume = this.settings.volume;

    for (const el of [this.el, this.radioEl]) {
      el.addEventListener('play', () => this.emit('state'));
      el.addEventListener('pause', () => this.emit('state'));
      el.addEventListener('waiting', () => this.emit('state'));
      el.addEventListener('playing', () => this.emit('state'));
    }
    this.el.addEventListener('timeupdate', () => {
      this.emit('time');
      if (Date.now() - (this._lastSave || 0) > 4000) this.saveState();
    });
    this.el.addEventListener('loadedmetadata', () => {
      this.el.playbackRate = this.settings.rate;
      this.emit('time');
      this.updatePosition();
    });
    this.el.addEventListener('ended', () => this.onEnded());
    this.radioEl.addEventListener('error', () => {
      // Stream dropped while already playing (play() reports failures to start).
      if (this.mode === 'radio' && this.radioEl.getAttribute('src') && this.radioEl.currentTime > 0) this.emit('error', 'Verbindung zum Sender verloren.');
      this.emit('state');
    });
    this.setupMediaSession();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get media() {
    return this.mode === 'radio' ? this.radioEl : this.el;
  }
  get playing() {
    return !this.media.paused;
  }
  get currentId() {
    return this.queue[this.index];
  }

  saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  saveState() {
    this._lastSave = Date.now();
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        queue: this.queue, original: this.original, index: this.index,
        time: this.el.currentTime || 0, shuffle: this.shuffle, repeat: this.repeat,
      }));
    } catch { /* storage full or unavailable */ }
  }

  async restore() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (!s) return;
      this.shuffle = !!s.shuffle;
      this.repeat = s.repeat || 'off';
      this.original = s.original || null;
      this.queue = (s.queue || []).filter((id) => this.lookup(id));
      if (this.original) this.original = this.original.filter((id) => this.lookup(id));
      const idx = Math.min(Math.max(s.index, 0), this.queue.length - 1);
      if (this.queue.length) await this.load(idx, false, s.time || 0);
      this.emit('queue');
    } catch (e) {
      console.warn(e);
    }
  }

  // ---------- Audio graph (equalizer + visualizer) ----------
  initGraph() {
    if (this.ctx || !this.settings.fx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    let node = this.ctx.createMediaElementSource(this.el);
    this.filters = BANDS.map((f, i) => {
      const b = this.ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      node.connect(b);
      node = b;
      return b;
    });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    node.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.applyEq();
  }

  applyEq() {
    if (!this.ctx) return;
    const gains = this.settings.eqOn ? this.settings.eq : BANDS.map(() => 0);
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i] || 0, this.ctx.currentTime, 0.04));
  }

  setEq(gains, preset) {
    this.settings.eq = gains.map(Number);
    this.settings.preset = preset || 'Eigene';
    this.saveSettings();
    this.applyEq();
  }

  setEqOn(on) {
    this.settings.eqOn = on;
    this.saveSettings();
    if (on) this.setFx(true);
    this.applyEq();
  }

  setFx(on) {
    this.settings.fx = on;
    this.saveSettings();
    if (on) this.initGraph();
    else this.applyEq();
  }

  // ---------- Library playback ----------
  async load(i, autoplay = true, startAt = 0) {
    if (i < 0 || i >= this.queue.length) return;
    const token = ++this.loadToken;
    this.stopRadio();
    this.index = i;
    const id = this.queue[i];
    const t = this.lookup(id);
    const blob = t && (await db.get('files', id));
    if (token !== this.loadToken) return;
    if (!blob) {
      this.emit('error', 'Titel nicht gefunden.');
      return;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.track = t;
    this.el.src = this.url;
    this.el.defaultPlaybackRate = this.el.playbackRate = this.settings.rate;
    if (startAt > 0) {
      this.el.addEventListener('loadedmetadata', () => { this.el.currentTime = startAt; }, { once: true });
    }
    this.updateMetadata();
    this.emit('track', t);
    this.emit('queue');
    this.saveState();
    if (autoplay) {
      await this.play();
      t.plays = (t.plays || 0) + 1;
      t.lastPlayed = Date.now();
      db.put('tracks', t).catch(() => {});
      this.emit('played', t);
    }
  }

  async play() {
    if (this.mode === 'library') {
      if (!this.el.getAttribute('src')) {
        if (this.queue.length) return this.load(Math.max(this.index, 0));
        return;
      }
      this.initGraph();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }
    try {
      await this.media.play();
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') this.emit('error', 'Tippe auf Play, um die Wiedergabe zu starten.');
      else if (this.mode === 'radio') this.emit('error', 'Sender nicht erreichbar.');
      else this.emit('error', 'Diese Datei kann auf diesem Gerät nicht abgespielt werden.');
    }
  }

  pause() {
    this.media.pause();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  next(auto = false) {
    if (this.mode === 'radio') return;
    if (this.index + 1 < this.queue.length) return this.load(this.index + 1);
    if (this.repeat === 'all' && this.queue.length) return this.load(0);
    if (auto) {
      this.el.currentTime = 0;
      this.pause();
      this.emit('state');
    }
  }

  prev() {
    if (this.mode === 'radio') return;
    if (this.el.currentTime > 3 || this.index <= 0) {
      this.el.currentTime = 0;
      return;
    }
    this.load(this.index - 1);
  }

  onEnded() {
    if (this.sleepAtEnd) {
      this.sleepAtEnd = false;
      this.emit('sleep', 'done');
      return;
    }
    if (this.repeat === 'one') {
      this.el.currentTime = 0;
      this.play();
      return;
    }
    this.next(true);
  }

  playList(ids, start = 0) {
    if (!ids.length) return;
    this.queue = [...ids];
    this.original = null;
    let idx = start;
    if (this.shuffle) {
      this.original = [...ids];
      const first = ids[start];
      this.queue = [first, ...shuffled(ids.filter((_, i) => i !== start))];
      idx = 0;
    }
    return this.load(idx);
  }

  playShuffled(ids) {
    if (!ids.length) return;
    this.shuffle = true;
    return this.playList(ids, Math.floor(Math.random() * ids.length));
  }

  addNext(ids) {
    if (!this.queue.length) return this.playList(ids);
    this.queue.splice(this.index + 1, 0, ...ids);
    if (this.original) this.original.push(...ids);
    this.saveState();
    this.emit('queue');
  }

  addEnd(ids) {
    if (!this.queue.length) return this.playList(ids);
    this.queue.push(...ids);
    if (this.original) this.original.push(...ids);
    this.saveState();
    this.emit('queue');
  }

  jump(i) {
    this.load(i);
  }

  removeAt(i) {
    if (i === this.index) return;
    const [id] = this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    if (this.original) {
      const oi = this.original.indexOf(id);
      if (oi >= 0) this.original.splice(oi, 1);
    }
    this.saveState();
    this.emit('queue');
  }

  // Remove a deleted track everywhere.
  forget(id) {
    const cur = this.currentId;
    this.queue = this.queue.filter((x) => x !== id);
    if (this.original) this.original = this.original.filter((x) => x !== id);
    if (cur === id) {
      this.el.pause();
      this.el.removeAttribute('src');
      this.track = null;
      this.index = Math.min(this.index, this.queue.length - 1);
      this.emit('track', null);
    } else {
      this.index = this.queue.indexOf(cur);
    }
    this.saveState();
    this.emit('queue');
  }

  setShuffle(on) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    const cur = this.currentId;
    if (on) {
      this.original = [...this.queue];
      if (cur) {
        this.queue = [cur, ...shuffled(this.queue.filter((_, i) => i !== this.index))];
        this.index = 0;
      } else {
        this.queue = shuffled(this.queue);
      }
    } else if (this.original) {
      this.queue = this.original;
      this.original = null;
      this.index = Math.max(0, this.queue.indexOf(cur));
    }
    this.saveState();
    this.emit('queue');
    this.emit('state');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.saveState();
    this.emit('state');
  }

  seek(sec) {
    if (this.mode !== 'library' || !isFinite(sec)) return;
    this.el.currentTime = Math.max(0, Math.min(sec, this.el.duration || 0));
    this.updatePosition();
  }

  setVolume(v) {
    this.settings.volume = v;
    this.el.volume = this.radioEl.volume = v;
    this.saveSettings();
  }

  setRate(r) {
    this.settings.rate = r;
    this.el.defaultPlaybackRate = this.el.playbackRate = r;
    this.saveSettings();
    this.updatePosition();
    this.emit('state');
  }

  // ---------- Sleep timer ----------
  setSleep(minutes) {
    this.cancelSleep();
    if (minutes === 'end') {
      this.sleepAtEnd = true;
    } else if (minutes > 0) {
      this.sleepUntil = Date.now() + minutes * 60000;
      this.sleepTimer = setTimeout(() => this.fadeOutAndPause(), minutes * 60000);
    }
    this.emit('sleep');
  }

  cancelSleep() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.sleepUntil = 0;
    this.sleepAtEnd = false;
    this.emit('sleep');
  }

  fadeOutAndPause() {
    const m = this.media;
    const start = m.volume;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      m.volume = Math.max(0, start * (1 - step / 20));
      if (step >= 20) {
        clearInterval(iv);
        m.pause();
        m.volume = this.settings.volume;
        this.sleepTimer = null;
        this.sleepUntil = 0;
        this.emit('sleep', 'done');
      }
    }, 250);
  }

  // ---------- Radio ----------
  playRadio(station) {
    this.loadToken++;
    this.el.pause();
    this.mode = 'radio';
    this.station = station;
    this.radioEl.src = station.url;
    this.updateMetadata();
    this.emit('track', null);
    this.play();
  }

  stopRadio() {
    if (this.mode !== 'radio') return;
    this.radioEl.pause();
    this.radioEl.removeAttribute('src');
    this.radioEl.load();
    this.mode = 'library';
    this.station = null;
  }

  // ---------- Media Session (lock screen, headphones, car) ----------
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => this.play(),
      pause: () => this.pause(),
      previoustrack: () => this.prev(),
      nexttrack: () => this.next(),
      seekto: (d) => this.seek(d.seekTime),
      seekbackward: (d) => this.seek(this.el.currentTime - (d.seekOffset || 10)),
      seekforward: (d) => this.seek(this.el.currentTime + (d.seekOffset || 10)),
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(k, fn); } catch { /* unsupported action */ }
    }
  }

  updateMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const fallback = [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
    if (this.mode === 'radio' && this.station) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.station.name, artist: 'Melody Radio', album: this.station.tags || '', artwork: fallback,
      });
      return;
    }
    const t = this.track;
    if (!t) return;
    const cover = this.coverUrl(t);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album,
      artwork: cover ? [{ src: cover, sizes: '512x512', type: t.cover.type || 'image/jpeg' }] : fallback,
    });
  }

  updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = this.el.duration;
    if (!isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d, playbackRate: this.el.playbackRate || 1, position: Math.min(this.el.currentTime, d),
      });
    } catch { /* ignore */ }
  }
}

export const player = new Player();
export { shuffled, isIOS };
