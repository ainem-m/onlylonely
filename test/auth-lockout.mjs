import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const login = (pin) => fetch(base + '/api/admin/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ pin }),
});

// A successful login first guarantees a clean failure counter.
assert.equal((await login('2468')).status, 200);
const attempts = await Promise.all(Array.from({ length: 5 }, () => login('1111')));
const statuses = attempts.map((response) => response.status);
assert.ok(statuses.includes(429), `five concurrent failures did not lock: ${statuses.join(',')}`);
assert.equal((await login('2468')).status, 429, 'correct PIN must remain locked during the lock window');
console.log(`Concurrent PIN lockout passed: ${statuses.join(',')}; correct PIN blocked with 429`);
