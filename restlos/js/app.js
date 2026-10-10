// Restlos – Oberfläche. Ansichten: Vorrat, Rezepte, Einkauf, Teilen, Bilanz.
import { createStore } from './store.js';
import { CATS, PLACES, PRODUCTS, byId, matchProduct, searchProducts } from './products.js';
import { iso, addDays, daysLeft, status, stats, openItem, parseFreeText, makeItem } from './pantry.js';
import { parseReceipt } from './receipt.js';
import { suggest } from './recipes.js';
import { shareItems, printPoster, calendarFile } from './share.js';

const store = createStore();
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const sheet = $('#sheet');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const kg = (n) => `${n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 })} kg`;
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dateLabel = (s) => { const [y, m, d] = s.split('-').map(Number); return `${WD[new Date(y, m - 1, d).getDay()]}. ${d}.${m}.`; };

// ---------- kleine Helfer ----------
let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  // Ein offenes Sheet liegt in der obersten Ebene – der Hinweis muss mit hinein, sonst ist er verdeckt.
  (sheet.open ? sheet : document.body).append(t);
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-action="undo">Rückgängig</button>' : ''}`;
  t.classList.add('show');
  toast.undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 6000 : 3000);
}

function openSheet(html, onReady) {
  sheet.innerHTML = `<div class="sheet-inner"><button class="sheet-close" data-action="close" aria-label="Schließen">✕</button>${html}</div>`;
  if (!sheet.open) sheet.showModal();
  onReady?.(sheet);
}
const closeSheet = () => sheet.open && sheet.close();
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

const badge = (item) => {
  const s = status(item);
  return `<span class="badge ${s.level}">${s.label}</span>`;
};

// ---------- Vorrat ----------
let placeFilter = 'alle';

function renderVorrat() {
  const items = store.items();
  const urgent = items.filter((i) => daysLeft(i) <= 2 && !i.offered);
  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const counts = { alle: items.length };
  for (const i of items) counts[i.place] = (counts[i.place] || 0) + 1;
  const shown = placeFilter === 'alle' ? items : items.filter((i) => i.place === placeFilter);

  const groups = [
    ['Drüber – erst prüfen', (d) => d < 0],
    ['Heute & morgen', (d) => d >= 0 && d <= 1],
    ['Diese Woche', (d) => d > 1 && d <= 7],
    ['Später', (d) => d > 7],
  ];
  const list = groups.map(([title, test]) => {
    const g = shown.filter((i) => test(daysLeft(i)));
    if (!g.length) return '';
    return `<h3 class="group">${title}</h3><ul class="list">${g.map(row).join('')}</ul>`;
  }).join('');

  view.innerHTML = `
    <section class="hero">
      <h1>${hello}!</h1>
      <p>${items.length ? `${items.length} ${items.length === 1 ? 'Sache' : 'Sachen'} im Vorrat${urgent.length ? ` · <b>${urgent.length} ${urgent.length === 1 ? 'muss' : 'müssen'} bald weg</b>` : ' · alles im grünen Bereich'}` : 'Dein Vorrat ist noch leer.'}</p>
    </section>
    ${urgent.length ? `
    <section class="card alert">
      <div class="alert-head">⏰ Bald weg: ${urgent.slice(0, 4).map((i) => esc(i.name)).join(', ')}${urgent.length > 4 ? ' …' : ''}</div>
      <div class="row-btns">
        <a class="btn primary" href="#/rezepte">Rezept dafür</a>
        <a class="btn" href="#/teilen">Verschenken</a>
      </div>
    </section>` : ''}
    <section class="quick">
      <button class="quick-btn" data-action="scan"><span>📷</span>Kassenbon</button>
      <button class="quick-btn" data-action="add" data-voice="1"><span>🎤</span>Sprechen</button>
      <button class="quick-btn" data-action="add"><span>⌨️</span>Eintippen</button>
    </section>
    ${items.length ? `
    <div class="chips" role="tablist">
      ${['alle', 'kuehl', 'vorrat', 'tk'].map((p) => `<button class="chip ${placeFilter === p ? 'on' : ''}" data-action="place" data-place="${p}">${p === 'alle' ? 'Alle' : PLACES[p]} <small>${counts[p] || 0}</small></button>`).join('')}
    </div>
    ${list || '<p class="muted center">Hier liegt gerade nichts.</p>'}` : `
    <section class="empty">
      <div class="big">🧺</div>
      <p><b>Kein Eintippen von Ablaufdaten.</b> Fotografiere einfach deinen Kassenbon – Restlos erkennt die Lebensmittel und schätzt, wie lange sie halten.</p>
      <button class="btn primary" data-action="scan">📷 Ersten Kassenbon scannen</button>
      <button class="btn ghost" data-action="demo">Erst mal mit Beispiel-Vorrat ausprobieren</button>
    </section>`}
  `;
}

