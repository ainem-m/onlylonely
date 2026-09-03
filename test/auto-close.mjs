import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
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
if (!auth.configured) await request('/api/admin/setup-pin', { method:'POST', body:JSON.stringify({ pin:'2468' }) }, 201);
else await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
const names = Array.from({ length: 32 }, (_, i) => `締切参加者${String(i + 1).padStart(2, '0')}`);
await request('/api/admin/game', { method: 'POST', body: JSON.stringify({ title: '32票目自動締切テスト', min: 1, max: 18, names }) }, 201);
await request('/api/admin/start', { method: 'POST', body: '{}' });
const sharedToken = (await request('/api/admin/state')).game.sharedToken;
const game = await request(`/api/game?s=${sharedToken}`);

await Promise.all(game.participants.slice(0, 31).map((participant, i) => request('/api/vote', {
  method: 'POST', body: JSON.stringify({ participantId: participant.id, sharedToken, number: (i % 18) + 1 }),
}, 201)));
const at31 = await request('/api/admin/state');
assert.equal(at31.voted, 31);
assert.equal(at31.game.status, 'voting');
assert.equal((await request(`/api/game?s=${sharedToken}`)).participants.length, 1);

const last = await request('/api/vote', { method: 'POST', body: JSON.stringify({ participantId: game.participants[31].id, sharedToken, number: 18 }) }, 201);
assert.equal(last.autoClosed, true);
const at32 = await request('/api/admin/state');
assert.equal(at32.voted, 32);
assert.equal(at32.game.status, 'closed');
assert.equal('presentation' in at32, false);
const publicClosed = await request(`/api/game?s=${sharedToken}`);
assert.equal(publicClosed.game.status, 'closed');
assert.equal(publicClosed.participants.length, 0);
const presentBeforeHost = await request('/api/present');
assert.equal(presentBeforeHost.stage, 'idle');
assert.equal(presentBeforeHost.count, null);
assert.equal(presentBeforeHost.person, null);

for (let i = 0; i < 150; i++) {
  const current = await request('/api/admin/state');
  if (current.game.status === 'finished') break;
  await request('/api/admin/advance', { method: 'POST', body: '{}' });
}
assert.equal((await request('/api/admin/state')).game.status, 'finished');
console.log('Auto-close passed: 31/32 voting, 32/32 closed, no result leak before host advance');
