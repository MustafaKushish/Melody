import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, checkInput, setFeedback, deloadState, checkPlan, newPlanFrom, TEMPLATES, nextDay, readinessWarnings, weekStreak, EXERCISES } from '../js/trainer.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 11, 12);
const sess = (daysAgo, ex, sets, extra = {}) => ({ at: NOW - daysAgo * DAY, entries: [{ ex, sets: sets.map(([kg, reps, rir = 2]) => ({ kg, reps, rir })) }], ...extra });
const item = { ex: 'bankdruecken', sets: 3 };

test('Neue Übung: kein Gewicht vorgegeben, Hinweis zum leichten Einstieg', () => {
  const s = suggest('bankdruecken', item, [], { now: NOW });
  assert.equal(s.trend, 'new');
  assert.equal(s.kg, 0);
  assert.match(s.note, /leicht/);
});

test('Alle Sätze am oberen Ende → kleiner Gewichtsschritt', () => {
  const log = [sess(3, 'bankdruecken', [[60, 10], [60, 10], [60, 10]])];
  const s = suggest('bankdruecken', item, log, { now: NOW });
  assert.equal(s.trend, 'up');
  assert.equal(s.kg, 62.5);
  assert.equal(s.aim, 6);
});

test('Oben angekommen, aber am Limit → nicht steigern', () => {
  const log = [sess(3, 'bankdruecken', [[60, 10, 1], [60, 10, 0], [60, 10, 0]])];
  assert.equal(suggest('bankdruecken', item, log, { now: NOW }).kg, 60);
});

test('Im Zielbereich → gleiches Gewicht, eine Wiederholung mehr', () => {
  const log = [sess(3, 'bankdruecken', [[60, 8], [60, 8], [60, 7]])];
  const s = suggest('bankdruecken', item, log, { now: NOW });
  assert.equal(s.kg, 60);
  assert.equal(s.aim, 9);
});

test('Zweimal unter dem Ziel → 10 % leichter', () => {
  const log = [sess(3, 'bankdruecken', [[80, 5], [80, 4], [80, 4]]), sess(6, 'bankdruecken', [[80, 5], [80, 5], [80, 4]])];
  const s = suggest('bankdruecken', item, log, { now: NOW });
  assert.equal(s.trend, 'down');
  assert.equal(s.kg, 72.5);
});

test('Lange Pause → leichter einsteigen', () => {
  const log = [sess(30, 'bankdruecken', [[60, 8], [60, 8], [60, 8]])];
  assert.equal(suggest('bankdruecken', item, log, { now: NOW }).kg, 47.5);
});

test('Leichte Woche: weniger Sätze und Gewicht', () => {
  const log = [sess(3, 'bankdruecken', [[60, 8], [60, 8], [60, 8]])];
  const s = suggest('bankdruecken', item, log, { now: NOW, deload: true });
  assert.equal(s.sets, 2);
  assert.equal(s.kg, 55);
});

test('Körpergewicht: Fortschritt über Wiederholungen', () => {
  const log = [sess(2, 'liegestuetze', [[0, 15], [0, 15], [0, 16]])];
  const s = suggest('liegestuetze', { ex: 'liegestuetze', sets: 3 }, log, { now: NOW });
  assert.equal(s.trend, 'up');
  assert.equal(s.kg, 0);
  assert.ok(s.aim > 15);
});

test('Tippfehler beim Gewicht wird erkannt und korrigiert', () => {
  const log = [sess(3, 'bankdruecken', [[80, 8]])];
  const r = checkInput('bankdruecken', 800, 8, log);
  assert.equal(r.ok, false);
  assert.equal(r.fix.kg, 80);
  assert.equal(checkInput('bankdruecken', 82.5, 8, log).ok, true);
  assert.match(checkInput('bankdruecken', 100, 8, log).warn, /Großer Sprung/);
  assert.equal(checkInput('bankdruecken', 80, 0, log).ok, false);
  // Without history, the sets of today are the reference.
  const r2 = checkInput('kniebeuge', 600, 10, [], {}, [{ kg: 60, reps: 10 }]);
  assert.equal(r2.ok, false);
  assert.equal(r2.fix.kg, 60);
});

