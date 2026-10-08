import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.MELODY_DB = ':memory:';
process.env.NODE_ENV = 'test';
process.env.TRUST_PROXY = '1';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { server } = await import('../index.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => server.close());

let ipCounter = 0;
function client() {
  let cookie = '';
  const ip = `10.0.0.${++ipCounter}`;
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { 'X-Forwarded-For': ip, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

const user = { name: 'Mia', email: 'mia@example.com', password: 'geheim123', acceptTerms: true };

test('Preise sind korrekt eingestellt', async () => {
  const { data } = await client()('/pricing');
  assert.equal(data.plans.find((p) => p.id === 'monthly').priceCents, 499);
  assert.equal(data.plans.find((p) => p.id === 'yearly').priceCents, 4999);
  assert.deepEqual(data.vouchers.map((v) => v.months), [1, 3, 6, 12]);
  assert.equal(data.demo, true);
});

test('Registrierung startet Testphase, Login/Logout funktioniert', async () => {
  const api = client();
  assert.equal((await api('/me')).status, 401);
  const reg = await api('/auth/register', { method: 'POST', body: user });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.account.status, 'trial');
  assert.equal(reg.data.account.access, true);
  assert.equal((await api('/auth/register', { method: 'POST', body: user })).status, 409);
  await api('/auth/logout', { method: 'POST', body: {} });
  assert.equal((await api('/me')).status, 401);
  assert.equal((await api('/auth/login', { method: 'POST', body: { email: user.email, password: 'falsch!!' } })).status, 401);
  const login = await api('/auth/login', { method: 'POST', body: { email: 'MIA@example.com', password: user.password } });
  assert.equal(login.data.account.name, 'Mia');
});

test('Validierung bei Registrierung', async () => {
  const api = client();
  assert.equal((await api('/auth/register', { method: 'POST', body: { ...user, email: 'x@y.de', password: 'kurz' } })).status, 400);
  assert.equal((await api('/auth/register', { method: 'POST', body: { ...user, email: 'z@y.de', acceptTerms: false } })).status, 400);
});

test('POST ohne JSON wird abgelehnt (CSRF-Schutz)', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
  assert.equal(res.status, 415);
});

test('Abo (Testmodus) schaltet Premium frei', async () => {
  const api = client();
  await api('/auth/register', { method: 'POST', body: { ...user, email: 'abo@example.com' } });
  const r = await api('/billing/checkout', { method: 'POST', body: { kind: 'plan', id: 'yearly' } });
  assert.equal(r.data.demo, true);
  const { data } = await api('/me');
  assert.equal(data.account.status, 'premium');
  assert.equal(data.account.plan.id, 'yearly');
  const months = (data.account.premiumUntil - Date.now()) / (30.4 * 86400000);
  assert.ok(months > 11.5 && months < 12.5, `≈12 Monate, war ${months}`);
});

test('Gutschein kaufen, verschenken und einlösen', async () => {
  const buyer = client();
  const friend = client();
  await buyer('/auth/register', { method: 'POST', body: { ...user, email: 'kaeufer@example.com' } });
  await friend('/auth/register', { method: 'POST', body: { ...user, name: 'Ali', email: 'freund@example.com' } });
  const { data } = await buyer('/billing/checkout', { method: 'POST', body: { kind: 'voucher', id: 'v3' } });
  assert.match(data.code, /^MELO-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal((await buyer('/vouchers')).data.vouchers.length, 1);

  const redeem = await friend('/vouchers/redeem', { method: 'POST', body: { code: data.code.toLowerCase().replace(/-/g, ' ') } });
  assert.equal(redeem.status, 200);
  assert.equal(redeem.data.months, 3);
  assert.equal(redeem.data.account.status, 'premium');
  const again = await buyer('/vouchers/redeem', { method: 'POST', body: { code: data.code } });
  assert.equal(again.status, 409);
  assert.equal((await friend('/vouchers/redeem', { method: 'POST', body: { code: 'MELO-AAAA-BBBB' } })).status, 404);
});

test('Ohne Zugang sind Premium-Funktionen gesperrt', async () => {
  const api = client();
  assert.equal((await api('/lyrics?artist=a&title=b')).status, 401);
  assert.equal((await api('/ai/recommend', { method: 'POST', body: {} })).status, 401);
});

test('Sound-Beliebtheit wird anonym gezählt', async () => {
  const a = client();
  const b = client();
  await a('/auth/register', { method: 'POST', body: { ...user, email: 's1@example.com' } });
  await b('/auth/register', { method: 'POST', body: { ...user, email: 's2@example.com' } });
  await a('/presets/choice', { method: 'POST', body: { preset: 'Melody Signature' } });
  await a('/presets/choice', { method: 'POST', body: { preset: 'Melody Signature' } });
  await b('/presets/choice', { method: 'POST', body: { preset: 'Rock' } });
  const { data } = await a('/presets/popular');
  assert.equal(data.total, 2);
  assert.equal(data.presets[0].users, 1);
});

test('Konto löschen braucht Passwort', async () => {
  const api = client();
  await api('/auth/register', { method: 'POST', body: { ...user, email: 'weg@example.com' } });
  assert.equal((await api('/account/delete', { method: 'POST', body: { password: 'falsch' } })).status, 401);
  assert.equal((await api('/account/delete', { method: 'POST', body: { password: user.password } })).status, 200);
  assert.equal((await api('/me')).status, 401);
});

test('Server-Dateien und Datenbank sind nicht öffentlich', async () => {
  for (const p of ['/server/config.js', '/server/data/melody.db', '/README.md', '/.git/config', '/server/.env']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/legal/agb.html')).status, 200);
});

test('Rate-Limit bei Registrierung greift', async () => {
  const api = client();
  let last;
  for (let i = 0; i < 11; i++) last = await api('/auth/register', { method: 'POST', body: { ...user, email: `spam${i}@example.com` } });
  assert.equal(last.status, 429);
});

test('Katalog: Songs streamen mit Range-Anfragen (zum Spulen)', async () => {
  const cat = await (await fetch(base + '/catalog/catalog.json')).json();
  assert.ok(cat.tracks.length >= 5);
  const url = base + '/catalog/' + cat.tracks[0].audio;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  const part = await fetch(url, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.match(part.headers.get('content-range'), /^bytes 100-199\/\d+$/);
});

test('Schüler-Abo: nur mit Nachweis, halber Preis', async () => {
  const api = client();
  await api('/auth/register', { method: 'POST', body: { ...user, email: 'schueler@example.com' } });
  const pricing = (await api('/pricing')).data;
  const sm = pricing.plans.find((p) => p.id === 'student_monthly');
  assert.equal(sm.priceCents, 249);
  assert.equal(pricing.plans.find((p) => p.id === 'student_yearly').priceCents, 2499);
  assert.equal((await api('/billing/checkout', { method: 'POST', body: { kind: 'plan', id: 'student_monthly' } })).status, 403);
  assert.equal((await api('/student/apply', { method: 'POST', body: { type: 'schule', school: 'Gymnasium Musterstadt', confirm: true } })).status, 400);
  const ok = await api('/student/apply', { method: 'POST', body: { type: 'schule', school: 'Gymnasium Musterstadt', validUntil: '2099-07', confirm: true, guardian: true } });
  assert.equal(ok.data.account.student.status, 'approved');
  const maxDays = (ok.data.account.student.validUntil - Date.now()) / 86400000;
  assert.ok(maxDays <= 367, 'höchstens ein Jahr gültig');
  const buy = await api('/billing/checkout', { method: 'POST', body: { kind: 'plan', id: 'student_monthly' } });
  assert.equal(buy.status, 200);
  assert.equal((await api('/me')).data.account.plan.id, 'student_monthly');
});

test('Admin-Endpunkte brauchen Token', async () => {
  const r = await fetch(base + '/api/admin/students');
  assert.equal(r.status, 401);
});
