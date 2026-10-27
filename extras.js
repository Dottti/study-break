// Reactions, rapid-fire picks and character trash talk.

export const REACTIONS = [
  { id: 'laugh', emoji: '😂', name: 'Laugh' },
  { id: 'melt', emoji: '🫠', name: 'Melt' },
  { id: 'eyeroll', emoji: '🙄', name: 'Eye roll' },
  { id: 'cheeky', emoji: '😏', name: 'Cheeky' },
];
export const reactionById = (id) => REACTIONS.find((r) => r.id === id);

// Rapid fire: every fifth break, three this-or-that picks. Match on all three for a bonus.
export const RAPID_EVERY = 5;
export const RAPID_SECONDS = 30;
export const RAPID_PAIRS = [
  ['Pizza', 'Burger'],
  ['Beach', 'Mountains'],
  ['Cats', 'Dogs'],
  ['Coffee', 'Tea'],
  ['Night in', 'Night out'],
  ['Sweet', 'Salty'],
  ['Summer', 'Winter'],
  ['Texting', 'Calling'],
  ['Movie', 'Series'],
  ['Early bird', 'Night owl'],
  ['Window seat', 'Aisle seat'],
  ['Sunrise', 'Sunset'],
  ['Cake', 'Ice cream'],
  ['Books', 'Podcasts'],
  ['Rain', 'Snow'],
  ['Pancakes', 'Waffles'],
  ['City', 'Countryside'],
  ['Spicy', 'Mild'],
  ['Hugs', 'Kisses'],
  ['Plan it', 'Wing it'],
];
export const isRapidQ = (q) => (q + 1) % RAPID_EVERY === 0;
// Same three pairs on both laptops for a given question.
export function rapidPairs(q) {
  const start = (Math.floor((q + 1) / RAPID_EVERY) - 1) * 3;
  return [0, 1, 2].map((i) => RAPID_PAIRS[(start + i) % RAPID_PAIRS.length]);
}

// One line per event, spoken by the scorer's character. {me} = the scorer, {you} = the other player.
export const TAUNTS = {
  bunny:    { point: 'Bunny hopped right over that guess.',        dare: 'Bunny sang. Try not to cry.',           sweep: 'Bunny: matched all three. Cute wins.' },
  kitten:   { point: 'Kitten purrs. Guessed it, obviously.',        dare: 'Kitten sang. The neighbours are listening.', sweep: 'Kitten: three for three. Pay up in treats.' },
  panda:    { point: 'Panda read your mind between naps.',           dare: 'Panda sang. Bamboo-grade performance.',   sweep: 'Panda: all three matched. Back to napping.' },
  unicorn:  { point: 'Unicorn sparkled through that guess.',         dare: 'Unicorn sang. Rainbows everywhere.',      sweep: 'Unicorn: a perfect three. Magical.' },
  fox:      { point: 'Fox saw that coming a mile away.',              dare: 'Fox sang. Sly and smooth.',               sweep: 'Fox: three matches. Outfoxed you.' },
  penguin:  { point: 'Penguin slid straight into that point.',        dare: 'Penguin sang. Very formal.',              sweep: 'Penguin: three for three. Waddle on.' },
  catwoman: { point: 'Cat Woman knew. Cat Woman always knows.',      dare: 'Cat Woman sang. You are welcome.',        sweep: 'Cat Woman: a clean three. Naturally.' },
  frog:     { point: 'Frog: ribbit. That is frog for "told you".',    dare: 'Frog sang. Half croak, half heart.',      sweep: 'Frog: three matches. Ribbit of victory.' },
  octopus:  { point: 'Octopus grabbed that point with all eight arms.', dare: 'Octopus sang. Eight arms, one song.',   sweep: 'Octopus: three for three. Ink everywhere.' },
  dragon:   { point: 'Dragon torched that guess.',                    dare: 'Dragon sang. Fire alarm went off.',       sweep: 'Dragon: three matches. Bow down.' },
  vampire:  { point: 'Vampire read your mind. Delicious.',            dare: 'Vampire sang. Very dramatic.',            sweep: 'Vampire: three for three. Eternal.' },
  zombie:   { point: 'Zombie: braaains. Correct braaains.',           dare: 'Zombie sang. Groaned, mostly.',           sweep: 'Zombie: three matches. Still hungry.' },
  ogre:     { point: 'Ogre smashed that guess.',                      dare: 'Ogre sang. The swamp is shaking.',        sweep: 'Ogre: all three. Get out of my swamp.' },
  poop:     { point: 'Mr. Poop got the point. Nobody saw it coming.', dare: 'Mr. Poop sang. Somehow it was beautiful.', sweep: 'Mr. Poop: three for three. Flush with pride.' },
};
export const tauntFor = (charId, event) => (TAUNTS[charId] || TAUNTS.bunny)[event];
