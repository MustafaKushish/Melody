import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now } from './db.js';
import {
  HttpError, register, login, createSession, sessionCookie, userFromRequest, destroySession,
  publicAccount, deleteAccount, verifyPassword, rateLimit, getUser, applyStudent, decideStudent, pendingStudents,
} from './auth.js';
import { pricing, checkout, portal, demoCancel, redeemVoucher, myVouchers, voucherForSession, webhook } from './billing.js';
import { recommend, aiEnabled, MELODY_PRESETS } from './ai.js';
import { findLyrics } from './lyrics.js';
import { recognize, recognitionEnabled, addWish, topWishes } from './recognize.js';
import { searchPodcasts, proxyFeed, proxyMedia } from './podcasts.js';
import { openStream, updateState, command, dropSession, dropUser } from './connect.js';
import { PORT, PUBLIC_URL, DEMO_PAYMENTS, TRUST_PROXY, STUDENT_AUTO_APPROVE, ADMIN_TOKEN } from './config.js';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECURE = PUBLIC_URL.startsWith('https://');

// ---------- Routing ----------
const routes = [];
const STREAMED = Symbol('streamed'); // handler already wrote the response
const route = (method, p, handler, opts = {}) => routes.push({ method, p, handler, ...opts });

const authed = (req) => {
  const u = userFromRequest(req);
  if (!u) throw new HttpError(401, 'Bitte melde dich an.');
  return u;
};
const withAccess = (req) => {
  const u = authed(req);
  if (!publicAccount(u).access) throw new HttpError(402, 'Dafür brauchst du Melody Premium.');
  return u;
};

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/pricing', () => ({ ...pricing(), ai: aiEnabled(), recognition: recognitionEnabled() }));

route('GET', '/api/me', ({ req }) => ({ account: publicAccount(authed(req)) }));

route('POST', '/api/auth/register', ({ req, body, res, ip }) => {
  rateLimit(`reg:${ip}`, 10, 3600000);
  const id = register(body);
  res.setHeader('Set-Cookie', sessionCookie(createSession(id), SECURE));
  return { account: publicAccount(getUser(id)) };
});

route('POST', '/api/auth/login', ({ body, res, ip }) => {
  rateLimit(`login:${ip}`, 10, 600000);
  const id = login(body);
  res.setHeader('Set-Cookie', sessionCookie(createSession(id), SECURE));
  return { account: publicAccount(getUser(id)) };
});

route('POST', '/api/auth/logout', ({ req, res }) => {
  const u = userFromRequest(req);
  if (u) { destroySession(u._token); dropSession(u.id, u._token); }
  res.setHeader('Set-Cookie', sessionCookie('', SECURE));
  return { ok: true };
});

route('POST', '/api/account/delete', ({ req, body, res }) => {
  const u = authed(req);
  if (!verifyPassword(String(body.password || ''), u.pass_hash)) throw new HttpError(401, 'Passwort ist falsch.');
  if (u.stripe_sub && ['active', 'trialing', 'past_due'].includes(u.sub_status) && !u.cancel_at_period_end) {
    throw new HttpError(409, 'Bitte kündige zuerst dein Abo unter „Abo verwalten“.');
  }
  deleteAccount(u.id);
  dropUser(u.id);
  res.setHeader('Set-Cookie', sessionCookie('', SECURE));
  return { ok: true };
});

route('POST', '/api/student/apply', ({ req, body }) => {
  const u = authed(req);
  rateLimit(`student:${u.id}`, 5, 86400000);
  applyStudent(u, body, STUDENT_AUTO_APPROVE);
  return { account: publicAccount(getUser(u.id)) };
});

const admin = (req) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const ok = ADMIN_TOKEN && token.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
  if (!ok) throw new HttpError(401, 'Nicht berechtigt.');
};
route('GET', '/api/admin/students', ({ req }) => { admin(req); return { pending: pendingStudents() }; });
route('POST', '/api/admin/students/decide', ({ req, body }) => {
  admin(req);
  decideStudent(Number(body.userId), !!body.approve);
  return { ok: true };
});

route('POST', '/api/billing/checkout', ({ req, body }) => checkout(authed(req), body));
route('POST', '/api/billing/portal', ({ req }) => portal(authed(req)));
route('POST', '/api/billing/cancel-demo', ({ req }) => { demoCancel(authed(req)); return { ok: true }; });

route('POST', '/api/vouchers/redeem', ({ req, body, ip }) => {
  const u = authed(req);
  rateLimit(`voucher:${u.id}`, 10, 3600000);
  rateLimit(`voucher-ip:${ip}`, 20, 3600000);
  const r = redeemVoucher(u, body.code);
  return { ...r, account: publicAccount(getUser(u.id)) };
});
route('GET', '/api/vouchers', ({ req }) => ({ vouchers: myVouchers(authed(req)) }));
route('GET', '/api/vouchers/session', ({ req, query }) => ({ voucher: voucherForSession(authed(req), query.get('id')) }));

route('POST', '/api/stripe/webhook', ({ req, rawBody }) => webhook(rawBody, req.headers['stripe-signature']), { raw: true });

route('POST', '/api/ai/recommend', ({ req, body }) => recommend(withAccess(req), body));

