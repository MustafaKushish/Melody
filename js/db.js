// Minimal IndexedDB wrapper. Stores:
//  tracks    – metadata (+ cover blob), keyPath id
//  files     – audio blobs keyed by track id (kept apart so listing stays cheap)
//  playlists – { id, name, trackIds, createdAt }
const DB_NAME = 'melody';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(stores, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    let result;
    const r = fn(tx);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  all: (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll()),
  get: (store, key) => run(store, 'readonly', (tx) => tx.objectStore(store).get(key)),
  put: (store, value, key) => run(store, 'readwrite', (tx) => tx.objectStore(store).put(value, key)),
  del: (store, key) => run(store, 'readwrite', (tx) => tx.objectStore(store).delete(key)),
  clear: (store) => run(store, 'readwrite', (tx) => tx.objectStore(store).clear()),
  addTrack: (track, blob) =>
    run(['tracks', 'files'], 'readwrite', (tx) => {
      tx.objectStore('tracks').put(track);
      tx.objectStore('files').put(blob, track.id);
    }),
  deleteTrack: (id) =>
    run(['tracks', 'files'], 'readwrite', (tx) => {
      tx.objectStore('tracks').delete(id);
      tx.objectStore('files').delete(id);
    }),
};

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
