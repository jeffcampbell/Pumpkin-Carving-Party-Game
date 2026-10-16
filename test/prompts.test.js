import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPrompt, WORDS } from '../server/game/prompts.js';
import { CATEGORIES, parseCustomPrompts, CUSTOM_LIMITS } from '../shared/prompt-categories.js';

test('every word category has a label, and every labelled category except random/custom has words', () => {
  for (const id of Object.keys(WORDS)) assert.ok(CATEGORIES[id], id);
  for (const id of Object.keys(CATEGORIES)) if (id !== 'random' && id !== 'custom') assert.ok(WORDS[id], id);
});

test('prompts are an article, an adjective and a subject from the chosen category', () => {
  const used = new Set();
  for (let i = 0; i < 50; i++) {
    const prompt = pickPrompt({ category: 'animals' }, used);
    const [, article, adjective, noun] = prompt.match(/^(An?) ([a-z]+) (.+)$/);
    assert.equal(article, /^[aeiou]/.test(adjective) ? 'An' : 'A', prompt);
    assert.ok(WORDS.animals.nouns.includes(noun), prompt);
  }
});

test('subjects do not repeat until the category runs out', () => {
  const used = new Set();
  const { nouns } = WORDS.food;
  const seen = Array.from({ length: nouns.length }, () => pickPrompt({ category: 'food' }, used).match(/^An? [a-z]+ (.+)$/)[1]);
  assert.equal(new Set(seen).size, nouns.length);
  assert.doesNotThrow(() => pickPrompt({ category: 'food' }, used)); // starts over
});

test('random draws from the word categories; unknown categories fall back to random', () => {
  const nouns = new Set(Object.values(WORDS).flatMap((c) => c.nouns));
  for (const category of ['random', 'bogus']) {
    const prompt = pickPrompt({ category });
    assert.ok(nouns.has(prompt.match(/^An? [a-z]+ (.+)$/)[1]), prompt);
  }
});

test('custom prompts are used as written and cycle without repeats', () => {
  const customPrompts = ['Our teacher', 'A haunted toaster', 'Grandma on a skateboard'];
  const used = new Set();
  const picked = customPrompts.map(() => pickPrompt({ category: 'custom', customPrompts }, used));
  assert.deepEqual([...picked].sort(), [...customPrompts].sort());
});

test('custom prompt lists are trimmed, de-duplicated and capped', () => {
  assert.deepEqual(parseCustomPrompts(' A cat \n\na CAT\nA  dog\r\n'), ['A cat', 'A dog']);
  assert.deepEqual(parseCustomPrompts([1, null, 'Ok']), ['Ok']);
  assert.deepEqual(parseCustomPrompts(undefined), []);
  assert.equal(parseCustomPrompts('x'.repeat(200))[0].length, CUSTOM_LIMITS.length);
  const many = Array.from({ length: 150 }, (_, i) => `Prompt ${i}`).join('\n');
  assert.equal(parseCustomPrompts(many).length, CUSTOM_LIMITS.count);
});
