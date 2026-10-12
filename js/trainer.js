// Personal trainer for the fitness mode: exercises, plans, set logging, tips & corrections, progression.
// Pure logic without DOM access (tested in Node). Progression is deliberately cautious: small steps,
// automatic deloads and recovery checks, so training develops without overloading the person.

export const MUSCLES = { brust: 'Brust', ruecken: 'Rücken', schultern: 'Schultern', beine: 'Beine', po: 'Po', arme: 'Arme', bauch: 'Bauch' };

// kind: c = Grundübung (mehrere Gelenke), i = Isolationsübung. step = kleinster sinnvoller Gewichtssprung (kg).
// unit 's' = gehalten in Sekunden statt Wiederholungen. bw = Körpergewicht (Fortschritt über Wiederholungen).
const X = (name, muscle, kind, step, cues, extra = {}) => ({ name, muscle, kind, step, cues, ...extra });
export const EXERCISES = {
  kniebeuge: X('Kniebeuge', 'beine', 'c', 2.5, ['Füße schulterbreit, Knie zeigen in Richtung Zehen.', 'Brust raus, Rücken gerade – der Blick bleibt nach vorn.', 'Mindestens bis die Oberschenkel waagerecht sind, Fersen bleiben am Boden.']),
  beinpresse: X('Beinpresse', 'beine', 'c', 5, ['Unterer Rücken bleibt fest am Polster.', 'Knie oben nicht ganz durchstrecken.', 'Langsam ablassen, kräftig wegdrücken.']),
  ausfallschritte: X('Ausfallschritte', 'beine', 'c', 2, ['Großer Schritt, das hintere Knie geht fast bis zum Boden.', 'Vorderes Knie bleibt über dem Fuß, nicht nach innen.', 'Oberkörper aufrecht halten.']),
  'rum-kreuzheben': X('Rumänisches Kreuzheben', 'beine', 'c', 2.5, ['Hüfte nach hinten schieben, Knie nur leicht gebeugt.', 'Stange eng an den Beinen entlang führen.', 'Rücken bleibt gerade – nur so tief, wie es ohne Rundrücken geht.']),
  kreuzheben: X('Kreuzheben', 'ruecken', 'c', 2.5, ['Stange über der Fußmitte, Schienbeine fast an der Stange.', 'Vor dem Heben Rücken anspannen und tief einatmen.', 'Nie mit rundem Rücken ziehen – lieber leichter.'], { rest: 180 }),
  beinstrecker: X('Beinstrecker', 'beine', 'i', 2.5, ['Oben kurz halten, langsam ablassen.', 'Nicht mit Schwung arbeiten.']),
  beinbeuger: X('Beinbeuger', 'beine', 'i', 2.5, ['Hüfte bleibt auf dem Polster.', 'Volle Bewegung, langsam zurück.']),
  wadenheben: X('Wadenheben', 'beine', 'i', 2.5, ['Unten kurz dehnen, oben 1 Sekunde halten.', 'Nicht wippen.']),
  'hip-thrust': X('Hip Thrust', 'po', 'c', 2.5, ['Kinn leicht zur Brust, Rippen unten lassen.', 'Oben den Po fest anspannen, nicht ins Hohlkreuz.']),
  'glute-bridge': X('Glute Bridge', 'po', 'i', 2, ['Fersen nah am Po, oben 2 Sekunden halten.', 'Bauch fest, kein Hohlkreuz.'], { bw: true }),
  bankdruecken: X('Bankdrücken', 'brust', 'c', 2.5, ['Schulterblätter zusammen und nach unten ziehen.', 'Stange kontrolliert zur unteren Brust, Ellbogen etwa 45° vom Körper.', 'Füße fest am Boden, Po bleibt auf der Bank.']),
  'schraegbank-kh': X('Schrägbankdrücken (Kurzhanteln)', 'brust', 'c', 2, ['Bank auf etwa 30° stellen.', 'Hanteln unten tief, oben nicht zusammenschlagen.']),
  liegestuetze: X('Liegestütze', 'brust', 'c', 0, ['Körper bleibt ein Brett – Po nicht hoch, nicht durchhängen.', 'Ellbogen leicht am Körper, Brust bis knapp über den Boden.', 'Zu schwer? Erst an einer Bank oder auf den Knien.'], { bw: true }),
  butterfly: X('Butterfly', 'brust', 'i', 2.5, ['Ellbogen leicht gebeugt lassen.', 'Langsam öffnen, in der Dehnung nicht wippen.']),
  dips: X('Dips', 'brust', 'c', 0, ['Schultern weg von den Ohren.', 'Nur so tief, wie es in der Schulter angenehm ist.'], { bw: true }),
  klimmzuege: X('Klimmzüge', 'ruecken', 'c', 0, ['Aus dem Hang starten, Schulterblätter zuerst nach unten ziehen.', 'Kein Schwung – zu schwer? Mit Band oder Maschine helfen lassen.'], { bw: true }),
  latzug: X('Latzug', 'ruecken', 'c', 2.5, ['Stange zur oberen Brust ziehen, nicht in den Nacken.', 'Oberkörper nur leicht zurücklehnen.', 'Oben ganz lang werden lassen.']),
  'rudern-lh': X('Langhantelrudern', 'ruecken', 'c', 2.5, ['Oberkörper etwa 45° vorgebeugt, Rücken gerade.', 'Stange zum Bauchnabel ziehen, Ellbogen nah am Körper.']),
  'rudern-kh': X('Kurzhantelrudern (einarmig)', 'ruecken', 'c', 2, ['Hand und Knie auf der Bank, Rücken flach.', 'Ellbogen nach hinten Richtung Hüfte ziehen.']),
  kabelrudern: X('Rudern am Kabel', 'ruecken', 'c', 2.5, ['Brust raus, Schulterblätter am Ende zusammenziehen.', 'Nicht mit dem Oberkörper schaukeln.']),
  tischrudern: X('Rudern unter dem Tisch', 'ruecken', 'c', 0, ['Unter einen stabilen Tisch legen, Kante greifen, Körper gerade.', 'Brust zur Tischkante ziehen. Je flacher du liegst, desto schwerer.'], { bw: true }),
  superman: X('Superman', 'ruecken', 'i', 0, ['Auf dem Bauch: Arme und Beine leicht anheben, 2 Sekunden halten.', 'Blick zum Boden, Nacken lang.'], { bw: true }),
  'face-pulls': X('Face Pulls', 'schultern', 'i', 2.5, ['Seil Richtung Stirn ziehen, Ellbogen hoch.', 'Gut für gesunde Schultern – leicht und sauber.']),
  schulterdruecken: X('Schulterdrücken', 'schultern', 'c', 2.5, ['Bauch und Po fest, kein Hohlkreuz.', 'Stange oder Hanteln senkrecht über den Kopf drücken.']),
  seitheben: X('Seitheben', 'schultern', 'i', 1, ['Arme leicht gebeugt, nur bis Schulterhöhe.', 'Leichtes Gewicht, kein Schwung aus dem Oberkörper.']),
  bizepscurls: X('Bizepscurls', 'arme', 'i', 1, ['Ellbogen bleiben am Körper.', 'Langsam ablassen – das bringt am meisten.']),
  hammercurls: X('Hammercurls', 'arme', 'i', 1, ['Daumen zeigen nach oben.', 'Kein Schwung aus dem Rücken.']),
  trizepsdruecken: X('Trizepsdrücken am Kabel', 'arme', 'i', 2.5, ['Oberarme bleiben fest am Körper.', 'Unten ganz durchstrecken, kurz halten.']),
  plank: X('Unterarmstütz (Plank)', 'bauch', 'i', 0, ['Ellbogen unter den Schultern, Körper gerade.', 'Bauch und Po anspannen, ruhig weiteratmen.'], { bw: true, unit: 's' }),
  crunches: X('Crunches', 'bauch', 'i', 0, ['Nur Schultern vom Boden heben, Nacken locker.', 'Langsam, ohne Schwung.'], { bw: true }),
  beinheben: X('Beinheben', 'bauch', 'i', 0, ['Rücken bleibt am Boden bzw. ruhig im Hang.', 'Langsam ablassen.'], { bw: true }),
  'kniebeuge-kg': X('Kniebeuge ohne Gewicht', 'beine', 'c', 0, ['Arme nach vorn, Fersen bleiben unten.', 'Tief und kontrolliert, oben Po anspannen.'], { bw: true }),
};

