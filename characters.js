// Pick-your-character roster, from cutest to least cute. Cuteness is out of 10.
export const CHARACTERS = [
  { id: 'bunny',    emoji: '🐰', name: 'Bunny',       cute: 10, line: 'Too cute to lose.' },
  { id: 'kitten',   emoji: '🐱', name: 'Kitten',      cute: 10, line: 'Purrs when you answer.' },
  { id: 'panda',    emoji: '🐼', name: 'Panda',       cute: 9,  line: 'Studies, then naps.' },
  { id: 'unicorn',  emoji: '🦄', name: 'Unicorn',     cute: 9,  line: 'Sparkles on every point.' },
  { id: 'fox',      emoji: '🦊', name: 'Fox',         cute: 8,  line: 'Sly guesser.' },
  { id: 'penguin',  emoji: '🐧', name: 'Penguin',     cute: 8,  line: 'Waddles to the next break.' },
  { id: 'catwoman', emoji: '😼', name: 'Cat Woman',   cute: 7,  line: 'Dangerous and knows it.' },
  { id: 'frog',     emoji: '🐸', name: 'Frog',        cute: 6,  line: 'Ribbit. That is the answer.' },
  { id: 'octopus',  emoji: '🐙', name: 'Octopus',     cute: 5,  line: 'Eight arms, zero focus.' },
  { id: 'dragon',   emoji: '🐲', name: 'Dragon',      cute: 4,  line: 'Burns the study notes.' },
  { id: 'vampire',  emoji: '🧛', name: 'Vampire',     cute: 3,  line: 'Only studies at night.' },
  { id: 'zombie',   emoji: '🧟', name: 'Zombie',      cute: 2,  line: 'Braaains. Needs coffee.' },
  { id: 'ogre',     emoji: '👹', name: 'Ogre',        cute: 1,  line: 'Big heart. Hidden well.' },
  { id: 'poop',     emoji: '💩', name: 'Mr. Poop',    cute: 0,  line: 'Somebody has to be last.' },
];
export const charById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

// Titles you earn together as the points grow. A full game is roughly 800 to 1,200 points together
// (about 16 per question just for answering, plus guesses and rapid fire), so the ladder runs to the last questions.
export const TITLES = [
  [0, 'Strangers at the library'],
  [40, 'Study buddies'],
  [110, 'Lab partners'],
  [200, 'Coffee date regulars'],
  [310, 'Partners in crime'],
  [440, 'Inside joke experts'],
  [590, 'Two peas in a pod'],
  [760, 'Power couple'],
  [950, 'Soulmates'],
];
export const titleFor = (pts) => TITLES.filter(([min]) => pts >= min).pop()[1];
