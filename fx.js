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
// Every sound is a soft music-box chime: pure sine tones in the middle range (no square or buzzy waves, nothing
// shrill above about 1,100 Hz), a gentle fade in so nothing clicks, a long soft fade out, and low volume.
// notes: [frequency, start offset s, length s, glide-to frequency (optional)]
function play(notes, { vol = 0.1 } = {}) {
  if (!soundOn) return;
  try {
    ctx ||= new AudioContext();
    for (const [f, at, len, to] of notes) {
      const t0 = ctx.currentTime + at;
      // The tone plus a quiet octave above it, like a little bell.
      for (const [mult, gain] of [[1, 1], [2, 0.18]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * mult, t0);
        if (to) o.frequency.exponentialRampToValueAtTime(to * mult, t0 + len * 0.6);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol * gain, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
        o.connect(g).connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + len + 0.05);
      }
    }
  } catch {}
}
// Notes from a C major pentatonic scale, so any two sounds that overlap still sound nice together.
const C5 = 523, D5 = 587, E5 = 659, G5 = 784, A5 = 880, C6 = 1047, G4 = 392, E4 = 330;
const SOUNDS = {
  pop: () => play([[E5, 0, 0.6], [A5, 0.14, 0.8]], { vol: 0.11 }),                          // a question pops
  back: () => play([[A5, 0, 0.5], [E5, 0.14, 0.7]], { vol: 0.08 }),                         // back to studying
  blip: () => play([[G5, 0, 0.35, A5]], { vol: 0.06 }),                                     // chat message: a little bubble
  sparkle: () => play([[G5, 0, 0.5], [A5, 0.09, 0.5], [C6, 0.18, 0.8]], { vol: 0.07 }),     // answers revealed
  point: () => play([[C5, 0, 0.4], [G5, 0.1, 0.6]], { vol: 0.09 }),                          // a point
  fanfare: () => play([[C5, 0, 0.5], [E5, 0.13, 0.5], [G5, 0.26, 0.5], [C6, 0.39, 1.1]], { vol: 0.08 }), // new title, goal done, the end
  womp: () => play([[G4, 0, 0.6, E4]], { vol: 0.08 }),                                       // a missed guess: a soft "aww"
  heart: () => play([[E5, 0, 0.7], [G5, 0.16, 1.0]], { vol: 0.06 }),                         // thinking of you
  nudge: () => play([[D5, 0, 0.25, G5], [D5, 0.22, 0.25, G5], [C6, 0.46, 0.6]], { vol: 0.08 }), // nudge: "boop boop, ding"
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