function row(i) {
  return `<li class="item ${i.offered ? 'offered' : ''}">
    <button class="item-main" data-action="item" data-id="${i.id}">
      <span class="emoji">${i.emoji}</span>
      <span class="item-text"><b>${esc(i.name)}</b>${i.qty > 1 ? ` <small>× ${i.qty}</small>` : ''}
        <small class="sub">${i.offered ? '🤝 angeboten · ' : ''}${i.opened ? 'angebrochen · ' : ''}${PLACES[i.place]}</small></span>
      ${badge(i)}
    </button>
    <button class="done-btn" data-action="used" data-id="${i.id}" aria-label="${esc(i.name)} aufgebraucht">✓</button>
  </li>`;
}

function itemSheet(id) {
  const i = store.find(id);
  if (!i) return closeSheet();
  const s = status(i);
  const p = i.pid && byId[i.pid];
  let hint = '';
  if (s.d < 0 && s.vd) hint = '<p class="hint danger">Verbrauchsdatum überschritten – bitte nicht mehr essen.</p>';
  else if (s.d < 0) hint = '<p class="hint">Mindesthaltbarkeit heißt nicht „schlecht ab“. Ansehen, riechen, probieren – oft ist es noch gut.</p>';
  else if (!i.dateSet) hint = '<p class="hint muted">Datum geschätzt. Steht etwas anderes auf der Packung? Einfach unten ändern.</p>';
  openSheet(`
    <div class="sheet-head"><span class="emoji xl">${i.emoji}</span><div><h2 id="sheet-title">${esc(i.name)}${i.qty > 1 ? ` × ${i.qty}` : ''}</h2>
      <p>${badge(i)} <span class="muted">bis ${dateLabel(i.expires)}</span></p></div></div>
    ${hint}
    <div class="actions">
      <button class="act good" data-action="consume" data-id="${i.id}" data-how="used">✓<span>Aufgebraucht</span></button>
      ${i.qty > 1 ? `<button class="act" data-action="consume" data-id="${i.id}" data-how="used" data-qty="1">½<span>1 Stück weg</span></button>` : ''}
      ${!i.opened ? `<button class="act" data-action="open" data-id="${i.id}">🔓<span>Angebrochen</span></button>` : ''}
      ${i.place !== 'tk' ? `<button class="act" data-action="freeze" data-id="${i.id}">❄️<span>Einfrieren</span></button>` : ''}
      <button class="act" data-action="offer" data-id="${i.id}">🤝<span>${i.offered ? 'Nicht mehr anbieten' : 'Verschenken'}</span></button>
      <button class="act bad" data-action="consume" data-id="${i.id}" data-how="wasted">🗑<span>Weggeworfen</span></button>
    </div>
    <div class="form">
      <label>Gut bis <input type="date" value="${i.expires}" data-change="expires" data-id="${i.id}"></label>
      <label>Ort <select data-change="place" data-id="${i.id}">${Object.entries(PLACES).map(([k, v]) => `<option value="${k}" ${k === i.place ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Menge <input type="number" min="1" max="99" value="${i.qty}" data-change="qty" data-id="${i.id}"></label>
      <label>Preis (Stück) <input type="number" min="0" step="0.01" value="${i.price ?? ''}" data-change="price" data-id="${i.id}"></label>
    </div>
    <p class="muted small">Gekauft ${dateLabel(i.bought)}${i.raw ? ` · auf dem Bon: „${esc(i.raw)}“` : ''}${p ? ` · ${CATS[p.cat].name}` : ''}</p>
    <button class="link danger" data-action="consume" data-id="${i.id}" data-how="removed">Falsch eingetragen – löschen</button>
  `);
}

// ---------- Hinzufügen: Tippen oder Sprechen ----------
const QUICK = ['milch', 'eier', 'brot', 'bananen', 'tomaten', 'joghurt', 'kaese', 'aepfel', 'salat', 'butter', 'hackfleisch', 'gurke'];

function addSheet(voice) {
  openSheet(`
    <h2 id="sheet-title">Was ist neu im Vorrat?</h2>
    <p class="muted small">Mehrere Sachen mit Komma trennen – z. B. „Milch, 6 Eier, Brot“. Ablaufdaten schätzt Restlos.</p>
    <div class="input-row">
      <input id="add-text" type="text" autocomplete="off" enterkeyhint="done" placeholder="Milch, 6 Eier, Brot …" aria-label="Lebensmittel">
      <button class="icon-btn mic" data-action="listen" aria-label="Sprechen">🎤</button>
    </div>
    <div id="add-suggest" class="chips"></div>
    <div class="chips wrap">${QUICK.map((id) => `<button class="chip" data-action="quick-add" data-name="${byId[id].name}">${byId[id].emoji} ${byId[id].name}</button>`).join('')}</div>
    <ul id="add-preview" class="list compact"></ul>
    <button class="btn primary block" data-action="add-confirm" disabled>Hinzufügen</button>
  `, () => {
    const input = $('#add-text');
    input.addEventListener('input', updateAddPreview);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-action="add-confirm"]').click(); } });
    if (voice) listen(); else setTimeout(() => input.focus(), 50);
  });
}

function addPreviewItems() {
  return parseFreeText($('#add-text')?.value || '').map((x) => makeItem({ name: x.name, qty: x.qty }));
}

function updateAddPreview() {
  const input = $('#add-text');
  const items = addPreviewItems();
  $('#add-preview').innerHTML = items.map((i) => `<li class="item"><span class="emoji">${i.emoji}</span>
    <span class="item-text"><b>${esc(i.name)}</b>${i.qty > 1 ? ` <small>× ${i.qty}</small>` : ''}<small class="sub">${i.pid ? `hält ca. bis ${dateLabel(i.expires)}` : 'unbekannt – ca. 1 Woche'} · ${PLACES[i.place]}</small></span></li>`).join('');
  $('[data-action="add-confirm"]').disabled = !items.length;
  $('[data-action="add-confirm"]').textContent = items.length > 1 ? `${items.length} Sachen hinzufügen` : 'Hinzufügen';
  // Vorschläge zum letzten angefangenen Wort
  const last = input.value.split(/,|\bund\b/).pop().trim().replace(/^\d+\s*/, '');
  const hits = last.length >= 2 ? searchProducts(last, 4).filter((p) => p.name.toLowerCase() !== last.toLowerCase()) : [];
  $('#add-suggest').innerHTML = hits.map((p) => `<button class="chip" data-action="complete" data-name="${p.name}">${p.emoji} ${p.name}</button>`).join('');
}

function listen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Spracheingabe kann dieser Browser nicht – nutze das Mikrofon der Tastatur.');
  const rec = new SR();
  rec.lang = 'de-DE';
  rec.interimResults = true;
  const input = $('#add-text');
  const before = input.value ? `${input.value.replace(/,\s*$/, '')}, ` : '';
  const mic = $('.mic');
  mic?.classList.add('on');
  rec.onresult = (e) => {
    input.value = before + [...e.results].map((r) => r[0].transcript).join(' ');
    updateAddPreview();
  };
  rec.onend = () => mic?.classList.remove('on');
  rec.onerror = (e) => { mic?.classList.remove('on'); if (e.error === 'not-allowed') toast('Bitte Mikrofon erlauben.'); };
  rec.start();
}

// ---------- Kassenbon ----------
function scanSheet() {
  openSheet(`
    <h2 id="sheet-title">Kassenbon scannen</h2>
    <p class="muted">Bon glatt hinlegen, gut beleuchten, ganz aufs Foto. Die Erkennung läuft auf deinem Gerät – das Foto wird nicht hochgeladen.</p>
    <button class="btn primary block" data-action="photo">📷 Foto aufnehmen oder auswählen</button>
    <details class="paste">
      <summary>Digitalen Kassenbon einfügen (eBon aus REWE-, Lidl-Plus-App …)</summary>
      <textarea id="bon-text" rows="7" placeholder="Bon-Text hier einfügen …"></textarea>
      <button class="btn block" data-action="bon-text">Bon auswerten</button>
    </details>
  `);
}

async function handlePhoto(file) {
  openSheet(`<h2 id="sheet-title">Bon wird gelesen …</h2>
    <div class="progress"><div id="bar"></div></div><p id="progress-text" class="muted center">Einen Moment …</p>`);
  try {
    const { recognize } = await import('./ocr.js');
    const text = await recognize(file, (p, msg) => {
      $('#bar') && ($('#bar').style.width = `${Math.round(p * 100)}%`);
      $('#progress-text') && ($('#progress-text').textContent = msg);
    });
    reviewReceipt(text);
  } catch (e) {
    openSheet(`<h2 id="sheet-title">Das hat nicht geklappt</h2><p>${esc(e.message)}</p>
      <button class="btn primary block" data-action="photo">Nochmal versuchen</button>
      <button class="btn block" data-action="add">Lieber eintippen</button>`);
  }
}

let pending = [];
function reviewReceipt(text) {
  const { store: shop, date, items } = parseReceipt(text);
  const today = iso();
  const bought = date && date <= today && date >= addDays(today, -30) ? date : today;
  pending = items.map((x) => ({ ...makeItem({ name: x.name, pid: x.pid, qty: x.qty, price: x.price, bought, source: 'bon', raw: x.raw }), checked: x.known }));
  if (!pending.length) {
    return openSheet(`<h2 id="sheet-title">Keine Lebensmittel gefunden</h2>
      <p class="muted">Der Bon war schwer zu lesen. Tipp: flach hinlegen, ohne Schatten, näher ran. Oder einfach eintippen.</p>
      <button class="btn primary block" data-action="photo">Nochmal fotografieren</button>
      <button class="btn block" data-action="add">Eintippen</button>
      <details class="paste"><summary>Erkannter Text</summary><pre>${esc(text)}</pre></details>`);
  }
  const sum = pending.reduce((s, i) => s + i.price * i.qty, 0);
  openSheet(`
    <h2 id="sheet-title">${pending.length} Sachen erkannt</h2>
    <p class="muted small">${shop ? `${esc(shop)} · ` : ''}${dateLabel(bought)} · ${euro(sum)}. Haken weg bei allem, was nicht in den Vorrat soll.</p>
    <ul class="list compact checks">${pending.map((i, n) => `<li class="item"><label>
      <input type="checkbox" data-pick="${n}" ${i.checked ? 'checked' : ''}>
      <span class="emoji">${i.emoji}</span>
      <span class="item-text"><b>${esc(i.name)}</b>${i.qty > 1 ? ` <small>× ${i.qty}</small>` : ''}<small class="sub">${esc(i.raw)} · ${i.pid ? `bis ca. ${dateLabel(i.expires)}` : 'unbekannt'}</small></span>
      <span class="price">${euro(i.price * i.qty)}</span></label></li>`).join('')}</ul>
    <button class="btn primary block" data-action="bon-confirm">In den Vorrat übernehmen</button>
    <details class="paste"><summary>Fehlt etwas? Erkannten Text ansehen</summary><pre>${esc(text)}</pre>
      <button class="btn block" data-action="add">Fehlendes eintippen</button></details>
  `);
}

// ---------- Rezepte ----------
let lastSuggestions = [];
function renderRezepte() {
  const items = store.items();
  const veg = store.state.settings.veg;
  lastSuggestions = suggest(items.filter((i) => !i.offered), { vegOnly: veg, limit: 10 });
  view.innerHTML = `
    <section class="hero"><h1>Reste-Rezepte</h1><p>Sortiert nach dem, was zuerst weg muss.</p></section>
    <div class="chips"><button class="chip ${veg ? 'on' : ''}" data-action="veg">🥦 Nur vegetarisch</button></div>
    ${lastSuggestions.length ? lastSuggestions.map((r, n) => `
      <button class="card recipe" data-action="recipe" data-n="${n}">
        <span class="emoji xl">${r.emoji}</span>
        <span class="recipe-text"><b>${esc(r.title)}</b>
          <small>${r.time} Min. · nutzt ${r.uses.length} ${r.uses.length === 1 ? 'Sache' : 'Sachen'} aus dem Vorrat</small>
          ${r.urgent.length ? `<small class="save">🌱 rettet ${r.urgent.map((i) => esc(i.name)).join(', ')}</small>` : ''}
          ${r.missing.length ? `<small class="miss">fehlt: ${r.missing.map(esc).join(', ')}</small>` : ''}</span>
      </button>`).join('') : `
      <section class="empty"><div class="big">🍳</div><p>Sobald etwas im Vorrat ist, schlägt Restlos hier Gerichte vor – zuerst die, die Ablaufendes aufbrauchen.</p>
      <button class="btn primary" data-action="scan">📷 Kassenbon scannen</button></section>`}
  `;
}

function recipeSheet(n) {
  const r = lastSuggestions[n];
  if (!r) return;
  openSheet(`
    <div class="sheet-head"><span class="emoji xl">${r.emoji}</span><div><h2 id="sheet-title">${esc(r.title)}</h2><p class="muted">${r.time} Minuten${r.veg ? ' · vegetarisch' : ''}</p></div></div>
    <h3>Aus deinem Vorrat</h3>
    <ul class="list compact checks">${r.uses.map((i) => `<li class="item"><label><input type="checkbox" data-use="${i.id}" checked>
      <span class="emoji">${i.emoji}</span><span class="item-text"><b>${esc(i.name)}</b></span>${badge(i)}</label></li>`).join('')}</ul>
    ${r.missing.length ? `<p>Fehlt noch: <b>${r.missing.map(esc).join(', ')}</b> <button class="link" data-action="to-list" data-names="${esc(r.missing.join('|'))}">→ auf die Einkaufsliste</button></p>` : ''}
    <p class="muted small">Dazu aus dem Schrank: Salz, Pfeffer, Öl, ggf. Mehl, Zucker, Gewürze.</p>
    <h3>So geht's</h3>
    <ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <button class="btn primary block" data-action="cooked">Gekocht! Zutaten austragen</button>
  `);
}

// ---------- Einkauf ----------
function renderEinkauf() {
  const list = store.state.shopping;
  const items = store.items();
  const inStock = (name) => {
    const p = matchProduct(name);
    return items.filter((i) => (p ? i.pid === p.id : i.name.toLowerCase() === name.toLowerCase()));
  };
  const done = list.filter((s) => s.done).length;
  view.innerHTML = `
    <section class="hero"><h1>Einkaufsliste</h1><p>Restlos warnt, wenn du etwas schon zu Hause hast.</p></section>
    <form class="input-row" data-form="shop">
      <input id="shop-text" type="text" autocomplete="off" enterkeyhint="send" placeholder="Was brauchst du?" aria-label="Neuer Eintrag">
      <button class="icon-btn" aria-label="Hinzufügen">＋</button>
    </form>
    <p id="shop-warn" class="hint" hidden></p>
    ${list.length ? `<ul class="list">${list.map((s) => {
      const have = inStock(s.name);
      return `<li class="item ${s.done ? 'checked' : ''}">
        <label class="item-main"><input type="checkbox" data-action="shop-toggle" data-id="${s.id}" ${s.done ? 'checked' : ''}>
          <span class="item-text"><b>${esc(s.name)}</b>${s.qty > 1 ? ` <small>× ${s.qty}</small>` : ''}
          ${have.length && !s.done ? `<small class="sub warn">Noch da: ${have.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${esc(i.name)} (${status(i).label})`).join(', ')}</small>` : ''}</span></label>
        <button class="done-btn ghost" data-action="shop-remove" data-id="${s.id}" aria-label="Entfernen">✕</button>
      </li>`;
    }).join('')}</ul>
    ${done ? `<button class="btn primary block" data-action="shop-to-pantry">${done} abgehakte Sachen in den Vorrat</button>` : ''}`
    : '<p class="muted center">Noch nichts auf der Liste.</p>'}
  `;
  const input = $('#shop-text');
  input.addEventListener('input', () => {
    const have = input.value.trim().length > 2 ? inStock(input.value.trim()) : [];
    const warn = $('#shop-warn');
    warn.hidden = !have.length;
    warn.innerHTML = have.length ? `🤔 Hast du noch: ${have.map((i) => `<b>${i.qty > 1 ? `${i.qty}× ` : ''}${esc(i.name)}</b> (${status(i).label})`).join(', ')}` : '';
  });
}