export const GOALS = {
  kraft: { name: 'Kraft', c: [3, 6], i: [8, 12], bw: [5, 12] },
  muskel: { name: 'Muskelaufbau', c: [6, 10], i: [10, 15], bw: [8, 15] },
  fit: { name: 'Fit & gesund', c: [10, 15], i: [12, 20], bw: [10, 20] },
};
export const LEVELS = { neu: 'Einsteiger', fort: 'Fortgeschritten' };
// Effort = how many more reps would have been possible (reps in reserve).
export const EFFORT = [
  { rir: 3, label: 'Leicht' },
  { rir: 2, label: 'Gut' },
  { rir: 1, label: 'Schwer' },
  { rir: 0, label: 'Am Limit' },
];

const T = (ex, sets) => ({ ex, sets });
export const TEMPLATES = [
  { id: 'gk', name: 'Ganzkörper', perWeek: 3, level: 'neu', desc: '2–3× pro Woche · ideal zum Einstieg', days: [
    { name: 'Tag A', items: [T('kniebeuge', 3), T('bankdruecken', 3), T('latzug', 3), T('seitheben', 2), T('plank', 2)] },
    { name: 'Tag B', items: [T('rum-kreuzheben', 3), T('schulterdruecken', 3), T('kabelrudern', 3), T('beinpresse', 2), T('crunches', 2)] },
  ] },
  { id: 'ou', name: 'Oberkörper / Unterkörper', perWeek: 4, level: 'fort', desc: '4× pro Woche · mehr Volumen', days: [
    { name: 'Oberkörper', items: [T('bankdruecken', 3), T('rudern-lh', 3), T('schulterdruecken', 2), T('latzug', 3), T('bizepscurls', 2), T('trizepsdruecken', 2)] },
    { name: 'Unterkörper', items: [T('kniebeuge', 3), T('rum-kreuzheben', 3), T('hip-thrust', 2), T('beinbeuger', 2), T('wadenheben', 3), T('beinheben', 2)] },
  ] },
  { id: 'ppl', name: 'Push / Pull / Beine', perWeek: 3, level: 'fort', desc: '3–6× pro Woche · klassischer Split', days: [
    { name: 'Push', items: [T('bankdruecken', 3), T('schulterdruecken', 3), T('schraegbank-kh', 2), T('seitheben', 3), T('trizepsdruecken', 2)] },
    { name: 'Pull', items: [T('klimmzuege', 3), T('rudern-lh', 3), T('kabelrudern', 2), T('face-pulls', 2), T('bizepscurls', 3)] },
    { name: 'Beine', items: [T('kniebeuge', 3), T('rum-kreuzheben', 3), T('ausfallschritte', 2), T('beinbeuger', 2), T('wadenheben', 3)] },
  ] },
  { id: 'home', name: 'Zuhause ohne Geräte', perWeek: 3, level: 'neu', desc: 'Nur mit dem eigenen Körper', days: [
    { name: 'Tag A', items: [T('kniebeuge-kg', 3), T('liegestuetze', 3), T('tischrudern', 3), T('glute-bridge', 3), T('plank', 3)] },
    { name: 'Tag B', items: [T('ausfallschritte', 3), T('tischrudern', 3), T('liegestuetze', 3), T('superman', 2), T('crunches', 3)] },
  ] },
];

