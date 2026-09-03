import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8790';
let cookie = '';

async function request(path, options = {}, expect = 200) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  assert.equal(response.status, expect, `${path}: ${JSON.stringify(data)}`);
  return data;
}

async function finishPresentation(assertOrganization) {
  let final;
  for (let i = 0; i < 120; i++) {
    const publicState = await request('/api/present');
    if (['idle', 'number', 'count', 'only'].includes(publicState.stage)) {
      assert.equal('organization' in (publicState.person || {}), false, `person organization leaked at ${publicState.stage}`);
    }
    assert.equal('organization' in (publicState.person || {}), false, `person organization leaked at ${publicState.stage}`);
    if (assertOrganization && publicState.champion) assert.ok(publicState.champion.organization);
    if (!assertOrganization) {
      assert.equal('organization' in (publicState.person || {}), false);
      assert.equal('organization' in (publicState.champion || {}), false);
    }
    const admin = await request('/api/admin/state');
    if (admin.game.status === 'finished') { final = admin; break; }
    await request('/api/admin/advance', { method: 'POST', body: '{}' });
  }
  assert.equal(final?.game.status, 'finished');
  return final;
}

const auth = await request('/api/admin/auth-status');
if (!auth.configured) await request('/api/admin/setup-pin', { method: 'POST', body: JSON.stringify({ pin: '2468' }) }, 201);
else await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: '2468' }) });

await request('/api/admin/game', { method: 'POST', body: JSON.stringify({
  title: '本人登録E2E', min: 1, max: 3, registrationMode: 'self-registration', participantCount: 4,
  organizationEnabled: true, organizationLabel: '所属', organizationRequired: true, showOrganizationInResults: true,
}) }, 201);

const setupState = await request('/api/admin/state');
assert.equal(setupState.game.registrationMode, 'self-registration');
assert.equal(setupState.participants.length, 4);
assert.ok(setupState.participants.every((p) => p.is_registered === 0));
assert.match(setupState.game.sharedToken, /^[a-f0-9]{32}$/);

const links = await request('/api/admin/participant-links');
assert.deepEqual(links.participants.map((p) => p.cardNumber), [1, 2, 3, 4]);
const tokens = links.participants.map((p) => new URL(p.url).searchParams.get('p'));
assert.ok(tokens.every((token) => /^[a-f0-9]{32}$/.test(token)));
assert.equal(new Set(tokens).size, 4);

await request('/api/game', {}, 403);
const shared = await request(`/api/game?s=${setupState.game.sharedToken}`);
assert.ok(shared.participants.every((p) => !('display_name' in p) && !('organization' in p) && !('access_token' in p)));
const firstBefore = await request(`/api/participant?token=${tokens[0]}`);
assert.equal(firstBefore.participant.card_number, 1);
assert.equal(firstBefore.participant.is_registered, 0);
assert.equal(firstBefore.participant.display_name, null);

await request('/api/vote', { method: 'POST', body: JSON.stringify({ token: tokens[0], number: 1 }) }, 409);
await request('/api/register', { method: 'POST', body: JSON.stringify({ participantId: setupState.participants[0].id, displayName: '番号だけ攻撃', organization: '外部' }) }, 403);

const concurrentRegistrations = await Promise.all([
  fetch(base + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tokens[0], displayName: '本人A', organization: '部署A' }) }),
  fetch(base + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: tokens[0], displayName: '本人A別名', organization: '部署X' }) }),
]);
assert.deepEqual(concurrentRegistrations.map((response) => response.status).sort(), [201, 409]);
const firstRegistered = await request(`/api/participant?token=${tokens[0]}`);
assert.equal(firstRegistered.participant.is_registered, 1);
assert.ok(['本人A', '本人A別名'].includes(firstRegistered.participant.display_name));
const winningOrganization = firstRegistered.participant.organization;