// ---------- Teilen ----------
function renderTeilen() {
  const items = store.items();
  const offered = items.filter((i) => i.offered);
  // Rohes Fleisch, Geflügel und Fisch (Verbrauchsdatum) gibt man nicht weiter – wie bei foodsharing.
  const candidates = items.filter((i) => !i.offered && daysLeft(i) >= 0 && !(i.pid && byId[i.pid]?.vd));
  const flat = store.state.settings.flat;
  view.innerHTML = `
    <section class="hero"><h1>Im Hausflur teilen</h1><p>Was du nicht mehr schaffst, freut die Nachbarn. Teile es in der Haus-Gruppe oder häng einen Aushang auf.</p></section>
    <label class="field">Abholen bei (Name an der Klingel, Etage)
      <input type="text" value="${esc(flat)}" data-setting="flat" placeholder="z. B. Müller, 3. OG links"></label>
    ${offered.length ? `<h3 class="group">Angeboten</h3><ul class="list">${offered.map((i) => `<li class="item">
      <span class="item-main static"><span class="emoji">${i.emoji}</span><span class="item-text"><b>${esc(i.name)}</b>${i.qty > 1 ? ` <small>× ${i.qty}</small>` : ''}<small class="sub">gut bis ${dateLabel(i.expires)}</small></span></span>
      <button class="btn small primary" data-action="consume" data-id="${i.id}" data-how="shared">Abgeholt</button></li>`).join('')}</ul>
      <div class="row-btns"><button class="btn" data-action="share-offered">📲 Nochmal teilen</button><button class="btn" data-action="poster">🖨 Aushang drucken</button></div>` : ''}
    <h3 class="group">Was möchtest du anbieten?</h3>
    ${candidates.length ? `<ul class="list compact checks">${candidates.map((i) => `<li class="item"><label>
      <input type="checkbox" data-offer="${i.id}" ${daysLeft(i) <= 3 ? 'checked' : ''}>
      <span class="emoji">${i.emoji}</span><span class="item-text"><b>${esc(i.name)}</b>${i.qty > 1 ? ` <small>× ${i.qty}</small>` : ''}</span>${badge(i)}</label></li>`).join('')}</ul>
      <div class="row-btns"><button class="btn primary" data-action="share">📲 In Haus-Gruppe teilen</button><button class="btn" data-action="poster-new">🖨 Aushang</button></div>
      <p class="muted small">Fleisch, Fisch und Geflügel nach Verbrauchsdatum bitte nicht weitergeben. Angebrochenes nur, wenn du es selbst noch essen würdest.</p>`
    : '<p class="muted center">Gerade nichts zum Verschenken.</p>'}
  `;
}

