import { db } from './db.js';

export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Melody's own sound profiles – tuned by us, recommended to everyone, default for new users.
export const MELODY_SOUNDS = {
  'Melody Signature': { eq: [3, 2, 1, 0, -1, 0, 1, 2, 2, 1], reverb: 0, width: 110, desc: 'Unser Klang: warm, klar, ausgewogen' },
  'Melody Bass': { eq: [7, 6, 4, 1, 0, 0, 0, 1, 1, 0], reverb: 0, width: 100, desc: 'Druckvoller Bass ohne Dröhnen' },
  'Melody Klar': { eq: [-1, -1, 0, 0, 1, 2, 3, 3, 2, 1], reverb: 0, width: 105, desc: 'Stimmen und Details im Vordergrund' },
  'Melody Party': { eq: [6, 5, 2, 0, -1, 1, 2, 3, 4, 4], reverb: 5, width: 125, desc: 'Laut, breit, tanzbar' },
  'Melody Chill': { eq: [2, 2, 1, 0, 0, -1, -1, 0, 1, 1], reverb: 15, width: 115, desc: 'Weich und entspannt' },
  'Melody Live': { eq: [2, 1, 0, 1, 2, 2, 2, 1, 1, 0], reverb: 30, width: 135, desc: 'Wie im Konzertsaal' },
};
export const DEFAULT_SOUND = 'Melody Signature';

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

export const DJ_DEFAULTS = { filter: 0, echo: 0, reverb: 0, width: 110, crossfade: 0, keepPitch: true };

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const SETTINGS_KEY = 'melody.settings';
const STATE_KEY = 'melody.state';

