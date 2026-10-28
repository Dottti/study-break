# Study Break: how Claude works here

A study-together question game Mohanad built for him and his girlfriend Dana. Personal project.
Live: https://dottti.github.io/study-break/ (GitHub Pages, deploys from `main` in about a minute).

Read `docs/IDEA.md` first. It has every decision, the version log, and the open ideas.

## How it works

- Plain HTML + JS, no build step. Files: `index.html`, `app.js` (all logic), `questions.js` (the 40),
  `characters.js` (14 characters + team titles), `extras.js` (reactions, rapid fire, trash talk), `style.css`.
- Sync is direct laptop to laptop with PeerJS (loaded from jsDelivr). No server, no accounts. Each laptop keeps its own
  copy in localStorage; voice notes in IndexedDB.
- Flow: pick character + name, create game (5-letter code) or join, Start studying once. A question pops up at random
  every 3 to 10 minutes. Both answer privately, then both answers show. Reveal stays 3 minutes or Back to studying.

## His rules (do not undo)

- No timers or countdowns. Random pop-ups only.
- Voice only on the singing dare (question 21). Everything else is typed.
- No red in the palette. Blush, lavender, orchid, gold.
- No Stop studying button.
- He uses a screen reader (VoiceOver). Every change keeps announcements, labels and focus moves working.

## Release checklist

1. Test locally as two players: `python3 -m http.server 8742`, open `http://localhost:8742/?fast` and
   `http://localhost:8742/?fast&p=2` (fast = minutes become seconds, p=2 = second player). Clear localStorage after.
2. Bump `?v=N` on the `app.js`, `style.css` links in `index.html` and on the three imports in `app.js`. Browsers cache
   hard; without the bump players keep the old version.
3. Commit, push to `main`, curl the live file until the change shows.
4. Close every test tab afterwards (the chime in background tabs bothered him).
5. Add a line to the log in `docs/IDEA.md`.

## Not done yet

Real two-laptop test across the internet, real microphone test, invite link with the code pre-filled, question packs,
the $1.99 version. See `docs/IDEA.md`.
