// Produkt-Wissen: wie lange hält was, wo liegt es, was kostet es ungefähr, wie viel CO₂ steckt drin.
// Damit muss niemand ein Ablaufdatum eintippen – Restlos schätzt es ab Einkaufstag.
// days  = Haltbarkeit ungeöffnet ab Einkauf, open = Haltbarkeit nach dem Anbrechen
// co2   = kg CO₂e pro typischer Packung (grobe Mittelwerte, u. a. nach ifeu 2020)
// vd    = Verbrauchsdatum (nach Ablauf nicht mehr essen) statt Mindesthaltbarkeitsdatum
// keys  = Suchwörter in Kassenbon-Schreibweise (ohne Umlaute); "=" heißt: nur als ganzes Wort

export const CATS = {
  obst: { name: 'Obst', emoji: '🍎', place: 'vorrat', price: 1.99, co2: 0.4 },
  gemuese: { name: 'Gemüse', emoji: '🥕', place: 'kuehl', price: 1.49, co2: 0.3 },
  milch: { name: 'Milchprodukte', emoji: '🥛', place: 'kuehl', price: 1.19, co2: 0.9 },
  kaese: { name: 'Käse', emoji: '🧀', place: 'kuehl', price: 2.29, co2: 1.7 },
  fleisch: { name: 'Fleisch & Fisch', emoji: '🥩', place: 'kuehl', price: 4.49, co2: 3 },
  wurst: { name: 'Wurst & Aufschnitt', emoji: '🥓', place: 'kuehl', price: 1.99, co2: 1.2 },
  brot: { name: 'Brot & Backwaren', emoji: '🍞', place: 'vorrat', price: 2.49, co2: 0.6 },
  eier: { name: 'Eier', emoji: '🥚', place: 'kuehl', price: 2.69, co2: 1.6 },
  vorrat: { name: 'Vorrat', emoji: '🥫', place: 'vorrat', price: 1.29, co2: 0.6 },
  tk: { name: 'Tiefkühl', emoji: '🧊', place: 'tk', price: 2.99, co2: 1 },
  fertig: { name: 'Fertiges & Snacks', emoji: '🥡', place: 'kuehl', price: 2.49, co2: 0.8 },
  getraenke: { name: 'Getränke', emoji: '🧃', place: 'vorrat', price: 1.49, co2: 0.5 },
  sonst: { name: 'Sonstiges', emoji: '🛒', place: 'vorrat', price: 1.99, co2: 0.5 },
};

export const PLACES = { kuehl: 'Kühlschrank', vorrat: 'Küche & Vorrat', tk: 'Tiefkühler' };

const P = (id, name, emoji, cat, days, keys, o = {}) => ({
  id, name, emoji, cat, days, keys,
  place: o.place ?? CATS[cat].place,
  open: o.open ?? null,
  price: o.price ?? CATS[cat].price,
  co2: o.co2 ?? CATS[cat].co2,
  vd: !!o.vd,
});