const selectedOffers = () => [...view.querySelectorAll('[data-offer]:checked')].map((c) => store.find(c.dataset.offer)).filter(Boolean);

// ---------- Bilanz & Einstellungen ----------
function renderBilanz() {
  const s = stats(store.state.log);
  const all = stats(store.state.log, iso(), 3650);
  const rate = s.rate ?? 0;
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  view.innerHTML = `
    <section class="hero"><h1>Deine Bilanz</h1><p>Letzte 30 Tage</p></section>
    ${s.rate === null ? '<p class="muted center">Sobald du Sachen als aufgebraucht, verschenkt oder weggeworfen markierst, siehst du hier, wie viel du rettest.</p>' : `
    <section class="card stat-hero">
      <div class="ring" style="--p:${rate}"><span>${rate}%</span></div>
      <div><b>gerettet statt weggeworfen</b><p class="muted small">${s.saved} gegessen oder verschenkt, ${s.wasted} im Müll</p></div>
    </section>
    <div class="stats">
      <div class="card stat"><b>${euro(s.wastedEuro)}</b><small>im Müll gelandet</small></div>
      <div class="card stat"><b>${kg(s.wastedCo2)}</b><small>CO₂ dadurch verschwendet</small></div>
      <div class="card stat"><b>${s.shared}</b><small>an Nachbarn verschenkt</small></div>
      <div class="card stat"><b>${kg(all.savedCo2)}</b><small>CO₂ insgesamt gerettet</small></div>
    </div>
    ${s.topWasted.length ? `<section class="card tip">💡 Am häufigsten weggeworfen: <b>${s.topWasted.map(([n, c]) => `${esc(n)} (${c}×)`).join(', ')}</b>. Kleinere Packungen kaufen oder direkt nach dem Einkauf einen Teil einfrieren?</section>` : ''}`}
    <p class="muted small">Zum Vergleich: Ein Haushalt in Deutschland wirft im Schnitt rund 78 kg Lebensmittel pro Person und Jahr weg – Gegenwert etwa 300 €.</p>

    <h3 class="group">Erinnerungen</h3>
    <div class="card settings">
      <button class="set" data-action="calendar"><span>📅</span><span><b>In den Kalender eintragen</b><small>Erinnerung am Vorabend für alles, was in den nächsten 3 Wochen abläuft</small></span></button>
      ${notif !== 'unsupported' ? `<button class="set" data-action="notify"><span>🔔</span><span><b>Mitteilungen ${notif === 'granted' ? 'sind an' : 'erlauben'}</b><small>Hinweis beim Öffnen, wenn heute etwas abläuft</small></span></button>` : ''}
    </div>
    <h3 class="group">Daten</h3>
    <div class="card settings">
      <button class="set" data-action="export"><span>💾</span><span><b>Sicherung speichern</b><small>Alles bleibt auf diesem Gerät – hier als Datei sichern</small></span></button>
      <button class="set" data-action="import"><span>📂</span><span><b>Sicherung laden</b><small>z. B. auf einem neuen Handy</small></span></button>
      <button class="set" data-action="demo"><span>🧪</span><span><b>Beispiel-Vorrat laden</b><small>Zum Ausprobieren</small></span></button>
      <button class="set danger" data-action="reset"><span>🗑</span><span><b>Alles löschen</b></span></button>
    </div>
    <p class="muted small center">Restlos · Prototyp · Haltbarkeiten und CO₂-Werte sind Schätzungen.</p>
  `;
}

