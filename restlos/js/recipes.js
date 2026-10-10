// Reste-Rezepte: wählt Gerichte, die möglichst viele bald ablaufende Sachen aufbrauchen.
// Zutaten: Produkt-IDs aus products.js, Alternativen mit „|“, ganze Kategorien mit „cat:…“.
// Gerichte mit {} im Namen werden mit den eigenen Resten benannt („Frittata mit Zucchini & Paprika“).
// Salz, Pfeffer, Öl, Zucker, Mehl und Gewürze setzen wir als vorhanden voraus.
import { urgency, daysLeft, iso } from './pantry.js';
import { byId } from './products.js';

export const RECIPES = [
  { id: 'frittata', name: 'Frittata mit {}', emoji: '🍳', time: 25, veg: true, need: ['eier', 'cat:gemuese'], opt: ['kaese|feta|parmesan|mozzarella', 'kartoffeln', 'schinken|speck|wurst'],
    steps: ['Gemüse klein schneiden und in einer ofenfesten Pfanne mit etwas Öl 5 Minuten anbraten.', '6 Eier mit Salz und Pfeffer verquirlen, Käse unterheben, über das Gemüse gießen.', 'Bei kleiner Hitze 8 Minuten stocken lassen, dann 5 Minuten unter den Backofengrill.'] },
  { id: 'pfanne', name: 'Gemüsepfanne mit {}', emoji: '🥘', time: 20, veg: true, need: ['cat:gemuese', 'reis|nudeln|frischenudeln|kartoffeln'], opt: ['haehnchen|tofu|eier', 'zwiebeln', 'knoblauch', 'ingwer'],
    steps: ['Reis oder Nudeln nach Packung kochen (Kartoffeln in Würfeln 15 Minuten braten).', 'Zwiebel, Knoblauch und das Gemüse in Streifen in heißem Öl 6–8 Minuten kräftig braten.', 'Alles mischen, mit Salz, Pfeffer und etwas Sojasauce oder Zitrone abschmecken.'] },
  { id: 'suppe', name: 'Resteküchen-Suppe mit {}', emoji: '🍲', time: 30, veg: true, need: ['cat:gemuese', 'cat:gemuese'], opt: ['kartoffeln', 'zwiebeln', 'sahne|kokosmilch', 'brot|broetchen'],
    steps: ['Zwiebel in einem Topf anschwitzen, Gemüse und Kartoffeln grob würfeln und kurz mitbraten.', 'Mit 1 Liter Wasser oder Brühe aufgießen, 20 Minuten köcheln.', 'Pürieren, mit Sahne verfeinern und abschmecken. Altes Brot als Croutons in der Pfanne rösten.'] },
  { id: 'smoothie', name: 'Smoothie mit {}', emoji: '🥤', time: 5, veg: true, need: ['cat:obst', 'joghurt|milch|hmilch|pflanzendrink|saft'], opt: ['bananen', 'haferflocken', 'spinat'],
    steps: ['Obst grob schneiden (sehr reife Bananen sind perfekt).', 'Mit Joghurt oder Milch und einer Handvoll Haferflocken fein pürieren.', 'Tipp: Reifes Obst in Stücken einfrieren – dann wird der nächste Smoothie eiskalt.'] },
  { id: 'arme-ritter', name: 'Arme Ritter', emoji: '🍞', time: 15, veg: true, need: ['brot|broetchen|toast', 'eier', 'milch|hmilch|pflanzendrink'], opt: ['cat:obst', 'marmelade'],
    steps: ['2 Eier mit 200 ml Milch, 1 EL Zucker und etwas Zimt verquirlen.', 'Altbackene Brotscheiben darin einweichen.', 'In Butter von beiden Seiten goldbraun braten, mit Obst oder Marmelade servieren.'] },
  { id: 'brotsalat', name: 'Brotsalat (Panzanella)', emoji: '🥗', time: 15, veg: true, need: ['brot|broetchen', 'tomaten'], opt: ['gurke', 'zwiebeln', 'kraeuter', 'mozzarella|feta', 'paprika'],
    steps: ['Altes Brot würfeln und in Olivenöl knusprig rösten.', 'Tomaten, Gurke und Zwiebel klein schneiden, mit Öl, Essig, Salz und Pfeffer mischen.', 'Brot unterheben, 10 Minuten ziehen lassen, mit Kräutern bestreuen.'] },
  { id: 'pfannkuchen', name: 'Pfannkuchen', emoji: '🥞', time: 20, veg: true, need: ['eier', 'milch|hmilch|pflanzendrink'], opt: ['cat:obst', 'marmelade', 'kaese|schinken'],
    steps: ['3 Eier, 250 ml Milch, 150 g Mehl und eine Prise Salz glatt rühren, 10 Minuten quellen lassen.', 'Dünn in einer gefetteten Pfanne von beiden Seiten backen.', 'Süß mit Obst oder herzhaft mit Käse und Schinken füllen.'] },
  { id: 'bananenpancakes', name: 'Bananen-Pancakes', emoji: '🥞', time: 15, veg: true, need: ['bananen', 'eier'], opt: ['haferflocken', 'beeren|erdbeeren'],
    steps: ['2 sehr reife Bananen zerdrücken, mit 2 Eiern und 3 EL Haferflocken verrühren.', 'Kleine Pancakes in etwas Öl bei mittlerer Hitze 2 Minuten je Seite backen.', 'Mit Beeren oder Joghurt servieren.'] },
  { id: 'bananenbrot', name: 'Bananenbrot', emoji: '🍌', time: 60, veg: true, need: ['bananen', 'eier', 'butter'], opt: ['nuesse', 'schokolade'],
    steps: ['3 überreife Bananen zerdrücken, mit 2 Eiern, 80 g geschmolzener Butter und 100 g Zucker verrühren.', '250 g Mehl mit 1 Päckchen Backpulver unterheben, Nüsse oder Schokolade nach Wunsch.', 'In einer Kastenform bei 175 °C etwa 50 Minuten backen.'] },
  { id: 'bratkartoffeln', name: 'Bratkartoffeln', emoji: '🥔', time: 30, veg: false, need: ['kartoffeln', 'zwiebeln'], opt: ['speck|schinken|wurst', 'eier', 'kraeuter'],
    steps: ['Kartoffeln (gern vom Vortag) in Scheiben schneiden.', 'In reichlich Öl 15 Minuten goldbraun braten, erst dann wenden.', 'Zwiebeln und Speck dazugeben, salzen, pfeffern – mit Spiegelei servieren.'] },
  { id: 'kartoffelsuppe', name: 'Kartoffelsuppe', emoji: '🍲', time: 35, veg: true, need: ['kartoffeln', 'moehren|lauch|zwiebeln'], opt: ['wuerstchen', 'sahne', 'kraeuter'],
    steps: ['Kartoffeln, Möhren und Lauch würfeln, in Öl anschwitzen.', 'Mit 1 Liter Brühe 20 Minuten kochen, die Hälfte pürieren.', 'Mit Majoran abschmecken, Würstchen in Scheiben darin erwärmen.'] },
  { id: 'tomatennudeln', name: 'Nudeln mit Tomatensauce', emoji: '🍝', time: 20, veg: true, need: ['nudeln|frischenudeln', 'tomaten|dosentomaten|tomatensauce'], opt: ['zwiebeln', 'knoblauch', 'parmesan|kaese', 'kraeuter', 'zucchini|paprika|aubergine'],
    steps: ['Nudeln in Salzwasser kochen.', 'Zwiebel und Knoblauch in Olivenöl anschwitzen, gewürfelte Tomaten (oder Dose) zugeben, 10 Minuten köcheln.', 'Mit Salz, Pfeffer und Kräutern abschmecken, mit Käse servieren.'] },
  { id: 'carbonara', name: 'Spaghetti Carbonara', emoji: '🍝', time: 20, veg: false, need: ['nudeln', 'eier', 'speck|schinken'], opt: ['parmesan|kaese'],
    steps: ['Nudeln kochen. Speck in einer Pfanne knusprig braten.', '2 Eier mit geriebenem Käse und viel Pfeffer verrühren.', 'Heiße Nudeln mit Speck mischen, Pfanne vom Herd nehmen, Eiermasse und etwas Nudelwasser unterrühren, bis es cremig wird.'] },
  { id: 'auflauf', name: 'Nudelauflauf mit {}', emoji: '🧀', time: 40, veg: true, need: ['nudeln|frischenudeln', 'kaese|mozzarella', 'sahne|milch|hmilch'], opt: ['cat:gemuese', 'schinken|wurst|wuerstchen'],
    steps: ['Nudeln knapp bissfest kochen.', 'Mit dem Gemüse und Schinken in eine Auflaufform geben, Sahne oder Milch mit 1 Ei verquirlen und darübergießen.', 'Mit Käse bestreuen und bei 200 °C 20 Minuten überbacken.'] },
  { id: 'curry', name: 'Gemüsecurry mit {}', emoji: '🍛', time: 30, veg: true, need: ['cat:gemuese', 'kokosmilch|sahne', 'reis'], opt: ['haehnchen|tofu', 'zwiebeln', 'ingwer', 'knoblauch'],
    steps: ['Reis kochen. Zwiebel, Knoblauch und Ingwer in Öl anschwitzen, 1 EL Currypulver oder -paste kurz mitrösten.', 'Gemüse in Stücken zugeben, mit Kokosmilch ablöschen und 15 Minuten köcheln.', 'Mit Salz und Zitrone abschmecken.'] },
  { id: 'chili', name: 'Chili', emoji: '🌶️', time: 40, veg: false, need: ['bohnen', 'dosentomaten|tomaten', 'zwiebeln'], opt: ['hackfleisch', 'mais', 'paprika', 'reis'],
    steps: ['Zwiebeln und Hackfleisch (oder nur Gemüse) kräftig anbraten, Paprikapulver und Kreuzkümmel dazu.', 'Tomaten, Bohnen, Mais und Paprika zugeben, 25 Minuten köcheln.', 'Mit Salz, Chili und etwas Schokolade abschmecken, mit Reis oder Brot servieren.'] },
  { id: 'bolognese', name: 'Spaghetti Bolognese', emoji: '🍝', time: 40, veg: false, need: ['hackfleisch', 'nudeln', 'dosentomaten|tomaten|tomatensauce'], opt: ['zwiebeln', 'moehren', 'knoblauch', 'parmesan'],
    steps: ['Zwiebel und Möhre fein würfeln, mit dem Hack krümelig braten.', 'Tomaten zugeben und mindestens 20 Minuten köcheln.', 'Nudeln kochen und mit Sauce und Käse servieren. Rest der Sauce lässt sich einfrieren.'] },
  { id: 'haehnchenpfanne', name: 'Hähnchenpfanne mit {}', emoji: '🍗', time: 25, veg: false, need: ['haehnchen', 'cat:gemuese'], opt: ['reis|nudeln', 'sahne', 'zwiebeln', 'knoblauch'],
    steps: ['Hähnchen in Streifen schneiden und durchbraten, herausnehmen.', 'Gemüse in derselben Pfanne braten, mit etwas Sahne oder Brühe ablöschen.', 'Fleisch wieder zugeben, abschmecken, mit Reis servieren.'] },
  { id: 'kraeuterquark', name: 'Pellkartoffeln mit Kräuterquark', emoji: '🥔', time: 30, veg: true, need: ['kartoffeln', 'quark|joghurt|frischkaese'], opt: ['kraeuter|fruehlingszwiebeln', 'gurke', 'knoblauch'],
    steps: ['Kartoffeln mit Schale 20–25 Minuten kochen.', 'Quark mit etwas Milch glatt rühren, Kräuter, Salz, Pfeffer und Knoblauch unterrühren.', 'Gurke klein würfeln und dazugeben.'] },
  { id: 'obstsalat', name: 'Obstsalat mit {}', emoji: '🍓', time: 10, veg: true, need: ['cat:obst', 'cat:obst'], opt: ['joghurt|quark', 'nuesse', 'zitronen'],
    steps: ['Obst klein schneiden, Weiches erst zum Schluss.', 'Mit etwas Zitronensaft und Honig mischen.', 'Mit Joghurt und gehackten Nüssen servieren.'] },
  { id: 'crumble', name: 'Obst-Crumble', emoji: '🥧', time: 40, veg: true, need: ['aepfel|birnen|beeren|erdbeeren|pfirsiche', 'butter'], opt: ['haferflocken', 'nuesse', 'joghurt|sahne'],
    steps: ['Obst klein schneiden und in eine Auflaufform geben.', '80 g kalte Butter mit 100 g Mehl, 60 g Zucker und Haferflocken zu Streuseln reiben.', 'Streusel darauf verteilen, bei 190 °C 25 Minuten backen.'] },
  { id: 'milchreis', name: 'Milchreis', emoji: '🍚', time: 35, veg: true, need: ['milch|hmilch|pflanzendrink', 'reis'], opt: ['cat:obst', 'marmelade'],
    steps: ['1 Liter Milch mit 2 EL Zucker und einer Prise Salz aufkochen.', '250 g (Milch-)Reis einrühren und bei kleinster Hitze 30 Minuten quellen lassen, öfter umrühren.', 'Mit Zimt und Zucker oder Obstkompott servieren.'] },
  { id: 'oats', name: 'Overnight Oats', emoji: '🥣', time: 5, veg: true, need: ['haferflocken', 'milch|hmilch|joghurt|pflanzendrink'], opt: ['cat:obst', 'nuesse'],
    steps: ['50 g Haferflocken mit 150 ml Milch oder Joghurt in ein Glas geben.', 'Obst darauf schichten, über Nacht in den Kühlschrank stellen.', 'Morgens mit Nüssen toppen – fertig.'] },
  { id: 'bauernfruehstueck', name: 'Bauernfrühstück', emoji: '🍳', time: 25, veg: false, need: ['eier', 'kartoffeln'], opt: ['speck|schinken|wurst|wuerstchen', 'zwiebeln', 'kraeuter|fruehlingszwiebeln'],
    steps: ['Gekochte Kartoffeln in Scheiben mit Zwiebeln und Speck knusprig braten.', '4 Eier verquirlen, salzen und darübergießen.', 'Bei kleiner Hitze stocken lassen, mit Schnittlauch bestreuen.'] },
  { id: 'ueberbacken', name: 'Überbackene Brote', emoji: '🧀', time: 15, veg: false, need: ['brot|toast|broetchen', 'kaese|mozzarella'], opt: ['schinken|wurst', 'tomaten', 'paprika|pilze'],
    steps: ['Brot oder halbierte Brötchen belegen: Schinken, Tomatenscheiben, Gemüse.', 'Mit Käse bedecken.', 'Bei 220 °C etwa 8 Minuten backen, bis der Käse blubbert.'] },
  { id: 'wraps', name: 'Reste-Wraps mit {}', emoji: '🌯', time: 15, veg: true, need: ['wraps', 'cat:gemuese'], opt: ['kaese|feta', 'haehnchen|schinken|tofu', 'hummus|quark|frischkaese', 'bohnen|mais'],
    steps: ['Wraps kurz in einer trockenen Pfanne erwärmen.', 'Mit Hummus oder Frischkäse bestreichen, Gemüse, Käse und Reste darauf verteilen.', 'Fest einrollen und halbieren.'] },
  { id: 'salat', name: 'Großer Salat mit Croutons', emoji: '🥗', time: 15, veg: true, need: ['salat|rucola|spinat', 'tomaten|gurke|paprika'], opt: ['brot|broetchen', 'feta|kaese|mozzarella', 'eier', 'nuesse'],
    steps: ['Altes Brot würfeln und in Öl mit Knoblauch rösten.', 'Salat waschen, Gemüse schneiden, mit Öl, Essig, Senf, Salz und etwas Honig anmachen.', 'Croutons und Käse darüber.'] },
  { id: 'tzatziki', name: 'Tzatziki', emoji: '🥒', time: 10, veg: true, need: ['joghurt|quark', 'gurke'], opt: ['knoblauch', 'kraeuter'],
    steps: ['Gurke grob raspeln, salzen und gut ausdrücken.', 'Mit Joghurt, gepresstem Knoblauch, Olivenöl und Dill verrühren.', 'Passt zu Brot, Kartoffeln und Gegrilltem.'] },
  { id: 'ofengemuese', name: 'Ofengemüse mit {}', emoji: '🫑', time: 40, veg: true, need: ['cat:gemuese', 'kartoffeln|suesskartoffeln'], opt: ['feta', 'quark|joghurt', 'zwiebeln'],
    steps: ['Ofen auf 200 °C vorheizen. Kartoffeln und Gemüse in Stücke schneiden.', 'Mit Öl, Salz, Pfeffer und Rosmarin auf einem Blech mischen.', '30–35 Minuten rösten, Feta in den letzten 10 Minuten darüberbröseln.'] },
  { id: 'shakshuka', name: 'Shakshuka', emoji: '🍳', time: 25, veg: true, need: ['eier', 'tomaten|dosentomaten', 'paprika|zwiebeln'], opt: ['feta', 'kraeuter', 'brot|broetchen'],
    steps: ['Zwiebel und Paprika in Öl weich braten, Kreuzkümmel und Paprikapulver dazu.', 'Tomaten zugeben und 10 Minuten zu einer dicken Sauce einkochen.', 'Mulden drücken, Eier hineinschlagen, zugedeckt 6–8 Minuten garen. Mit Brot servieren.'] },
  { id: 'gebratenerreis', name: 'Gebratener Reis mit {}', emoji: '🍚', time: 20, veg: true, need: ['reis', 'eier', 'cat:gemuese'], opt: ['haehnchen|schinken|tofu', 'fruehlingszwiebeln', 'knoblauch|ingwer'],
    steps: ['Am besten Reis vom Vortag nehmen (frisch gekocht ausdampfen lassen).', 'Gemüse in heißem Öl kurz braten, Reis zugeben und kräftig mitbraten.', 'Eier darüberschlagen, unterrühren, mit Sojasauce abschmecken.'] },
  { id: 'tomatensuppe', name: 'Tomatensuppe', emoji: '🍅', time: 30, veg: true, need: ['tomaten|dosentomaten', 'zwiebeln'], opt: ['sahne', 'knoblauch', 'kraeuter', 'brot|broetchen'],
    steps: ['Zwiebel und Knoblauch anschwitzen, Tomaten (auch schrumpelige) grob zugeben.', 'Mit 500 ml Brühe 15 Minuten köcheln, pürieren.', 'Mit Sahne, Salz, Zucker und Basilikum abschmecken.'] },
  { id: 'joghurtbowl', name: 'Joghurt-Bowl', emoji: '🥣', time: 5, veg: true, need: ['joghurt|quark', 'cat:obst'], opt: ['haferflocken', 'nuesse', 'marmelade'],
    steps: ['Joghurt in eine Schale geben.', 'Obst klein schneiden und darauf verteilen.', 'Mit Haferflocken, Nüssen und etwas Honig toppen.'] },
  { id: 'pesto', name: 'Resteküchen-Pesto', emoji: '🌿', time: 10, veg: true, need: ['kraeuter|rucola|spinat'], opt: ['parmesan|kaese', 'nuesse', 'knoblauch', 'nudeln'],
    steps: ['Kräuter, Rucola oder Spinat (auch etwas welk) grob hacken.', 'Mit Nüssen, Käse, Knoblauch und reichlich Olivenöl pürieren, salzen.', 'Mit Nudeln mischen oder im Glas mit Öl bedeckt 1 Woche aufbewahren.'] },
  { id: 'wurstsalat', name: 'Wurst-Käse-Salat', emoji: '🥓', time: 15, veg: false, need: ['wurst|wuerstchen|schinken', 'kaese'], opt: ['gurke', 'zwiebeln', 'brot|broetchen'],
    steps: ['Wurst und Käse in feine Streifen schneiden.', 'Zwiebeln und Gewürzgurken dazu, mit Essig, Öl, Senf, Salz und Pfeffer anmachen.', '15 Minuten ziehen lassen, mit Brot servieren.'] },
  { id: 'gnocchipfanne', name: 'Gnocchi-Pfanne mit {}', emoji: '🥟', time: 15, veg: true, need: ['frischenudeln', 'cat:gemuese'], opt: ['sahne|frischkaese', 'parmesan|kaese', 'speck|schinken'],
    steps: ['Gnocchi (oder Tortellini) in Öl goldbraun braten.', 'Gemüse zugeben und 5 Minuten mitbraten.', 'Mit Sahne oder Frischkäse cremig machen, Käse darüber.'] },
];

