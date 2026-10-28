// Effects: sounds, confetti, the love-letter pop-up, the title card and the nudge shake.
// Everything here is decoration: the screen reader gets the same news from announce() in app.js.

// ?motion forces the animations on (for testing on a laptop with Reduce motion turned on).
const forced = new URLSearchParams(location.search).has('motion');
if (forced) document.documentElement.classList.add('force-motion');
const calm = () => !forced && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- sounds (synthesized, no files) ----------

let ctx = null;
let soundOn = true;
export function setSound(on) { soundOn = on; }
// Browsers keep sound muted until the page is clicked or typed in, so app.js calls this on the first touch.
export function unlock() {
  try { ctx ||= new AudioContext(); if (ctx.state === 'suspended') ctx.resume(); } catch {}
}
// notes: [frequency, start offset s, length s]
function play(notes, { type = 'sine', vol = 0.2 } = {}) {
  if (!soundOn) return;
  try {
    ctx ||= new AudioContext();
    for (const [f, at, len] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t0 = ctx.currentTime + at;
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + len + 0.05);
    }
  } catch {}
}
const SOUNDS = {
  pop: () => play([[523, 0, 0.45], [784, 0.2, 0.55]], { vol: 0.25 }),                       // a question pops
  back: () => play([[784, 0, 0.4], [523, 0.2, 0.5]], { vol: 0.2 }),                          // back to studying
  blip: () => play([[880, 0, 0.18], [1175, 0.09, 0.2]], { vol: 0.15 }),                      // chat message
  sparkle: () => play([[1047, 0, 0.3], [1319, 0.07, 0.3], [1568, 0.14, 0.35], [2093, 0.21, 0.5]], { type: 'triangle', vol: 0.12 }), // reveal
  point: () => play([[659, 0, 0.2], [988, 0.1, 0.4]], { type: 'triangle', vol: 0.18 }),      // a point
  fanfare: () => play([[523, 0, 0.25], [659, 0.15, 0.25], [784, 0.3, 0.25], [1047, 0.45, 0.8], [784, 0.45, 0.8]], { type: 'triangle', vol: 0.15 }), // new title / finish
  womp: () => play([[392, 0, 0.3], [330, 0.22, 0.5]], { type: 'triangle', vol: 0.12 }),      // a missed guess
  heart: () => play([[659, 0, 0.4], [880, 0.14, 0.6]], { vol: 0.1 }),                       // thinking of you (soft)
  nudge: () => play([[330, 0, 0.12], [330, 0.15, 0.12], [440, 0.3, 0.25]], { type: 'square', vol: 0.06 }), // MSN-ish buzz
};
export function sfx(name) { SOUNDS[name]?.(); }

// ---------- confetti ----------

const COLORS = ['#f0a6c2', '#d3a0dd', '#a86bb5', '#ffd6e4', '#e2b85c', '#ffffff'];
let heartShape = null;
function shapes() {
  const c = window.confetti;
  if (!c) return null;
  try { heartShape ||= c.shapeFromText({ text: '💗', scalar: 2 }); } catch {}
  return heartShape ? [heartShape, 'circle', 'star'] : ['circle', 'star'];
}
// kind: 'small' (a point, a reaction), 'reveal' (answers showing), 'big' (sweep, title, the end)
export function confetti(kind = 'small') {
  const c = window.confetti;
  if (!c || calm()) return;
  const base = { colors: COLORS, shapes: shapes(), scalar: 1.4, disableForReducedMotion: !forced, zIndex: 70 };
  if (kind === 'big') {
    c({ ...base, particleCount: 90, angle: 60, spread: 70, origin: { x: 0, y: 0.75 } });
    c({ ...base, particleCount: 90, angle: 120, spread: 70, origin: { x: 1, y: 0.75 } });
    setTimeout(() => c({ ...base, particleCount: 120, spread: 120, startVelocity: 35, origin: { y: 0.35 } }), 350);
  } else if (kind === 'reveal') {
    c({ ...base, particleCount: 70, spread: 90, startVelocity: 32, origin: { y: 0.45 } });
  } else {
    c({ ...base, particleCount: 35, spread: 60, startVelocity: 25, origin: { y: 0.6 } });
  }
}

// ---------- overlays ----------

function overlay(className, html, ms) {
  const el = document.createElement('div');
  el.className = 'fx ' + className;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
// A love letter flies in and opens when a question pops.
export function letter() {
  if (calm()) return;
  overlay('fx-letter', '<img src="assets/letter.png" alt=""><span class="fx-spark s1">✨</span><span class="fx-spark s2">💗</span><span class="fx-spark s3">✨</span>', 1700);
}
// A big heart floats up the middle of the screen (thinking of you).
export function floatHeart() {
  if (calm()) return;
  overlay('fx-heart', '<img src="assets/heart.png" alt="">', 2400);
}
// "New title unlocked" card.
export function titleCard(title) {
  overlay('fx-title', `<div class="fx-card"><img src="assets/trophy.png" alt=""><p class="fx-kicker">New title unlocked</p><p class="fx-name">${title}</p></div>`, calm() ? 2600 : 3400);
  confetti('big');
  sfx('fanfare');
}
// The whole window shakes, like an MSN nudge.
export function shake() {
  if (calm()) return;
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 700);
}
