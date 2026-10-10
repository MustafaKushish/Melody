import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt } from '../js/receipt.js';
import { matchProduct, isNonFood } from '../js/products.js';
import { makeItem, openItem, status, stats, parseFreeText, addDays, daysBetween } from '../js/pantry.js';
import { suggest } from '../js/recipes.js';
import { calendarFile, shareText } from '../js/share.js';
import { createStore } from '../js/store.js';

const T = '2026-10-10';

test('REWE-Bon: Mengen, Gewicht, Rabatt, Pfand und Non-Food', () => {
  const bon = `REWE Markt GmbH
Hauptstr. 12, 10115 Berlin
EUR
BIO BANANE 1,99 B
JA! H-MILCH 3,5% 1,98 B
  2 Stk x 0,99
GOUDA JUNG SCHEIBEN 1,79 B
PFAND 0,25 EURO 0,25 A
RISPENTOMATEN 2,09 B
  0,824 kg x 2,54 EUR/kg
SPUELMITTEL 1,29 A
HAEHNCHENBRUSTFILET 5,49 B
Rabatt -0,50 B
--------------------------------------
SUMME EUR 13,30
Geg. EC-Cash EUR 13,30
Datum: 08.10.2026 Uhrzeit: 18:32`;
  const r = parseReceipt(bon);
  assert.equal(r.store, 'REWE');
  assert.equal(r.date, '2026-10-08');
  assert.deepEqual(r.items.map((i) => i.pid), ['bananen', 'hmilch', 'kaese', 'tomaten', 'haehnchen']);
  const milk = r.items[1];
  assert.equal(milk.qty, 2);
  assert.equal(milk.price, 0.99);
  assert.equal(r.items[3].weight, 0.824);
  assert.equal(r.items[4].price, 4.99);
});

test('Lidl-Bon mit Texterkennungs-Fehlern', () => {
  const r = parseReceipt(`LIDL
Bio Bananen 1,49 A
Joghurt mild 0,49 x 2 0,98 A
Lauchzwiebeln O,79 A
Eier Bodenh. M 10St 1 ,99 A
Kidney Bohnen 0,79 A
RISPENTOMATEN 2,099 B
Muellbeutel 1,29 A
zu zahlen 6,33`);
  assert.equal(r.store, 'LIDL');
  assert.deepEqual(r.items.map((i) => [i.pid, i.qty, i.price]), [
    ['bananen', 1, 1.49], ['joghurt', 2, 0.49], ['fruehlingszwiebeln', 1, 0.79], ['eier', 1, 1.99], ['bohnen', 1, 0.79], ['tomaten', 1, 2.09],
  ]);
});

test('Produkterkennung: Wortende zählt (deutsche Komposita)', () => {
  assert.equal(matchProduct('Erdbeerjoghurt').id, 'joghurt');
  assert.equal(matchProduct('Vollmilchschokolade').id, 'schokolade');
  assert.equal(matchProduct('Basmati Reis').id, 'reis');
  assert.equal(matchProduct('Blumenkohl').id, 'blumenkohl');
  assert.equal(matchProduct('Schinken Scheiben').id, 'schinken');
  assert.equal(matchProduct('Eier').id, 'eier');
  assert.equal(matchProduct('Bleistift'), null);
  assert.ok(isNonFood('Küchenrolle 4x'));
  assert.ok(!isNonFood('Creme fraiche'));
  assert.ok(!isNonFood('Blumenkohl'));
});

test('Haltbarkeit wird geschätzt, Anbrechen verkürzt sie', () => {
  const milk = makeItem({ name: 'Milch' }, T);
  assert.equal(milk.expires, addDays(T, 7));
  const hmilk = makeItem({ name: 'H-Milch' }, T);
  assert.equal(daysBetween(T, hmilk.expires), 90);
  assert.equal(openItem(hmilk, T).expires, addDays(T, 4));
  assert.equal(makeItem({ name: 'Gartenkresse vom Markt' }, T).expires, addDays(T, 7));
  assert.equal(makeItem({ name: 'Erdbeerjoghurt' }, T).name, 'Erdbeerjoghurt');
  assert.equal(makeItem({ name: 'ERDBEERJOGHURT', source: 'bon' }, T).name, 'Joghurt');
});

