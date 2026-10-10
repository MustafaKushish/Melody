// Speichert alles lokal auf dem Gerät (localStorage). Kein Konto, keine Cloud – Daten bleiben beim Nutzer.
import { iso, uid, makeItem, sortByExpiry } from './pantry.js';

const KEY = 'restlos:v1';
const EMPTY = () => ({ items: [], log: [], shopping: [], settings: { flat: '', veg: false, notified: '' } });

export function createStore(storage = globalThis.localStorage) {
  let state = EMPTY();
  try {
    const raw = storage?.getItem(KEY);
    if (raw) state = { ...EMPTY(), ...JSON.parse(raw) };
    state.settings = { ...EMPTY().settings, ...state.settings };
  } catch { /* privater Modus oder kaputte Daten: leer starten */ }
  const listeners = new Set();
  const save = () => {
    try { storage?.setItem(KEY, JSON.stringify(state)); } catch { /* Speicher voll oder gesperrt */ }
    listeners.forEach((fn) => fn(state));
  };

  const api = {
    get state() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    items: () => sortByExpiry(state.items),
    find: (id) => state.items.find((i) => i.id === id),

    add(entries, source) {
      const today = iso();
      const added = entries.map((e) => makeItem({ ...e, source: e.source || source }, today));
      state.items.push(...added);
      save();
      return added;
    },
    update(id, patch) {
      state.items = state.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
      save();
    },
    // action: 'used' (aufgegessen), 'wasted' (weggeworfen), 'shared' (verschenkt), 'removed' (falsch eingetragen)
    consume(id, action, qty) {
      const item = api.find(id);
      if (!item) return null;
      const n = Math.min(qty ?? item.qty, item.qty);
      const before = structuredClone(state);
      if (action !== 'removed') {
        state.log.push({ id: uid(), name: item.name, pid: item.pid, cat: item.cat, qty: n, price: item.price, action, date: iso() });
      }
      if (n >= item.qty) state.items = state.items.filter((i) => i.id !== id);
      else state.items = state.items.map((i) => (i.id === id ? { ...i, qty: i.qty - n } : i));
      save();
      return () => { state = before; save(); }; // Rückgängig
    },

    addShopping(name, qty = 1) {
      const existing = state.shopping.find((s) => s.name.toLowerCase() === name.toLowerCase() && !s.done);
      if (existing) existing.qty += qty;
      else state.shopping.push({ id: uid(), name, qty, done: false });
      save();
    },
    toggleShopping(id) {
      state.shopping = state.shopping.map((s) => (s.id === id ? { ...s, done: !s.done } : s));
      save();
    },
    removeShopping(id) {
      state.shopping = state.shopping.filter((s) => s.id !== id);
      save();
    },
    // Abgehakte Einkäufe wandern direkt in den Vorrat – Einkaufszettel statt Kassenbon.
    shoppingToPantry() {
      const done = state.shopping.filter((s) => s.done);
      state.shopping = state.shopping.filter((s) => !s.done);
      return api.add(done.map((s) => ({ name: s.name, qty: s.qty })), 'liste');
    },

    setting(key, value) {
      state.settings[key] = value;
      save();
    },
    exportJson: () => JSON.stringify(state, null, 1),
    importJson(text) {
      const data = JSON.parse(text);
      if (!Array.isArray(data.items)) throw new Error('Keine Restlos-Sicherung');
      state = { ...EMPTY(), ...data, settings: { ...EMPTY().settings, ...data.settings } };
      save();
    },
    reset() { state = EMPTY(); save(); },
  };
  return api;
}
