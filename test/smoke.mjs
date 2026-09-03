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

await request('/api/health');
await request('/api/admin/participant-links', {}, 401);
await request('/api/participant?token=00000000000000000000000000000000', {}, 404);
const authStatus = await request('/api/admin/auth-status');
if (!authStatus.configured) {
  await request('/api/admin/setup-pin', { method: 'POST', body: JSON.stringify({ pin: '2468' }) }, 201);
  await request('/api/admin/setup-pin', { method: 'POST', body: JSON.stringify({ pin: '9999' }) }, 409);
}
await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: '1111' }) }, 401);
await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });
const authenticated = await request('/api/admin/auth-status');
assert.equal(authenticated.authenticated, true);
await request('/api/admin/game', { method: 'POST', body: JSON.stringify({ title: '作り直しテスト', min: 1, max: 3, names: ['仮A', '仮B'] }) }, 201);
await request('/api/admin/reset-game', { method: 'POST', body: '{}' });
assert.notEqual((await request('/api/admin/state')).game?.title, '作り直しテスト');
await request('/api/admin/game', { method: 'POST', body: JSON.stringify({ title: 'E2E ONLY LONELY', min: 1, max: 3, names: ['Aさん', 'Bさん', 'Cさん', 'Dさん'] }) }, 201);
await request('/api/admin/start', { method: 'POST', body: '{}' });
const startedState = await request('/api/admin/state');
const sharedToken = startedState.game.sharedToken;
await request('/api/game', {}, 403);
const publicGame = await request(`/api/game?s=${sharedToken}`);
assert.equal(publicGame.game.status, 'voting');
assert.equal(publicGame.participants.length, 4);
assert.ok(publicGame.participants.every((participant) => !('access_token' in participant)), 'personal token leaked from common participant list');

const ids = Object.fromEntries(publicGame.participants.map((p) => [p.display_name, p.id]));
const links = await request('/api/admin/participant-links');
assert.equal(links.participants.length, 4);
const personal = Object.fromEntries(links.participants.map((p) => [p.name, new URL(p.url).searchParams.get('p')]));
assert.match(personal['Aさん'], /^[a-f0-9]{32}$/);
const direct = await request(`/api/participant?token=${personal['Aさん']}`);
assert.equal(direct.participant.display_name, 'Aさん');
assert.equal(direct.participant.has_voted, 0);
const duplicateResponses = await Promise.all([3, 3].map((number) => fetch(base + '/api/vote', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ token: personal['Aさん'], number }),
})));
assert.deepEqual(duplicateResponses.map((response) => response.status).sort(), [201, 409]);
const directAfterVote = await request(`/api/participant?token=${personal['Aさん']}`);
assert.equal(directAfterVote.participant.has_voted, 1);
assert.equal(Number(directAfterVote.participant.game_id), Number(publicGame.game.id));
await request('/api/vote', { method: 'POST', body: JSON.stringify({ participantId: ids['Bさん'], sharedToken, number: 3 }) }, 201);
await request('/api/vote', { method: 'POST', body: JSON.stringify({ token: personal['Dさん'], number: 1 }) }, 201);
const beforeLast = await request('/api/admin/state');
assert.equal(beforeLast.voted, 3);
assert.equal(beforeLast.game.status, 'voting');
const sharedBeforeLast = await request(`/api/game?s=${sharedToken}`);
assert.deepEqual(sharedBeforeLast.participants.map((p) => p.display_name), ['Cさん']);
await request('/api/admin/proxy-vote', { method: 'POST', body: JSON.stringify({ participantId: ids['Cさん'], number: 2 }) }, 201);
const autoClosed = await request('/api/admin/state');
assert.equal(autoClosed.voted, 4);
assert.equal(autoClosed.game.status, 'closed');
assert.equal('presentation' in autoClosed, false, 'presentation data leaked before host starts it');
await request('/api/admin/unlock', { method: 'POST', body: JSON.stringify({ participantId: ids['Cさん'] }) });
await request('/api/admin/reopen', { method: 'POST', body: '{}' });
await request('/api/vote', { method: 'POST', body: JSON.stringify({ participantId: ids['Cさん'], sharedToken, number: 2 }) }, 201);
await request('/api/vote', { method: 'POST', body: JSON.stringify({ participantId: ids['Aさん'], number: 1 }) }, 409);
const votingState = await request('/api/admin/state');
assert.equal(votingState.voted, 4);
assert.equal(votingState.game.status, 'closed');
assert.equal('distribution' in votingState, false, 'distribution leaked before close');
assert.ok(votingState.participants.every((p) => !('number' in p)), 'vote number leaked in participant rows');

const closedPublic = await request(`/api/game?s=${sharedToken}`);
assert.equal(closedPublic.game.status, 'closed');
await request('/api/vote', { method: 'POST', body: JSON.stringify({ participantId: ids['Dさん'], number: 2 }) }, 409);

let final;
const publicStages = new Set();
const publicStates = [];
for (let i = 0; i < 30; i++) {
  await request('/api/admin/advance', { method: 'POST', body: '{}' });
  const visible = await request('/api/present');
  publicStages.add(visible.stage);
  publicStates.push(visible);
  final = await request('/api/admin/state');
  if (final.game.status === 'finished') break;
}
assert.equal(final.game.status, 'finished');
assert.ok(['number','count','pair','pair_count','pair_person','final'].every((stage) => publicStages.has(stage)), `missing public presentation stages: ${JSON.stringify([...publicStages])}`);
assert.ok(publicStates.every((visible) => !(visible.current <= 2 && ['number','count','only','person','champion'].includes(visible.stage))), '1 or 2 used the old single-number reveal');
assert.equal(final.presentation.champion.name, 'Dさん');
assert.equal(final.presentation.champion.number, 1);
assert.equal(final.distribution.find((row) => Number(row.number) === 3).count, 2);

const svg = await fetch(base + '/api/qr?text=' + encodeURIComponent(base + '/'));
assert.equal(svg.status, 200);
assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
assert.match(await svg.text(), /<svg/);

console.log('API smoke passed: auth, secrecy, voting, lock, countdown, champion, distribution, QR');