// Audio upload: only audio/wav is accepted (a cross-site form cannot send that type without CORS).
route('POST', '/api/recognize', ({ req, rawBody }) => {
  const u = withAccess(req);
  if (!String(req.headers['content-type'] || '').startsWith('audio/wav')) throw new HttpError(415, 'WAV-Aufnahme erwartet.');
  rateLimit(`recognize:${u.id}`, 30, 3600000);
  return recognize(rawBody);
}, { raw: true });
route('POST', '/api/wishes', ({ req, body }) => { addWish(authed(req).id, body); return { ok: true }; });
route('GET', '/api/admin/wishes', ({ req }) => { admin(req); return { wishes: topWishes() }; });

route('GET', '/api/podcasts/search', ({ req, query }) => {
  const u = withAccess(req);
  rateLimit(`podsearch:${u.id}`, 60, 3600000);
  return searchPodcasts(query.get('q'));
});
route('GET', '/api/podcasts/feed', ({ req, query }) => {
  const u = withAccess(req);
  rateLimit(`podfeed:${u.id}`, 300, 3600000);
  return proxyFeed(query.get('url'));
});
route('GET', '/api/podcasts/media', async ({ req, res, query }) => {
  const u = withAccess(req);
  rateLimit(`podmedia:${u.id}`, 200, 3600000);
  await proxyMedia(query.get('url'), res, req.headers.range);
  return STREAMED;
});

// Melody Connect
route('GET', '/api/connect/stream', ({ req, res, query }) => {
  openStream(withAccess(req), query, req, res);
  return STREAMED;
});
route('POST', '/api/connect/state', ({ req, body }) => updateState(withAccess(req), body));
route('POST', '/api/connect/command', ({ req, body }) => {
  const u = withAccess(req);
  rateLimit(`connect:${u.id}`, 600, 600000);
  return command(u, body);
});

route('GET', '/api/lyrics', ({ req, query }) => {
  const u = withAccess(req);
  rateLimit(`lyrics:${u.id}`, 120, 3600000);
  return findLyrics(Object.fromEntries(query));
});

// Sound presets: users' chosen preset, aggregated anonymously for "Beliebt bei Melody-Hörern".
route('POST', '/api/presets/choice', ({ req, body }) => {
  const u = authed(req);
  const preset = String(body.preset || '').slice(0, 40);
  if (!preset) throw new HttpError(400, 'Preset fehlt.');
  db.prepare('INSERT OR REPLACE INTO preset_choice (user_id, preset, at) VALUES (?, ?, ?)').run(u.id, preset, now());
  return { ok: true };
});
route('GET', '/api/presets/popular', () => {
  const rows = db.prepare('SELECT preset, COUNT(*) AS users FROM preset_choice GROUP BY preset ORDER BY users DESC LIMIT 20').all();
  const total = rows.reduce((s, r) => s + r.users, 0);
  return { total, melody: MELODY_PRESETS, presets: rows.map((r) => ({ ...r, share: total ? r.users / total : 0 })) };
});

// ---------- Static files (the app itself) ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.lrc': 'text/plain; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
const PUBLIC_DIRS = new Set(['', 'css', 'js', 'icons', 'legal', 'catalog', 'vendor', 'podcasts']);

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(ROOT, rel);
  const dir = path.dirname(path.relative(ROOT, file)).split(path.sep)[0];
  const ext = path.extname(file);
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC_DIRS.has(dir === '.' ? '' : dir) || !TYPES[ext] ||
      path.basename(file).startsWith('.') || /README|package/i.test(path.basename(file))) {
    return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', ext === '.html' || rel === 'sw.js' || rel.endsWith('.json') ? 'no-cache' : 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    // Range requests let the player seek inside streamed songs.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      if (start < 0) start = 0;
      end = Math.min(end, st.size - 1);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { 'Content-Type': TYPES[ext], 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': TYPES[ext], 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function send(res, status, data, type) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(data);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Anfrage zu groß.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '', 'text/plain');
    return serveStatic(req, res, url.pathname);
  }
  const r = routes.find((x) => x.method === req.method && x.p === url.pathname);
  try {
    if (!r) throw new HttpError(404, 'Unbekannte Adresse.');
    let body = {};
    let rawBody;
    if (req.method === 'POST') {
      rawBody = await readBody(req);
      if (!r.raw) {
        // JSON only: browsers can't send it cross-site without CORS, which blocks CSRF.
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'JSON erwartet.');
        try { body = rawBody.length ? JSON.parse(rawBody) : {}; } catch { throw new HttpError(400, 'Ungültiges JSON.'); }
      }
    }
    // Only trust X-Forwarded-For behind a known reverse proxy, otherwise clients could dodge rate limits.
    const ip = (TRUST_PROXY && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
    const out = await r.handler({ req, res, body, rawBody, query: url.searchParams, ip });
    if (out === STREAMED) return;
    res.setHeader('Cache-Control', 'no-store');
    send(res, 200, JSON.stringify(out ?? {}), 'application/json; charset=utf-8');
  } catch (e) {
    if (res.headersSent) { res.destroy(); return; }
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    send(res, status, JSON.stringify({ error: status === 500 ? 'Interner Fehler.' : e.message }), 'application/json; charset=utf-8');
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`Melody läuft auf ${PUBLIC_URL}`);
    if (DEMO_PAYMENTS) console.log('⚠  Testmodus: Zahlungen werden nur simuliert (STRIPE_SECRET_KEY fehlt).');
    if (!aiEnabled()) console.log('ℹ  KI ohne ANTHROPIC_API_KEY: die App nutzt die eingebaute Empfehlungs-Engine.');
  });
}