const DAY = 86400000;
export const exInfo = (id, custom = {}) => EXERCISES[id] || custom[id] || { name: id, muscle: 'arme', kind: 'i', step: 2.5, cues: [] };
export const isBw = (ex) => !!ex.bw || !ex.step;
export const repRange = (item, ex, goal = 'muskel') => item?.reps || (ex.unit === 's' ? [20, 60] : GOALS[goal]?.[isBw(ex) ? 'bw' : ex.kind]) || [8, 12];
export const restFor = (ex, goal = 'muskel') => ex.rest || (ex.kind === 'c' ? (goal === 'kraft' ? 180 : 120) : 75);
export const roundTo = (kg, step) => (step ? Math.max(0, Math.round(kg / step) * step) : 0);
export const fmtKg = (kg) => Number(kg || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + Math.min(reps, 12) / 30) : 0);
export const parseNum = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : NaN; };
export const unitLabel = (ex) => (ex.unit === 's' ? 'Sek.' : 'Wdh.');

export function newPlanFrom(tpl, id = 'p' + Date.now().toString(36)) {
  return { id, name: tpl.name, perWeek: tpl.perWeek, days: tpl.days.map((d) => ({ name: d.name, items: d.items.map((it) => ({ ...it })) })) };
}

// All logged sessions for one exercise, newest first.
export const historyOf = (exId, log) => log.filter((s) => s.entries?.some((e) => e.ex === exId && e.sets.length))
  .map((s) => ({ at: s.at, deload: s.deload, sets: s.entries.find((e) => e.ex === exId).sets }));

