import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
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

const post = (path, data = {}, expect = 200) => request(path, { method:'POST', body:JSON.stringify(data) }, expect);

async function setupPin() {
  const auth = await request('/api/admin/auth-status');
  if (!auth.configured) await post('/api/admin/setup-pin', { pin:'2468' }, 201);
  else if (!auth.authenticated) await post('/api/admin/login', { pin:'2468' });
}

async function finishRound(expectedRound) {
  const before = await request('/api/present');
  assert.equal(before.game.roundNumber, expectedRound);
  assert.equal(before.stage, 'idle');
  assert.equal('count' in before && before.count !== null, false, 'count leaked before host reveal');
  const stages = new Set();
  for (let step = 0; step < 100; step++) {
    const state = await request('/api/admin/state');
    if (state.game.status === 'finished') {
      assert.equal(state.game.roundNumber, expectedRound);
      assert.ok(stages.has('pair') && stages.has('pair_count') && stages.has('pair_person'), `missing simultaneous final-pair stages: ${JSON.stringify([...stages])}`);
      return state;
    }
    await post('/api/admin/advance');
    const visible = await request('/api/present');
    stages.add(visible.stage);
    assert.equal(visible.current <= 2 && ['number','count','only','person','champion'].includes(visible.stage), false, `number ${visible.current} leaked through the old single-number flow`);
    if (visible.stage === 'pair') assert.ok(visible.finalPair.every((entry) => !('count' in entry) && !('person' in entry)), '1/2 count leaked before simultaneous reveal');
    if (visible.stage === 'pair_count') assert.ok(visible.finalPair.every((entry) => 'count' in entry && !('person' in entry)), 'final-pair counts were not revealed together');
    if (visible.stage === 'pair_person') {
      assert.equal(visible.champion, null, 'final winner leaked on the name reveal');
      assert.ok(visible.finalPair.filter((entry) => entry.count === 1).every((entry) => entry.person?.name), 'unique final-pair name missing');
    }
  }
  throw new Error(`round ${expectedRound} presentation did not finish`);
}

async function prepareNextRound(expectedRound) {
  const responses = await Promise.all([0, 1].map(() => fetch(base + '/api/admin/next-round', {
    method:'POST', headers:{ 'content-type':'application/json', cookie }, body:JSON.stringify({ expectedRoundNumber:expectedRound }),
  })));
  assert.ok(responses.every((response) => [200, 201].includes(response.status)), `next-round race: ${responses.map((response) => response.status)}`);
  const state = await request('/api/admin/state');
  assert.equal(state.game.roundNumber, expectedRound + 1);
  assert.equal(state.game.status, 'setup');
  assert.equal(state.voted, 0);
  await post('/api/admin/next-round', { expectedRoundNumber:expectedRound });
  assert.equal((await request('/api/admin/state')).game.roundNumber, expectedRound + 1);
}

async function runRosterEvent() {
  await post('/api/admin/game', { title:'3回戦・名簿', min:1, max:2, names:['名簿A','名簿B','名簿C'] }, 201);
  const links = await request('/api/admin/participant-links');
  const tokens = links.participants.map((participant) => new URL(participant.url).searchParams.get('p'));
  const sharedToken = links.game.sharedToken;
  for (let round = 1; round <= 3; round++) {
    const setupParticipant = await request(`/api/participant?token=${tokens[0]}`);
    assert.equal(setupParticipant.participant.current_round_number, round);
    assert.equal(setupParticipant.participant.has_voted, 0);
    await post('/api/admin/start');
    await post('/api/vote', { token:tokens[0], number:1 }, 201);
    await post('/api/vote', { token:tokens[0], number:2 }, 409);
    await post('/api/vote', { token:tokens[1], number:2 }, 201);
    const last = await post('/api/vote', { participantId:links.participants[2].id, sharedToken, number:2 }, 201);
    assert.equal(last.autoClosed, true);
    const final = await finishRound(round);
    assert.equal(final.presentation.champion.name, '名簿A');
    assert.equal(final.roundHistory.length, round);
    if (round < 3) await prepareNextRound(round);
  }
  const finalLinks = await request('/api/admin/participant-links');
  assert.deepEqual(finalLinks.participants.map((participant) => new URL(participant.url).searchParams.get('p')), tokens);
  assert.equal(finalLinks.game.sharedToken, sharedToken);
  await post('/api/admin/end-event');
  await post('/api/admin/next-round', { expectedRoundNumber:3 }, 409);
  await post('/api/vote', { token:tokens[0], number:1 }, 409);
  await post('/api/admin/purge-now', { confirmation:'完全削除' });
  assert.equal((await request('/api/admin/auth-status')).configured, false);
  cookie = '';
}

async function runSelfRegistrationEvent() {
  await setupPin();
  await post('/api/admin/game', {
    title:'3回戦・本人登録', min:1, max:2, registrationMode:'self-registration', participantCount:2,
    organizationEnabled:true, organizationLabel:'所属', organizationRequired:true, showOrganizationInResults:true,
  }, 201);
  const setup = await request('/api/admin/state');
  const links = await request('/api/admin/participant-links');
  const tokens = links.participants.map((participant) => new URL(participant.url).searchParams.get('p'));
  const sharedToken = setup.game.sharedToken;
  await post('/api/register', { token:tokens[0], displayName:'本人A', organization:'部署A' }, 201);
  await post('/api/register', { participantId:setup.participants[1].id, sharedToken, displayName:'本人B', organization:'部署B' }, 201);
  for (let round = 1; round <= 3; round++) {
    const registered = await request(`/api/participant?token=${tokens[0]}`);
    assert.equal(registered.participant.current_round_number, round);
    assert.equal(registered.participant.is_registered, 1);
    assert.equal(registered.participant.display_name, '本人A');
    const shared = await request(`/api/game?s=${sharedToken}`);
    assert.ok(shared.participants.every((participant) => !('display_name' in participant) && !('organization' in participant)));
    await post('/api/admin/start');
    await post('/api/vote', { token:tokens[0], number:1 }, 201);
    const last = await post('/api/vote', { participantId:setup.participants[1].id, sharedToken, number:2 }, 201);
    assert.equal(last.autoClosed, true);
    const final = await finishRound(round);
    assert.equal(final.presentation.champion.name, '本人A');
    assert.equal(final.presentation.champion.organization, '部署A');
    if (round < 3) await prepareNextRound(round);
  }
  const final = await request('/api/admin/state');
  assert.deepEqual(final.roundHistory.map((round) => round.roundNumber), [3, 2, 1]);
  assert.ok(final.roundHistory.every((round) => round.champion.name === '本人A'));
  assert.ok(final.roundHistory.every((round) => round.champion.organization === '部署A'));
}

await setupPin();
await runRosterEvent();
await runSelfRegistrationEvent();
console.log('Multi-round E2E passed: roster/self-registration, 3 rounds, stable QR/shared tokens, idempotent next-round, privacy');
