// Vorrat: Datumsrechnung, Haltbarkeit, Dringlichkeit und Bilanz. Ohne DOM, damit es testbar bleibt.
import { CATS, byId, matchProduct } from './products.js';

// Datum immer als 'JJJJ-MM-TT' in Ortszeit – so verschiebt keine Zeitumstellung einen Tag.
export const iso = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
const utc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (s, n) => new Date(utc(s) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Baut einen Vorrats-Eintrag. Ohne bekanntes Produkt gelten die Werte der Kategorie (Standard: 7 Tage).
export function makeItem({ name, pid, qty = 1, price, bought, expires, source = 'hand', raw }, today = iso()) {
  const p = pid ? byId[pid] : matchProduct(name);
  const cat = p?.cat ?? 'sonst';
  const day = bought || today;
  return {
    id: uid(),
    pid: p?.id ?? null,
    // Kassenbons sind kryptisch („JA! H-MILCH 3,5%“) – dann lieber den sauberen Produktnamen.
    name: (source === 'bon' && p ? p.name : name) || p?.name || 'Unbekannt',
    emoji: p?.emoji ?? CATS[cat].emoji,
    cat,
    place: p?.place ?? CATS[cat].place,
    qty: Math.max(1, Math.round(qty) || 1),
    price: price ?? p?.price ?? CATS[cat].price,
    bought: day,
    expires: expires || addDays(day, p?.days ?? 7),
    opened: null,
    source,
    ...(raw ? { raw } : {}),
  };
}

// Angebrochen: läuft dann oft deutlich früher ab (z. B. Milch nach 4 Tagen).
export function openItem(item, today = iso()) {
  const p = item.pid && byId[item.pid];
  const days = p?.open ?? (p ? Math.min(p.days, 5) : 4);
  const exp = addDays(today, days);
  return { ...item, opened: today, expires: exp < item.expires ? exp : item.expires };
}

export const daysLeft = (item, today = iso()) => daysBetween(today, item.expires);

export function status(item, today = iso()) {
  const d = daysLeft(item, today);
  const vd = item.pid && byId[item.pid]?.vd;
  if (d < 0) return { level: 'over', d, vd, label: d === -1 ? 'seit gestern drüber' : `seit ${-d} Tagen drüber` };
  if (d === 0) return { level: 'today', d, vd, label: 'heute' };
  if (d === 1) return { level: 'soon', d, vd, label: 'morgen' };
  if (d <= 3) return { level: 'soon', d, vd, label: `noch ${d} Tage` };
  if (d <= 7) return { level: 'week', d, vd, label: `noch ${d} Tage` };
  if (d <= 60) return { level: 'ok', d, vd, label: d < 14 ? `noch ${d} Tage` : `noch ${Math.round(d / 7)} Wochen` };
  return { level: 'ok', d, vd, label: d < 365 ? `noch ${Math.round(d / 30)} Monate` : 'lange haltbar' };
}

// Wie dringend sollte etwas weg? Für Rezeptvorschläge.
export function urgency(item, today = iso()) {
  const d = daysLeft(item, today);
  if (d <= 1) return 6;
  if (d <= 3) return 4;
  if (d <= 6) return 2;
  return 0.5;
}

export const sortByExpiry = (items) => [...items].sort((a, b) => a.expires.localeCompare(b.expires) || a.name.localeCompare(b.name));

export function co2Of(entry) {
  const p = entry.pid && byId[entry.pid];
  return (p?.co2 ?? CATS[entry.cat]?.co2 ?? 0.5) * (entry.qty || 1);
}

// Bilanz aus dem Verlauf: gerettet = aufgegessen oder verschenkt.
export function stats(log, today = iso(), days = 30) {
  const from = addDays(today, -days + 1);
  const recent = log.filter((e) => e.date >= from);
  const sum = (arr, f) => arr.reduce((s, e) => s + f(e), 0);
  const saved = recent.filter((e) => e.action === 'used' || e.action === 'shared');
  const wasted = recent.filter((e) => e.action === 'wasted');
  const shared = recent.filter((e) => e.action === 'shared');
  const count = (arr) => sum(arr, (e) => e.qty || 1);
  const total = count(saved) + count(wasted);
  const top = {};
  for (const e of wasted) top[e.name] = (top[e.name] || 0) + (e.qty || 1);
  return {
    saved: count(saved),
    wasted: count(wasted),
    shared: count(shared),
    rate: total ? Math.round((count(saved) / total) * 100) : null,
    wastedEuro: sum(wasted, (e) => (e.price || 0) * (e.qty || 1)),
    savedEuro: sum(saved, (e) => (e.price || 0) * (e.qty || 1)),
    wastedCo2: sum(wasted, co2Of),
    savedCo2: sum(saved, co2Of),
    topWasted: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}

// Freitext und Sprache: „2 Liter Milch, 6 Eier und Tomaten“ → [{name:'Milch',qty:2}, …]
const NUMS = { ein: 1, eine: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, zwölf: 12, paar: 3 };
const UNIT = /^(st(ü|ue)?c?k?|stk|x|packung(en)?|packs?|pck|pkg|flaschen?|becher|dosen?|gl(ä|ae)ser|glas|beutel|netze?|bund|kopf|k(ö|oe)pfe|schalen?|tafeln?|kg|kilo|g|gr|gramm|l|liter|ml)$/i;
const SMALL = /^(g|gr|gramm|ml)$/i;

export function parseFreeText(text) {
  return String(text)
    .split(/\s*(?:,|;|\n|\bund\b|\bsowie\b|\bplus\b)\s*/i)
    .map((part) => part.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean)
    .map((part) => {
      const words = part.split(/\s+/);
      let qty = 1;
      const first = words[0].toLowerCase();
      if (/^\d+([.,]\d+)?$/.test(first)) { qty = parseFloat(first.replace(',', '.')); words.shift(); }
      else if (first === 'ein' && words[1]?.toLowerCase() === 'paar') { qty = 3; words.splice(0, 2); }
      else if (NUMS[first] && words.length > 1) { qty = NUMS[first]; words.shift(); }
      if (words.length > 1 && UNIT.test(words[0])) {
        if (SMALL.test(words[0]) || qty > 12 || qty % 1) qty = 1;
        words.shift();
      }
      if (words[0]?.toLowerCase() === 'von' || words[0]?.toLowerCase() === 'mit') words.shift();
      const name = words.join(' ').replace(/^\w/, (c) => c.toUpperCase());
      return { name, qty: Math.max(1, Math.round(qty)) };
    })
    .filter((x) => x.name.length > 1);
}