export function bestE1rm(exId, log, before = Infinity) {
  let best = 0;
  for (const s of log) if (s.at < before) for (const e of s.entries || []) if (e.ex === exId) for (const st of e.sets) best = Math.max(best, e1rm(st.kg, st.reps));
  return best;
}
export function bestReps(exId, log, before = Infinity) {
  let best = 0;
  for (const s of log) if (s.at < before) for (const e of s.entries || []) if (e.ex === exId) for (const st of e.sets) best = Math.max(best, st.reps);
  return best;
}

const topSets = (sets) => { const kg = Math.max(...sets.map((s) => s.kg || 0)); return { kg, sets: sets.filter((s) => (s.kg || 0) === kg) }; };

// What to do next time for one exercise. Double progression: first more reps, then a small weight step.
// Returns { kg, sets, reps:[lo,hi], aim, trend: new|up|same|down, note }.
export function suggest(exId, item, log, { goal = 'muskel', custom = {}, now = Date.now(), deload = false, readiness = 'ok' } = {}) {
  const ex = exInfo(exId, custom);
  const [lo, hi] = repRange(item, ex, goal);
  const bw = isBw(ex);
  let sets = item?.sets || 3;
  const hist = historyOf(exId, log).filter((h) => !h.deload);
  const r = { kg: 0, sets, reps: [lo, hi], aim: hi, trend: 'new', note: '' };
  if (!hist.length) {
    r.note = bw ? `Starte mit sauberen Wiederholungen – Ziel ${lo}–${hi} ${unitLabel(ex)}.`
      : `Erstes Mal: Wähle ein Gewicht, mit dem ${hi} saubere ${unitLabel(ex)} gerade so gehen. Lieber zu leicht als zu schwer.`;
  } else {
    const last = hist[0];
    const top = topSets(last.sets);
    const reps = top.sets.map((s) => s.reps);
    const minRir = Math.min(...top.sets.map((s) => (s.rir ?? 2)));
    const allTop = top.sets.length >= Math.min(sets, last.sets.length) && reps.every((n) => n >= hi);
    const below = reps.some((n) => n < lo);
    const prevBelow = hist[1] && (() => { const p = topSets(hist[1].sets); return p.kg === top.kg && p.sets.some((s) => s.reps < lo); })();
    r.kg = top.kg;
    r.aim = Math.min(hi, Math.max(lo, Math.max(...reps) + (minRir > 0 ? 1 : 0)));
    const lastStr = reps.join('/');
    if (bw && !top.kg) {
      if (allTop && minRir > 0) {
        r.trend = 'up';
        r.aim = hi + Math.max(1, Math.round(hi * 0.1));
        r.note = reps.every((n) => n >= hi + 5)
          ? `Sehr stark (zuletzt ${lastStr})! Zeit für eine schwerere Variante oder etwas Zusatzgewicht.`
          : `Ziel geschafft (zuletzt ${lastStr}) – heute ein paar ${unitLabel(ex)} mehr.`;
      } else if (below && prevBelow) {
        r.trend = 'down'; r.aim = lo;
        r.note = `Zweimal unter dem Ziel – nimm eine leichtere Variante und baue sauber wieder auf.`;
      } else {
        r.trend = 'same';
        r.note = `Zuletzt ${lastStr}. Versuch je Satz eine ${ex.unit === 's' ? 'paar Sekunden' : 'Wiederholung'} mehr.`;
      }
    } else if (allTop && minRir > 0) {
      r.trend = 'up';
      // Always just the smallest step, so joints and tendons can keep up.
      r.kg = roundTo(top.kg + ex.step, ex.step);
      r.aim = lo;
      r.note = `Stark! Alle Sätze mit ${hi}+ ${unitLabel(ex)} → heute ${fmtKg(r.kg)} kg. Die Wiederholungen fallen erst wieder auf ${lo}, das ist normal.`;
    } else if (allTop) {
      r.trend = 'same';
      r.note = `Ziel erreicht, aber am Limit. Noch einmal ${fmtKg(top.kg)} kg – wenn es leichter geht, wird gesteigert.`;
    } else if (below && prevBelow) {
      r.trend = 'down';
      r.kg = roundTo(top.kg * 0.9, ex.step) || top.kg;
      r.aim = hi;
      r.note = `Zweimal unter ${lo} ${unitLabel(ex)} mit ${fmtKg(top.kg)} kg. Heute 10 % leichter (${fmtKg(r.kg)} kg) und sauber wieder hocharbeiten.`;
    } else if (below) {
      r.trend = 'same';
      r.note = `Zuletzt ${lastStr} mit ${fmtKg(top.kg)} kg. Gleiches Gewicht, Ziel: in jedem Satz mindestens ${lo}.`;
    } else {
      r.trend = 'same';
      r.note = `Zuletzt ${lastStr} mit ${fmtKg(top.kg)} kg. Gleiches Gewicht, versuch ${r.aim} ${unitLabel(ex)} pro Satz.`;
    }
    // Back after a break: start lighter.
    const gap = (now - last.at) / DAY;
    if (gap > 14 && r.kg) {
      const f = gap > 28 ? 0.8 : 0.9;
      r.kg = roundTo(r.kg * f, ex.step) || r.kg;
      r.trend = 'down';
      r.note = `${Math.round(gap)} Tage Pause – heute etwas leichter einsteigen (${fmtKg(r.kg)} kg). In 1–2 Wochen bist du wieder auf dem alten Stand.`;
    }
  }
  if (deload) {
    r.sets = Math.max(1, Math.round(sets * 0.6));
    if (r.kg) r.kg = roundTo(r.kg * 0.9, ex.step) || r.kg;
    r.trend = 'down';
    r.note = `Leichte Woche: ${r.sets} ${r.sets === 1 ? 'Satz' : 'Sätze'}${r.kg ? ` mit ${fmtKg(r.kg)} kg` : ''}, locker bleiben. So erholt sich der Körper und du wirst danach stärker.`;
  } else if (readiness === 'muede' || readiness === 'schmerz') {
    r.sets = Math.max(1, sets - 1);
    if (r.kg) r.kg = roundTo(r.kg * 0.95, ex.step) || r.kg;
    if (r.trend === 'up') r.trend = 'same';
    r.note = `Heute etwas weniger (${r.sets} ${r.sets === 1 ? 'Satz' : 'Sätze'}${r.kg ? `, ${fmtKg(r.kg)} kg` : ''}) – du bist nicht ganz fit. Qualität vor Menge.`;
  }
  return r;
}