test('Feedback nach dem Satz: zu leicht, zu schwer, Rekord', () => {
  const sug = { sets: 3, reps: [6, 10] };
  const light = setFeedback('bankdruecken', { kg: 60, reps: 15, rir: 3 }, [], sug, [], { now: NOW });
  assert.equal(light.next.kg, 62.5);
  const heavy = setFeedback('bankdruecken', { kg: 60, reps: 3, rir: 0 }, [], sug, [], { now: NOW });
  assert.ok(heavy.next.kg < 60);
  assert.ok(heavy.msgs.some((m) => m.t === 'warn'));
  const log = [sess(3, 'bankdruecken', [[60, 8]])];
  const pr = setFeedback('bankdruecken', { kg: 65, reps: 8, rir: 1 }, [], sug, log, { now: NOW });
  assert.ok(pr.msgs.some((m) => m.t === 'pr'));
});

test('Leichte Woche wird nach 6 Wochen am Stück empfohlen', () => {
  const log = [];
  for (let d = 1; d <= 45; d += 3) log.push(sess(d, 'kniebeuge', [[60, 8]]));
  assert.equal(deloadState(log, NOW).due, true);
  assert.equal(deloadState(log.slice(0, 5), NOW).due, false);
  log.unshift({ ...sess(0.5, 'kniebeuge', [[50, 8]]), deload: true });
  assert.equal(deloadState(log, NOW).due, false);
});

test('Viele Sätze am Limit → Erholung empfohlen', () => {
  const log = [1, 3, 5].map((d) => sess(d, 'kniebeuge', [[60, 8, 0], [60, 8, 0], [60, 7, 0], [60, 6, 1]]));
  assert.equal(deloadState(log, NOW).due, true);
});

test('Vorlagen sind ausgewogen, Planprüfung findet Fehler', () => {
  for (const tpl of TEMPLATES) {
    const plan = newPlanFrom(tpl);
    for (const d of plan.days) for (const it of d.items) assert.ok(EXERCISES[it.ex], `${it.ex} fehlt`);
    const w = checkPlan(plan, { level: tpl.level });
    assert.ok(!w.some((x) => x.t === 'warn'), `${tpl.name}: ${JSON.stringify(w)}`);
  }
  const bad = { perWeek: 7, days: [{ name: 'Tag A', items: [{ ex: 'bankdruecken', sets: 8 }, { ex: 'butterfly', sets: 8 }, { ex: 'schraegbank-kh', sets: 8 }, { ex: 'bizepscurls', sets: 4 }] }] };
  const w = checkPlan(bad).map((x) => x.text).join('\n');
  assert.match(w, /Brust/);
  assert.match(w, /Beine fehlen/);
  assert.match(w, /Rücken/);
  assert.match(w, /Ruhetage/);
});

test('Nächster Trainingstag rotiert, Erholung wird geprüft', () => {
  const plan = newPlanFrom(TEMPLATES[0], 'p1');
  assert.equal(nextDay(plan, []), 0);
  assert.equal(nextDay(plan, [{ planId: 'p1', dayIdx: 0, at: NOW }]), 1);
  assert.equal(nextDay(plan, [{ planId: 'p1', dayIdx: 1, at: NOW }]), 0);
  const w = readinessWarnings(plan.days[0], [sess(1, 'beinpresse', [[100, 10]])], { now: NOW });
  assert.match(w.join(), /Beine/);
  assert.equal(readinessWarnings(plan.days[0], [sess(3, 'beinpresse', [[100, 10]])], { now: NOW }).length, 0);
});

test('Wochen-Serie', () => {
  assert.equal(weekStreak([NOW, NOW - 7 * DAY, NOW - 14 * DAY], NOW), 3);
  assert.equal(weekStreak([NOW - 21 * DAY], NOW), 0);
});
