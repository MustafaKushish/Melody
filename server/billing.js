import crypto from 'node:crypto';
import Stripe from 'stripe';
import { db, now, tx } from './db.js';
import { HttpError, getUser, extendPremium, isStudentVerified } from './auth.js';
import {
  PLANS, VOUCHERS, CURRENCY, PUBLIC_URL, TRIAL_DAYS,
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, DEMO_PAYMENTS,
} from './config.js';

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export function pricing() {
  return {
    currency: CURRENCY,
    trialDays: TRIAL_DAYS,
    plans: Object.values(PLANS),
    vouchers: Object.values(VOUCHERS),
    demo: DEMO_PAYMENTS,
    payments: !!stripe || DEMO_PAYMENTS,
  };
}

// Codes like MELO-7KQ2-X9TB: no 0/O/1/I to avoid typos.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newVoucherCode() {
  const pick = () => Array.from(crypto.randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `MELO-${pick()}-${pick()}`;
}

function createVoucher(months, buyerId, stripeSession = null) {
  for (let i = 0; i < 5; i++) {
    const code = newVoucherCode();
    try {
      db.prepare(`INSERT INTO vouchers (code, months, created_at, buyer_id, stripe_session) VALUES (?, ?, ?, ?, ?)`)
        .run(code, months, now(), buyerId, stripeSession);
      return code;
    } catch (e) {
      if (stripeSession && /UNIQUE.*stripe_session/.test(e.message)) {
        return db.prepare('SELECT code FROM vouchers WHERE stripe_session = ?').get(stripeSession).code;
      }
      if (!/UNIQUE/.test(e.message)) throw e;
    }
  }
  throw new Error('Gutscheincode konnte nicht erzeugt werden');
}

function recordPayment(userId, kind, amountCents, reference) {
  db.prepare('INSERT INTO payments (user_id, kind, amount_cents, reference, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, kind, amountCents, reference, now());
}

function hasRenewingSubscription(u) {
  return u.stripe_sub && ['active', 'trialing', 'past_due'].includes(u.sub_status) && !u.cancel_at_period_end;
}

// ---------- Checkout ----------
export async function checkout(user, { kind, id }) {
  const item = kind === 'plan' ? PLANS[id] : kind === 'voucher' ? VOUCHERS[id] : null;
  if (!item) throw new HttpError(400, 'Unbekanntes Produkt.');
  if (item.student && !isStudentVerified(user)) {
    throw new HttpError(403, 'Bitte bestätige zuerst, dass du Schüler, Azubi oder Student bist.');
  }
  if (kind === 'plan' && hasRenewingSubscription(user) && user.plan === id) {
    throw new HttpError(409, 'Dieses Abo hast du bereits.');
  }

  if (!stripe) {
    if (!DEMO_PAYMENTS) throw new HttpError(503, 'Zahlungen sind noch nicht eingerichtet.');
    // Testmodus: sofort freischalten, keine echte Zahlung.
    if (kind === 'plan') {
      tx(() => {
        extendPremium(user.id, item.months);
        db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(id, user.id);
        recordPayment(user.id, `demo-plan-${id}`, item.priceCents, 'demo');
      });
      return { demo: true };
    }
    const code = tx(() => {
      recordPayment(user.id, `demo-voucher-${id}`, item.priceCents, 'demo');
      return createVoucher(item.months, user.id);
    });
    return { demo: true, code };
  }

  let customer = user.stripe_customer;
  if (!customer) {
    const c = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId: String(user.id) } });
    customer = c.id;
    db.prepare('UPDATE users SET stripe_customer = ? WHERE id = ?').run(customer, user.id);
  }

  const common = {
    customer,
    client_reference_id: String(user.id),
    locale: 'de',
    allow_promotion_codes: true,
    metadata: { userId: String(user.id), kind, id },
  };

  const session = kind === 'plan'
    ? await stripe.checkout.sessions.create({
      ...common,
      mode: 'subscription',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: item.priceCents,
          recurring: { interval: item.interval },
          product_data: { name: item.name },
        },
      }],
      subscription_data: { metadata: { userId: String(user.id), plan: id } },
      success_url: `${PUBLIC_URL}/#/account?checkout=success`,
      cancel_url: `${PUBLIC_URL}/#/premium?checkout=cancel`,
    })
    : await stripe.checkout.sessions.create({
      ...common,
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: { currency: CURRENCY, unit_amount: item.priceCents, product_data: { name: item.name } },
      }],
      success_url: `${PUBLIC_URL}/#/account?voucher_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}/#/account?checkout=cancel`,
    });
  return { url: session.url };
}

