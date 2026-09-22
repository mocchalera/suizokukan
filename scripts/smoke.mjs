import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const origin = new URL(process.env.BASE_URL || 'http://127.0.0.1:8787').origin;
const expectedCommit = process.env.EXPECTED_COMMIT;
const read = (route, options = {}) => fetch(`${origin}${route}`, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
const healthResponse = await read('/api/health');
assert.equal(healthResponse.status, 200);
assert.match(healthResponse.headers.get('content-type') || '', /application\/json/);
assert.equal(healthResponse.headers.get('cache-control'), 'no-store');
const health = await healthResponse.json();
assert.equal(health.ok, true);
if (expectedCommit) {
  const commit = expectedCommit === 'HEAD' ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : expectedCommit;
  assert.equal(health.commit, commit);
  assert.equal(health.dirty, false);
}
let html = '';
for (const route of ['/', '/create', '/collection', '/family', `/room/${crypto.randomUUID()}`]) {
  const response = await read(route, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 200, route);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  html = await response.text();
  assert.match(html, /おえかきのうみ/);
}
const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
assert(assetPaths.some(filename => filename.endsWith('.js')));
for (const filename of new Set(assetPaths)) {
  const response = await read(filename);
  assert.equal(response.status, 200, filename);
  assert.match(response.headers.get('cache-control') || '', /immutable/);
  assert.doesNotMatch(response.headers.get('content-type') || '', /text\/html/);
}
const source = await (await read('/source.json')).json();
assert.equal(source.commit, health.commit);
assert.equal(source.dirty, health.dirty);
for (const route of ['/api', '/api/not-a-route']) {
  const response = await read(route, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
}
const foreign = await read('/api/rooms', { method: 'POST', headers: { Origin: 'https://untrusted.invalid' } });
assert.equal(foreign.status, 403);
if (health.jev === 'fallback') {
  const response = await read('/api/personality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'あわが好き', fallback: { mood: 'calm', energy: 0.2, bubbleLove: 0.5 } }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'fallback');
}
console.log(JSON.stringify({ check: 'http-source-headers', passed: true, origin, commit: health.commit, dirty: health.dirty, deployment: health.deployment, jev: health.jev, assets: new Set(assetPaths).size }, null, 2));
