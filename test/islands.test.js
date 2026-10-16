import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findIslands } from '../src/pumpkin/islands.js';

const W = 40;
const H = 20;
const CUT = 158;

/** Builds a mask from a predicate: cut(x, y) => true means a hole there. */
function mask(cut) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[(y * W + x) * 4] = cut(x, y) ? 255 : 0;
  return data;
}

const loose = ({ groups, main }) => [...groups.keys()].filter((g) => g !== main);
const groupAt = ({ labels, groupOf }, x, y) => groupOf[labels[y * W + x]];

test('an uncut pumpkin is one piece', () => {
  const r = findIslands(mask(() => false), W, H, CUT);
  assert.equal(r.groups.size, 1);
});

test('a closed ring cut leaves the middle loose', () => {
  const ring = (x, y) => Math.max(Math.abs(x - 20), Math.abs(y - 10)) === 4;
  const r = findIslands(mask(ring), W, H, CUT);
  assert.equal(loose(r).length, 1);
  assert.equal(groupAt(r, 20, 10), loose(r)[0]);
  assert.notEqual(groupAt(r, 2, 2), loose(r)[0]);
});

test('a ring with a gap stays attached', () => {
  const ring = (x, y) => Math.max(Math.abs(x - 20), Math.abs(y - 10)) === 4 && !(x === 24 && y === 10);
  assert.equal(loose(findIslands(mask(ring), W, H, CUT)).length, 0);
});

test('etched (grey) skin still counts as attached skin', () => {
  const data = mask(() => false);
  for (let i = 0; i < W * H; i++) data[i * 4] = 152;
  assert.equal(findIslands(data, W, H, CUT).groups.size, 1);
});

test('the u seam wraps: a band straddling it is one piece, not two', () => {
  // Two vertical cuts at x=5 and x=30 split the pumpkin into a front band and a back
  // band that crosses the seam (x 31..39 + 0..4); the back band must be connected.
  // Rows 0 and H-1 are cut too, so the poles don't join the bands.
  const cuts = (x, y) => x === 5 || x === 30 || y === 0 || y === H - 1;
  const r = findIslands(mask(cuts), W, H, CUT);
  assert.equal(groupAt(r, 35, 10), groupAt(r, 2, 10));
  assert.notEqual(groupAt(r, 35, 10), groupAt(r, 15, 10));
  assert.equal(r.groups.size, 2);
});

test('pieces touching the same pole are joined through it', () => {
  // Vertical cuts from row 1 down split the sides apart, but every piece still
  // touches the top row, which is a single point on the pumpkin.
  const cuts = (x, y) => (x === 10 || x === 20 || x === 30) && y > 0;
  const r = findIslands(mask(cuts), W, H, CUT);
  assert.equal(r.groups.size, 1);
});

test('cutting all the way around near the top makes a loose lid that has the stem', () => {
  const r = findIslands(mask((x, y) => y === 4), W, H, CUT);
  const [lid] = loose(r);
  assert.equal(groupAt(r, 7, 1), lid);
  assert.equal(r.groups.get(lid).top, true);
  assert.equal(r.groups.get(r.main).top, false);
});

test('the main body is the biggest piece by real surface area, not pixel count', () => {
  // A horizontal cut at row 6 of 20: the top part is 6 rows but those rows are short
  // near the pole, so the bottom part (13 rows) wins easily; check area is weighted.
  const r = findIslands(mask((x, y) => y === 6), W, H, CUT);
  const top = r.groups.get(groupAt(r, 0, 0));
  const bottom = r.groups.get(groupAt(r, 0, 19));
  assert.equal(r.main, groupAt(r, 0, 19));
  assert.ok(top.area / top.pixels < bottom.area / bottom.pixels);
});

test('diagonal-only contact does not hold a piece on', () => {
  // A single solid pixel surrounded by cuts except at its corners is loose.
  const cuts = (x, y) => Math.abs(x - 20) + Math.abs(y - 10) === 1;
  const r = findIslands(mask(cuts), W, H, CUT);
  assert.equal(loose(r).length, 1);
  assert.equal(r.groups.get(loose(r)[0]).pixels, 1);
});
