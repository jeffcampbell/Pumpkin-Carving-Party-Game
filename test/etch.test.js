import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etchTarget, LEVEL, ETCH_MAX, CUT_THRESHOLD } from '../src/pumpkin/mask.js';

test('three etching passes shave deeper, the fourth breaks through', () => {
  const passes = [];
  let value = LEVEL.skin;
  for (let i = 0; i < 5; i++) passes.push((value = etchTarget(value)));
  assert.deepEqual(passes, [96, 115, 134, LEVEL.cut, LEVEL.cut]);
  assert.equal(passes[2], ETCH_MAX);
  assert.ok(ETCH_MAX < CUT_THRESHOLD);
});

test('soft brush edges count as the nearest level, so edges do not break through early', () => {
  assert.equal(etchTarget(40), LEVEL.etch); // faint edge of a first pass
  assert.equal(etchTarget(100), 115); // a first-pass pixel grazed by a second pass
  assert.equal(etchTarget(120), 134); // second level, lightly grazed: one more step, not a hole
  assert.equal(etchTarget(130), LEVEL.cut); // effectively at the deepest level
  assert.equal(etchTarget(255), 255);
});