// ---------- Beispiel-Vorrat ----------
function loadDemo() {
  const t = iso();
  const demo = [['Joghurt', 1, 0], ['Milch', 1, 2], ['Brot', 1, 1], ['Bananen', 4, 1], ['Zucchini', 2, 3], ['Paprika', 2, 4], ['Eier', 6, 12],
    ['Gouda', 1, 9], ['Hackfleisch', 1, 1], ['Spinat', 1, 0], ['Nudeln', 2, 300], ['Kartoffeln', 1, 20], ['Zwiebeln', 1, 25], ['Äpfel', 6, 14], ['Tomaten', 4, 2], ['Kidney Bohnen', 1, 400]];
  store.add(demo.map(([name, qty, d]) => ({ name, qty, expires: addDays(t, d), bought: addDays(t, -2) })), 'demo');
  const log = [['Salat', 'gemuese', 'wasted', 1.29, 3], ['Joghurt', 'milch', 'used', 0.89, 5], ['Brot', 'brot', 'used', 2.49, 6], ['Bananen', 'obst', 'shared', 1.49, 8], ['Milch', 'milch', 'used', 1.19, 9], ['Salat', 'gemuese', 'wasted', 1.29, 12], ['Käse', 'kaese', 'used', 2.29, 15]];
  for (const [name, cat, action, price, ago] of log) store.state.log.push({ id: `d${ago}`, name, pid: matchProduct(name)?.id, cat, qty: 1, price, action, date: addDays(t, -ago) });
  store.setting('demo', true);
  toast('Beispiel-Vorrat geladen');
}

