import crypto from 'node:crypto';
import { db, now } from './db.js';
import { TRIAL_DAYS, SESSION_DAYS, PLANS } from './config.js';

const DAY = 86400000;
const COOKIE = 'melody_session';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Passwords (scrypt) ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Sessions ----------
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)')
    .run(sha(token), userId, now() + SESSION_DAYS * DAY);
  return token;
}

export function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function userFromRequest(req) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, v.join('=')]),
  );
  const token = cookies[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires > ?`).get(sha(token), now());
  if (row) row._token = token;
  return row || null;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

// ---------- Users ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function register({ name, email, password, acceptTerms }) {
  name = String(name || '').trim().slice(0, 60);
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (!name) throw new HttpError(400, 'Bitte gib deinen Namen ein.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse ein.');
  if (password.length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen lang sein.');
  if (!acceptTerms) throw new HttpError(400, 'Bitte stimme den AGB und der Datenschutzerklärung zu.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'Für diese E-Mail gibt es bereits ein Konto.');
  }
  const t = now();
  const r = db.prepare(`INSERT INTO users (email, name, pass_hash, created_at, trial_ends)
                        VALUES (?, ?, ?, ?, ?)`).run(email, name, hashPassword(password), t, t + TRIAL_DAYS * DAY);
  return Number(r.lastInsertRowid);
}

export function login({ email, password }) {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  // Always run scrypt so response time doesn't reveal whether the email exists.
  const ok = verifyPassword(String(password || ''), u?.pass_hash || 'scrypt$AAAA$AAAA');
  if (!u || !ok) throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
  return u.id;
}

export function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// What the client is allowed to see about the account and its access.
export function publicAccount(u) {
  const t = now();
  const subActive = ['active', 'trialing', 'past_due'].includes(u.sub_status);
  const premium = u.premium_until > t || subActive;
  const trial = !premium && u.trial_ends > t;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.created_at,
    access: premium || trial,
    status: premium ? 'premium' : trial ? 'trial' : 'expired',
    trialEnds: u.trial_ends,
    premiumUntil: u.premium_until,
    plan: u.plan && PLANS[u.plan] ? { id: u.plan, name: PLANS[u.plan].name } : null,
    subscription: u.stripe_sub ? { status: u.sub_status, cancelAtPeriodEnd: !!u.cancel_at_period_end } : null,
  };
}

// Adds months of premium on top of whatever remains.
export function extendPremium(userId, months) {
  const u = getUser(userId);
  const base = new Date(Math.max(u.premium_until, now()));
  base.setMonth(base.getMonth() + months);
  db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(base.getTime(), userId);
}

export function deleteAccount(userId) {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// ---------- Simple in-memory rate limit ----------
const hits = new Map();
export function rateLimit(key, max, windowMs) {
  const t = now();
  const arr = (hits.get(key) || []).filter((x) => x > t - windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Zu viele Versuche. Bitte warte kurz.');
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 10000) hits.clear();
}