await request('/api/register', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[1].id,sharedToken:setupState.game.sharedToken,displayName:'本人B',organization:'部署B' }) }, 201);
await request('/api/admin/registration', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[2].id,displayName:'本人C仮',organization:'部署C仮' }) });
await request('/api/admin/registration', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[2].id,displayName:'本人C',organization:'部署C' }) });
await request('/api/admin/unregister', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[2].id }) });
await request('/api/admin/registration', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[2].id,displayName:'本人C再登録',organization:'部署C' }) });
await request('/api/register', { method: 'POST', body: JSON.stringify({ token:tokens[3],displayName:'本人D',organization:'部署D' }) }, 201);

const registeredState = await request('/api/admin/state');
assert.ok(registeredState.participants.every((p) => p.is_registered === 1));
assert.equal(registeredState.participants[2].display_name, '本人C再登録');
const sharedAfterRegistration = await request(`/api/game?s=${setupState.game.sharedToken}`);
assert.ok(sharedAfterRegistration.participants.every((p) => !('display_name' in p) && !('organization' in p)));

await request('/api/admin/start', { method: 'POST', body: '{}' });
await request('/api/vote', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[1].id,number:2 }) }, 403);
const unregisterVoteRace = await Promise.all([
  fetch(base + '/api/vote', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ participantId:setupState.participants[1].id,sharedToken:setupState.game.sharedToken,number:2 }) }),
  fetch(base + '/api/admin/unregister', { method:'POST', headers:{'content-type':'application/json',cookie}, body:JSON.stringify({ participantId:setupState.participants[1].id }) }),
]);
const raceStatuses = unregisterVoteRace.map((response) => response.status).sort();
assert.equal(raceStatuses[1], 409, 'vote/unregister race must reject one operation');
assert.ok([200, 201].includes(raceStatuses[0]), 'vote/unregister race must accept one operation');
let afterRace = await request('/api/admin/state');
const racedParticipant = afterRace.participants.find((participant) => participant.id === setupState.participants[1].id);
if (racedParticipant.has_voted === 0) {
  assert.equal(racedParticipant.is_registered, 0);
  await request('/api/admin/registration', { method:'POST', body:JSON.stringify({ participantId:setupState.participants[1].id,displayName:'本人B',organization:'部署B' }) });
  await request('/api/vote', { method:'POST', body:JSON.stringify({ participantId:setupState.participants[1].id,sharedToken:setupState.game.sharedToken,number:2 }) }, 201);
} else {
  assert.equal(racedParticipant.is_registered, 1);
}
await request('/api/admin/proxy-vote', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[2].id,number:2 }) }, 201);
await request('/api/vote', { method: 'POST', body: JSON.stringify({ token:tokens[3],number:3 }) }, 201);
await request('/api/vote', { method: 'POST', body: JSON.stringify({ token:tokens[3],number:1 }) }, 409);
const beforeLast = await request('/api/admin/state');
assert.equal(beforeLast.voted, 3);
assert.equal(beforeLast.game.status, 'voting');
assert.equal('presentation' in beforeLast, false);
assert.ok(beforeLast.participants.every((p) => !('number' in p)));
const last = await request('/api/vote', { method: 'POST', body: JSON.stringify({ token:tokens[0],number:1 }) }, 201);
assert.equal(last.autoClosed, true);
await request('/api/admin/unregister', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[0].id }) }, 409);
const closed = await request('/api/admin/state');
assert.equal(closed.game.status, 'closed');
assert.equal('presentation' in closed, false);
const beforeHost = await request('/api/present');
assert.equal(beforeHost.stage, 'idle');
assert.equal('organization' in (beforeHost.person || {}), false);
assert.equal('organization' in (beforeHost.champion || {}), false);

const visibleFinal = await finishPresentation(true);
assert.equal(visibleFinal.presentation.champion.number, 1);
assert.equal(visibleFinal.presentation.champion.organization, winningOrganization);
await request('/api/admin/registration', { method: 'POST', body: JSON.stringify({ participantId:setupState.participants[0].id,displayName:'終了後変更',organization:'不可' }) }, 409);

