import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const setupSecret = process.env.TEST_ADMIN_SETUP_SECRET;
assert.ok(setupSecret, 'TEST_ADMIN_SETUP_SECRET is required');
let cookie = '';
async function request(path, options = {}, expect = 200) {
  const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(options.headers || {}) } });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  assert.equal(response.status, expect, `${path}: ${JSON.stringify(data)}`);
  return data;
}

const auth = await request('/api/admin/auth-status');
if (!auth.configured) await request('/api/admin/setup-pin', { method:'POST', body:JSON.stringify({ pin:'2468', setupSecret }) }, 201);
else await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
const names = Array.from({ length: 32 }, (_, i) => `負荷参加者${String(i + 1).padStart(2, '0')}`);
await request('/api/admin/game', { method: 'POST', body: JSON.stringify({ title: '32人同時投票テスト', min: 1, max: 18, names }) }, 201);
await request('/api/admin/start', { method: 'POST', body: '{}' });
const sharedToken = (await request('/api/admin/state')).game.sharedToken;
const game = await request(`/api/game?s=${sharedToken}`);

const started = performance.now();
const timings = await Promise.all(game.participants.map(async (participant, i) => {
  const begin = performance.now();
  await request('/api/vote', { method: 'POST', body: JSON.stringify({ participantId: participant.id, sharedToken, number: (i % 18) + 1 }) }, 201);
  return performance.now() - begin;
}));
const elapsed = performance.now() - started;
const sorted = timings.toSorted((a, b) => a - b);
const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
const state = await request('/api/admin/state');
assert.equal(state.voted, 32);
assert.equal(state.total, 32);
assert.equal(state.game.status, 'closed');
assert.equal('distribution' in state, false);
for (let i = 0; i < 150; i++) {
  const state = await request('/api/admin/state');
  if (state.game.status === 'finished') break;
  await request('/api/admin/advance', { method: 'POST', body: '{}' });
}
const final = await request('/api/admin/state');
assert.equal(final.game.status, 'finished');
assert.equal(final.presentation.champion.number, 15);
console.log(`32 concurrent votes passed: total=${elapsed.toFixed(1)}ms p95=${p95.toFixed(1)}ms winner=15`);