export const PRODUCTS = [
  // Obst
  P('bananen', 'Bananen', '🍌', 'obst', 5, ['banane', 'bananen'], { price: 1.49, co2: 0.6 }),
  P('aepfel', 'Äpfel', '🍎', 'obst', 21, ['apfel', 'aepfel', 'apfl', 'elstar', 'braeburn', 'jonagold', 'pink lady', 'gala'], { place: 'kuehl', price: 2.49, co2: 0.3 }),
  P('birnen', 'Birnen', '🍐', 'obst', 7, ['birne', 'birnen']),
  P('beeren', 'Beeren', '🫐', 'obst', 3, ['beere', 'beeren', 'heidelbeer', 'himbeer', 'brombeer', 'johannisbeer'], { place: 'kuehl', price: 2.99, co2: 0.5 }),
  P('erdbeeren', 'Erdbeeren', '🍓', 'obst', 3, ['erdbeere', 'erdbeeren'], { place: 'kuehl', price: 2.99, co2: 0.5 }),
  P('trauben', 'Weintrauben', '🍇', 'obst', 7, ['traube', 'trauben', 'weintraube'], { place: 'kuehl', price: 2.49 }),
  P('zitronen', 'Zitronen', '🍋', 'obst', 21, ['zitrone', 'zitronen', 'limette', 'limetten']),
  P('orangen', 'Orangen', '🍊', 'obst', 14, ['orange', 'orangen', 'mandarine', 'clementine', 'mandarinen', 'clementinen'], { price: 2.29 }),
  P('kiwi', 'Kiwis', '🥝', 'obst', 10, ['kiwi', 'kiwis']),
  P('avocado', 'Avocados', '🥑', 'obst', 5, ['avocado', 'avocados'], { price: 1.79, co2: 0.6 }),
  P('mango', 'Mango', '🥭', 'obst', 5, ['mango']),
  P('ananas', 'Ananas', '🍍', 'obst', 5, ['ananas']),
  P('melone', 'Melone', '🍉', 'obst', 7, ['melone', 'wassermelone', 'honigmelone']),
  P('pfirsiche', 'Pfirsiche', '🍑', 'obst', 4, ['pfirsich', 'nektarine', 'aprikose', 'pflaume', 'zwetschge']),
  // Gemüse
  P('tomaten', 'Tomaten', '🍅', 'gemuese', 6, ['tomate', 'tomaten', 'rispentomate', 'cherrytomate', 'cocktailtomate', 'strauchtomate', 'romatomate'], { place: 'vorrat', price: 1.99, co2: 0.8 }),
  P('gurke', 'Gurke', '🥒', 'gemuese', 7, ['gurke', 'gurken', 'salatgurke', 'minigurke'], { price: 0.69 }),
  P('paprika', 'Paprika', '🫑', 'gemuese', 7, ['paprika', 'spitzpaprika'], { price: 1.99 }),
  P('salat', 'Salat', '🥬', 'gemuese', 4, ['salat', 'kopfsalat', 'eisberg', 'eisbergsalat', 'romana', 'lollo', 'feldsalat', 'salatmix', 'salatherz'], { price: 1.29, co2: 0.2 }),
  P('rucola', 'Rucola', '🥬', 'gemuese', 3, ['rucola', 'rauke'], { price: 1.29 }),
  P('spinat', 'Spinat', '🥬', 'gemuese', 3, ['spinat', 'babyspinat', 'blattspinat'], { price: 1.79 }),
  P('moehren', 'Möhren', '🥕', 'gemuese', 21, ['moehre', 'moehren', 'mohren', 'karotte', 'karotten'], { price: 0.99 }),
  P('zucchini', 'Zucchini', '🥒', 'gemuese', 7, ['zucchini'], { price: 0.99 }),
  P('aubergine', 'Aubergine', '🍆', 'gemuese', 7, ['aubergine']),
  P('brokkoli', 'Brokkoli', '🥦', 'gemuese', 5, ['brokkoli', 'broccoli'], { price: 1.49 }),
  P('blumenkohl', 'Blumenkohl', '🥦', 'gemuese', 7, ['blumenkohl'], { price: 1.99 }),
  P('kohl', 'Kohl', '🥬', 'gemuese', 14, ['kohl', 'weisskohl', 'rotkohl', 'spitzkohl', 'wirsing', 'chinakohl', 'kohlrabi']),
  P('pilze', 'Champignons', '🍄', 'gemuese', 4, ['champignon', 'champignons', 'pilze', 'pilz', 'braune champ', 'champ'], { price: 1.79 }),
  P('lauch', 'Lauch', '🥬', 'gemuese', 10, ['lauch', 'porree']),
  P('fruehlingszwiebeln', 'Frühlingszwiebeln', '🧅', 'gemuese', 6, ['fruehlingszwiebel', 'lauchzwiebel', 'lauchzwiebeln'], { price: 0.79 }),
  P('zwiebeln', 'Zwiebeln', '🧅', 'gemuese', 30, ['zwiebel', 'zwiebeln', 'speisezwiebel', 'rote zwiebel', 'schalotte'], { place: 'vorrat', price: 1.29 }),
  P('knoblauch', 'Knoblauch', '🧄', 'gemuese', 30, ['knoblauch', 'knobi'], { place: 'vorrat', price: 0.79 }),
  P('kartoffeln', 'Kartoffeln', '🥔', 'gemuese', 30, ['kartoffel', 'kartoffeln', 'drillinge', 'speisekartoffel', 'festkochend', 'mehligkochend'], { place: 'vorrat', price: 2.49, co2: 0.4 }),
  P('suesskartoffeln', 'Süßkartoffeln', '🍠', 'gemuese', 14, ['suesskartoffel', 'susskartoffel'], { place: 'vorrat' }),
  P('kraeuter', 'Frische Kräuter', '🌿', 'gemuese', 4, ['petersilie', 'basilikum', 'schnittlauch', 'dill', 'koriander', 'minze', 'kraeuter'], { price: 1.29, co2: 0.1 }),
  P('ingwer', 'Ingwer', '🫚', 'gemuese', 21, ['ingwer'], { price: 0.89 }),
  P('mais', 'Mais', '🌽', 'vorrat', 365, ['mais', 'maiskolben', 'gemuesemais'], { open: 3 }),
  // Milchprodukte
  P('milch', 'Milch', '🥛', 'milch', 7, ['milch', 'vollmilch', 'frischmilch', 'weidemilch', 'trinkmilch', '=fettarme milch', 'landmilch', 'bergbauernmilch'], { open: 4, price: 1.19, co2: 1.2 }),
  P('hmilch', 'H-Milch', '🥛', 'milch', 90, ['h milch', 'h-milch', 'haltbare milch', 'haltb milch', 'haltbar'], { place: 'vorrat', open: 4, price: 0.99, co2: 1.2 }),
  P('pflanzendrink', 'Haferdrink', '🥛', 'milch', 120, ['haferdrink', 'hafer drink', 'oatly', 'sojadrink', 'mandeldrink', 'pflanzendrink', 'barista'], { place: 'vorrat', open: 5, price: 1.49, co2: 0.3 }),
  P('joghurt', 'Joghurt', '🥣', 'milch', 21, ['joghurt', 'jogurt', 'yoghurt', 'skyr', 'jog'], { open: 4, price: 0.89 }),
  P('quark', 'Quark', '🥣', 'milch', 14, ['quark', 'magerquark', 'speisequark'], { open: 3, price: 0.89 }),
  P('sahne', 'Sahne', '🥛', 'milch', 14, ['sahne', 'schlagsahne', 'kochsahne', 'schmand', 'saure sahne', 'creme fraiche', 'cremefraiche'], { open: 3, price: 0.99, co2: 0.8 }),
  P('butter', 'Butter', '🧈', 'milch', 42, ['butter', 'suessrahmbutter', 'sauerrahmbutter', 'markenbutter', 'kerrygold'], { price: 2.29, co2: 2.3 }),
  P('frischkaese', 'Frischkäse', '🧀', 'kaese', 21, ['frischkaese', 'philadelphia', 'hirtenkaese'], { open: 5, price: 1.19, co2: 0.8 }),
  P('mozzarella', 'Mozzarella', '🧀', 'kaese', 14, ['mozzarella', 'burrata'], { open: 2, price: 0.99, co2: 1.1 }),
  P('feta', 'Feta', '🧀', 'kaese', 30, ['feta', 'schafskaese'], { open: 5, price: 1.69 }),
  P('parmesan', 'Parmesan', '🧀', 'kaese', 60, ['parmesan', 'grana', 'padano', 'pecorino', 'reibekaese'], { open: 21, price: 2.49 }),
  P('kaese', 'Käse', '🧀', 'kaese', 21, ['kaese', 'kase', 'gouda', 'emmentaler', 'edamer', 'butterkaese', 'tilsiter', 'cheddar', 'bergkaese', 'leerdammer', 'camembert', 'brie', 'gratinkaese', 'pizzakaese'], { open: 10 }),
  // Eier
  P('eier', 'Eier', '🥚', 'eier', 21, ['=ei', 'eier', 'freiland', 'bodenhaltung', 'eier m', 'eier l'], { price: 2.69 }),
  // Fleisch, Fisch, Wurst
  P('hackfleisch', 'Hackfleisch', '🥩', 'fleisch', 1, ['hack', 'hackfleisch', 'gehacktes', 'rinderhack', 'hackfl'], { vd: true, price: 3.49, co2: 4 }),
  P('haehnchen', 'Hähnchen', '🍗', 'fleisch', 2, ['haehnchen', 'hahnchen', 'haenchen', 'huhn', 'huehnchen', 'chicken', 'gefluegel', 'pute', 'putenbrust', 'haehnchenbrust', 'haehn'], { vd: true, price: 5.49, co2: 2.8 }),
  P('rind', 'Rindfleisch', '🥩', 'fleisch', 3, ['rind', 'rinder', 'rumpsteak', 'steak', 'gulasch', 'roastbeef'], { vd: true, price: 7.99, co2: 6.8 }),
  P('schwein', 'Schweinefleisch', '🥩', 'fleisch', 3, ['schwein', 'schnitzel', 'kotelett', 'nacken', 'schweine'], { vd: true, price: 4.49, co2: 2 }),
  P('wuerstchen', 'Würstchen', '🌭', 'wurst', 10, ['wuerstchen', 'wurstchen', 'bratwurst', 'wiener', 'bockwurst', 'frankfurter', 'grillwurst'], { open: 3, price: 2.49, co2: 1.3 }),
  P('fisch', 'Fisch', '🐟', 'fleisch', 2, ['fisch', 'lachs', 'forelle', 'kabeljau', 'seelachs', 'garnelen', 'shrimps', 'dorade'], { vd: true, price: 5.99, co2: 1.5 }),
  P('schinken', 'Schinken', '🥓', 'wurst', 14, ['schinken', 'kochschinken', 'putenaufschnitt', 'prosciutto', 'serrano'], { open: 4, price: 1.79 }),
  P('speck', 'Speck', '🥓', 'wurst', 21, ['speck', 'bacon', 'speckwuerfel', 'schinkenwuerfel', 'pancetta'], { open: 5, price: 1.49 }),
  P('wurst', 'Aufschnitt', '🥓', 'wurst', 14, ['wurst', 'salami', 'aufschnitt', 'mortadella', 'leberwurst', 'teewurst', 'lyoner', 'fleischwurst', 'chorizo'], { open: 5 }),
  P('tofu', 'Tofu', '🧆', 'fertig', 30, ['tofu', 'tempeh', 'seitan'], { open: 4, price: 1.99, co2: 0.4 }),
  // Brot
  P('brot', 'Brot', '🍞', 'brot', 4, ['brot', 'vollkornbrot', 'mischbrot', 'roggenbrot', 'sauerteig', 'krustenbrot', 'dinkelbrot', 'bauernbrot'], { price: 2.49 }),
  P('broetchen', 'Brötchen', '🥖', 'brot', 2, ['broetchen', 'brotchen', 'semmel', 'schrippe', 'weckle', 'baguette', 'ciabatta', 'laugen', 'brezel', 'croissant', 'aufback'], { price: 1.49, co2: 0.3 }),
  P('toast', 'Toastbrot', '🍞', 'brot', 8, ['toast', 'toastbrot', 'sandwich', 'american sandwich'], { price: 1.29 }),
  P('wraps', 'Wraps', '🌯', 'brot', 21, ['wrap', 'wraps', 'tortilla', 'tortillas'], { open: 5, price: 1.49 }),
  P('kuchen', 'Kuchen', '🍰', 'brot', 4, ['kuchen', 'muffin', 'berliner', 'donut', 'plunder', 'gebaeck'], { price: 2.99 }),
  // Vorrat
  P('nudeln', 'Nudeln', '🍝', 'vorrat', 365, ['nudeln', 'spaghetti', 'penne', 'fusilli', 'farfalle', 'pasta', 'tagliatelle', 'makkaroni', 'spirelli', 'rigatoni', 'linguine'], { price: 0.99, co2: 0.6 }),
  P('frischenudeln', 'Frische Nudeln', '🍝', 'fertig', 14, ['tortellini', 'ravioli', 'gnocchi', 'spaetzle', 'frische pasta'], { price: 1.99 }),
  P('reis', 'Reis', '🍚', 'vorrat', 365, ['reis', 'basmati', 'jasmin', 'risotto', 'milchreis', 'parboiled'], { price: 1.79, co2: 3 }),
  P('haferflocken', 'Haferflocken', '🥣', 'vorrat', 300, ['haferflocken', 'hafer', 'muesli', 'musli', 'granola', 'cornflakes'], { price: 0.79 }),
  P('mehl', 'Mehl', '🌾', 'vorrat', 365, ['mehl', 'weizenmehl', 'dinkelmehl'], { price: 0.69 }),
  P('dosentomaten', 'Dosentomaten', '🥫', 'vorrat', 540, ['passierte', 'passata', 'dosentomate', 'stueckige tomaten', 'gehackte tomaten', 'tomatenmark', 'pizzatomaten'], { open: 4, price: 0.79 }),
  P('bohnen', 'Bohnen', '🥫', 'vorrat', 540, ['bohnen', 'kidney', 'kichererbsen', 'linsen', 'weisse bohnen'], { open: 3, price: 0.89 }),
  P('kokosmilch', 'Kokosmilch', '🥥', 'vorrat', 540, ['kokosmilch', 'kokos'], { open: 3, price: 1.29 }),
  P('tomatensauce', 'Tomatensauce', '🥫', 'vorrat', 365, ['sugo', 'pastasauce', 'tomatensauce', 'arrabbiata', 'bolognese sauce', 'pesto', 'ketchup'], { open: 7, price: 1.69 }),
  P('marmelade', 'Marmelade', '🍯', 'vorrat', 365, ['marmelade', 'konfituere', 'nutella', 'honig', 'aufstrich'], { open: 60, price: 1.99 }),
  P('nuesse', 'Nüsse', '🥜', 'vorrat', 180, ['nuesse', 'nusse', 'mandeln', 'walnuss', 'cashew', 'erdnuss', 'haselnuss'], { price: 1.99 }),
  P('schokolade', 'Schokolade', '🍫', 'vorrat', 300, ['schokolade', 'schoko', 'ritter sport', 'milka', 'kekse', 'chips', 'gummibaerchen', 'riegel'], { price: 1.29 }),
  P('kaffee', 'Kaffee', '☕', 'vorrat', 365, ['kaffee', 'espresso', 'bohnenkaffee', 'cafe crema'], { price: 5.99, co2: 4 }),
  // Fertiges
  P('pizza', 'Pizza', '🍕', 'tk', 180, ['pizza', 'flammkuchen'], { price: 2.99 }),
  P('tkgemuese', 'TK-Gemüse', '🧊', 'tk', 365, ['tk ', 'tiefkuehl', 'tiefgekuehlt', 'rahmspinat', 'erbsen', 'pommes', 'kroketten', 'fischstaebchen'], { price: 1.99 }),
  P('eis', 'Eis', '🍦', 'tk', 365, ['eis', 'eiscreme', 'magnum', 'langnese'], { price: 2.99 }),
  P('salatfertig', 'Fertigsalat', '🥗', 'fertig', 3, ['nudelsalat', 'kartoffelsalat', 'krautsalat', 'fleischsalat', 'eiersalat'], { price: 1.99 }),
  P('hummus', 'Hummus & Dips', '🥙', 'fertig', 14, ['hummus', 'tzatziki', 'guacamole', 'dip', 'aufstrich'], { open: 4, price: 1.49 }),
  // Getränke
  P('saft', 'Saft', '🧃', 'getraenke', 270, ['saft', 'orangensaft', 'apfelsaft', 'multivitamin', 'nektar', 'smoothie', 'direktsaft', 'schorle'], { open: 5, price: 1.49 }),
  P('getraenk', 'Getränke', '🥤', 'getraenke', 365, ['wasser', 'mineralwasser', 'cola', 'limo', 'limonade', 'bier', 'wein', 'sprudel', 'eistee', 'mate'], { price: 0.79, co2: 0.3 }),
];