await request('/api/admin/end-event', { method:'POST', body:'{}' });
await request('/api/admin/purge-now', { method:'POST', body:JSON.stringify({ confirmation:'完全削除' }) });
cookie = '';
await request('/api/admin/setup-pin', { method:'POST', body:JSON.stringify({ pin:'2468' }) }, 201);

await request('/api/admin/game', { method: 'POST', body: JSON.stringify({
  title: '所属非表示E2E', min: 1, max: 2, registrationMode: 'self-registration', participantCount: 2,
  organizationEnabled: true, organizationLabel: 'チーム', organizationInputMode: 'select',
  organizationOptions: ['チームA', 'チームB'], organizationDefault: 'チームA',
  organizationRequired: true, showOrganizationInResults: false,
}) }, 201);
const hiddenState = await request('/api/admin/state');
assert.equal(hiddenState.game.organization.inputMode, 'select');
assert.deepEqual(hiddenState.game.organization.options, ['チームA', 'チームB']);
assert.equal(hiddenState.game.organization.defaultValue, 'チームA');
const hiddenLinks = await request('/api/admin/participant-links');
await request('/api/register', { method: 'POST', body: JSON.stringify({ token:new URL(hiddenLinks.participants[0].url).searchParams.get('p'),displayName:'候補外',organization:'秘密組織' }) }, 400);
for (let index = 0; index < 2; index++) {
  const token = new URL(hiddenLinks.participants[index].url).searchParams.get('p');
  await request('/api/register', { method: 'POST', body: JSON.stringify({ token,displayName:`非表示${index + 1}`,organization:index === 0 ? 'チームA' : 'チームB' }) }, 201);
}
await request('/api/admin/start', { method: 'POST', body: '{}' });
await request('/api/vote', { method: 'POST', body: JSON.stringify({ token:new URL(hiddenLinks.participants[0].url).searchParams.get('p'),number:1 }) }, 201);
await request('/api/vote', { method: 'POST', body: JSON.stringify({ token:new URL(hiddenLinks.participants[1].url).searchParams.get('p'),number:2 }) }, 201);
const hiddenFinal = await finishPresentation(false);
assert.equal('organization' in (hiddenFinal.presentation.person || {}), false);
assert.equal('organization' in (hiddenFinal.presentation.champion || {}), false);
assert.equal(hiddenState.game.organization.showInResults, false);

await request('/api/admin/purge-now', { method:'POST', body:JSON.stringify({ confirmation:'完全削除' }) });
cookie = '';
await request('/api/admin/setup-pin', { method:'POST', body:JSON.stringify({ pin:'2468' }) }, 201);
await request('/api/admin/game', { method:'POST', body:JSON.stringify({
  title:'その他自由入力E2E', min:1, max:2, registrationMode:'self-registration', participantCount:2,
  organizationEnabled:true, organizationLabel:'所属', organizationInputMode:'select',
  organizationOptions:['社内', '社外'], organizationDefault:'社内', organizationAllowOther:true,
  organizationRequired:true, showOrganizationInResults:false,
}) }, 201);
const otherState = await request('/api/admin/state');
assert.equal(otherState.game.organization.allowOther, true);
assert.equal(otherState.game.organization.defaultValue, '社内');
const otherLinks = await request('/api/admin/participant-links');
await request('/api/register', { method:'POST', body:JSON.stringify({ token:new URL(otherLinks.participants[0].url).searchParams.get('p'),displayName:'その他本人',organization:'地域コミュニティ' }) }, 201);
await request('/api/register', { method:'POST', body:JSON.stringify({ token:new URL(otherLinks.participants[1].url).searchParams.get('p'),displayName:'選択本人',organization:'社内' }) }, 201);
const otherRegistered = await request('/api/admin/state');
assert.deepEqual(otherRegistered.participants.map((participant) => participant.organization), ['地域コミュニティ', '社内']);

console.log('Self-registration E2E passed: atomic registration, free/select/other organization input, secure shared flow, admin correction/unregister, auto-close, organization privacy');
