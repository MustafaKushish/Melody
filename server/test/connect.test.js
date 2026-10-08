import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.MELODY_DB = ':memory:';
process.env.TRUST_PROXY = '1';
const { server } = await import('../index.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => server.close());

let n = 0;
async function account() {
  const ip = `10.9.0.${++n}`;
  const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ name: 'C' + n, email: `c${n}@example.com`, password: 'geheim123', acceptTerms: true }) });
  return r.headers.get('set-cookie').split(';')[0];
}

// Minimal SSE reader: collects events from a streaming fetch.
function stream(cookie, device, name) {
  const ctrl = new AbortController();
  const events = [];
  const waiters = [];
  const st = { ended: false };
  const ready = fetch(`${base}/api/connect/stream?device=${device}&name=${encodeURIComponent(name)}&type=phone`, { headers: { cookie }, signal: ctrl.signal })
    .then(async (r) => {
      assert.equal(r.status, 200);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) { st.ended = true; break; }
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = block.match(/^event: (.+)$/m)?.[1];
              const data = block.match(/^data: (.+)$/m)?.[1];
              if (ev && data) { events.push({ ev, data: JSON.parse(data) }); waiters.splice(0).forEach((w) => w()); }
            }
          }
        } catch { /* aborted */ }
      })();
    });
  const next = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = events.find(pred);
      if (hit) { events.splice(events.indexOf(hit), 1); return hit; }
      if (Date.now() > end) throw new Error('Zeitüberschreitung');
      await new Promise((r) => { waiters.push(r); setTimeout(r, 100); });
    }
  };
  return { ready, next, close: () => ctrl.abort(), get ended() { return st.ended; } };
}

const post = (cookie, path, body) => fetch(base + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });

test('Geräte sehen sich, Zustand und Befehle kommen an', async () => {
  const c = await account();
  const phone = stream(c, 'phone-1234', 'Handy');
  await phone.ready;
  await phone.next((e) => e.ev === 'devices' && e.data.devices.length === 1);
  const laptop = stream(c, 'laptop-5678', 'Laptop');
  await laptop.ready;
  await phone.next((e) => e.ev === 'devices' && e.data.devices.some((d) => d.name === 'Laptop'));

  const st = await post(c, '/connect/state', { device: 'laptop-5678', important: true, state: { title: 'Sommerwind', artist: 'Die Wellen', playing: true, position: 12, duration: 60, volume: 0.8, mode: 'library', item: { kind: 'catalog', id: 'sommerwind' }, image: 'javascript:alert(1)' } });
  assert.equal(st.status, 200);
  const ev = await phone.next((e) => e.ev === 'devices' && e.data.devices.find((d) => d.id === 'laptop-5678')?.state?.title === 'Sommerwind');
  const ls = ev.data.devices.find((d) => d.id === 'laptop-5678').state;
  assert.equal(ls.item.id, 'sommerwind');
  assert.equal(ls.image, '', 'gefährliche Bild-Adresse entfernt');

  assert.equal((await post(c, '/connect/command', { from: 'phone-1234', to: 'laptop-5678', cmd: 'seek', arg: 30 })).status, 200);
  const cmd = await laptop.next((e) => e.ev === 'command');
  assert.deepEqual([cmd.data.cmd, cmd.data.arg, cmd.data.from.name], ['seek', 30, 'Handy']);

  assert.equal((await post(c, '/connect/command', { from: 'phone-1234', to: 'laptop-5678', cmd: 'rm -rf' })).status, 400);
  laptop.close();
  await phone.next((e) => e.ev === 'devices' && e.data.devices.length === 1);
  phone.close();
});

test('Fremde Konten können meine Geräte nicht steuern', async () => {
  const mine = await account();
  const other = await account();
  const s = stream(mine, 'tv-00000001', 'Fernseher');
  await s.ready;
  await s.next((e) => e.ev === 'devices');
  const r = await post(other, '/connect/command', { to: 'tv-00000001', cmd: 'pause' });
  assert.equal(r.status, 404);
  s.close();
});

test('Connect nur angemeldet', async () => {
  assert.equal((await fetch(base + '/api/connect/stream?device=abcdefgh')).status, 401);
});

test('Abmelden beendet nur die Verbindung dieser Sitzung', async () => {
  const c1 = await account();
  const email = `c${n}@example.com`;
  const lr = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.1.1' },
    body: JSON.stringify({ email, password: 'geheim123' }) });
  const c2 = lr.headers.get('set-cookie').split(';')[0];
  const a = stream(c1, 'sess-a-1234', 'A');
  await a.ready;
  const b = stream(c2, 'sess-b-5678', 'B');
  await b.ready;
  await b.next((e) => e.ev === 'devices' && e.data.devices.length === 2);
  assert.equal((await post(c1, '/auth/logout', {})).status, 200);
  await b.next((e) => e.ev === 'devices' && e.data.devices.length === 1 && e.data.devices[0].id === 'sess-b-5678');
  for (let i = 0; i < 30 && !a.ended; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(a.ended, 'Stream der abgemeldeten Sitzung ist zu');
  assert.equal(b.ended, false);
  b.close();
});
