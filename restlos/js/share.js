// Teilen im Hausflur und Erinnerungen – ohne eigenen Server:
// Text für die Haus-WhatsApp-Gruppe / nebenan.de, ein Aushang zum Ausdrucken und Kalender-Erinnerungen (.ics).
import { addDays, daysLeft, iso } from './pantry.js';

const fmt = (s) => { const [, m, d] = s.split('-'); return `${+d}.${+m}.`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function shareText(items, flat) {
  const lines = items.map((i) => `• ${i.qty > 1 ? `${i.qty}× ` : ''}${i.name} (gut bis ${fmt(i.expires)})`);
  return `🥕 Zu verschenken – bevor es schlecht wird:\n${lines.join('\n')}\n\nAbholen bei: ${flat || 'mir'} – einfach klingeln oder kurz schreiben 🙂`;
}

export async function shareItems(items, flat) {
  const text = shareText(items, flat);
  if (navigator.share) {
    try { await navigator.share({ title: 'Zu verschenken', text }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  await navigator.clipboard?.writeText(text);
  return 'copied';
}

// DIN-A4-Aushang mit Abreißzetteln für das schwarze Brett im Hausflur.
export function printPoster(items, flat) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const rows = items.map((i) => `<li><span>${i.emoji}</span> ${i.qty > 1 ? `${i.qty}× ` : ''}${esc(i.name)} <small>gut bis ${fmt(i.expires)}</small></li>`).join('');
  const tab = `<div class="tab">${esc(flat || 'Bitte klingeln')}</div>`.repeat(8);
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Zu verschenken</title><style>
    @page { size: A4; margin: 14mm; }
    body { font: 16px/1.4 system-ui, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 46px; margin: 0 0 4px; } p.lead { font-size: 20px; margin: 0 0 18px; color: #333; }
    ul { list-style: none; padding: 0; font-size: 24px; } li { padding: 8px 0; border-bottom: 1px dashed #bbb; }
    li span { font-size: 30px; } small { color: #555; font-size: 16px; margin-left: 6px; }
    .who { font-size: 22px; margin: 22px 0; padding: 14px; border: 3px solid #1f7a4d; border-radius: 12px; }
    .tabs { position: fixed; bottom: 0; left: 0; right: 0; display: flex; border-top: 2px dashed #000; }
    .tab { flex: 1; writing-mode: vertical-rl; transform: rotate(180deg); padding: 12px 4px; border-left: 1px dashed #000; font-size: 14px; height: 52mm; }
    .foot { color: #777; font-size: 12px; }
  </style></head><body>
    <h1>🥕 Zu verschenken!</h1>
    <p class="lead">Noch gut – aber bei mir wird es nicht mehr gegessen. Bevor es im Müll landet: nimm es gern!</p>
    <ul>${rows}</ul>
    <div class="who">Abholen bei: <b>${esc(flat || '______________________')}</b><br>Einfach klingeln oder einen Zettel abreißen.</div>
    <p class="foot">Erstellt mit Restlos · ${fmt(iso())}</p>
    <div class="tabs">${tab}</div>
    <script>setTimeout(() => print(), 300);<\/script>
  </body></html>`);
  w.document.close();
  return true;
}

// Erinnerungen in den Handy-Kalender: je Tag ein Termin um 18 Uhr am Vortag des Ablaufs.
export function calendarFile(items, today = iso()) {
  const byDay = {};
  for (const i of items) {
    const d = daysLeft(i, today);
    if (d < 1 || d > 21) continue;
    const day = addDays(i.expires, -1);
    (byDay[day] ??= []).push(i.name);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const fold = (s) => s.replace(/[,;\\]/g, (c) => `\\${c}`);
  const events = Object.entries(byDay).map(([day, names]) => {
    const d = day.replace(/-/g, '');
    return [
      'BEGIN:VEVENT',
      `UID:restlos-${d}@restlos.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${d}T180000`,
      `DTEND:${d}T181500`,
      `SUMMARY:${fold(`🥕 Restlos: ${names.join(', ')} läuft morgen ab`)}`,
      `DESCRIPTION:${fold('Heute verkochen, einfrieren oder im Hausflur verschenken.')}`,
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Restlos', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  if (!events.length) return null;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Restlos//DE', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}
