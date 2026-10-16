// Prompts handed to players at the start of each carving round.
export const PROMPTS = [
  'A vampire who just woke up',
  'Your favorite animal',
  'A ghost that is scared of people',
  'The moon',
  'A haunted house',
  'A cat that saw a cucumber',
  'A robot',
  'Someone who just smelled something terrible',
  'A spider',
  'An owl',
  'A pirate',
  'A witch on a broomstick',
  'The happiest pumpkin alive',
  'A pumpkin with a secret',
  'A bat colony',
  'An alien',
  'Your best friend',
  'A skeleton',
  'A dragon',
  'The ocean',
  'A monster under the bed',
  'Something you would find in space',
  'A pumpkin that is very sleepy',
  'A grumpy old wizard',
  'A sunflower',
  'Your dream house',
  'A shark',
  'A pumpkin in love',
  'The worst haircut',
  'A frog prince',
  'A zombie that wants a hug',
  'A cyclops',
  'A snowman (in October)',
  'A spooky tree',
  'An evil genius',
  'A pumpkin who has seen things',
  'A mummy',
  'A werewolf at the full moon',
  'Fireworks',
  'Your own face',
];

/** Picks a prompt not in `used` (a Set); resets when every prompt has been used. */
export function pickPrompt(used, random = Math.random) {
  let pool = PROMPTS.filter((p) => !used.has(p));
  if (pool.length === 0) {
    used.clear();
    pool = PROMPTS;
  }
  const prompt = pool[Math.floor(random() * pool.length)];
  used.add(prompt);
  return prompt;
}
