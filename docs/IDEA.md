# 40 Questions: a study-break game for two

Status: live and playable (v6, 2026-10-28). The sections down to "Decisions" are the first draft from 2026-10-27
(timers, phones). They are kept for history; the decisions and version log below are what the game does now.

## The idea in one line

While you both study, the game gives you one question at each break. You both answer. Then you see each other's answer.
Over 40 questions you get closer, and studying feels less lonely.

## How a session works

1. You both start a study timer together (for example 25 minutes).
2. The timer ends. A break starts (5 minutes).
3. One question shows on both phones.
4. Each of you answers in private: type it, or record a short voice note.
5. When both have answered, both answers show at the same time. Nobody can copy the other.
6. Timer starts again. Next break, next question.

A normal study night of 4 breaks = 4 questions. 40 questions = about 10 study nights.

## Stronger versions to consider

1. Guess mode. You answer for yourself and also guess her answer. You get a point for each right guess. Turns it into a game with a score.
2. Unlock only by studying. A new question only unlocks after a full focus block. The reward for studying is the next question.
3. Levels. Questions go from light (1 to 15) to deeper (16 to 30) to close (31 to 40). Like the well-known "36 questions" study, where questions get more personal step by step.
4. Memory book. Every answer is saved. After question 40 you get a page with all your answers together, to keep.
5. Daily widget. A home-screen widget shows today's question and a dot when she has answered.

## My pick

Start with versions 1, 2, 3 and 4 together. Guess mode makes it a game. Unlock-by-studying ties it to studying. Levels keep it interesting. The memory book is the payoff at the end.
Add the widget (version 5) second.

Build: first as a web app you both open from a link on your phones. It works on iPhone and Android, needs no App Store review, and can be ready fast.
The home-screen widget needs a real phone app. Do that second, once you both like the game. Same Flutter setup as Imaan and XoXo Arcade.

## The 40 questions (draft, edit freely)

Level 1: light (1 to 15)
1. What is a small thing that always makes your day better?
2. What food could you eat every day for a month?
3. What was your favorite cartoon as a kid?
4. If we had a free day tomorrow with no studying, what would we do?
5. What song do you play when you need energy?
6. What is a skill you wish you had without practice?
7. What is the funniest thing that happened to you this year?
8. Morning person or night person, and why?
9. What is one place you want us to visit together?
10. What subject did you hate most in school?
11. What is your comfort movie or show?
12. What is the best gift you ever got?
13. What is a habit of mine you find cute?
14. If you could live in any city for one year, which one?
15. What would your perfect weekend breakfast be?

Level 2: deeper (16 to 30)
16. What are you most proud of that few people know about?
17. What does a good day look like for you, start to finish?
18. What is something you were scared of and did anyway?
19. Who taught you the most about life, and what did they teach you?
20. What do you want your life to look like in five years?
21. What is something you changed your mind about recently?
22. When do you feel most like yourself?
23. What is one thing you want to get better at this year?
24. What is a memory from your childhood you think about often?
25. What stresses you most about studying right now?
26. What helps you most when you feel down?
27. What is a dream you have not told many people?
28. What does home mean to you?
29. What is one thing you want us to try together?
30. What is something you are thankful for today?

Level 3: close (31 to 40)
31. When did you first feel close to me?
32. What is something I do that makes you feel loved?
33. What is one thing I could do to support you better?
34. What is your favorite memory of us so far?
35. What is something you want to tell me but find hard to say?
36. What do you think we do well as a team?
37. What is one thing you hope never changes between us?
38. What did you think of me the first time we met?
39. What is a promise you want us to make for the next year?
40. Finish this sentence: "When I think about our future, I feel..."

## Decisions (2026-10-27)

1. Name: Study Break.
2. Language: English.
3. Answers: typing and voice notes.
4. Device: laptops, not phones. Hers is Windows, his is a Mac.
5. So v1 is a web app in the browser, synced laptop to laptop with a game code. The "widget" is the app installed
   as its own small window (Chrome or Edge: Install app), with a compact mode.
6. He uses a screen reader: every step is announced, focus jumps to the new question, a chime marks each break.

## Log

- 2026-10-27: idea restarted from scratch, draft questions written.
- 2026-10-27: v1 web app built in `Couples-40Q/app/` (plain HTML + JS, no build step).
  Sync is direct laptop to laptop (PeerJS); answers and voice notes never sit on a server. Each laptop keeps a full copy.
  Tested with two players in two browser tabs: create + join by code, timer loop, unlock per break, private answer
  then reveal, guess scoring, reconnect after reload, half-typed answer kept, voice note sent to the other side
  (fake mic, real mic is blocked in the test browser), memory book and its download. No console errors.
  Not yet: a public link, so her Windows laptop can open it. Real microphone test on a real laptop.

- 2026-10-27: pushed to GitHub (repo Dottti/study-break, public) and live on GitHub Pages.
  Tested the live link as two players: join by code, connect, timer, first question opened on both. Test data cleared.

## v2 (2026-10-27): Valentine edition

- Valentine look: pink and red theme, Pacifico title, floating hearts, heart bursts on reveals and points.
- Choose your character at the start, 14 characters from Bunny (cute 10/10) down to Mr. Poop (0/10). Each player picks
  one and a name. Partner's character shows in the top bar, the score bar and the answer cards.
