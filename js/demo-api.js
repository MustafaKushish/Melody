// Demo backend that runs entirely in the browser (localStorage). Used only by the try-it-out
// build (<html data-demo="1">). Same endpoints and answers as the real server, no real payments.
import { ApiError } from './api.js';

const KEY = 'melody.demo.db';
const DAY = 86400000;
const PLANS = [
  { id: 'monthly', name: 'Melody Premium – Monatlich', priceCents: 499, interval: 'month', months: 1, note: 'Monatlich kündbar' },
  { id: 'yearly', name: 'Melody Premium – Jährlich', priceCents: 4999, interval: 'year', months: 12, note: '2 Monate geschenkt', badge: 'Beliebteste Wahl' },
];
const VOUCHERS = [
  { id: 'v1', months: 1, priceCents: 499, name: 'Melody Gutschein – 1 Monat' },
  { id: 'v3', months: 3, priceCents: 1449, name: 'Melody Gutschein – 3 Monate' },
  { id: 'v6', months: 6, priceCents: 2799, name: 'Melody Gutschein – 6 Monate' },
  { id: 'v12', months: 12, priceCents: 4999, name: 'Melody Gutschein – 12 Monate' },
];
const SOUNDS = ['Melody Signature', 'Melody Bass', 'Melody Klar', 'Melody Party', 'Melody Chill', 'Melody Live'];

function load() {
  try { return { users: [], vouchers: [], presets: {}, session: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { users: [], vouchers: [], presets: {}, session: null }; }
}
const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));

async function hash(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('melody-demo:' + pw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function account(u) {
  const t = Date.now();
  const premium = u.premiumUntil > t;
  const trial = !premium && u.trialEnds > t;
  return {
    id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, access: premium || trial,
    status: premium ? 'premium' : trial ? 'trial' : 'expired', trialEnds: u.trialEnds, premiumUntil: u.premiumUntil,
    plan: u.plan ? { id: u.plan, name: PLANS.find((p) => p.id === u.plan).name } : null, subscription: null,
  };
}

function extend(u, months) {
  const d = new Date(Math.max(u.premiumUntil || 0, Date.now()));
  d.setMonth(d.getMonth() + months);
  u.premiumUntil = d.getTime();
}

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => A[b % A.length]).join('');
  return `MELO-${pick()}-${pick()}`;
}

export async function demoApi(path, method, body = {}) {
  const db = load();
  const me = db.users.find((u) => u.id === db.session);
  const need = () => { if (!me) throw new ApiError(401, 'Bitte melde dich an.'); return me; };
  const [route, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const done = (out) => { save(db); return out; };

  switch (`${method} ${route}`) {
    case 'GET /health': return { ok: true };
    case 'GET /pricing': return { currency: 'eur', trialDays: 7, plans: PLANS, vouchers: VOUCHERS, demo: true, payments: true, ai: false };
    case 'GET /me': return { account: account(need()) };
    case 'POST /auth/register': {
      const email = String(body.email || '').trim().toLowerCase();
      if (!String(body.name || '').trim()) throw new ApiError(400, 'Bitte gib deinen Namen ein.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ApiError(400, 'Bitte gib eine gültige E-Mail-Adresse ein.');
      if (String(body.password || '').length < 8) throw new ApiError(400, 'Das Passwort muss mindestens 8 Zeichen lang sein.');
      if (!body.acceptTerms) throw new ApiError(400, 'Bitte stimme den AGB und der Datenschutzerklärung zu.');
      if (db.users.some((u) => u.email === email)) throw new ApiError(409, 'Für diese E-Mail gibt es bereits ein Konto.');
      const u = { id: Date.now(), name: body.name.trim(), email, pass: await hash(body.password), createdAt: Date.now(), trialEnds: Date.now() + 7 * DAY, premiumUntil: 0, plan: null };
      db.users.push(u);
      db.session = u.id;
      return done({ account: account(u) });
    }
    case 'POST /auth/login': {
      const u = db.users.find((x) => x.email === String(body.email || '').trim().toLowerCase());
      if (!u || u.pass !== (await hash(String(body.password || '')))) throw new ApiError(401, 'E-Mail oder Passwort ist falsch.');
      db.session = u.id;
      return done({ account: account(u) });
    }
    case 'POST /auth/logout': db.session = null; return done({ ok: true });
    case 'POST /account/delete': {
      const u = need();
      if (u.pass !== (await hash(String(body.password || '')))) throw new ApiError(401, 'Passwort ist falsch.');
      db.users = db.users.filter((x) => x !== u);
      db.session = null;
      return done({ ok: true });
    }
    case 'POST /billing/checkout': {
      const u = need();
      if (body.kind === 'plan') {
        const p = PLANS.find((x) => x.id === body.id);
        if (!p) throw new ApiError(400, 'Unbekanntes Produkt.');
        extend(u, p.months);
        u.plan = p.id;
        return done({ demo: true });
      }
      const v = VOUCHERS.find((x) => x.id === body.id);
      if (!v) throw new ApiError(400, 'Unbekanntes Produkt.');
      const c = code();
      db.vouchers.push({ code: c, months: v.months, buyer: u.id, createdAt: Date.now(), redeemedAt: null });
      return done({ demo: true, code: c });
    }
    case 'POST /billing/cancel-demo': need().plan = null; return done({ ok: true });
    case 'POST /billing/portal': throw new ApiError(400, 'Im Demo-Modus nicht verfügbar.');
    case 'POST /vouchers/redeem': {
      const u = need();
      const c = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MELO(\w{4})(\w{4})$/, 'MELO-$1-$2');
      const v = db.vouchers.find((x) => x.code === c);
      if (!v) throw new ApiError(404, 'Dieser Gutscheincode ist ungültig.');
      if (v.redeemedAt) throw new ApiError(409, 'Dieser Gutschein wurde bereits eingelöst.');
      v.redeemedAt = Date.now();
      extend(u, v.months);
      return done({ months: v.months, account: account(u) });
    }
    case 'GET /vouchers': {
      const u = need();
      return { vouchers: db.vouchers.filter((v) => v.buyer === u.id).map(({ code: c, months, createdAt, redeemedAt }) => ({ code: c, months, createdAt, redeemedAt })) };
    }
    case 'GET /vouchers/session': return { voucher: null };
    case 'POST /presets/choice': db.presets[need().id] = String(body.preset || ''); return done({ ok: true });
    case 'GET /presets/popular': {
      const counts = {};
      for (const p of Object.values(db.presets)) counts[p] = (counts[p] || 0) + 1;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const presets = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([preset, users]) => ({ preset, users, share: users / total }));
      return { total, melody: SOUNDS, presets };
    }
    case 'GET /lyrics': {
      need();
      // Demo: lyrics for catalog songs only.
      const r = await fetch('catalog/catalog.json').then((x) => x.json()).catch(() => ({ tracks: [] }));
      const c = r.tracks.find((x) => x.title.toLowerCase() === (q.get('title') || '').toLowerCase());
      if (!c?.lyrics) return { found: false };
      const synced = await fetch('catalog/' + c.lyrics).then((x) => x.text()).catch(() => '');
      return synced ? { found: true, synced, plain: '' } : { found: false };
    }
    case 'POST /ai/recommend': throw new ApiError(503, 'KI im Demo-Modus nicht verbunden.');
    default: throw new ApiError(404, 'Unbekannte Adresse.');
  }
}
