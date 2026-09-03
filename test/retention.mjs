import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const setupSecret = process.env.TEST_ADMIN_SETUP_SECRET;
assert.ok(setupSecret, 'TEST_ADMIN_SETUP_SECRET is required');
const persistTo = process.env.TEST_D1_PERSIST_TO;
assert.ok(persistTo, 'TEST_D1_PERSIST_TO is required');
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

const post = (path, data = {}, expect = 200) => request(path, { method:'POST', body:JSON.stringify(data) }, expect);

function executeSql(command) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'only-lonely-db', '--local', '--persist-to', persistTo, '--command', command], {
    cwd: new URL('..', import.meta.url), stdio:'pipe', encoding:'utf8',
  });
}

async function scheduled() {
  const response = await fetch(base + '/cdn-cgi/local/scheduled');
  assert.equal(response.status, 200, `scheduled: ${await response.text()}`);
}

async function setupPin() {
  const auth = await request('/api/admin/auth-status');
  if (!auth.configured) await post('/api/admin/setup-pin', { pin:'2468', setupSecret }, 201);
  else if (!auth.authenticated) await post('/api/admin/login', { pin:'2468' });
}

await setupPin();
let current = await request('/api/admin/state');
assert.equal(current.game.status, 'finished', 'retention test expects the completed multi-round fixture');
const links = await request('/api/admin/participant-links');
const personalToken = new URL(links.participants[0].url).searchParams.get('p');
const sharedToken = current.game.sharedToken;
const ended = await post('/api/admin/end-event');
assert.equal(ended.purgeAfter - ended.endedAt, 24 * 60 * 60);
current = await request('/api/admin/state');
assert.equal(current.game.endedAt, ended.endedAt);
assert.equal(current.roundHistory.length, 3);
await post('/api/admin/next-round', { expectedRoundNumber:3 }, 409);
await post('/api/admin/registration', { participantId:current.participants[0].id, displayName:'変更不可', organization:'変更不可' }, 409);
await post('/api/vote', { token:personalToken, number:1 }, 409);
await post('/api/admin/purge-now', { confirmation:'違う文字' }, 400);

executeSql("UPDATE games SET purge_after=unixepoch()+3600 WHERE ended_at IS NOT NULL");
await scheduled();
assert.equal((await request('/api/admin/state')).roundHistory.length, 3, 'event purged before deadline');

executeSql("UPDATE games SET purge_after=unixepoch()-1 WHERE ended_at IS NOT NULL");
await Promise.all([scheduled(), scheduled()]);
assert.equal((await request('/api/admin/auth-status')).configured, false);
await request(`/api/participant?token=${personalToken}`, {}, 404);
const publicAfterPurge = await request(`/api/game?s=${sharedToken}`);
assert.equal(publicAfterPurge.game, null);
assert.equal((await request('/api/present')).game, null);

cookie = '';
await setupPin();
await post('/api/admin/game', { title:'7日安全網', min:1, max:2, names:['安全網A','安全網B'] }, 201);
const staleLinks = await request('/api/admin/participant-links');
const staleToken = new URL(staleLinks.participants[0].url).searchParams.get('p');
executeSql("UPDATE games SET last_activity_at=unixepoch()-(7*24*60*60)-1,ended_at=NULL,purge_after=NULL");
await Promise.all([scheduled(), scheduled()]);
assert.equal((await request('/api/admin/auth-status')).configured, false);
await request(`/api/participant?token=${staleToken}`, {}, 404);

cookie = '';
await setupPin();
await post('/api/admin/game', { title:'手動Cron競合', min:1, max:2, names:['競合A','競合B'] }, 201);
executeSql('UPDATE admin_auth SET game_id=NULL');
executeSql("UPDATE games SET last_activity_at=unixepoch()-(7*24*60*60)-1");
const manual = fetch(base + '/api/admin/purge-now', {
  method:'POST', headers:{ 'content-type':'application/json', cookie }, body:JSON.stringify({ confirmation:'完全削除' }),
});
const [manualResponse] = await Promise.all([manual, scheduled()]);
assert.notEqual(manualResponse.status, 500, `manual/Cron race failed: ${await manualResponse.text()}`);
assert.equal((await request('/api/admin/auth-status')).configured, false);

cookie = '';
await setupPin();
await post('/api/admin/game', { title:'通常リクエスト安全網', min:1, max:2, names:['通常A','通常B'] }, 201);
const requestSweepLinks = await request('/api/admin/participant-links');
const requestSweepToken = new URL(requestSweepLinks.participants[0].url).searchParams.get('p');
executeSql("UPDATE games SET last_activity_at=unixepoch()-(7*24*60*60)-1");
await request('/api/health');
assert.equal((await request('/api/admin/auth-status')).configured, false);
await request(`/api/participant?token=${requestSweepToken}`, {}, 404);

console.log('Retention E2E passed: 24h deadline, 7-day safety net, request sweep, manual/Cron and duplicate Cron idempotency, QR/session invalidation');