// Plausibility check before a set is saved. Returns { ok, warn?, fix? } – fix = corrected values to offer.
// done = sets of this exercise already logged today (the most recent reference).
export function checkInput(exId, kg, reps, log, custom = {}, done = []) {
  const ex = exInfo(exId, custom);
  if (!(reps > 0)) return { ok: false, warn: `Trag ein, wie viele ${unitLabel(ex)} du geschafft hast.` };
  if (!(kg >= 0)) return { ok: false, warn: 'Das Gewicht ist keine gültige Zahl.' };
  const hist = historyOf(exId, log);
  const today = done.filter((s) => s.kg > 0);
  const lastKg = today.length ? today[today.length - 1].kg : hist.length ? topSets(hist[0].sets).kg : 0;
  const when = today.length ? 'Im letzten Satz' : 'Letztes Mal';
  if (lastKg && kg > lastKg * 3) {
    const guess = [kg / 10, kg / 100].find((g) => g <= lastKg * 1.3 && g >= lastKg * 0.5);
    return { ok: false, warn: `${fmtKg(kg)} kg? ${when} waren es ${fmtKg(lastKg)} kg.${guess ? ` Meintest du ${fmtKg(guess)} kg?` : ' Bitte prüfe die Eingabe.'}`, fix: guess ? { kg: guess, reps } : null };
  }
  if (ex.unit !== 's' && reps > 50) return { ok: false, warn: `${reps} Wiederholungen wirken wie ein Tippfehler.`, fix: reps >= 100 ? { kg, reps: Math.round(reps / 10) } : null };
  if (lastKg && kg > lastKg * 1.2 && kg - lastKg > ex.step) {
    return { ok: true, warn: `Großer Sprung: +${Math.round((kg / lastKg - 1) * 100)} % gegenüber ${today.length ? 'dem letzten Satz' : 'dem letzten Training'}. Steigere lieber in kleinen Schritten (${fmtKg(ex.step)} kg), sonst leiden Technik und Gelenke.` };
  }
  return { ok: true };
}

