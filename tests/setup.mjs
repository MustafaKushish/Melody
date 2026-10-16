if (typeof globalThis.Audio === 'undefined') {
  globalThis.Audio = class {
    addEventListener() {}
    removeEventListener() {}
    load() {}
    play() { return Promise.resolve(); }
    pause() {}
    setAttribute() {}
    getAttribute() { return null; }
  };
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { onLine: true, userAgent: '', platform: '', maxTouchPoints: 0 };
}