// ---------- Aktionen ----------
const actions = {
  add: (el) => addSheet(!!el.dataset.voice),
  scan: scanSheet,
  demo: () => { closeSheet(); loadDemo(); location.hash = '#/vorrat'; },
  close: closeSheet,
  undo: () => { toast.undo?.(); toast.undo = null; $('#toast').classList.remove('show'); },
  place: (el) => { placeFilter = el.dataset.place; render(); },
  item: (el) => itemSheet(el.dataset.id),
  used: (el) => consume(el.dataset.id, 'used'),
  consume: (el) => { closeSheet(); consume(el.dataset.id, el.dataset.how, el.dataset.qty ? +el.dataset.qty : undefined); },
  open: (el) => { const i = store.find(el.dataset.id); store.update(i.id, openItem(i)); itemSheet(i.id); },
  freeze: (el) => {
    const i = store.find(el.dataset.id);
    store.update(i.id, { place: 'tk', expires: addDays(iso(), i.cat === 'fleisch' ? 90 : 60) });
    closeSheet();
    toast(`${i.name} eingefroren – hält jetzt bis ${dateLabel(store.find(i.id).expires)}`);
  },
  offer: (el) => {
    const i = store.find(el.dataset.id);
    store.update(i.id, { offered: i.offered ? null : iso() });
    closeSheet();
    if (!i.offered) location.hash = '#/teilen';
  },
  // Hinzufügen
  listen,
  'quick-add': (el) => {
    const input = $('#add-text');
    input.value = input.value.trim() ? `${input.value.replace(/,\s*$/, '')}, ${el.dataset.name}` : el.dataset.name;
    updateAddPreview();
  },
  complete: (el) => {
    const input = $('#add-text');
    const parts = input.value.split(',');
    const last = parts.pop();
    const num = last.trim().match(/^\d+\s*/)?.[0] || '';
    parts.push(`${parts.length ? ' ' : ''}${num}${el.dataset.name}`);
    input.value = `${parts.join(',')}, `;
    input.focus();
    updateAddPreview();
  },
  'add-confirm': () => {
    const items = parseFreeText($('#add-text').value);
    if (!items.length) return;
    const added = store.add(items, 'hand');
    closeSheet();
    toast(added.length === 1 ? `${added[0].name} hinzugefügt` : `${added.length} Sachen hinzugefügt`, () => added.forEach((i) => store.consume(i.id, 'removed')));
  },
  // Kassenbon
  photo: () => $('#photo').click(),
  'bon-text': () => reviewReceipt($('#bon-text').value),
  'bon-confirm': () => {
    const picked = pending.filter((_, n) => $(`[data-pick="${n}"]`)?.checked);
    const added = store.add(picked.map(({ name, pid, qty, price, bought, raw }) => ({ name, pid, qty, price, bought, raw, source: 'bon' })));
    pending = [];
    closeSheet();
    location.hash = '#/vorrat';
    toast(`${added.length} Sachen im Vorrat`, () => added.forEach((i) => store.consume(i.id, 'removed')));
  },
  // Rezepte
  veg: () => { store.setting('veg', !store.state.settings.veg); },
  recipe: (el) => recipeSheet(+el.dataset.n),
  'to-list': (el) => { el.dataset.names.split('|').forEach((n) => store.addShopping(n)); toast('Auf der Einkaufsliste'); el.remove(); },
  cooked: () => {
    const ids = [...sheet.querySelectorAll('[data-use]:checked')].map((c) => c.dataset.use);
    const undos = ids.map((id) => store.consume(id, 'used', 1)).filter(Boolean);
    closeSheet();
    toast(`Guten Appetit! ${ids.length} ${ids.length === 1 ? 'Sache' : 'Sachen'} gerettet 🌱`, () => undos.reverse().forEach((u) => u()));
  },
  // Einkauf
  'shop-toggle': (el) => store.toggleShopping(el.dataset.id),
  'shop-remove': (el) => store.removeShopping(el.dataset.id),
  'shop-to-pantry': () => { const added = store.shoppingToPantry(); toast(`${added.length} Sachen in den Vorrat übernommen`); },
  // Teilen
  share: async () => {
    const items = selectedOffers();
    if (!items.length) return toast('Erst etwas auswählen');
    items.forEach((i) => store.update(i.id, { offered: iso() }));
    const how = await shareItems(items, store.state.settings.flat);
    if (how === 'copied') toast('Text kopiert – jetzt in die Haus-Gruppe einfügen');
  },
  'share-offered': async () => {
    const how = await shareItems(store.items().filter((i) => i.offered), store.state.settings.flat);
    if (how === 'copied') toast('Text kopiert');
  },
  poster: () => printPoster(store.items().filter((i) => i.offered), store.state.settings.flat) || toast('Bitte Pop-ups erlauben'),
  'poster-new': () => {
    const items = selectedOffers();
    if (!items.length) return toast('Erst etwas auswählen');
    items.forEach((i) => store.update(i.id, { offered: iso() }));
    printPoster(items, store.state.settings.flat) || toast('Bitte Pop-ups erlauben');
  },
  // Einstellungen
  calendar: () => {
    const ics = calendarFile(store.items());
    if (!ics) return toast('In den nächsten 3 Wochen läuft nichts ab');
    download(ics, 'restlos-erinnerungen.ics', 'text/calendar');
  },
  notify: async () => {
    if (Notification.permission === 'granted') return toast('Mitteilungen sind schon an');
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Mitteilungen an' : 'Mitteilungen wurden nicht erlaubt');
    render();
  },
  export: () => download(store.exportJson(), `restlos-sicherung-${iso()}.json`, 'application/json'),
  import: () => $('#backup').click(),
  reset: () => { if (confirm('Wirklich alles löschen? Vorrat, Einkaufsliste und Bilanz.')) { store.reset(); toast('Alles gelöscht'); } },
};