test('Status: MHD vs. Verbrauchsdatum', () => {
  const hack = { ...makeItem({ name: 'Hackfleisch' }, T), expires: addDays(T, -1) };
  assert.equal(status(hack, T).level, 'over');
  assert.equal(status(hack, T).vd, true);
  assert.equal(status({ ...hack, expires: T }, T).label, 'heute');
  assert.equal(status({ ...hack, expires: addDays(T, 1) }, T).label, 'morgen');
});

test('Freitext und Sprache', () => {
  assert.deepEqual(parseFreeText('2 Liter Milch, sechs Eier und ein paar Tomaten, 500 g Hackfleisch'), [
    { name: 'Milch', qty: 2 }, { name: 'Eier', qty: 6 }, { name: 'Tomaten', qty: 3 }, { name: 'Hackfleisch', qty: 1 },
  ]);
  assert.deepEqual(parseFreeText('brot'), [{ name: 'Brot', qty: 1 }]);
});

test('Rezepte bevorzugen Ablaufendes und benennen sich nach den Resten', () => {
  const mk = (name, d) => ({ ...makeItem({ name }, T), expires: addDays(T, d) });
  const items = [mk('Zucchini', 1), mk('Paprika', 2), mk('Eier', 10), mk('Gouda', 8), mk('Nudeln', 200), mk('Zwiebeln', 20)];
  const top = suggest(items, { today: T });
  assert.ok(top.length > 2);
  assert.ok(top[0].urgent.some((i) => i.name === 'Zucchini'));
  const frittata = top.find((r) => r.id === 'frittata');
  assert.equal(frittata.title, 'Frittata mit Zucchini & Paprika');
  assert.deepEqual(frittata.missing, []);
  // Abgelaufenes Hackfleisch wird nie vorgeschlagen
  const old = suggest([mk('Hackfleisch', -1), mk('Nudeln', 200), mk('Dosentomaten', 200)], { today: T });
  assert.ok(old.every((r) => r.uses.every((i) => i.pid !== 'hackfleisch')));
});

test('Bilanz rechnet gerettet vs. weggeworfen', () => {
  const log = [
    { name: 'Salat', pid: 'salat', cat: 'gemuese', qty: 1, price: 1.29, action: 'wasted', date: T },
    { name: 'Milch', pid: 'milch', cat: 'milch', qty: 1, price: 1.19, action: 'used', date: T },
    { name: 'Brot', pid: 'brot', cat: 'brot', qty: 1, price: 2.49, action: 'shared', date: T },
    { name: 'Alt', pid: null, cat: 'sonst', qty: 1, price: 9, action: 'wasted', date: '2025-01-01' },
  ];
  const s = stats(log, T);
  assert.equal(s.saved, 2);
  assert.equal(s.wasted, 1);
  assert.equal(s.rate, 67);
  assert.equal(s.wastedEuro, 1.29);
  assert.deepEqual(s.topWasted, [['Salat', 1]]);
});

test('Store: Hinzufügen, Verbrauchen, Rückgängig, Einkaufsliste → Vorrat', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const store = createStore(storage);
  const [eggs] = store.add([{ name: 'Eier', qty: 6 }], 'hand');
  const undo = store.consume(eggs.id, 'used', 2);
  assert.equal(store.find(eggs.id).qty, 4);
  assert.equal(store.state.log.length, 1);
  undo();
  assert.equal(store.find(eggs.id).qty, 6);
  assert.equal(store.state.log.length, 0);
  store.addShopping('Milch');
  store.addShopping('milch');
  assert.equal(store.state.shopping[0].qty, 2);
  store.toggleShopping(store.state.shopping[0].id);
  store.shoppingToPantry();
  assert.equal(store.state.shopping.length, 0);
  assert.equal(store.items().find((i) => i.pid === 'milch').qty, 2);
  // Neu laden aus dem Speicher
  assert.equal(createStore(storage).items().length, 2);
});

test('Teilen-Text und Kalender-Erinnerungen', () => {
  const items = [{ ...makeItem({ name: 'Joghurt', qty: 2 }, T), expires: addDays(T, 2) }];
  assert.match(shareText(items, 'Müller, 3. OG'), /2× Joghurt \(gut bis 12\.10\.\)[\s\S]*Müller, 3\. OG/);
  const ics = calendarFile(items, T);
  assert.match(ics, /DTSTART:20261011T180000/);
  assert.match(ics, /Joghurt läuft morgen ab/);
  assert.equal(calendarFile([{ ...items[0], expires: addDays(T, 60) }], T), null);
});
