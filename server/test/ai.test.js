import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Stand-in for the Claude API: records the request, returns a structured answer.
let lastRequest;
let reply;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(body) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
});
await new Promise((r) => mock.listen(0, r));

process.env.MELODY_DB = ':memory:';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.MELODY_AI_DAILY_LIMIT = '2';

const { server } = await import('../index.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); mock.close(); });

let cookie = '';
async function api(path, body) {
  const res = await fetch(base + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}

const message = (json, stop = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 10, output_tokens: 10 },
});

const library = [
  { t: 'Sommerwind', a: 'Luna Park', g: 'Pop', y: '2026', p: 3, f: 1 },
  { t: 'Treibholz', a: 'Die Wellen', g: 'Indie', y: '2025', p: 0, f: 0 },
];

test('KI-Mix: Anfrage an Claude ist korrekt aufgebaut, Antwort wird geprüft', async () => {
  await api('/auth/register', { name: 'K', email: 'ki@example.com', password: 'geheim123', acceptTerms: true });
  reply = message({ title: 'Sonntag', message: 'Viel Spaß!', trackIndexes: [1, 0, 7, 1], preset: 'Melody Chill', radioTags: ['chillout'], discover: [{ artist: 'A', song: 'B', why: 'C' }] });
  const r = await api('/ai/recommend', { prompt: 'Entspannen', library, recent: [0], hour: 9 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.trackIndexes, [1, 0]); // invented index 7 and duplicate removed
  assert.equal(r.data.preset, 'Melody Chill');
  assert.equal(r.data.source, 'ki');

  const b = lastRequest.body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.fallbacks, 'default');
  assert.match(lastRequest.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(b.output_config.format.type, 'json_schema');
  assert.equal(b.output_config.effort, 'low');
  assert.equal(b.thinking, undefined);
  assert.match(b.messages[0].content, /Sommerwind/);
});

test('KI-Ablehnung wird sauber gemeldet, Tageslimit greift', async () => {
  reply = message({}, 'refusal');
  const r = await api('/ai/recommend', { prompt: 'x', library });
  assert.equal(r.status, 422);
  const limited = await api('/ai/recommend', { prompt: 'x', library });
  assert.equal(limited.status, 429);
});