// Passt ein Vorrats-Eintrag zu einer Zutat wie „milch|hmilch“ oder „cat:obst“?
const fits = (spec, item) => spec.split('|').some((s) => (s.startsWith('cat:') ? item.cat === s.slice(4) : item.pid === s));
// Zwiebeln & Co. hat man fast immer – als „Gemüse“ zählen sie nur, wenn sie wirklich weg müssen.
const BASICS = new Set(['zwiebeln', 'knoblauch', 'kartoffeln', 'ingwer', 'zitronen']);
// Blattsalat & Co. gehören nicht in Suppe oder Auflauf – nur in Rezepte, die sie ausdrücklich nennen.
const RAW = new Set(['salat', 'rucola', 'gurke', 'kraeuter']);

// Bewertet alle Rezepte gegen den Vorrat. Bevorzugt Rezepte, die Dringendes verbrauchen und wenig Einkauf brauchen.
export function suggest(items, { today = iso(), limit = 8, vegOnly = false } = {}) {
  // Abgelaufenes mit Verbrauchsdatum (Hack, Geflügel, Fisch) schlagen wir nie vor.
  const pool = items.filter((i) => !(i.pid && byId[i.pid]?.vd && daysLeft(i, today) < 0));
  const out = [];
  for (const r of RECIPES) {
    if (vegOnly && !r.veg) continue;
    const used = new Set();
    const pick = (spec, max) => {
      const cand = pool.filter((i) => !used.has(i.id) && fits(spec, i)
        && !(spec.startsWith('cat:') && (RAW.has(i.pid) || (BASICS.has(i.pid) && daysLeft(i, today) > 3)))).sort((a, b) => a.expires.localeCompare(b.expires));
      const take = cand.slice(0, max);
      take.forEach((i) => used.add(i.id));
      return take;
    };
    const have = [];
    const missing = [];
    for (const spec of r.need) {
      // Eine Kategorie (z. B. „cat:gemuese“) darf bis zu 3 dringende Sachen aufnehmen.
      const got = pick(spec, spec.startsWith('cat:') ? 3 : 1);
      if (got.length) have.push(...got); else missing.push(spec);
    }
    const extras = r.opt.flatMap((spec) => pick(spec, spec.startsWith('cat:') ? 2 : 1));
    const all = [...have, ...extras];
    if (!have.length || missing.length > 1 || missing.length >= r.need.length) continue;
    const urgent = all.filter((i) => daysLeft(i, today) <= 3);
    const score = all.reduce((s, i) => s + urgency(i, today), 0) + (missing.length ? -4 : 3) + have.length;
    const dyn = all.filter((i) => ['gemuese', 'obst'].includes(i.cat) && !BASICS.has(i.pid)).map((i) => i.name)
      .filter((n, k, arr) => arr.indexOf(n) === k).slice(0, 3);
    const name = r.name.includes('{}')
      ? (dyn.length ? r.name.replace('{}', dyn.length > 1 ? `${dyn.slice(0, -1).join(', ')} & ${dyn.at(-1)}` : dyn[0]) : r.name.replace(/ (mit|aus) \{\}/, ''))
      : r.name;
    out.push({ ...r, title: name, uses: all, urgent, missing: missing.map(label), score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// „milch|hmilch“ → „Milch“, „cat:gemuese“ → „Gemüse“ – für die Einkaufsliste.
export function label(spec) {
  const first = spec.split('|')[0];
  if (first.startsWith('cat:')) return { gemuese: 'Gemüse', obst: 'Obst', kaese: 'Käse' }[first.slice(4)] || first.slice(4);
  return byId[first]?.name || first;
}