- Points: lock in an answer 5, the singing dare 10, both answer the same question 3 more each, partner judges your
  guess right 10. Team titles as the total grows: Strangers at the library, Study buddies, Lab partners, Partners in
  crime, Soulmates.
- Voice only on one question, number 21: "Sing me a few lines of a song that reminds you of me." Every other question
  is typed. Two questions reworded to typed ones (nickname for me; sweetest thing you can say).
- Five spicy questions with a chilli tag (sleepwear, favorite outfit on me, where you like to be kissed, lazy morning
  in bed, what makes your heart race). Adult but tasteful.
- Guess your partner's answer is on every typed question, partner judges it, 10 points if right.
- Sounds on/off button in the top bar (the break chime). Test partner name in notes and tests: Dana.
- Business idea (his): sell a version as a one-time $1.99 USD purchase. Needs: own domain, Stripe or Lemon Squeezy
  (Lemon Squeezy already approved for Desloppy), a license code screen, more question packs. Parked until she likes it.

## v3 (2026-10-27): no timers, random pop-ups, more game

- His rule: no timers. Questions pop up at a random moment while they study, gap 3 to 10 minutes, no countdown shown.
- A question stays open until both answer. Then the reveal stays up 3 minutes (judge the guess, react), or either
  presses Back to studying. Then a new random gap.
- Reactions on the partner's answer: Laugh, Melt, Eye roll, Cheeky. The other hears it and their character bounces.
- Rapid fire on every 5th question: three this-or-that picks (Pizza or Burger...). 5 points per match, 10 extra for
  all three. 20 pairs in extras.js, same three on both laptops.
- Trash talk: each character has a line for a right guess, the dare, and a rapid-fire sweep. Shown to both for 7 s.
- Streak: 3 right guesses in a row shows a flame and doubles the next right guess to 20.
- Cache busting: index.html loads app.js?v=3 and style.css?v=3; bump v on every release or browsers keep the old file.
- Tested as two players in fast mode: pop-up, answer, reveal, judge, react, taunt, rapid sweep, streak flame. No errors.

## v4 (2026-10-27): the look

- His rule: pretty, beautiful, and NOT red. Palette is blush cream, lavender wash, white cards, plum ink, orchid
  accent, rose petal secondary, gold for the dare, soft orange for spicy. Dark mode is deep plum with the same roles.
- Fonts: Fraunces italic for headings and the question, Nunito for everything else. Hearts are pink, lavender, white.
- Checked light desktop and dark phone width: no sideways scroll, no console errors. Version links now v=4.

- Stop studying button removed (his ask). Start studying once; it runs until Leave game. Links at v=5.

## v6 (2026-10-28): connection and polish

- Invite link: the waiting screen shows `?join=CODE` with a Copy invite link button; opening it fills in the code.
- Questions only pop while both are connected. A question due while one is away comes 1 minute after they return.
  Closing the tab sends a goodbye (instant pause); a closed laptop is noticed by a 5 s ping within 75 s.
- After 45 s without a connection, a tip says strict wifi can block it and to try a phone hotspot.
- Found: PeerJS's own relay servers (eu-0/us-0.turn.peerjs.com) no longer resolve and Open Relay is shut down, so
  there is no relay today. Direct links work on most home wifi; campus or office wifi may block them. Fix when needed:
  a free TURN app (for example Metered.ca, needs his signup), credentials go in `TURN` in app.js.
- Team titles: 9 steps up to Soulmates at 950 points together (old ladder topped out around question 12). A new title
  gets hearts and an announcement.
- Rapid fire: 24 pairs, so the 8 rounds never repeat a pick.
- Both players are asked for notifications (on create and join, not only Start). Sound wakes on the first click or key,
  so the chime works after a reload. The tab title shows "💕 Pop!" while a question waits for your answer.
- Saved memory book uses the plum/lavender palette (it had red-pink).
- Tested as two players in fast mode: invite link join, pop-up, tab title, answer and reveal, pause on partner leave,
  long-wait tip, pop after the partner returns. No console errors.

## v7 (2026-10-28): Railway relay

- His call: run the connection through Railway instead of direct links. PeerJS removed. Both laptops connect to
  `relay/` (Node + ws, ~60 lines): forwards messages per game code, stores nothing, only accepts the GitHub Pages and
  localhost origins, newest window wins, pings every 15 s to notice closed laptops. Works on any wifi.
- Sleeps when nobody plays (Railway serverless), so it costs cents. First connect after a sleep takes a few seconds.
- Tested: two players through a local relay (join, pop-up, pause), a 1.5 MB voice note through the live relay byte
  for byte, wrong-origin connection refused.

- v8 (2026-10-28): he opened his own invite link in the same browser that created the game. The saved game reopened
  his own seat, so he waited for himself. Now an invite link in a browser that already has a game asks first: own link
  explains to send it on (or use a private window to test alone); a different game offers Join or Stay. The seat only
  connects after that answer, so it never bumps the other window.

## Where it lives

Live link (send this to her): https://dottti.github.io/study-break/
Code: this repo. These notes moved here from Dottti-Misc/Couples-40Q on 2026-10-28.
Push to `main` and GitHub Pages updates in about a minute.
Test mode: add `?fast` to the address (minutes become seconds). Add `&p=2` for a second player in the same browser.
