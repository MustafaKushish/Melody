import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPopular, search, JAMENDO_PREFIX } from '../js/jamendo.js';

test('Jamendo getPopular returns fallback tracks when API credentials fail', async () => {
  const tracks = await getPopular('');
  assert.ok(Array.isArray(tracks));
  assert.ok(tracks.length > 0);
  assert.ok(tracks[0].id.startsWith(JAMENDO_PREFIX));
  assert.ok(tracks[0].url.startsWith('http'));
});

test('Jamendo getPopular with genre returns matching genre tracks', async () => {
  const tracks = await getPopular('pop');
  assert.ok(Array.isArray(tracks));
  assert.ok(tracks.length > 0);
  assert.equal(tracks[0].genre.toLowerCase(), 'pop');
});

test('Jamendo search returns relevant tracks for query', async () => {
  const results = await search('Sunset');
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  assert.match(results[0].title, /Sunset/i);
});