// Feedback right after a set: tips and corrections for the next set.
// Returns { msgs: [{ t: ok|tip|warn|pr, text }], next: { kg, reps }, rest }.
export function setFeedback(exId, set, done, sug, log, { goal = 'muskel', custom = {}, now = Date.now() } = {}) {
  const ex = exInfo(exId, custom);
  const [lo, hi] = sug.reps;
  const msgs = [];
  const prev = done[done.length - 1];
  const n = done.length + 1;
  let rest = restFor(ex, goal);
  const next = { kg: set.kg, reps: set.reps };
  const bestBefore = bestE1rm(exId, log, now);
  const repsBefore = bestReps(exId, log, now);
  const doneBest = Math.max(0, ...done.map((s) => e1rm(s.kg, s.reps)));
  if (set.kg > 0 && bestBefore > 0 && e1rm(set.kg, set.reps) > Math.max(bestBefore, doneBest) + 0.01) {
    msgs.push({ t: 'pr', text: `Neuer Rekord! Geschätzte Maximalkraft jetzt ${fmtKg(Math.round(e1rm(set.kg, set.reps) * 2) / 2)} kg 🎉` });
  } else if (!set.kg && repsBefore > 0 && set.reps > Math.max(repsBefore, ...done.map((s) => s.reps))) {
    msgs.push({ t: 'pr', text: `Neuer Rekord: ${set.reps} ${unitLabel(ex)} 🎉` });
  }
  if (set.rir === 0 && n === 1 && sug.sets > 1) {
    msgs.push({ t: 'warn', text: 'Schon im ersten Satz am Limit. Lass 1–2 Wiederholungen „im Tank“ – so schaffst du alle Sätze und erholst dich schneller.' });
    if (set.kg) next.kg = roundTo(set.kg * 0.95, ex.step) || set.kg;
    rest += 30;
  } else if (set.rir === 0) {
    rest += 30;
  }
  if (!isBw(ex) && set.reps > hi + 2 && set.rir !== 0 && set.rir !== 1) {
    const up = roundTo(set.kg + ex.step, ex.step);
    msgs.push({ t: 'tip', text: `Zu leicht (${set.reps} statt ${lo}–${hi}). Nächster Satz: ${fmtKg(up)} kg.` });
    next.kg = up;
    next.reps = hi;
  } else if (set.reps < lo && set.kg > 0) {
    const down = roundTo(set.kg * 0.9, ex.step) || set.kg;
    msgs.push({ t: 'warn', text: `Unter dem Ziel (${set.reps} statt ${lo}–${hi}). Nächster Satz ${fmtKg(down)} kg, damit die Technik sauber bleibt.` });
    next.kg = down;
    next.reps = lo;
  } else if (prev && prev.reps >= 4 && set.reps <= prev.reps * 0.7 && set.kg >= prev.kg) {
    msgs.push({ t: 'tip', text: `Starker Abfall (${prev.reps} → ${set.reps}). Gönn dir eine längere Pause.` });
    rest += 60;
  }
  if (n >= sug.sets && !msgs.some((m) => m.t === 'warn')) {
    msgs.push({ t: 'ok', text: n > sug.sets ? 'Extra-Satz geschafft. Mehr Sätze bringen jetzt kaum noch etwas – weiter zur nächsten Übung.' : 'Alle Sätze geschafft! Weiter zur nächsten Übung.' });
  }
  if (!msgs.length) {
    const cue = ex.cues?.[(n - 1) % Math.max(1, ex.cues.length)];
    msgs.push({ t: set.rir === 3 && set.reps >= hi ? 'tip' : 'ok', text: set.rir === 3 && set.reps >= hi && !isBw(ex) ? 'Das ging leicht – beim nächsten Training gibt es mehr Gewicht.' : (cue ? `Gut! Tipp: ${cue}` : 'Gut so!') });
  }
  return { msgs, next, rest: Math.min(rest, 300) };
}