function loadSettings() {
  const sig = MELODY_SOUNDS[DEFAULT_SOUND];
  const defaults = {
    volume: 1,
    rate: 1,
    // On iOS the Web Audio graph pauses with the screen locked, so effects are opt-in there.
    fx: !isIOS,
    eqOn: true,
    eq: [...sig.eq],
    preset: DEFAULT_SOUND,
    dj: { ...DJ_DEFAULTS, reverb: sig.reverb, width: sig.width },
  };
  try {
    const s = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    s.dj = { ...DJ_DEFAULTS, ...s.dj };
    return s;
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

function impulseResponse(ctx, seconds = 2.6, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

// Songs streamed from another site (Audius) must not run through Web Audio: without CORS the browser
// mutes them there. They play on plain media elements, without sound effects.
const foreign = (t) => {
  try { return !!t?.url && !t.downloaded && new URL(t.url, location.href).origin !== location.origin; } catch { return false; }
};

class Player extends EventTarget {
  constructor() {
    super();
    // Two decks so tracks can crossfade like a DJ mix.
    this.decks = [];
    this.urls = [null, null];
    this.d = 0;
    this.radioEl = new Audio();
    this.radioEl.preload = 'none';
    this.mode = 'library'; // 'library' | 'radio' | 'podcast'
    this.episode = null; // { ep, pod } while a podcast episode plays
    this.queue = [];
    this.original = null; // order before shuffle
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this.track = null;
    this.station = null;
    this.loadToken = 0;
    this.fading = false;
    this.ctx = null;
    this.n = {}; // audio graph nodes
    this.filters = [];
    this.analyser = null;
    this.vocal = 0;
    this.mic = null;
    this.sleepTimer = null;
    this.sleepUntil = 0;
    this.sleepAtEnd = false;
    this.lookup = () => null; // set by app: id -> track
    this.coverUrl = () => null; // set by app: track -> object URL
    this.settings = loadSettings();
    this.decks = [this.makeDeck(), this.makeDeck()];
    this.radioEl.volume = this.settings.volume;
    for (const ev of ['play', 'pause', 'waiting', 'playing']) this.radioEl.addEventListener(ev, () => this.emit('state'));
    this.radioEl.addEventListener('timeupdate', () => { if (this.mode === 'podcast') { this.emit('time'); this.emit('podprogress'); } });
    this.radioEl.addEventListener('loadedmetadata', () => { if (this.mode === 'podcast') { this.radioEl.playbackRate = this.settings.podRate || 1; this.emit('time'); this.updatePosition(); } });
    this.radioEl.addEventListener('ended', () => {
      if (this.mode !== 'podcast') return;
      if (this.sleepAtEnd) { this.sleepAtEnd = false; this.emit('sleep', 'done'); }
      this.emit('episode-ended', this.episode);
    });
    this.radioEl.addEventListener('error', () => {
      // Stream dropped while already playing (play() reports failures to start).
      if (this.mode === 'radio' && this.radioEl.getAttribute('src') && this.radioEl.currentTime > 0) this.emit('error', 'Verbindung zum Sender verloren.');
      if (this.mode === 'podcast' && this.radioEl.getAttribute('src')) this.emit('error', 'Folge nicht erreichbar – lade sie für unterwegs herunter.');
      this.emit('state');
    });
    this.setupMediaSession();
    if (isIOS) this.keepPlayingInBackground();
  }

  makeDeck() {
    const deck = new Audio();
    deck.preload = 'auto';
    deck.volume = this.settings.volume;
    deck.preservesPitch = deck.webkitPreservesPitch = this.settings.dj.keepPitch;
    const mine = (fn) => (e) => { if (e.target === this.el) fn(e); };
    for (const ev of ['play', 'pause', 'waiting', 'playing']) deck.addEventListener(ev, mine(() => this.emit('state')));
    deck.addEventListener('timeupdate', mine(() => {
      this.emit('time');
      this.checkCrossfade();
      if (Date.now() - (this._lastSave || 0) > 4000) this.saveState();
    }));
    deck.addEventListener('loadedmetadata', mine(() => {
      this.el.playbackRate = this.settings.rate;
      this.emit('time');
      this.updatePosition();
    }));
    deck.addEventListener('ended', mine(() => this.onEnded()));
    return deck;
  }

  // Moves playback to fresh <audio> elements that bypass Web Audio, at the same position.
  // iOS silences Web Audio as soon as a home-screen app goes to the background or the screen locks,
  // plain media elements keep playing. Also lets the effects be switched off without reloading.
  async detachGraph() {
    if (!this.ctx) return true;
    if (this.fading) this.cancelFade();
    const wasPlaying = this.mode === 'library' && !this.el.paused;
    const fresh = this.decks.map((old) => {
      const deck = this.makeDeck();
      const src = old.getAttribute('src');
      if (src) {
        deck.src = src;
        try { deck.currentTime = old.currentTime; } catch { /* set once loaded */ }
      }
      deck.playbackRate = old.playbackRate;
      return deck;
    });
    const master = this.n.master?.gain;
    if (wasPlaying) {
      if (master) master.value = 0; // no echo while both play for a moment
      try {
        fresh[this.d].currentTime = this.el.currentTime;
        await fresh[this.d].play();
      } catch {
        if (master) master.value = 1;
        for (const d of fresh) d.removeAttribute('src');
        return false;
      }
    }
    const old = this.decks;
    this.decks = fresh;
    for (const o of old) { o.pause(); o.removeAttribute('src'); try { o.load(); } catch { /* ignore */ } }
    if (this.mic) this.disableMic();
    try { this.ctx.close(); } catch { /* already closed */ }
    this.ctx = null;
    this.n = {};
    this.filters = [];
    this.analyser = null;
    this.emit('state');
    return true;
  }

  keepPlayingInBackground() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.ctx && this.mode === 'library' && !this.el.paused) {
        this.graphHold = true;
        this.detachGraph();
      }
    });
    // Back in the app: the next tap brings the effects back (a new AudioContext needs a user gesture on iOS).
    const reattach = () => {
      if (document.hidden || !this.graphHold) return;
      this.graphHold = false;
      if (this.settings.fx && !this.ctx && this.mode === 'library') { this.initGraph(); this.ctx?.resume?.(); }
    };
    document.addEventListener('pointerup', reattach, true);
    document.addEventListener('keydown', reattach, true);
  }

  // Features like Mitsingen or Party switch the effects on for a while; afterwards the previous state returns.
  borrowFx() {
    const had = this.settings.fx;
    if (!had) this.setFx(true);
    return had;
  }
  returnFx(had) {
    if (had === false && this.settings.fx) this.setFx(false);
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get el() {
    return this.decks[this.d];
  }
  get media() {
    return this.mode === 'library' ? this.el : this.radioEl;
  }

  // What's playing, independent of the source (used by drive, party and fitness screens).
  nowInfo() {
    if (this.mode === 'radio') return { title: this.station?.name, artist: 'Live-Radio', image: this.station?.favicon || '' };
    if (this.mode === 'podcast') return { title: this.episode?.ep.title, artist: this.episode?.pod.title, image: this.episode?.ep.image || this.episode?.pod.image || '' };
    return { title: this.track?.title, artist: this.track?.artist, track: this.track };
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
      this.original = s.original ? s.original.filter((id) => this.lookup(id)) : null;
      this.queue = (s.queue || []).filter((id) => this.lookup(id));
      const idx = Math.min(Math.max(s.index, 0), this.queue.length - 1);
      if (this.queue.length) await this.load(idx, false, s.time || 0);
      this.emit('queue');
    } catch (e) {
      console.warn(e);
    }
  }

  // ---------- Audio graph ----------
  // decks → mix → [vocal remover] → 10-band EQ → DJ filter → dry/echo/reverb → stereo width → master → analyser
  initGraph() {
    if (this.ctx || !this.settings.fx || (isIOS && (document.hidden || this.graphHold)) || foreign(this.track)) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const n = this.n;

    n.mix = g();
    n.deckGains = this.decks.map((deck) => {
      const gain = g();
      ctx.createMediaElementSource(deck).connect(gain);
      gain.connect(n.mix);
      return gain;
    });

    // Karaoke: (L − R) removes centre-panned vocals; low frequencies are added back so the beat stays.
    n.stage = g();
    n.vDry = g(1);
    n.vWet = g(0);
    n.mix.connect(n.vDry).connect(n.stage);
    const split = ctx.createChannelSplitter(2);
    const diff = g();
    const inv = g(-1);
    n.mix.connect(split);
    split.connect(diff, 0);
    split.connect(inv, 1).connect(diff);
    const lows = ctx.createBiquadFilter();
    lows.type = 'lowpass';
    lows.frequency.value = 160;
    n.mix.connect(lows).connect(n.vWet);
    diff.connect(n.vWet);
    n.vWet.connect(n.stage);

    let node = n.stage;
    this.filters = BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      node.connect(b);
      node = b;
      return b;
    });

    n.djFilter = ctx.createBiquadFilter();
    node.connect(n.djFilter);

    n.width = g();
    n.dry = g(1);
    n.djFilter.connect(n.dry).connect(n.width);

    n.delay = ctx.createDelay(2);
    n.delay.delayTime.value = 0.375;
    n.feedback = g(0);
    n.echoWet = g(0);
    n.djFilter.connect(n.delay);
    n.delay.connect(n.feedback).connect(n.delay);
    n.delay.connect(n.echoWet).connect(n.width);

    n.convolver = ctx.createConvolver();
    n.convolver.buffer = impulseResponse(ctx);
    n.reverbWet = g(0);
    n.djFilter.connect(n.convolver).connect(n.reverbWet).connect(n.width);

    // Stereo width: L' = L·(1+w)/2 + R·(1−w)/2, R' likewise.
    const wSplit = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    n.wLL = g(); n.wRL = g(); n.wLR = g(); n.wRR = g();
    n.width.connect(wSplit);
    wSplit.connect(n.wLL, 0).connect(merge, 0, 0);
    wSplit.connect(n.wRL, 1).connect(merge, 0, 0);
    wSplit.connect(n.wRR, 1).connect(merge, 0, 1);
    wSplit.connect(n.wLR, 0).connect(merge, 0, 1);

    n.master = g();
    merge.connect(n.master);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    n.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.applyEq();
    this.applyDj();
    this.setVocal(this.vocal);
  }

  ramp(param, value, t = 0.05) {
    param.setTargetAtTime(value, this.ctx.currentTime, t);
  }

  applyEq() {
    if (!this.ctx) return;
    const gains = this.settings.eqOn ? this.settings.eq : BANDS.map(() => 0);
    this.filters.forEach((f, i) => this.ramp(f.gain, gains[i] || 0, 0.04));
  }

  applyDj() {
    const dj = this.settings.dj;
    for (const deck of this.decks) deck.preservesPitch = deck.webkitPreservesPitch = dj.keepPitch;
    if (!this.ctx) return;
    const n = this.n;
    const f = Math.max(-100, Math.min(100, dj.filter)) / 100;
    if (f < 0) {
      n.djFilter.type = 'lowpass';
      this.ramp(n.djFilter.frequency, 20000 * 10 ** (-2.7 * -f));
    } else if (f > 0) {
      n.djFilter.type = 'highpass';
      this.ramp(n.djFilter.frequency, 20 * 10 ** (2.8 * f));
    } else {
      n.djFilter.type = 'lowpass';
      this.ramp(n.djFilter.frequency, 22000);
    }
    this.ramp(n.djFilter.Q, 0.7 + Math.abs(f) * 6);
    const e = dj.echo / 100;
    this.ramp(n.echoWet.gain, e * 0.6);
    this.ramp(n.feedback.gain, e ? 0.25 + e * 0.4 : 0);
    this.ramp(n.reverbWet.gain, (dj.reverb / 100) * 0.8);
    const w = dj.width / 100;
    this.ramp(n.wLL.gain, (1 + w) / 2);
    this.ramp(n.wRR.gain, (1 + w) / 2);
    this.ramp(n.wRL.gain, (1 - w) / 2);
    this.ramp(n.wLR.gain, (1 - w) / 2);
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
    if (on) {
      this.graphHold = false;
      this.initGraph();
    } else this.detachGraph();
  }

  setDj(patch) {
    Object.assign(this.settings.dj, patch);
    if ('reverb' in patch || 'width' in patch) this.settings.preset = this.isMelodySound() ? this.settings.preset : 'Eigene';
    this.saveSettings();
    this.applyDj();
    this.emit('sound');
  }

  // A full Melody sound: EQ + room + width. Live DJ effects reset so the profile sounds as intended.
  applySound(name) {
    const s = MELODY_SOUNDS[name];
    if (s) {
      this.settings.eq = [...s.eq];
      Object.assign(this.settings.dj, { filter: 0, echo: 0, reverb: s.reverb, width: s.width });
    } else if (EQ_PRESETS[name]) {
      this.settings.eq = [...EQ_PRESETS[name]];
    } else return;
    this.settings.preset = name;
    this.settings.eqOn = true;
    this.saveSettings();
    this.setFx(true);
    this.applyEq();
    this.applyDj();
    this.emit('sound');
  }

  isMelodySound() {
    const s = MELODY_SOUNDS[this.settings.preset];
    return !!s && s.eq.every((v, i) => v === this.settings.eq[i]) &&
      this.settings.dj.reverb === s.reverb && this.settings.dj.width === s.width;
  }

  // 0…100: how strongly centre vocals are removed (sing-along mode).
  setVocal(v) {
    this.vocal = v;
    if (!this.ctx) return;
    const k = v / 100;
    this.ramp(this.n.vDry.gain, 1 - k);
    this.ramp(this.n.vWet.gain, k);
  }

  // ---------- DJ pads ----------
  padEchoOut() {
    if (!this.ctx || this.mode !== 'library') return;
    const n = this.n;
    this.ramp(n.echoWet.gain, 0.8, 0.02);
    this.ramp(n.feedback.gain, 0.7, 0.02);
    this.ramp(n.dry.gain, 0, 0.08);
    setTimeout(() => {
      this.next();
      this.ramp(n.dry.gain, 1, 0.1);
      this.applyDj();
    }, 2400);
  }

  padSweep() {
    if (!this.ctx) return;
    const f = this.n.djFilter;
    const t = this.ctx.currentTime;
    f.type = 'highpass';
    f.Q.cancelScheduledValues(t);
    f.frequency.cancelScheduledValues(t);
    f.Q.setValueAtTime(6, t);
    f.frequency.setValueAtTime(30, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + 3.5);
    f.frequency.exponentialRampToValueAtTime(30, t + 4.2);
    setTimeout(() => this.applyDj(), 4300);
  }

  padBassKill() {
    if (!this.ctx) return;
    const [b1, b2, b3] = this.filters;
    for (const b of [b1, b2, b3]) this.ramp(b.gain, -24, 0.02);
    setTimeout(() => this.applyEq(), 1600);
  }

  padBrake() {
    if (this.mode !== 'library' || this.el.paused) return;
    const el = this.el;
    const start = el.playbackRate;
    el.preservesPitch = el.webkitPreservesPitch = false;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      el.playbackRate = Math.max(0.1, start * (1 - step / 16));
      if (step >= 16) {
        clearInterval(iv);
        el.pause();
        el.playbackRate = this.settings.rate;
        this.applyDj();
      }
    }, 70);
  }

  // ---------- Microphone (sing along) ----------
  async enableMic() {
    this.setFx(true);
    if (!this.ctx) throw new Error('Audio-Effekte werden auf diesem Gerät nicht unterstützt.');
    if (this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = 0.9;
    const verb = this.ctx.createConvolver();
    verb.buffer = impulseResponse(this.ctx, 1.4, 4);
    const verbGain = this.ctx.createGain();
    verbGain.gain.value = 0.35;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(gain).connect(this.ctx.destination);
    gain.connect(verb).connect(verbGain).connect(this.ctx.destination);
    src.connect(analyser);
    this.mic = { stream, gain, analyser, buf: new Float32Array(analyser.fftSize) };
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  disableMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach((t) => t.stop());
    this.mic.gain.disconnect();
    this.mic = null;
  }

  micLevel() {
    if (!this.mic) return 0;
    this.mic.analyser.getFloatTimeDomainData(this.mic.buf);
    let sum = 0;
    for (const v of this.mic.buf) sum += v * v;
    return Math.sqrt(sum / this.mic.buf.length);
  }

  // ---------- Library playback ----------
  cancelFade() {
    if (!this.fading) return;
    clearTimeout(this.fadeTimer);
    const other = this.decks[1 - this.d];
    other.pause();
    other.removeAttribute('src');
    this.setDeckLevel(1 - this.d, 1, 0);
    this.setDeckLevel(this.d, 1, 0);
    this.fading = false;
  }

  setDeckLevel(k, v, secs) {
    if (this.ctx) {
      const p = this.n.deckGains[k].gain;
      const t = this.ctx.currentTime;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(v, t + Math.max(secs, 0.01));
      return;
    }
    const deck = this.decks[k];
    clearInterval(deck._fadeIv);
    const target = v * this.settings.volume;
    if (!secs) { deck.volume = target; return; }
    const from = deck.volume;
    const steps = Math.max(1, Math.round(secs * 20));
    let i = 0;
    deck._fadeIv = setInterval(() => {
      i++;
      deck.volume = Math.min(1, Math.max(0, from + (target - from) * (i / steps)));
      if (i >= steps) clearInterval(deck._fadeIv);
    }, 50);
  }

  // Downloaded/imported audio plays from the device; catalog songs that aren't downloaded are streamed.
  async loadInto(k, id) {
    const blob = await db.get('files', id);
    const t = this.lookup(id);
    if (this.urls[k]) URL.revokeObjectURL(this.urls[k]);
    this.urls[k] = null;
    const deck = this.decks[k];
    if (blob) {
      this.urls[k] = URL.createObjectURL(blob);
      deck.src = this.urls[k];
    } else if (t?.url) {
      if (!navigator.onLine) {
        this.emit('error', `„${t.title}“ ist nicht heruntergeladen – offline nicht verfügbar.`);
        return false;
      }
      deck.src = t.url;
    } else {
      return false;
    }
    deck.defaultPlaybackRate = deck.playbackRate = this.settings.rate;
    deck.preservesPitch = deck.webkitPreservesPitch = this.settings.dj.keepPitch;
    return true;
  }

  async load(i, autoplay = true, startAt = 0) {
    if (i < 0 || i >= this.queue.length) return;
    if (this.ctx && foreign(this.lookup(this.queue[i]))) await this.detachGraph();
    const token = ++this.loadToken;
    this.cancelFade();
    this.stopRadio();
    this.index = i;
    const id = this.queue[i];
    const t = this.lookup(id);
    const ok = t && (await this.loadInto(this.d, id));
    if (token !== this.loadToken) return;
    if (!ok) {
      if (!(t?.url && !navigator.onLine)) this.emit('error', 'Titel nicht gefunden.');
      return;
    }
    this.track = t;
    this.setDeckLevel(this.d, 1, 0);
    if (startAt > 0) {
      const el = this.el;
      el.addEventListener('loadedmetadata', () => { el.currentTime = startAt; }, { once: true });
    }
    this.updateMetadata();
    this.emit('track', t);
    this.emit('queue');
    this.saveState();
    if (autoplay) {
      await this.play();
      this.countPlay(t);
    }
  }

  countPlay(t) {
    t.plays = (t.plays || 0) + 1;
    t.lastPlayed = Date.now();
    db.put('tracks', t).catch(() => {});
    this.emit('played', t);
  }

  checkCrossfade() {
    const cf = this.settings.dj.crossfade;
    if (!cf || this.fading || this.mode !== 'library' || this.repeat === 'one' || this.sleepAtEnd || this.el.paused) return;
    const d = this.el.duration;
    if (!isFinite(d) || d < cf * 2 + 2 || d - this.el.currentTime > cf) return;
    let next = this.index + 1;
    if (next >= this.queue.length) {
      if (this.repeat !== 'all') return;
      next = 0;
    }
    this.crossfadeTo(next);
  }

  async crossfadeTo(i) {
    if (this.ctx && foreign(this.lookup(this.queue[i]))) await this.detachGraph();
    this.fading = true;
    const token = ++this.loadToken;
    const from = this.d;
    const to = 1 - from;
    const id = this.queue[i];
    const t = this.lookup(id);
    const ok = t && (await this.loadInto(to, id));
    if (!ok || token !== this.loadToken) {
      this.fading = false;
      return;
    }
    const secs = this.settings.dj.crossfade;
    this.setDeckLevel(to, 0, 0);
    this.d = to;
    this.index = i;
    this.track = t;
    try {
      await this.decks[to].play();
    } catch {
      this.d = from;
      this.fading = false;
      return;
    }
    this.setDeckLevel(to, 1, secs);
    this.setDeckLevel(from, 0, secs);
    this.updateMetadata();
    this.emit('track', t);
    this.emit('queue');
    this.saveState();
    this.countPlay(t);
    this.fadeTimer = setTimeout(() => {
      const old = this.decks[from];
      old.pause();
      old.removeAttribute('src');
      if (this.urls[from]) URL.revokeObjectURL(this.urls[from]);
      this.urls[from] = null;
      this.setDeckLevel(from, 1, 0);
      this.fading = false;
    }, secs * 1000 + 150);
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
      else if (this.mode === 'podcast') this.emit('error', 'Folge nicht erreichbar – lade sie für unterwegs herunter.');
      else this.emit('error', 'Diese Datei kann auf diesem Gerät nicht abgespielt werden.');
    }
  }

  pause() {
    this.media.pause();
    if (this.fading) this.cancelFade();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  next(auto = false) {
    if (this.mode === 'radio') return;
    if (this.mode === 'podcast') return this.seek(this.radioEl.currentTime + 30);
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
    if (this.mode === 'podcast') return this.seek(this.radioEl.currentTime - 15);
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

  playList(ids, start = 0, startAt = 0) {
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
    return this.load(idx, true, startAt);
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

  // Reorder upcoming songs (the current one stays where it is).
  moveInQueue(from, to) {
    const n = this.queue.length;
    if (from === to || from <= this.index || to <= this.index || from >= n || to >= n) return;
    const [id] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, id);
    this.saveState();
    this.emit('queue');
  }

  // Remove a deleted track everywhere.
  forget(id) {
    const cur = this.currentId;
    this.queue = this.queue.filter((x) => x !== id);
    if (this.original) this.original = this.original.filter((x) => x !== id);
    if (cur === id) {
      this.cancelFade();
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
    if (this.mode === 'radio' || !isFinite(sec)) return;
    const m = this.media;
    m.currentTime = Math.max(0, Math.min(sec, m.duration || sec));
    this.updatePosition();
    if (this.mode === 'podcast') this.emit('podprogress');
  }

  // Podcasts have their own speed (often 1.25–2×), music keeps its own.
  setPodRate(r) {
    this.settings.podRate = r;
    this.radioEl.preservesPitch = this.radioEl.webkitPreservesPitch = true;
    if (this.mode === 'podcast') this.radioEl.playbackRate = r;
    this.saveSettings();
    this.updatePosition();
    this.emit('state');
  }

  // Lowers the music while the navigation voice speaks (or voice control listens).
  duck(on) {
    const f = on ? 0.25 : 1;
    this.ducked = on;
    if (this.ctx) {
      this.ramp(this.n.master.gain, f, 0.15);
    } else {
      for (const deck of this.decks) deck.volume = this.settings.volume * f;
    }
    this.radioEl.volume = this.settings.volume * f;
  }

  setVolume(v) {
    v = Math.min(v, this.volumeCap ?? 1); // Kinder-Modus: hearing protection limit
    this.settings.volume = v;
    for (const deck of this.decks) deck.volume = v;
    this.radioEl.volume = v;
    this.saveSettings();
  }

  setRate(r) {
    this.settings.rate = r;
    for (const deck of this.decks) deck.defaultPlaybackRate = deck.playbackRate = r;
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

  fadeOutAndPause(silent = false) {
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
        if (silent) return;
        this.sleepTimer = null;
        this.sleepUntil = 0;
        this.emit('sleep', 'done');
      }
    }, 250);
  }

  // ---------- Podcast episodes (played on the stream element, outside the music effects) ----------
  playEpisode(ep, pod, src, startAt = 0) {
    this.loadToken++;
    this.cancelFade();
    this.el.pause();
    if (this.mode === 'radio') this.radioEl.pause();
    this.mode = 'podcast';
    this.station = null;
    this.episode = { ep, pod };
    const el = this.radioEl;
    el.preload = 'auto';
    el.src = src;
    el.preservesPitch = el.webkitPreservesPitch = true;
    el.defaultPlaybackRate = el.playbackRate = this.settings.podRate || 1;
    if (startAt > 5) el.addEventListener('loadedmetadata', () => { el.currentTime = startAt; }, { once: true });
    this.updateMetadata();
    this.emit('track', null);
    return this.play();
  }

  // ---------- Radio ----------
  playRadio(station) {
    this.loadToken++;
    this.cancelFade();
    this.el.pause();
    this.episode = null;
    this.radioEl.preload = 'none';
    this.mode = 'radio';
    this.station = station;
    this.radioEl.src = station.url;
    this.updateMetadata();
    this.emit('track', null);
    this.play();
  }

  stopRadio() {
    if (this.mode === 'library') return;
    if (this.mode === 'podcast') this.emit('podprogress');
    this.episode = null;
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
      seekbackward: (d) => this.seek(this.media.currentTime - (d.seekOffset || (this.mode === 'podcast' ? 15 : 10))),
      seekforward: (d) => this.seek(this.media.currentTime + (d.seekOffset || (this.mode === 'podcast' ? 30 : 10))),
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(k, fn); } catch { /* unsupported action */ }
    }
  }

  updateMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const fallback = [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }];
    if (this.mode === 'podcast' && this.episode) {
      const img = this.episode.ep.image || this.episode.pod.image;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.episode.ep.title, artist: this.episode.pod.title, album: 'Podcast',
        artwork: img ? [{ src: img, sizes: '512x512' }] : fallback,
      });
      return;
    }
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
      artwork: cover ? [{ src: cover, sizes: '512x512', type: t.cover?.type || 'image/jpeg' }] : fallback,
    });
  }

  updatePosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const m = this.media;
    const d = m.duration;
    if (!isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d, playbackRate: m.playbackRate || 1, position: Math.min(m.currentTime, d),
      });
    } catch { /* ignore */ }
  }
}

export const player = new Player();
export { shuffled, isIOS };
