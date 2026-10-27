// The 40 questions, in play order. Levels: 0-14 light, 15-29 deeper, 30-39 close.
// The one "dare" is voice only: no typing, you have to record it. Every other question is typed.
const q = (text) => ({ text });
const dare = (text) => ({ text, dare: true });

export const QUESTIONS = [
  q('What is a small thing that always makes your day better?'),
  q('What food could you eat every day for a month?'),
  q('What was your favorite cartoon as a kid?'),
  q('If we had a free day tomorrow with no studying, what would we do?'),
  q('What song do you play when you need energy?'),
  q('What is a skill you wish you had without practice?'),
  q('What is the funniest thing that happened to you this year?'),
  q('Morning person or night person, and why?'),
  q('What is one place you want us to visit together?'),
  q('What subject did you hate most in school?'),
  q('What is a nickname you would give me, and why?'),
  q('What is the best gift you ever got?'),
  q('What is a habit of mine you find cute?'),
  q('If you could live in any city for one year, which one?'),
  q('What would your perfect weekend breakfast be?'),

  q('What are you most proud of that few people know about?'),
  q('What does a good day look like for you, start to finish?'),
  q('What is something you were scared of and did anyway?'),
  q('Who taught you the most about life, and what did they teach you?'),
  q('What do you want your life to look like in five years?'),
  dare('Dare: sing me a few lines of a song that reminds you of me. Voice note only, no typing.'),
  q('When do you feel most like yourself?'),
  q('What is one thing you want to get better at this year?'),
  q('What is a memory from your childhood you think about often?'),
  q('What stresses you most about studying right now?'),
  q('What helps you most when you feel down?'),
  q('What is a dream you have not told many people?'),
  q('What does home mean to you?'),
  q('What is one thing you want us to try together?'),
  q('What is something you are thankful for today?'),

  q('When did you first feel close to me?'),
  q('What is something I do that makes you feel loved?'),
  q('What is one thing I could do to support you better?'),
  q('What is your favorite memory of us so far?'),
  q('What is the sweetest thing you can say to me right now?'),
  q('What is something you want to tell me but find hard to say?'),
  q('What do you think we do well as a team?'),
  q('What is one thing you hope never changes between us?'),
  q('What did you think of me the first time we met?'),
  q('Finish this sentence: "When I think about our future, I feel..."'),
];

export const LEVELS = ['Light', 'Deeper', 'Close'];
export const levelOf = (i) => (i < 15 ? 0 : i < 30 ? 1 : 2);