// Should the next week be lighter? Looks at continuous training weeks and fatigue signals.
export function deloadState(log, now = Date.now()) {
  const s = [...log].sort((a, b) => b.at - a.at).filter((x) => x.entries?.length);
  if (!s.length) return { due: false, weeks: 0 };
  // Count weeks of continuous training since the last deload (a break of >10 days counts as recovery).
  let start = s[0].at;
  for (let i = 0; i < s.length; i++) {
    if (s[i].deload) break;
    if (i > 0 && s[i - 1].at - s[i].at > 10 * DAY) break;
    start = s[i].at;
  }
  if (now - s[0].at > 10 * DAY) return { due: false, weeks: 0 };
  const weeks = Math.floor((now - start) / (7 * DAY));
  if (weeks >= 6) return { due: true, weeks, reason: `${weeks} Wochen am Stück trainiert – Zeit für eine leichte Woche.` };
  const recent = s.slice(0, 4).filter((x) => !x.deload);
  const sets = recent.flatMap((x) => x.entries.flatMap((e) => e.sets)).filter((x) => x.rir != null);
  if (sets.length >= 10 && sets.filter((x) => x.rir === 0).length / sets.length >= 0.4) {
    return { due: true, weeks, reason: 'Viele Sätze waren zuletzt am Limit – eine leichte Einheit beugt Überlastung vor.' };
  }
  if (s.slice(0, 3).filter((x) => x.readiness === 'muede' || x.readiness === 'schmerz').length >= 2) {
    return { due: true, weeks, reason: 'Du warst zuletzt öfter müde – dein Körper braucht Erholung.' };
  }
  return { due: false, weeks };
}

// Muscles worked hard within the last 48 h (to warn before training them again).
export function recentMuscles(log, now = Date.now(), custom = {}) {
  const out = new Map();
  for (const s of log) {
    if (now - s.at > 2 * DAY || s.deload) continue;
    for (const e of s.entries || []) {
      if (!e.sets.length) continue;
      const m = exInfo(e.ex, custom).muscle;
      out.set(m, Math.min(out.get(m) ?? Infinity, now - s.at));
    }
  }
  return out;
}

export function readinessWarnings(day, log, { now = Date.now(), custom = {} } = {}) {
  const w = [];
  const today = log.filter((s) => now - s.at < 14 * 3600000 && s.entries?.some((e) => e.sets.length));
  if (today.length) w.push('Du hast heute schon Krafttraining gemacht. Zwei Einheiten an einem Tag sind selten nötig – Erholung macht stark.');
  const rec = recentMuscles(log, now, custom);
  const hit = [...new Set((day?.items || []).map((it) => exInfo(it.ex, custom).muscle))].filter((m) => rec.has(m) && rec.get(m) < 40 * 3600000);
  if (hit.length && !today.length) w.push(`${hit.map((m) => MUSCLES[m]).join(', ')} ${hit.length === 1 ? 'wurde' : 'wurden'} vor kurzem trainiert. Muskeln brauchen etwa 48 Stunden Erholung – heute lieber locker oder einen anderen Tag.`);
  return w;
}

// Weekly sets per muscle for a plan (days rotate, perWeek sessions per week).
export function weeklySets(plan, custom = {}) {
  const per = (plan.perWeek || plan.days.length) / Math.max(1, plan.days.length);
  const out = {};
  for (const d of plan.days) for (const it of d.items) {
    const m = exInfo(it.ex, custom).muscle;
    out[m] = (out[m] || 0) + (it.sets || 0) * per;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 10) / 10;
  return out;
}