function consume(id, how, qty) {
  const i = store.find(id);
  if (!i) return;
  const undo = store.consume(id, how, qty);
  const msg = { used: `${i.name} aufgebraucht 👍`, wasted: `${i.name} weggeworfen`, shared: `${i.name} verschenkt – danke! 🤝`, removed: `${i.name} gelöscht` }[how];
  toast(msg, undo);
}

function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  if (el.tagName === 'INPUT') { actions[el.dataset.action](el); return; }
  e.preventDefault();
  actions[el.dataset.action](el);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.change) {
    let v = el.value;
    if (el.dataset.change === 'qty') v = Math.max(1, Math.min(99, +v || 1));
    if (el.dataset.change === 'price') v = Math.max(0, +v || 0);
    if (el.dataset.change === 'expires' && !v) return;
    store.update(el.dataset.id, { [el.dataset.change]: v, ...(el.dataset.change === 'expires' ? { dateSet: true } : {}) });
    if (el.dataset.change === 'expires') itemSheet(el.dataset.id);
  }
  if (el.dataset.setting) store.setting(el.dataset.setting, el.value.trim());
});

document.addEventListener('submit', (e) => {
  if (e.target.dataset.form !== 'shop') return;
  e.preventDefault();
  const input = $('#shop-text');
  const text = input.value;
  input.value = '';
  for (const x of parseFreeText(text)) store.addShopping(x.name, x.qty);
  $('#shop-text')?.focus();
});

