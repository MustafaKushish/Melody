import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let lastForm;
const mock = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('latin1');
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    lastForm = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', result: {
      title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', release_date: '1975-10-31',
      apple_music: { url: 'https://music.apple.com/x', artwork: { url: 'https://img/{w}x{h}.jpg' } },
      spotify: { external_urls: { spotify: 'https://open.spotify.com/track/x' } },
    } }));
  });
});
await new Promise((r) => mock.listen(0, r));
process.env.MELODY_DB = ':memory:';
process.env.AUDD_API_TOKEN = 'test-token';
process.env.AUDD_URL = `http://127.0.0.1:${mock.address().port}/`;
const { server } = await import('../index.js');
let base, cookie = '';
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); mock.close(); });

const wav = Buffer.alloc(44 + 11025 * 2 * 4);
wav.write('RIFF', 0);

test('Song-Erkennung: Aufnahme wird an AudD geschickt, Ergebnis normalisiert', async () => {
  const reg = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'R', email: 'r@example.com', password: 'geheim123', acceptTerms: true }) });
  cookie = reg.headers.get('set-cookie').split(';')[0];
  const r = await fetch(base + '/api/recognize', { method: 'POST', headers: { 'Content-Type': 'audio/wav', cookie }, body: wav });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.title, 'Bohemian Rhapsody');
  assert.equal(data.cover, 'https://img/600x600.jpg');
  assert.equal(data.links.spotify, 'https://open.spotify.com/track/x');
  assert.match(lastForm, /test-token/);
  assert.match(lastForm, /apple_music,spotify,deezer/);
});

test('Erkennung nur mit Anmeldung und nur als WAV', async () => {
  assert.equal((await fetch(base + '/api/recognize', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav })).status, 401);
  assert.equal((await fetch(base + '/api/recognize', { method: 'POST', headers: { 'Content-Type': 'text/plain', cookie }, body: 'x' })).status, 415);
});

test('Wunschliste zählt Wünsche', async () => {
  const r = await fetch(base + '/api/wishes', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ title: 'Bohemian Rhapsody', artist: 'Queen' }) });
  assert.equal(r.status, 200);
});