// Dinge auf dem Kassenbon, die nicht in den Vorrat gehören.
const NON_FOOD = [
  'spuelmittel', 'tabs', 'waschmittel', 'weichspueler', 'klopapier', 'toilettenpapier', 'kuechenrolle', 'kuechentuch', 'taschentuch',
  'zahnpasta', 'zahnbuerste', 'shampoo', 'duschgel', 'deo', 'seife', 'handcreme', 'sonnencreme', 'gesichtscreme', 'rasier', 'windel', 'feuchttuecher', 'tampon', 'binden',
  'muellbeutel', 'muellsack', 'alufolie', 'frischhaltefolie', 'backpapier', 'batterie', 'gluehbirne', 'kerze', 'servietten',
  'katzenfutter', 'hundefutter', 'katzenstreu', 'blumenstrauss', 'schnittblumen', 'tragetasche', 'tasche', 'tuete', 'beutel', 'zeitschrift', 'zeitung', 'zigaretten',
  'reiniger', 'putzmittel', 'schwamm', 'handseife', 'pflaster',
];

export const norm = (s) => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9%]+/g, ' ').trim();

export const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

// Findet das passende Produkt zu einem Text („BIO BANANE“, „Ja! H-Milch 3,5%“, „Erdbeerjoghurt“).
// Im Deutschen steht das Wichtigste am Wortende (Erdbeer|joghurt), deshalb zählen Treffer dort mehr.
export function matchProduct(text) {
  const t = ` ${norm(text)} `;
  const words = t.trim().split(' ');
  let best = null;
  let bestScore = 0;
  for (const p of PRODUCTS) {
    for (const raw of p.keys) {
      const whole = raw.startsWith('=');
      const key = norm(whole ? raw.slice(1) : raw);
      if (!key) continue;
      let score = 0;
      if (whole || key.length <= 2) {
        if (t.includes(` ${key} `)) score = key.length + 4;
      } else if (key.includes(' ')) {
        if (t.includes(key)) score = key.length + 3;
      } else {
        for (const w of words) {
          const i = w.indexOf(key);
          if (i < 0) continue;
          const mid = i > 0 && i + key.length < w.length;
          if (mid && key.length < 5) continue; // „eis“ steckt nicht in „Bleistift“
          let s = key.length;
          if (w === key) s += 4;
          else if (i + key.length === w.length) s += 3;
          else if (i === 0) s += 1;
          score = Math.max(score, s);
        }
      }
      if (score > bestScore) { bestScore = score; best = p; }
    }
  }
  return bestScore >= 3 ? best : null;
}

export function isNonFood(text) {
  const t = norm(text);
  return NON_FOOD.some((k) => t.split(' ').some((w) => w.startsWith(k) || w.endsWith(k)));
}

export function searchProducts(query, limit = 6) {
  const q = norm(query);
  if (!q) return [];
  const hits = [];
  for (const p of PRODUCTS) {
    const name = norm(p.name);
    let s = 0;
    if (name.startsWith(q)) s = 3;
    else if (name.includes(q)) s = 2;
    else if (p.keys.some((k) => norm(k.replace('=', '')).startsWith(q))) s = 1;
    if (s) hits.push([s, p]);
  }
  return hits.sort((a, b) => b[0] - a[0]).slice(0, limit).map((h) => h[1]);
}
