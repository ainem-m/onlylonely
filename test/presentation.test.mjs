import assert from 'node:assert/strict';
import test from 'node:test';

// TypeScript is compiled by the check step; this test mirrors the pure state contract via a tiny loader.
const mod = await import('../src/presentation.ts');
const base = { status: 'presenting', min: 1, max: 18, current: 18, stage: 'number', count: 0, participantId: null, participantName: null, championId: null, championNumber: null, history: [] };

test('closed starts at maximum without exposing count', () => {
  const result = mod.advancePresentation({ ...base, status: 'closed', current: null, stage: 'idle' });
  assert.deepEqual({ current: result.current, stage: result.stage, gameStatus: result.gameStatus }, { current: 18, stage: 'number', gameStatus: 'presenting' });
});

test('non-unique count advances to next number', () => {
  const result = mod.advancePresentation({ ...base, stage: 'count', count: 3 });
  assert.equal(result.current, 17);
  assert.equal(result.stage, 'number');
});

test('unique vote reveals separately, then updates champion before the next number', () => {
  const only = mod.advancePresentation({ ...base, stage: 'count', count: 1, participantId: 4, participantName: '山田' });
  assert.equal(only.stage, 'only');
  const person = mod.advancePresentation({ ...base, stage: 'only', count: 1, participantId: 4, participantName: '山田' });
  assert.equal(person.stage, 'person');
  assert.equal(person.championId, null);
  const championStage = mod.advancePresentation({ ...base, stage: 'person', count: 1, participantId: 4, participantName: '山田' });
  assert.equal(championStage.stage, 'champion');
  assert.equal(championStage.championId, 4);
  assert.equal(championStage.championNumber, 18);
  assert.deepEqual(championStage.history, [{ number: 18, participantId: 4, name: '山田' }]);
  const advanced = mod.advancePresentation({ ...base, stage: 'champion', count: 1, participantId: 4, participantName: '山田', championId: 4, championNumber: 18, history: championStage.history });
  assert.equal(advanced.championId, 4);
  assert.equal(advanced.current, 17);
});

test('a smaller unique answer replaces the old champion on the champion screen', () => {
  const result = mod.advancePresentation({ ...base, current: 9, stage: 'person', count: 1, participantId: 8, participantName: '佐藤', championId: 4, championNumber: 13, history: [{ number: 13, participantId: 4, name: '山田' }] });
  assert.equal(result.stage, 'champion');
  assert.equal(result.championId, 8);
  assert.equal(result.championNumber, 9);
  assert.equal(result.history.length, 2);
});

test('number one finishes with no winner when there is no unique vote', () => {
  const result = mod.advancePresentation({ ...base, current: 1, stage: 'count', count: 0 });
  assert.equal(result.gameStatus, 'finished');
  assert.equal(result.stage, 'final');
  assert.equal(result.championId, null);
});

test('numbers one and two enter a bundled finale without revealing either count', () => {
  const fromThree = mod.advancePresentation({ ...base, current:3, stage:'count', count:2 });
  assert.deepEqual({ current:fromThree.current, stage:fromThree.stage }, { current:2, stage:'pair' });
  const direct = mod.advancePresentation({ ...base, status:'closed', min:1, max:2, current:null, stage:'idle' });
  assert.deepEqual({ current:direct.current, stage:direct.stage }, { current:2, stage:'pair' });
  const counts = mod.advancePresentation({ ...base, current:2, stage:'pair' });
  assert.equal(counts.stage, 'pair_count');
});

test('both final counts are evaluated together and number one wins when both are unique', () => {
  const result = mod.advancePresentation({ ...base, current:2, stage:'pair_count', championId:9, championNumber:3, finalPair:[
    { number:1, count:1, participantId:1, participantName:'一郎' },
    { number:2, count:1, participantId:2, participantName:'二郎' },
  ] });
  assert.equal(result.stage, 'pair_person');
  assert.equal(result.championId, 1);
  assert.equal(result.championNumber, 1);
  assert.deepEqual(result.history.map((entry) => entry.number), [2, 1]);
});

test('number two wins only when it is the sole unique answer in the final pair', () => {
  const result = mod.advancePresentation({ ...base, current:2, stage:'pair_count', finalPair:[
    { number:1, count:2, participantId:null, participantName:null },
    { number:2, count:1, participantId:2, participantName:'二郎' },
  ] });
  assert.equal(result.stage, 'pair_person');
  assert.equal(result.championNumber, 2);
});

test('no unique final-pair answer preserves the earlier champion and finishes after count reveal', () => {
  const result = mod.advancePresentation({ ...base, current:2, stage:'pair_count', championId:9, championNumber:3, finalPair:[
    { number:1, count:2, participantId:null, participantName:null },
    { number:2, count:0, participantId:null, participantName:null },
  ] });
  assert.equal(result.stage, 'final');
  assert.equal(result.gameStatus, 'finished');
  assert.equal(result.championId, 9);
  assert.equal(result.championNumber, 3);
});

test('final-pair names are followed by the final result', () => {
  const result = mod.advancePresentation({ ...base, current:2, stage:'pair_person', championId:1, championNumber:1 });
  assert.equal(result.stage, 'final');
  assert.equal(result.gameStatus, 'finished');
});
