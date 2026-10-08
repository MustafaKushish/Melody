import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

process.env.MELODY_DB = ':memory:';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

const { server } = await import('../index.js');
const { db } = await import('../db.js');
const { register } = await import('../auth.js');
const stripe = new Stripe('sk_test_dummy');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => server.close());

async function send(type, object, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  const payload = JSON.stringify({ id: 'evt_' + Math.random(), object: 'event', type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': header, 'Content-Type': 'application/json' }, body: payload });
}

const uid = register({ name: 'Webhook', email: 'wh@example.com', password: 'geheim123', acceptTerms: true });
db.prepare('UPDATE users SET stripe_customer = ? WHERE id = ?').run('cus_123', uid);

test('Gefälschte Signatur wird abgelehnt', async () => {
  const r = await send('invoice.paid', {}, 'whsec_falsch');
  assert.equal(r.status, 400);
});

test('Abo-Abschluss und bezahlte Rechnung schalten Premium frei (idempotent)', async () => {
  await send('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', client_reference_id: String(uid), metadata: { userId: String(uid), kind: 'plan', id: 'monthly' } });
  const periodEnd = Math.floor(Date.now() / 1000) + 31 * 86400;
  const invoice = { id: 'in_1', customer: 'cus_123', amount_paid: 499, lines: { data: [{ period: { end: periodEnd } }] } };
  assert.equal((await send('invoice.paid', invoice)).status, 200);
  assert.equal((await send('invoice.paid', invoice)).status, 200);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  assert.equal(u.plan, 'monthly');
  assert.equal(u.stripe_sub, 'sub_1');
  assert.equal(u.premium_until, periodEnd * 1000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE reference = 'in_1'").get().n, 1);
});

test('Kündigung wird übernommen, Zugang bleibt bis Laufzeitende', async () => {
  await send('customer.subscription.updated', { id: 'sub_1', customer: 'cus_123', status: 'active', cancel_at_period_end: true, metadata: {} });
  let u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  assert.equal(u.cancel_at_period_end, 1);
  await send('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_123', status: 'canceled', cancel_at_period_end: false, metadata: {} });
  u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  assert.equal(u.sub_status, 'canceled');
  assert.ok(u.premium_until > Date.now());
});

test('Gutschein-Kauf erzeugt genau einen Code, auch bei doppeltem Webhook', async () => {
  const session = { id: 'cs_v', mode: 'payment', payment_status: 'paid', amount_total: 1449, client_reference_id: String(uid), metadata: { userId: String(uid), kind: 'voucher', id: 'v3' } };
  await send('checkout.session.completed', session);
  await send('checkout.session.completed', session);
  const rows = db.prepare("SELECT * FROM vouchers WHERE stripe_session = 'cs_v'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].months, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE reference = 'cs_v'").get().n, 1);
});