// Plan review: corrections for too much / too little / unbalanced training.
export function checkPlan(plan, { level = 'neu', custom = {} } = {}) {
  const w = [];
  if (!plan.days.length) return [{ t: 'warn', text: 'Der Plan hat noch keinen Trainingstag.' }];
  const vol = weeklySets(plan, custom);
  const maxV = level === 'neu' ? 16 : 22;
  for (const [m, v] of Object.entries(vol)) {
    if (v > maxV) w.push({ t: 'warn', text: `${MUSCLES[m]}: ${fmtKg(v)} Sätze pro Woche sind zu viel (empfohlen ${level === 'neu' ? '6–14' : '10–20'}). Mehr ist hier nicht besser – nur müder.` });
  }
  const all = Object.values(vol).reduce((a, b) => a + b, 0);
  if (all >= 12) {
    if (!vol.beine && !vol.po) w.push({ t: 'warn', text: 'Beine fehlen im Plan. Sie sind die größten Muskeln – mindestens eine Bein-Übung gehört dazu.' });
    if (!vol.ruecken) w.push({ t: 'warn', text: 'Kein Rücken im Plan. Zieh-Übungen (z. B. Rudern, Latzug) schützen Haltung und Schultern.' });
    const push = (vol.brust || 0) + (vol.schultern || 0) * 0.5, pull = vol.ruecken || 0;
    if (pull && push > pull * 1.6) w.push({ t: 'tip', text: 'Viel mehr Drücken als Ziehen. Ein paar Sätze Rücken mehr halten die Schultern gesund.' });
  }
  for (const d of plan.days) {
    const n = d.items.reduce((a, it) => a + (it.sets || 0), 0);
    if (n > 25) w.push({ t: 'warn', text: `${d.name}: ${n} Sätze sind sehr viel für eine Einheit. Besser höchstens 20–25.` });
    if (!d.items.length) w.push({ t: 'tip', text: `${d.name} hat noch keine Übungen.` });
    const ids = d.items.map((it) => it.ex);
    if (new Set(ids).size < ids.length) w.push({ t: 'tip', text: `${d.name}: Eine Übung steht doppelt drin.` });
    if (d.items.some((it) => it.sets > 6)) w.push({ t: 'tip', text: `${d.name}: Mehr als 6 Sätze für eine Übung bringen kaum mehr – lieber eine zweite Übung.` });
    // Big lifts first, small ones last.
    const firstIso = d.items.findIndex((it) => exInfo(it.ex, custom).kind === 'i');
    const lateCompound = d.items.findIndex((it, i) => i > firstIso && exInfo(it.ex, custom).kind === 'c' && !isBw(exInfo(it.ex, custom)));
    if (firstIso >= 0 && lateCompound > firstIso) w.push({ t: 'tip', text: `${d.name}: Große Übungen (z. B. ${exInfo(d.items[lateCompound].ex, custom).name}) besser an den Anfang – dann bist du noch frisch.` });
  }
  const pw = plan.perWeek || plan.days.length;
  if (pw >= 7) w.push({ t: 'warn', text: 'Jeden Tag Krafttraining ist zu viel. Plane mindestens 1–2 Ruhetage pro Woche ein.' });
  else if (level === 'neu' && pw > 4) w.push({ t: 'tip', text: `Für den Einstieg reichen 2–4 Einheiten pro Woche. Erholung ist Teil des Trainings.` });
  if (!w.length) w.push({ t: 'ok', text: 'Der Plan ist ausgewogen. 👍' });
  return w;
}

// Which day of the plan comes next (rotates after the last finished day).
export function nextDay(plan, log) {
  const last = log.find((s) => s.planId === plan.id && s.dayIdx != null);
  return last ? (last.dayIdx + 1) % Math.max(1, plan.days.length) : 0;
}

export function sessionStats(s) {
  let sets = 0, volume = 0;
  for (const e of s.entries || []) for (const st of e.sets) { sets++; volume += (st.kg || 0) * st.reps; }
  return { sets, volume: Math.round(volume) };
}

// Progress over time for one exercise: [{ at, value }] – best e1RM (or reps for bodyweight) per session.
export function progressSeries(exId, log, custom = {}) {
  const ex = exInfo(exId, custom);
  return historyOf(exId, log).reverse().map((h) => {
    const kgMax = Math.max(...h.sets.map((s) => s.kg || 0));
    const value = kgMax > 0 ? Math.max(...h.sets.map((s) => e1rm(s.kg, s.reps))) : Math.max(...h.sets.map((s) => s.reps));
    return { at: h.at, value: Math.round(value * 10) / 10, kg: kgMax > 0, unit: kgMax > 0 ? 'kg' : unitLabel(ex) };
  });
}

// Training days in a row per week (streak in weeks with at least one workout).
export function weekStreak(times, now = Date.now()) {
  const week = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const set = new Set(times.map(week));
  let w = week(now), n = 0;
  if (!set.has(w)) w -= 7 * DAY; // the current week may still come
  while (set.has(w)) { n++; w = week(w - 3 * DAY); }
  return n;
}