// Stripe customer portal: change plan, update card, cancel, download invoices.
export async function portal(user) {
  if (!stripe || !user.stripe_customer) throw new HttpError(400, 'Kein Abo zum Verwalten vorhanden.');
  const s = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer, return_url: `${PUBLIC_URL}/#/account` });
  return { url: s.url };
}

// Demo-only cancellation (with Stripe, cancelling happens in the portal).
export function demoCancel(user) {
  if (stripe) throw new HttpError(400, 'Bitte nutze „Abo verwalten“.');
  db.prepare('UPDATE users SET plan = NULL WHERE id = ?').run(user.id);
}

// ---------- Vouchers ----------
export function redeemVoucher(user, rawCode) {
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MELO(\w{4})(\w{4})$/, 'MELO-$1-$2');
  return tx(() => {
    const v = db.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
    if (!v) throw new HttpError(404, 'Dieser Gutscheincode ist ungültig.');
    if (v.redeemed_by) throw new HttpError(409, 'Dieser Gutschein wurde bereits eingelöst.');
    const u = getUser(user.id);
    if (hasRenewingSubscription(u)) {
      throw new HttpError(409, 'Du hast ein laufendes Abo. Kündige es zuerst oder verschenke den Gutschein.');
    }
    db.prepare('UPDATE vouchers SET redeemed_by = ?, redeemed_at = ? WHERE code = ?').run(user.id, now(), code);
    extendPremium(user.id, v.months);
    return { months: v.months };
  });
}

export function myVouchers(user) {
  return db.prepare(`SELECT code, months, created_at AS createdAt, redeemed_at AS redeemedAt
                     FROM vouchers WHERE buyer_id = ? ORDER BY created_at DESC`).all(user.id);
}

export function voucherForSession(user, sessionId) {
  const v = db.prepare('SELECT code, months FROM vouchers WHERE stripe_session = ? AND buyer_id = ?').get(String(sessionId), user.id);
  return v || null; // null = webhook not processed yet, client retries
}

// ---------- Webhook ----------
export async function webhook(rawBody, signature) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) throw new HttpError(400, 'Webhook nicht konfiguriert');
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new HttpError(400, 'Ungültige Signatur');
  }
  const o = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = Number(o.metadata?.userId || o.client_reference_id);
      if (!userId || !getUser(userId)) break;
      if (o.mode === 'payment' && o.payment_status === 'paid' && o.metadata?.kind === 'voucher') {
        const item = VOUCHERS[o.metadata.id];
        if (item) {
          tx(() => {
            const existed = db.prepare('SELECT 1 FROM vouchers WHERE stripe_session = ?').get(o.id);
            createVoucher(item.months, userId, o.id);
            if (!existed) recordPayment(userId, `voucher-${item.id}`, o.amount_total, o.id);
          });
        }
      } else if (o.mode === 'subscription') {
        db.prepare('UPDATE users SET stripe_sub = ?, plan = ?, sub_status = ?, cancel_at_period_end = 0 WHERE id = ?')
          .run(o.subscription, o.metadata?.id || null, 'active', userId);
      }
      break;
    }
    case 'invoice.paid': {
      const line = o.lines?.data?.[0];
      const u = db.prepare('SELECT * FROM users WHERE stripe_customer = ?').get(o.customer);
      if (u && line?.period?.end) {
        const until = line.period.end * 1000;
        tx(() => {
          db.prepare('UPDATE users SET premium_until = MAX(premium_until, ?) WHERE id = ?').run(until, u.id);
          // Stripe retries webhooks – record each invoice only once.
          if (!db.prepare('SELECT 1 FROM payments WHERE reference = ?').get(o.id)) {
            recordPayment(u.id, 'subscription', o.amount_paid, o.id);
          }
        });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const u = db.prepare('SELECT * FROM users WHERE stripe_customer = ?').get(o.customer);
      if (u) {
        db.prepare('UPDATE users SET stripe_sub = ?, sub_status = ?, cancel_at_period_end = ?, plan = COALESCE(?, plan) WHERE id = ?')
          .run(o.id, o.status, o.cancel_at_period_end ? 1 : 0, o.metadata?.plan || null, u.id);
      }
      break;
    }
  }
  return { received: true };
}
