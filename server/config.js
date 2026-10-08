// ─────────────────────────────────────────────────────────────
//  Melody – Preise & Einstellungen (zentral, eine Stelle für alles)
// ─────────────────────────────────────────────────────────────
// Alle Preise in Cent, inklusive 19 % MwSt.
// Kalkulation (siehe README → "Preiskalkulation"):
//   Schüler 2,49 € → netto 2,09 € → nach Zahlungsgebühren ≈ 1,80 € (bewusst knapp kalkuliert)
//   Monatlich 4,99 € → netto 4,19 € → nach Zahlungsgebühren ≈ 3,87 €
//   Jährlich 49,99 € → netto 42,01 € → nach Gebühren ≈ 41,01 € (≈ 3,42 €/Monat)
//   Laufende Kosten pro Kunde (Server, KI, Lyrics, Support) ≈ 0,40–0,90 €/Monat
//   → gesunde Marge, trotzdem weniger als die Hälfte von Spotify/Apple Music.

export const CURRENCY = 'eur';

export const PLANS = {
  monthly: {
    id: 'monthly',
    name: 'Melody Premium – Monatlich',
    priceCents: 499,
    interval: 'month',
    months: 1,
    note: 'Monatlich kündbar',
  },
  yearly: {
    id: 'yearly',
    name: 'Melody Premium – Jährlich',
    priceCents: 4999,
    interval: 'year',
    months: 12,
    note: '2 Monate geschenkt',
    badge: 'Beliebteste Wahl',
  },
  // Schüler, Azubis & Studierende: halber Preis. Nur mit bestätigtem Status buchbar.
  student_monthly: {
    id: 'student_monthly',
    name: 'Melody Schüler & Studenten – Monatlich',
    priceCents: 249,
    interval: 'month',
    months: 1,
    note: 'Halber Preis für Schule, Ausbildung & Studium',
    student: true,
  },
  student_yearly: {
    id: 'student_yearly',
    name: 'Melody Schüler & Studenten – Jährlich',
    priceCents: 2499,
    interval: 'year',
    months: 12,
    note: '2 Monate geschenkt',
    student: true,
  },
};

// Schüler-Nachweis: Selbstauskunft wird sofort bestätigt (1 = an) und gilt bis zum angegebenen
// Datum, höchstens 12 Monate. Mit 0 prüft ein Admin jede Anfrage (POST /api/admin/students/decide).
export const STUDENT_AUTO_APPROVE = process.env.MELODY_STUDENT_AUTO_APPROVE !== '0';
export const ADMIN_TOKEN = process.env.MELODY_ADMIN_TOKEN || '';

// Gutscheine: einmalige Zahlung, kein Abo. Code kann verschenkt werden.
export const VOUCHERS = {
  v1: { id: 'v1', months: 1, priceCents: 499, name: 'Melody Gutschein – 1 Monat' },
  v3: { id: 'v3', months: 3, priceCents: 1449, name: 'Melody Gutschein – 3 Monate' },
  v6: { id: 'v6', months: 6, priceCents: 2799, name: 'Melody Gutschein – 6 Monate' },
  v12: { id: 'v12', months: 12, priceCents: 4999, name: 'Melody Gutschein – 12 Monate' },
};

// Kostenlose Testphase nach der Registrierung (0 = keine).
export const TRIAL_DAYS = 7;

// KI-Empfehlungen: Modell und Tageslimit pro Kunde (schützt die Marge).
export const AI_MODEL = process.env.MELODY_AI_MODEL || 'claude-opus-5-5';
export const AI_DAILY_LIMIT = Number(process.env.MELODY_AI_DAILY_LIMIT || 5);

export const PORT = Number(process.env.PORT || 8080);
export const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
export const DB_PATH = process.env.MELODY_DB || new URL('./data/melody.db', import.meta.url).pathname;

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Testmodus ohne echte Zahlungen: nur wenn Stripe fehlt UND nicht in Produktion
// (oder ausdrücklich erlaubt). In Produktion ohne Stripe ist Bezahlen deaktiviert.
export const DEMO_PAYMENTS = !STRIPE_SECRET_KEY &&
  (process.env.NODE_ENV !== 'production' || process.env.MELODY_DEMO_PAYMENTS === '1');

export const SESSION_DAYS = 60;

// Weltweite Song-Erkennung (wie Shazam) über https://audd.io – ohne Token erkennt Melody nur den eigenen Katalog.
export const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN || '';
export const AUDD_URL = process.env.AUDD_URL || 'https://api.audd.io/';

// Set to 1 when running behind a reverse proxy (nginx, Render, Fly.io …) that sets X-Forwarded-For.
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';
