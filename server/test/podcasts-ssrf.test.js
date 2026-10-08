import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.MELODY_DB = ':memory:';
delete process.env.MELODY_ALLOW_PRIVATE_FETCH;
const { server } = await import('../index.js');
const { privateIp } = await import('../podcasts.js');
let base, cookie;
before(() => new Promise((r) => server.listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'P', email: 'p@example.com', password: 'geheim123', acceptTerms: true }) });
  cookie = reg.headers.get('set-cookie').split(';')[0];
  r();
})));
after(() => server.close());

test('Feed-Proxy blockiert interne Adressen (SSRF-Schutz)', async () => {
  for (const url of ['http://127.0.0.1/', 'http://localhost:8080/', 'http://10.0.0.5/feed', 'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/', 'file:///etc/passwd', 'http://192.168.1.1/', 'gopher://x', 'http://user:pw@example.com/']) {
    const r = await fetch(base + '/api/podcasts/feed?url=' + encodeURIComponent(url), { headers: { cookie } });
    assert.equal(r.status, 400, url);
  }
  for (const url of ['http://127.0.0.1/x.mp3', 'http://172.16.0.1/x.mp3']) {
    const r = await fetch(base + '/api/podcasts/media?url=' + encodeURIComponent(url), { headers: { cookie } });
    assert.equal(r.status, 400, url);
  }
});

test('IP-Prüfung erkennt private Bereiche', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0'])
    assert.equal(privateIp(ip), true, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(privateIp(ip), false, ip);
});

test('Podcast-Funktionen nur mit Konto', async () => {
  assert.equal((await fetch(base + '/api/podcasts/search?q=test')).status, 401);
});
