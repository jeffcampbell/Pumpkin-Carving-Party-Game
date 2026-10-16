// Prompt categories a host can pick for a party game, in display order. The
// word lists behind them live on the server (server/game/prompts.js), so the
// client bundle doesn't carry them.
export const CATEGORIES = {
  random: { label: 'Random', icon: '🎲' },
  animals: { label: 'Animals', icon: '🐶' },
  jobs: { label: 'Jobs', icon: '🧑‍🍳' },
  moods: { label: 'Moods', icon: '😜' },
  monsters: { label: 'Monsters', icon: '👻' },
  food: { label: 'Food', icon: '🍕' },
  things: { label: 'Things', icon: '🚀' },
  custom: { label: 'Custom', icon: '✍️' },
};
export const DEFAULT_CATEGORY = 'random';
export const isCategory = (id) => Object.hasOwn(CATEGORIES, id);

export const CUSTOM_LIMITS = { count: 100, length: 60 };

/** Turns a textarea's worth of text (or an array) into a clean, de-duplicated prompt list. */
export function parseCustomPrompts(input) {
  const lines = Array.isArray(input) ? input : typeof input === 'string' ? input.split('\n') : [];
  const seen = new Set();
  const prompts = [];
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const prompt = line.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_LIMITS.length);
    const key = prompt.toLowerCase();
    if (!prompt || seen.has(key)) continue;
    seen.add(key);
    prompts.push(prompt);
    if (prompts.length === CUSTOM_LIMITS.count) break;
  }
  return prompts;
}
