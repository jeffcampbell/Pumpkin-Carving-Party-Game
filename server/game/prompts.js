// Prompts handed to players at the start of each carving round. A prompt is an
// adjective plus a subject ("A lazy cat"), kept simple enough to carve: the
// subject gives the shape, the adjective mostly gives the face.

// Adjectives that read clearly as a facial expression or pose.
const ADJECTIVES = [
  'happy', 'sleepy', 'grumpy', 'scared', 'angry', 'silly', 'lazy', 'sneaky',
  'shy', 'hungry', 'surprised', 'sad', 'proud', 'dizzy', 'cool', 'nervous',
  'excited', 'bored', 'confused', 'cheeky', 'sick', 'tired', 'brave', 'evil',
  'friendly', 'cranky', 'giggly', 'worried',
];

// For the moods category the mood is the whole point, so it gets a longer list.
const MOODS = [
  ...ADJECTIVES, 'jealous', 'embarrassed', 'furious', 'smug', 'lovesick',
  'grateful', 'guilty', 'startled', 'heartbroken', 'mischievous', 'starstruck',
];

export const WORDS = {
  animals: {
    nouns: [
      'cat', 'dog', 'owl', 'bat', 'frog', 'fish', 'pig', 'mouse', 'bunny', 'bear',
      'snake', 'spider', 'duck', 'cow', 'fox', 'lion', 'monkey', 'shark', 'turtle',
      'chicken', 'horse', 'penguin', 'octopus', 'elephant',
    ],
  },
  jobs: {
    nouns: [
      'chef', 'pirate', 'doctor', 'wizard', 'firefighter', 'astronaut', 'cowboy',
      'king', 'queen', 'clown', 'farmer', 'teacher', 'baker', 'artist', 'ninja',
      'detective', 'sailor', 'nurse', 'magician', 'scientist', 'rock star', 'lifeguard',
    ],
  },
  moods: { nouns: ['face', 'pumpkin', 'ghost'], adjectives: MOODS },
  monsters: {
    nouns: [
      'ghost', 'vampire', 'zombie', 'witch', 'mummy', 'werewolf', 'skeleton', 'alien',
      'cyclops', 'dragon', 'goblin', 'troll', 'ogre', 'gremlin', 'scarecrow', 'monster',
    ],
  },
  food: {
    nouns: [
      'pizza', 'cupcake', 'taco', 'banana', 'donut', 'cookie', 'apple', 'hot dog',
      'egg', 'carrot', 'burger', 'ice cream cone', 'pickle', 'potato', 'pancake', 'lemon',
    ],
  },
  things: {
    nouns: [
      'house', 'car', 'rocket', 'moon', 'sun', 'cloud', 'tree', 'robot', 'boat',
      'castle', 'light bulb', 'star', 'flower', 'umbrella', 'teapot', 'clock',
      'mushroom', 'snowman',
    ],
  },
};

const WORD_CATEGORIES = Object.keys(WORDS);

/**
 * Picks the next prompt for a room. `used` is a Set the room keeps between
 * rounds so subjects and adjectives don't repeat until a list runs out.
 */
export function pickPrompt({ category = 'random', customPrompts = [] } = {}, used = new Set(), random = Math.random) {
  if (category === 'custom') return pickFrom(customPrompts, used, 'custom:', random);
  const id = WORDS[category] ? category : WORD_CATEGORIES[Math.floor(random() * WORD_CATEGORIES.length)];
  const { nouns, adjectives = ADJECTIVES } = WORDS[id];
  const adjective = pickFrom(adjectives, used, 'adj:', random);
  const noun = pickFrom(nouns, used, `${id}:`, random);
  return `${/^[aeiou]/.test(adjective) ? 'An' : 'A'} ${adjective} ${noun}`;
}

/** A random item from `list` that isn't in `used`; forgets the list's history once it's exhausted. */
function pickFrom(list, used, prefix, random) {
  let pool = list.filter((item) => !used.has(prefix + item));
  if (pool.length === 0) {
    for (const item of list) used.delete(prefix + item);
    pool = list;
  }
  const item = pool[Math.floor(random() * pool.length)];
  used.add(prefix + item);
  return item;
}
