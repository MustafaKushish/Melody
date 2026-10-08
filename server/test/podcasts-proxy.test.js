import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><title>Folge 1</title>
  <enclosure url="/ep1.mp3" type="audio/mpeg" length="1000"/></item></channel></rss>`;
const mp3 = Buffer.alloc(5000, 7);
const origin = http.createServer((req, res) => {
  if (req.url === '/feed') { res.writeHead(200, { 'Content-Type': 'application/rss+xml' }); return res.end(feed); }
  if (req.url === '/moved') { res.writeHead(301, { Location: '/feed' }); return res.end(); }
  if (req.url === '/ep1.mp3') { res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': mp3.length }); return res.end(mp3); }
  if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>keine rss</html>'); }
  res.writeHead(404); res.end();
});
await new Promise((r) => origin.listen(0, r));
const o = `http://127.0.0.1:${origin.address().port}`;
process.env.MELODY_DB = ':memory:';
process.env.MELODY_ALLOW_PRIVATE_FETCH = '1';
const { server } = await import('../index.js');
let base, cookie;
before(() => new Promise((r) => server.listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'P', email: 'p2@example.com', password: 'geheim123', acceptTerms: true }) });
  cookie = reg.headers.get('set-cookie').split(';')[0];
  r();
})));
after(() => { server.close(); origin.close(); });

test('Feed wird geladen, Weiterleitungen werden verfolgt', async () => {
  const r = await (await fetch(base + '/api/podcasts/feed?url=' + encodeURIComponent(o + '/moved'), { headers: { cookie } })).json();
  assert.match(r.xml, /Folge 1/);
  assert.equal(r.finalUrl, o + '/feed');
});

test('Keine RSS-Datei wird abgelehnt', async () => {
  const r = await fetch(base + '/api/podcasts/feed?url=' + encodeURIComponent(o + '/page'), { headers: { cookie } });
  assert.equal(r.status, 422);
});

test('Folge wird zum Herunterladen durchgereicht', async () => {
  const r = await fetch(base + '/api/podcasts/media?url=' + encodeURIComponent(o + '/ep1.mp3'), { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await r.arrayBuffer()).byteLength, 5000);
});
