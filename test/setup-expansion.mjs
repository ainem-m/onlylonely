import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8801';
let cookie = '';

async function request(path, options = {}, expect = 200) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type':'application/json', ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  assert.equal(response.status, expect, `${path}: ${JSON.stringify(data)}`);
  return data;
}

const auth = await request('/api/admin/auth-status');
if (!auth.configured) await request('/api/admin/setup-pin', { method:'POST', body:JSON.stringify({ pin:'2468' }) }, 201);
else if (!auth.authenticated) await request('/api/admin/login', { method:'POST', body:JSON.stringify({ pin:'2468' }) });

await request('/api/admin/game', { method:'POST', body:JSON.stringify({
  title:'準備中の追加E2E', min:1, max:12, registrationMode:'self-registration', participantCount:3,
}) }, 201);
const beforeLinks = await request('/api/admin/participant-links');
const originalUrls = beforeLinks.participants.map(participant => participant.url);
const expansionBody = JSON.stringify({ expectedTotal:3, expectedMax:12, addParticipants:5, addNumbers:4 });
const concurrent = await Promise.all([
  fetch(base + '/api/admin/expand-setup', { method:'POST', headers:{ 'content-type':'application/json', cookie }, body:expansionBody }),
  fetch(base + '/api/admin/expand-setup', { method:'POST', headers:{ 'content-type':'application/json', cookie }, body:expansionBody }),
]);
assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 201]);

const expanded = await request('/api/admin/state');
assert.equal(expanded.game.status, 'setup');
assert.equal(expanded.total, 8);
assert.equal(expanded.game.max, 16);
const afterLinks = await request('/api/admin/participant-links');
assert.deepEqual(afterLinks.participants.slice(0, 3).map(participant => participant.url), originalUrls, 'existing QR changed');
assert.deepEqual(afterLinks.participants.map(participant => participant.cardNumber), [1,2,3,4,5,6,7,8]);
assert.equal(new Set(afterLinks.participants.map(participant => participant.url)).size, 8);

await request('/api/admin/start', { method:'POST', body:'{}' });
await request('/api/admin/expand-setup', { method:'POST', body:JSON.stringify({ expectedTotal:8, expectedMax:16, addParticipants:1, addNumbers:1 }) }, 409);

console.log('Setup expansion E2E passed: +5 participants, +4 max, stable existing QR, idempotent retry, setup-only guard');