$('#photo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) handlePhoto(f);
});

$('#backup').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { store.importJson(await f.text()); toast('Sicherung geladen'); } catch (err) { toast(`Konnte die Datei nicht lesen: ${err.message}`); }
});

// ---------- Navigation ----------
const ROUTES = { vorrat: renderVorrat, rezepte: renderRezepte, einkauf: renderEinkauf, teilen: renderTeilen, bilanz: renderBilanz };
const current = () => location.hash.replace('#/', '').split('?')[0] || 'vorrat';

function render() {
  const route = ROUTES[current()] ? current() : 'vorrat';
  // Eingaben nicht beim Tippen wegrendern (z. B. Klingelschild)
  const active = document.activeElement;
  const keep = active?.dataset?.setting ? active.dataset.setting : null;
  ROUTES[route]();
  if (keep) view.querySelector(`[data-setting="${keep}"]`)?.focus();
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === route));
  const shopCount = store.state.shopping.filter((s) => !s.done).length;
  $('#tabs [data-tab="einkauf"]').dataset.count = shopCount || '';
}

let lastRoute = current();
window.addEventListener('hashchange', () => {
  render();
  if (current() !== lastRoute) { window.scrollTo(0, 0); lastRoute = current(); }
});
store.subscribe(render);
render();

// ---------- Erinnerung beim Öffnen ----------
async function remind() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = iso();
  if (store.state.settings.notified === today) return;
  const due = store.items().filter((i) => daysLeft(i) >= 0 && daysLeft(i) <= 1);
  if (!due.length) return;
  store.setting('notified', today);
  const body = `${due.map((i) => i.name).join(', ')} ${due.length === 1 ? 'sollte' : 'sollten'} heute oder morgen weg. Tippe für Rezeptideen.`;
  const reg = await navigator.serviceWorker?.ready.catch(() => null);
  if (reg) reg.showNotification('Restlos', { body, icon: 'icons/icon-192.png', tag: 'restlos-due', data: { url: './#/rezepte' } });
  else new Notification('Restlos', { body });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
setTimeout(remind, 1500);
// Schnellzugriff vom Startbildschirm („Kassenbon scannen“)
if (location.hash.includes('scan=1')) { history.replaceState(null, '', '#/vorrat'); scanSheet(); }

// Für Tests und Entwickler-Konsole
window.restlos = { store, PRODUCTS };
