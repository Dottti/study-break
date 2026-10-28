// Study Break: two people study on their own laptops. Questions pop up at random while they study.
// Sync goes through a small relay (relay/ on Railway). Each laptop keeps its own full copy of the game.
import { QUESTIONS, LEVELS, levelOf } from './questions.js?v=14';
import { CHARACTERS, charById, titleFor } from './characters.js?v=14';
import { REACTIONS, reactionById, isRapidQ, rapidPairs, tauntFor } from './extras.js?v=14';
import * as fx from './fx.js?v=14';

const params = new URLSearchParams(location.search);
const PROFILE = params.get('p') || '';          // ?p=2 gives a second player in the same browser (testing)
const UNIT = params.has('fast') ? 1000 : 60000; // ?fast makes "minutes" seconds (testing)
const KEY = 'studybreak' + PROFILE;
const JOIN_CODE = (params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); // invite link: ?join=CODE
const INVITED_NAME = 'Dandoon (The-Don)'; // name filled in for whoever opens an invite link (Dana); she can change it
const TOTAL = QUESTIONS.length;
const other = (w) => (w === 'a' ? 'b' : 'a');

// Pop-up gaps, in minutes: random between the two.
const GAP_MIN = 3;
const GAP_MAX = 10;
const REVEAL_MIN = 3; // minutes the reveal stays open before studying resumes on its own

// Points
const PTS_ANSWER = 5;    // lock in an answer
const PTS_DARE = 10;     // the dare, done by voice
const PTS_TEAM = 3;      // both answered the same question
const PTS_GUESS = 10;    // partner says your guess was right
const STREAK_AT = 3;     // this many right guesses in a row doubles the next one
const PTS_RAPID = 5;     // per matching rapid-fire pick
const PTS_SWEEP = 10;    // all three rapid-fire picks matched

// ---------- state ----------

function blank() {
  return {
    me: null, room: null,
    names: { a: '', b: '' },
    chars: { a: '', b: '' },
    shared: { v: 0, phase: 'idle', q: null, popAt: null, revealAt: null },
    answers: {},   // answers[q][who] = { text, guess, voice, at }
    judged: {},    // judged[q][who] = true/false: was who's guess right (marked by the other player)
    reactions: {}, // reactions[q][who] = reaction id that who gave to the other's answer
    rapid: {},     // rapid[q][who] = [0|1, 0|1, 0|1]
    chat: [],      // { id, who, text, at } or { id, who, nudge: true, at }
    goals: {},     // goals[who] = { text, done, at }: each player's study goal for the session
  };
}
let S = load() || blank();
for (const k of ['chars', 'reactions', 'rapid']) S[k] ||= k === 'chars' ? { a: '', b: '' } : {};
S.chat ||= [];
S.goals ||= {};
if (!('q' in S.shared)) S.shared = { v: S.shared.v + 1, phase: 'idle', q: null, popAt: null };
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
}

const nameOf = (who) => S.names[who] || (who === S.me ? 'You' : 'your partner');
const meName = () => nameOf(S.me);
const partnerName = () => nameOf(other(S.me));
const charName = (who) => (S.chars[who] ? charById(S.chars[who]).name : nameOf(who));
const faceOf = (who) => (S.chars[who] ? charById(S.chars[who]).emoji : '❔');
const both = (q) => !!(S.answers[q] && S.answers[q].a && S.answers[q].b);
const bothRapid = (q) => !!(S.rapid[q] && S.rapid[q].a && S.rapid[q].b);
function answeredCount() {
  let n = 0;
  while (n < TOTAL && both(n)) n++;
  return n;
}
function rapidMatches(q) {
  if (!bothRapid(q)) return 0;
  return S.rapid[q].a.filter((v, i) => v === S.rapid[q].b[i]).length;
}
// Right guesses in a row before question q (dares and unjudged ones are skipped).
function streakBefore(who, q) {
  let s = 0;
  for (let i = 0; i < q; i++) {
    const j = S.judged[i]?.[who];
    if (j === undefined) continue;
    s = j ? s + 1 : 0;
  }
  return s;
}
const currentStreak = (who) => streakBefore(who, TOTAL);
function guessPoints(who, q) {
  if (S.judged[q]?.[who] !== true) return 0;
  return streakBefore(who, q) >= STREAK_AT ? PTS_GUESS * 2 : PTS_GUESS;
}
function score(who) {
  let pts = 0;
  for (const [q, byWho] of Object.entries(S.answers)) {
    if (!byWho[who]) continue;
    pts += QUESTIONS[q].dare ? PTS_DARE : PTS_ANSWER;
    if (both(q)) pts += PTS_TEAM;
    pts += guessPoints(who, +q);
  }
  for (const q of Object.keys(S.rapid)) {
    const m = rapidMatches(+q);
    pts += m * PTS_RAPID + (m === 3 ? PTS_SWEEP : 0);
  }
  return pts;
}
const teamTitle = () => titleFor(score('a') + score('b'));

// ---------- voice notes (IndexedDB) ----------

const DB = 'studybreak-voices' + PROFILE;
let dbp = null;
function idb() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('v');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function vReq(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = fn(db.transaction('v', mode).objectStore('v'));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const vPut = (k, val) => vReq('readwrite', (s) => s.put(val, k));
const vGet = (k) => vReq('readonly', (s) => s.get(k));
const vKeys = () => vReq('readonly', (s) => s.getAllKeys());
const vKey = (q, who) => `${q}-${who}`;

// ---------- sync ----------

// Both laptops connect to a small relay on Railway (relay/ in this repo). It passes messages between the two players
// of a game, stores nothing, and tells each side when the other is here. Plain web traffic, so any wifi works.
// The relay sleeps when nobody plays; the first connect wakes it in a few seconds.
const RELAY = params.get('relay') || 'wss://relay-production-6e27.up.railway.app';
let sock = null;
let conn = null;      // { open: true } while the partner is connected too
let connectedAt = 0;  // when the partner last connected
let waitingSince = 0; // when this laptop started waiting for the partner

function startSync() {
  if (sock || !S.room) return;
  waitingSince = Date.now();
  connectRelay();
}
function connectRelay() {
  const ws = new WebSocket(`${RELAY}/?room=${encodeURIComponent(S.room)}&who=${S.me}`);
  sock = ws;
  ws.onmessage = (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.t === '_here') d.here ? partnerHere() : partnerGone();
    else handle(unpackVoice(d));
  };
  ws.onclose = (e) => {
    if (sock !== ws) return;
    sock = null;
    partnerGone();
    if (e.code === 4001) { connNote = 'Study Break was opened in another window. Use that one.'; renderConn(); return; }
    setTimeout(connectRelay, 3000);
  };
}
function partnerHere() {
  if (conn) return;
  conn = { open: true };
  connectedAt = Date.now();
  send({ t: 'hello', name: S.names[S.me], char: S.chars[S.me] });
  sendFull();
  announce(`${partnerName()} is connected.`);
  render(true);
}
function partnerGone() {
  if (!conn) return;
  conn = null;
  waitingSince = Date.now();
  announce(`${partnerName()} left. Questions wait until you are both back.`);
  render(true);
}
// Voice notes travel as base64 text inside the JSON message.
function packVoice(msg) {
  if (!(msg.buf instanceof ArrayBuffer)) return msg;
  const bytes = new Uint8Array(msg.buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ...msg, buf: btoa(bin) };
}
function unpackVoice(d) {
  if (d.t !== 'voice' || typeof d.buf !== 'string') return d;
  return { ...d, buf: Uint8Array.from(atob(d.buf), (c) => c.charCodeAt(0)).buffer };
}
function send(msg) {
  if (conn && sock && sock.readyState === 1) sock.send(JSON.stringify(packVoice({ ...msg, from: S.me })));
}
async function sendFull() {
  send({ t: 'full', goal: S.goals[S.me], shared: S.shared, answers: S.answers, judged: S.judged, reactions: S.reactions, rapid: S.rapid, chat: S.chat, voices: await vKeys() });
}
function mergeMap(mine, theirs, onNew) {
  for (const [q, byWho] of Object.entries(theirs || {}))
    for (const [w, val] of Object.entries(byWho)) {
      mine[q] ||= {};
      if (mine[q][w] === undefined) { mine[q][w] = val; if (onNew) onNew(+q, w, val); }
    }
}

async function handle(d) {
  const from = d.from;
  if (from !== other(S.me)) return;
  if (d.t === 'hello') {
    if (d.name && S.names[from] && d.name !== S.names[from]) announce(`${S.names[from]} changed their name to ${d.name}.`);
    if (d.name) S.names[from] = d.name;
    if (d.char) S.chars[from] = d.char;
    bump(from);
  } else if (d.t === 'full') {
    if (d.goal) S.goals[from] = d.goal;
    applyShared(d.shared, from);
    mergeMap(S.answers, d.answers, (q, w) => { if (w === from) announcePartnerAnswer(q); });
    mergeMap(S.judged, d.judged);
    mergeMap(S.reactions, d.reactions);
    mergeMap(S.rapid, d.rapid);
    mergeChat(d.chat);
    const theirs = new Set(d.voices || []);
    for (const k of await vKeys()) {
      if (!theirs.has(k)) { const v = await vGet(k); send({ t: 'voice', key: k, mime: v.mime, buf: v.buf }); }
    }
  } else if (d.t === 'state') {
    applyShared(d.shared, from);
  } else if (d.t === 'answer') {
    S.answers[d.q] ||= {};
    S.answers[d.q][from] = d.answer;
    announcePartnerAnswer(d.q);
    bump(from);
    if (QUESTIONS[d.q].dare) taunt(from, 'dare');
    if (both(d.q)) { celebrate('reveal'); fx.sfx('sparkle'); flip(d.q); }
  } else if (d.t === 'voice') {
    await vPut(d.key, { mime: d.mime, buf: d.buf });
  } else if (d.t === 'judge') {
    S.judged[d.q] ||= {};
    S.judged[d.q][d.who] = d.val;
    if (d.who === S.me) {
      if (d.val) { celebrate('small'); fx.sfx('point'); announce(`${partnerName()} says you guessed right. Plus ${guessPoints(S.me, d.q)} points for you.`); taunt(S.me, 'point'); }
      else { fx.sfx('womp'); bump(S.me, 'sad'); announce(`${partnerName()} says your guess missed. No points this time.`); }
    }
  } else if (d.t === 'react') {
    S.reactions[d.q] ||= {};
    S.reactions[d.q][from] = d.r;
    const r = reactionById(d.r);
    if (r) { announce(`${partnerName()} reacted to your answer: ${r.name}.`); bump(from); }
  } else if (d.t === 'chat') {
    gotChat(d.m);
  } else if (d.t === 'typing') {
    gotTyping();
  } else if (d.t === 'nudge') {
    gotNudge();
  } else if (d.t === 'nudgeReply') {
    gotNudgeReply(d.r);
  } else if (d.t === 'goal') {
    if (d.goal) gotGoal(d.goal);
  } else if (d.t === 'cheer') {
    gotCheer();
  } else if (d.t === 'heart') {
    gotHeart();
  } else if (d.t === 'rapid') {
    S.rapid[d.q] ||= {};
    S.rapid[d.q][from] = d.picks;
    if (bothRapid(d.q)) rapidDone(d.q);
    else announce(`${partnerName()} locked in the rapid fire picks.`);
  }
  afterChange();
  save();
  render();
}

// Newer version wins. On a tie, player a's copy wins so both laptops agree.
function applyShared(inc, from) {
  if (!inc) return;
  const cur = S.shared;
  if (inc.v > cur.v || (inc.v === cur.v && from === 'a' && JSON.stringify(inc) !== JSON.stringify(cur))) {
    const before = cur.phase + ':' + cur.q;
    S.shared = inc;
    if (inc.phase + ':' + inc.q !== before) onPhase();
  }
}
function setShared(patch) {
  S.shared = { ...S.shared, ...patch, v: S.shared.v + 1 };
  save();
  send({ t: 'state', shared: S.shared });
  onPhase();
  render(true);
}

// ---------- the pop-up loop ----------

const randomGap = () => (GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)) * UNIT;

function tick() {
  const sh = S.shared;
  if (sh.phase === 'question' && sh.revealAt && Date.now() >= sh.revealAt + REVEAL_MIN * UNIT && (S.me === 'a' || !(conn && conn.open))) {
    resumeStudy();
    return;
  }
  // Questions only pop while both are here. If one was due while the partner was away, it comes a minute after they return.
  if (sh.phase === 'study' && sh.popAt && conn && conn.open && Date.now() >= Math.max(sh.popAt, connectedAt + UNIT)) {
    const q = answeredCount();
    if (q >= TOTAL) { setShared({ phase: 'done', q: null, popAt: null }); return; }
    setShared({ phase: 'question', q, popAt: null, revealAt: null });
  }
}
// Called after anything changes: once both answered the open question, the reveal clock starts.
function afterChange() {
  const sh = S.shared;
  if (sh.phase === 'question' && both(sh.q) && !sh.revealAt) setShared({ revealAt: Date.now() });
}
// Back to studying (or the end), from the button or when the reveal has been open long enough.
function resumeStudy() {
  if (answeredCount() >= TOTAL) setShared({ phase: 'done', q: null, popAt: null, revealAt: null });
  else setShared({ phase: 'study', q: null, popAt: Date.now() + randomGap(), revealAt: null });
}

function onPhase() {
  const sh = S.shared;
  setTabTitle();
  if (sh.phase === 'question') {
    const qq = QUESTIONS[sh.q];
    if (draftQ !== sh.q) { draft = { text: '', guess: '', voice: null }; rapidDraft = [null, null, null]; draftQ = sh.q; }
    chime(true);
    fx.letter();
    arrive();
    notify('Study Break', qq.text);
    announce(`Pop! Question ${sh.q + 1}${qq.dare ? ', a dare' : qq.spicy ? ', spicy one' : ''}${isRapidQ(sh.q) ? ', with rapid fire' : ''}: ${qq.text}`);
    focusHeading = true;
  } else if (sh.phase === 'study') {
    chime(false);
    announce('Back to studying. The next question will pop up when you least expect it.');
    focusHeading = true;
  } else if (sh.phase === 'done') {
    celebrate('big');
    fx.sfx('fanfare');
    announce('You finished all 40 questions.');
    focusHeading = true;
  } else if (sh.phase === 'idle') {
    announce('Studying stopped.');
  }
}

// ---------- sound, notifications, screen reader, hearts ----------

let soundOn = true;
try { soundOn = localStorage.getItem('studybreak:sound') !== 'off'; } catch {}
// Browsers keep sound muted until the page is clicked or typed in, so wake the audio on the first touch.
document.addEventListener('pointerdown', fx.unlock);
document.addEventListener('keydown', fx.unlock);
function askNotify() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
}
// The tab shows "Pop!" while a question waits for my answer, so it stands out from another tab.
function setTabTitle() {
  const sh = S.shared;
  const waiting = sh.phase === 'question' && !S.answers[sh.q]?.[S.me];
  document.title = nudgeIn ? '💌 Nudge! Study Break' : waiting ? '💕 Pop! Study Break'
    : chatUnread ? `💬 (${chatUnread}) Study Break` : 'Study Break';
}
function chime(up) { fx.sfx(up ? 'pop' : 'back'); }
function notify(title, body) {
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  } catch {}
}
function announce(text) {
  const el = document.getElementById('announce');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);
}
function announcePartnerAnswer(q) {
  if (S.shared.phase === 'question' && S.shared.q === q) {
    announce(S.answers[q][S.me] ? `${partnerName()} answered. Answers are showing.` : `${partnerName()} has answered. Your turn.`);
  }
}
const HEART_SET = ['💗', '💜', '🩷', '💖', '🤍', '💕'];
function hearts(burst) {
  const box = document.getElementById('hearts');
  if (burst) {
    const b = document.createElement('div');
    b.className = 'hearts burst';
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('span');
      s.textContent = HEART_SET[i % HEART_SET.length];
      s.style.left = Math.random() * 100 + '%';
      s.style.fontSize = 18 + Math.random() * 26 + 'px';
      s.style.animationDelay = Math.random() * 0.5 + 's';
      b.appendChild(s);
    }
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2400);
    return;
  }
  box.innerHTML = '';
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    s.textContent = HEART_SET[i % HEART_SET.length];
    s.style.left = Math.random() * 100 + '%';
    s.style.fontSize = 14 + Math.random() * 22 + 'px';
    s.style.animationDelay = Math.random() * 9 + 's';
    s.style.animationDuration = 8 + Math.random() * 6 + 's';
    box.appendChild(s);
  }
}
// mood: 'bounce' (scored, reacted) or 'sad' (missed).
function bump(who, mood = 'bounce') {
  document.querySelectorAll(`.avatar[data-who="${who}"]`).forEach((el) => {
    el.classList.remove('bounce', 'sad');
    void el.offsetWidth;
    el.classList.add(mood);
  });
}
function celebrate(kind) {
  hearts(true);
  fx.confetti(kind);
}
// One-shot entrance animations: on for redraws in the next moment, then off so later redraws don't replay them.
let arriveNext = false; // the question card slides in
let flipNext = null;    // the answer cards for this question flip over
let arriveTimer = null;
let flipTimer = null;
function arrive() { arriveNext = true; clearTimeout(arriveTimer); arriveTimer = setTimeout(() => { arriveNext = false; }, 1600); }
function flip(q) { flipNext = q; clearTimeout(flipTimer); flipTimer = setTimeout(() => { flipNext = null; }, 1000); }
// Trash talk from a character, shown to both players for a few seconds.
let tauntText = '';
let tauntTimer = null;
function taunt(who, event) {
  if (!S.chars[who]) return;
  tauntText = `${faceOf(who)} ${tauntFor(S.chars[who], event)}`;
  clearTimeout(tauntTimer);
  tauntTimer = setTimeout(() => { tauntText = ''; render(true); }, 7000);
  if (who !== S.me) setTimeout(() => announce(tauntFor(S.chars[who], event)), 1500);
  render(true);
}

// ---------- nudges ----------

// "I'm bored, talk to me": a ping to the partner's screen with quick replies.
const NUDGE_REPLIES = [
  { id: 'coming', text: 'Coming! 💕' },
  { id: 'five', text: 'Give me 5 more minutes' },
  { id: 'study', text: 'Study, you! 📚' },
  { id: 'pop', text: 'Pop a question now' }, // only while studying: brings the next question early for both
];
const NUDGE_REST_MS = 30000; // one nudge per 30 s, so it stays a nudge and not a siren
let nudgeIn = null;   // a nudge from the partner, waiting for my reply
let nudgeSentAt = 0;
let nudgeBack = '';   // the partner's reply to my nudge, shown for a little while
let nudgeBackTimer = null;
let focusNudge = false;
const nudgeResting = () => Date.now() - nudgeSentAt < NUDGE_REST_MS;

function sendNudge() {
  if (!together() || nudgeResting()) return;
  nudgeSentAt = Date.now();
  nudgeBack = '';
  send({ t: 'nudge' });
  addChat({ nudge: true });
  bump(S.me);
  announce(`Nudge sent. ${partnerName()} knows you are bored.`);
  setTimeout(() => render(true), NUDGE_REST_MS);
  render(true);
}
function gotNudge() {
  nudgeIn = { at: Date.now() };
  fx.sfx('nudge');
  fx.shake();
  notify('Study Break', `${partnerName()} is bored. Talk to me!`);
  hearts(true);
  bump(other(S.me));
  announce(`${partnerName()} nudged you: I'm bored, talk to me! Reply buttons are at the top.`);
  // Move focus to the nudge, unless they are typing an answer.
  const t = document.activeElement?.tagName;
  focusNudge = t !== 'TEXTAREA' && t !== 'INPUT';
}
function replyNudge(id) {
  const r = NUDGE_REPLIES.find((x) => x.id === id);
  nudgeIn = null;
  if (r) {
    send({ t: 'nudgeReply', r: id });
    announce(`You replied: ${r.text}`);
    if (id === 'pop') popNow();
  } else {
    announce('Nudge dismissed.');
  }
  render(true);
}
function gotNudgeReply(id) {
  const r = NUDGE_REPLIES.find((x) => x.id === id);
  if (!r) return;
  nudgeBack = `${faceOf(other(S.me))} ${partnerName()}: ${r.text}`;
  bump(other(S.me));
  if (id !== 'pop') announce(`${partnerName()} replied: ${r.text}`);
  clearTimeout(nudgeBackTimer);
  nudgeBackTimer = setTimeout(() => { nudgeBack = ''; render(true); }, 15000);
}
function popNow() {
  if (S.shared.phase !== 'study') return;
  const q = answeredCount();
  if (q >= TOTAL) setShared({ phase: 'done', q: null, popAt: null });
  else setShared({ phase: 'question', q, popAt: null, revealAt: null });
}
function nudgeInHtml() {
  if (!nudgeIn) return '';
  const replies = NUDGE_REPLIES.filter((r) => r.id !== 'pop' || S.shared.phase === 'study');
  return `<div class="nudge" role="group" aria-labelledby="nudgeHead">
    <h3 id="nudgeHead" tabindex="-1">💌 ${avatar(other(S.me))} ${esc(partnerName())} is bored: talk to me!</h3>
    ${replies.map((r) => `<button type="button" data-nudge="${r.id}"${r.id === 'coming' ? '' : ' class="ghost"'}>${esc(r.text)}</button>`).join('')}
    <button type="button" data-nudge="dismiss" class="ghost">Dismiss</button>
  </div>`;
}
function nudgeBtnHtml() {
  if (!together()) return '';
  return `${nudgeBack ? `<p class="taunt" role="status">${esc(nudgeBack)}</p>` : ''}
    ${nudgeResting()
      ? `<button type="button" class="ghost" disabled>Nudge sent 💌</button>`
      : `<button id="nudge" type="button" class="ghost">I'm bored, talk to me 💌</button>`}
    ${heartResting()
      ? `<button type="button" class="ghost" disabled>Heart sent 💗</button>`
      : `<button id="heart" type="button" class="ghost">Thinking of you 💗</button>`}`;
}

// ---------- thinking-of-you hearts, study goals, mic check, keep awake ----------

// A quiet heart: floats up on the partner's screen with a soft sound. No buzz, no focus move.
const HEART_REST_MS = 5000;
let heartSentAt = 0;
const heartResting = () => Date.now() - heartSentAt < HEART_REST_MS;
function sendHeart() {
  if (!together() || heartResting()) return;
  heartSentAt = Date.now();
  send({ t: 'heart' });
  fx.floatHeart();
  announce(`Heart sent. ${partnerName()} knows you are thinking of them.`);
  setTimeout(() => render(true), HEART_REST_MS);
  render(true);
}
function gotHeart() {
  fx.floatHeart();
  fx.sfx('heart');
  bump(other(S.me));
  announce(`💗 ${partnerName()} is thinking of you.`);
}

// Each player sets a study goal. Ticking it off makes the partner's screen cheer, and they can cheer back.
let goalDraft = null;   // my goal while I am typing it, so a redraw does not wipe it
let goalEditing = false;
let cheeredAt = 0;      // the partner's finished goal I already cheered (its time stamp)
function setGoal(text) {
  S.goals[S.me] = { text, done: false, at: Date.now() };
  goalDraft = null;
  goalEditing = false;
  send({ t: 'goal', goal: S.goals[S.me] });
  save();
  announce(`Goal set: ${text}.`);
  render(true);
}
function goalDone() {
  const g = S.goals[S.me];
  if (!g || g.done) return;
  g.done = true;
  g.at = Date.now();
  send({ t: 'goal', goal: g });
  save();
  celebrate('small');
  fx.sfx('point');
  bump(S.me);
  announce(`Goal done: ${g.text}. Well done!`);
  render(true);
}
function gotGoal(goal) {
  const from = other(S.me);
  const was = S.goals[from];
  S.goals[from] = goal;
  if (goal.done && !was?.done) {
    celebrate('reveal');
    fx.sfx('fanfare');
    bump(from);
    announce(`${partnerName()} finished their goal: ${goal.text}. Cheer them on!`);
  } else if (!goal.done && was?.text !== goal.text) {
    announce(`${partnerName()} set a study goal: ${goal.text}.`);
  }
}
function sendCheer() {
  const g = S.goals[other(S.me)];
  if (!together() || !g?.done) return;
  cheeredAt = g.at;
  send({ t: 'cheer' });
  hearts(true);
  announce(`You cheered ${partnerName()} on.`);
  render(true);
}
function gotCheer() {
  celebrate('small');
  fx.sfx('sparkle');
  bump(other(S.me));
  announce(`${partnerName()} cheers you on! 🎉`);
}
function goalsHtml() {
  const mine = S.goals[S.me];
  const theirs = S.goals[other(S.me)];
  const me = !mine || goalEditing
    ? `<form id="goalForm" class="rename"><label for="goalInput">Your study goal</label>
        <input id="goalInput" maxlength="80" placeholder="Finish chapter 3" value="${esc(goalDraft ?? mine?.text ?? '')}">
        <button type="submit" class="ghost">Set goal</button></form>`
    : `<p>${mine.done ? '✅' : '🎯'} Your goal: ${esc(mine.text)}${mine.done ? ' (done)' : ''}</p>
        ${mine.done ? '' : `<button id="goalDone" type="button">I did it ✅</button>`}
        <button id="goalChange" type="button" class="ghost">${mine.done ? 'New goal' : 'Change goal'}</button>`;
  const them = theirs
    ? `<p>${theirs.done ? '✅' : '🎯'} ${esc(partnerName())}'s goal: ${esc(theirs.text)}${theirs.done ? ' (done)' : ''}</p>
        ${theirs.done && together() && cheeredAt !== theirs.at ? `<button id="cheer" type="button" class="ghost">Cheer 🎉</button>` : ''}`
    : `<p class="meta">${esc(partnerName())} has not set a goal yet.</p>`;
  return `<div class="goals"><h3>Study goals</h3>${me}${them}</div>`;
}

// Record 3 seconds and play it straight back, so a voice note never fails in the middle of a question.
let micBusy = false;
async function micCheck() {
  if (micBusy || recorder) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { announce('This browser cannot record voice notes.'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    announce('The microphone is blocked. Allow it in the browser settings, then try again.');
    return;
  }
  micBusy = true;
  render(true);
  let url = '';
  let safety = null;
  const end = (msg) => {
    if (!micBusy) return;
    clearTimeout(safety);
    stream.getTracks().forEach((t) => t.stop());
    if (url) URL.revokeObjectURL(url);
    micBusy = false;
    announce(msg);
    render(true);
  };
  safety = setTimeout(() => end('The mic check got stuck. Try again.'), 15000);
  try {
    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      if (!chunks.length) { end('The microphone sent no sound. Check it is plugged in and allowed.'); return; }
      url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      const audio = new Audio(url);
      audio.onended = () => end('Mic check done. If you heard yourself, voice notes work.');
      audio.onerror = () => end('Could not play the mic check back.');
      audio.play().catch(() => end('Could not play the mic check back.'));
    };
    rec.start();
    announce('Mic check: say something now.');
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), 3000);
  } catch {
    end('Could not start the microphone. Try again.');
  }
}

// Keep a phone screen on while the game is open, so the phone does not lock and pause the game.
let wakeLock = null;
async function keepAwake() {
  if (wakeLock || !S.room || document.hidden || !navigator.wakeLock) return;
  wakeLock = 'asking';
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', keepAwake);
document.addEventListener('pointerdown', keepAwake);
document.addEventListener('keydown', keepAwake);

// ---------- chat ----------

// A little MSN-style chat between the two players. Messages are kept with the game on both laptops and synced like
// answers, so a message sent while the partner is away arrives when they are back.
const CHAT_MAX = 500;      // messages kept
const CHAT_EMOJIS = ['😊', '😂', '😘', '🥰', '😴', '📚', '☕', '💕'];
let chatOpen = false;
try { chatOpen = localStorage.getItem(KEY + ':chat') === 'open'; } catch {}
let chatUnread = 0;
let partnerTypingUntil = 0;
let typingSentAt = 0;
let chatKey = '';

const chatId = () => `${S.me}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
function addChat(extra) {
  const m = { id: chatId(), who: S.me, at: Date.now(), ...extra };
  S.chat.push(m);
  if (S.chat.length > CHAT_MAX) S.chat.splice(0, S.chat.length - CHAT_MAX);
  send({ t: 'chat', m });
  save();
  renderChat(true);
}
function sendChat(text) {
  text = text.trim().slice(0, 500);
  if (!text) return;
  addChat({ text });
  typingSentAt = 0;
}
function gotChat(m) {
  if (!m || !m.id || S.chat.some((x) => x.id === m.id)) return;
  S.chat.push(m);
  S.chat.sort((x, y) => x.at - y.at);
  if (S.chat.length > CHAT_MAX) S.chat.splice(0, S.chat.length - CHAT_MAX);
  partnerTypingUntil = 0;
  if (m.nudge) return renderChat(true); // the nudge itself has its own sound and announcement
  if (!chatOpen || document.hidden) chatUnread++;
  blip();
  if (document.hidden) notify(`${partnerName()} says:`, m.text);
  announce(`${partnerName()} says: ${m.text}`);
  renderChat(true);
}
function mergeChat(list) {
  let added = 0;
  for (const m of list || []) {
    if (m && m.id && !S.chat.some((x) => x.id === m.id)) { S.chat.push(m); if (m.who !== S.me && !m.nudge) added++; }
  }
  if (!added) return;
  S.chat.sort((x, y) => x.at - y.at);
  if (!chatOpen) chatUnread += added;
  announce(`${added} new chat message${added > 1 ? 's' : ''} from ${partnerName()}.`);
  renderChat(true);
}
function gotTyping() {
  partnerTypingUntil = Date.now() + 4000;
  renderChat(true);
  setTimeout(() => renderChat(), 4100);
}
const blip = () => fx.sfx('blip');
const chatTime = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function chatLine(m) {
  const name = esc(nameOf(m.who));
  if (m.nudge) return `<li class="chat-nudge">💌 ${name} sent a nudge! <span class="chat-time">${chatTime(m.at)}</span></li>`;
  return `<li class="chat-msg ${m.who === S.me ? 'mine' : 'theirs'}"><span class="chat-who">${faceImg(m.who, 'chat-face')} ${name} says:</span>
    <span class="chat-time">${chatTime(m.at)}</span><br><span class="chat-text">${esc(m.text)}</span></li>`;
}
function renderChat(force) {
  const box = $('#chat');
  if (!S.room) { box.hidden = true; return; }
  box.hidden = false;
  if (chatOpen && !document.hidden) chatUnread = 0;
  const typing = Date.now() < partnerTypingUntil;
  const key = [S.chat.length, S.chat.at(-1)?.id, chatOpen, chatUnread, typing, S.names.a, S.names.b, S.chars.a, S.chars.b, together()].join('|');
  if (!force && key === chatKey) return;
  chatKey = key;
  $('#chatTitle').textContent = `Chat with ${partnerName()}`;
  $('#chatToggle').setAttribute('aria-expanded', String(chatOpen));
  $('#chatBadge').hidden = !chatUnread;
  $('#chatBadge').textContent = chatUnread ? `${chatUnread} new` : '';
  $('#chatBody').hidden = !chatOpen;
  $('#chatStatus').textContent = together() ? `${faceOf(other(S.me))} online` : 'away, gets it later';
  const log = $('#chatLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.innerHTML = S.chat.length ? S.chat.map(chatLine).join('') : `<li class="chat-empty">No messages yet. Say hi!</li>`;
  if (atBottom || force) log.scrollTop = log.scrollHeight;
  $('#chatTyping').textContent = typing ? `${partnerName()} is typing...` : '';
  setTabTitle();
}
function setChatOpen(onOff) {
  chatOpen = onOff;
  try { localStorage.setItem(KEY + ':chat', onOff ? 'open' : ''); } catch {}
  renderChat(true);
  if (onOff) $('#chatInput').focus();
}
// Wired once at boot (the chat box lives outside #main, so game redraws never touch what is being typed).
function wireChat() {
  $('#chatToggle').onclick = () => setChatOpen(!chatOpen);
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    sendChat(input.value);
    input.value = '';
    input.focus();
  };
  $('#chatInput').oninput = () => {
    if (Date.now() - typingSentAt > 2500) { typingSentAt = Date.now(); send({ t: 'typing' }); }
  };
  $('#chatInput').onkeydown = (e) => { if (e.key === 'Escape') { setChatOpen(false); $('#chatToggle').focus(); } };
  $('#chatEmojis').innerHTML = CHAT_EMOJIS.map((em) => `<button type="button" class="ghost" data-emoji="${em}" aria-label="Add ${em}">${em}</button>`).join('');
  $('#chatEmojis').onclick = (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    const input = $('#chatInput');
    input.value += b.dataset.emoji;
    input.focus();
  };
  document.addEventListener('visibilitychange', () => renderChat(true));
}

// ---------- answering ----------

let draft = { text: '', guess: '', voice: null }; // voice = { blob, mime }
let nameDraft = null; // my name while I am editing it, so a redraw does not wipe it
let draftQ = S.shared.q;
let rapidDraft = [null, null, null];
let recorder = null;
let recTimer = null;
async function toggleRecord() {
  if (recorder) { recorder.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    announce('The microphone is blocked. Allow it in the browser to record.');
    return;
  }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearTimeout(recTimer);
    const mime = recorder.mimeType || 'audio/webm';
    draft.voice = { blob: new Blob(chunks, { type: mime }), mime };
    recorder = null;
    announce('Voice note recorded.');
    render(true);
  };
  recorder.start();
  recTimer = setTimeout(() => recorder && recorder.stop(), 120000); // 2 minute cap
  announce('Recording. Press the button again to stop.');
  render(true);
}

async function submitAnswer() {
  const q = S.shared.q;
  const qq = QUESTIONS[q];
  const text = qq.dare ? '' : draft.text.trim();
  if (qq.dare && !draft.voice) { announce('This one is a dare. Record a voice note to do it.'); return; }
  if (!qq.dare && !text) { announce('Type an answer first.'); return; }
  if (draft.voice) {
    const buf = await draft.voice.blob.arrayBuffer();
    await vPut(vKey(q, S.me), { mime: draft.voice.mime, buf });
    send({ t: 'voice', key: vKey(q, S.me), mime: draft.voice.mime, buf });
  }
  const answer = { text, guess: qq.dare ? '' : draft.guess.trim(), voice: !!draft.voice, at: Date.now() };
  S.answers[q] ||= {};
  S.answers[q][S.me] = answer;
  send({ t: 'answer', q, answer });
  draft = { text: '', guess: '', voice: null };
  const got = qq.dare ? PTS_DARE : PTS_ANSWER;
  if (both(q)) { celebrate('reveal'); fx.sfx('sparkle'); flip(q); announce(`Locked in. Plus ${got + PTS_TEAM} points. Answers are showing.`); }
  else announce(`Locked in. Plus ${got} points. Waiting for ${partnerName()}.`);
  if (qq.dare) taunt(S.me, 'dare');
  afterChange();
  save();
  focusHeading = true;
  render(true);
}

function judge(q, val) {
  const who = other(S.me);
  S.judged[q] ||= {};
  S.judged[q][who] = val;
  send({ t: 'judge', q, who, val });
  if (val) { celebrate('small'); fx.sfx('point'); announce(`${guessPoints(who, q)} points for ${partnerName()}.`); taunt(who, 'point'); }
  else { bump(who, 'sad'); announce('No point this time.'); }
  afterChange();
  save();
  render(true);
}

function react(q, id) {
  S.reactions[q] ||= {};
  S.reactions[q][S.me] = id;
  send({ t: 'react', q, r: id });
  announce(`You reacted: ${reactionById(id).name}.`);
  bump(other(S.me));
  save();
  render(true);
}

function submitRapid() {
  const q = S.shared.q;
  if (rapidDraft.some((v) => v === null)) { announce('Pick one on each of the three.'); return; }
  S.rapid[q] ||= {};
  S.rapid[q][S.me] = rapidDraft.slice();
  send({ t: 'rapid', q, picks: S.rapid[q][S.me] });
  if (bothRapid(q)) rapidDone(q);
  else announce(`Rapid fire locked. Waiting for ${partnerName()}.`);
  save();
  render(true);
}
function rapidDone(q) {
  const m = rapidMatches(q);
  if (m === 3) { celebrate('big'); fx.sfx('fanfare'); announce(`Rapid fire: all three matched. ${PTS_RAPID * 3 + PTS_SWEEP} points each.`); taunt(S.me, 'sweep'); }
  else announce(`Rapid fire: ${m} of 3 matched. ${m * PTS_RAPID} points each.`);
}

// ---------- rendering ----------

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let view = 'game'; // or 'book'
let connNote = '';
let lastKey = '';
let focusHeading = false;

function renderConn() {
  const el = $('#conn');
  if (!S.room) { el.textContent = ''; return; }
  el.textContent = connNote || (conn && conn.open ? `${faceOf(other(S.me))} ${partnerName()} is here`
    : sock && sock.readyState === 1 ? `Waiting for ${partnerName()}. Game code ${S.room}` : 'Connecting to the game...');
}
const together = () => !!(conn && conn.open);
const longWait = () => !together() && waitingSince && Date.now() - waitingSince > 45000;
const inviteLink = () => `${location.origin}${location.pathname}?join=${S.room}`;

// Team title: announce and celebrate each time a new one is earned.
let shownTitle = null;
function checkTitle() {
  const t = teamTitle();
  if (shownTitle !== null && t !== shownTitle) {
    hearts(true);
    fx.titleCard(t);
    setTimeout(() => announce(`New title together: ${t}.`), 2500);
  }
  shownTitle = t;
}

function render(force) {
  renderConn();
  renderChat();
  setTabTitle();
  if (S.room) checkTitle();
  const sh = S.shared;
  const key = [view, S.room, sh.v, JSON.stringify(S.answers[sh.q] || {}), JSON.stringify(S.judged), JSON.stringify(S.reactions[sh.q] || {}),
    JSON.stringify(S.rapid[sh.q] || {}), !!recorder, !!draft.voice, S.names.a, S.names.b, S.chars.a, S.chars.b, score('a'), score('b'), tauntText,
    together(), longWait(), nudgeIn?.at, nudgeResting(), nudgeBack, heartResting(), JSON.stringify(S.goals), goalEditing, cheeredAt,
    micBusy].join('|');
  if (!force && key === lastKey) return;
  lastKey = key;
  // Keep keyboard / screen-reader focus where it was when the page redraws under the user.
  const act = document.activeElement;
  const keep = act && act.id ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
  const main = $('#main');
  if (!S.room) main.innerHTML = setupView();
  else if (view === 'book') main.innerHTML = bookView();
  else main.innerHTML = gameView();
  wire();
  loadAudio();
  if (focusNudge && $('#nudgeHead')) {
    focusNudge = false;
    $('#nudgeHead').focus();
  } else if (focusHeading) {
    focusHeading = false;
    const h = main.querySelector('h2');
    if (h) { h.tabIndex = -1; h.focus(); }
  } else if (keep && document.getElementById(keep.id)) {
    const el = document.getElementById(keep.id);
    el.focus();
    if (keep.s != null && el.setSelectionRange) try { el.setSelectionRange(keep.s, keep.e); } catch {}
  }
}

// 3D character art (Microsoft Fluent Emoji, MIT, in assets/). Text-only places keep the emoji from faceOf().
const faceImg = (who, cls = 'face-img') => (S.chars[who] ? `<img class="${cls}" src="assets/${S.chars[who]}.png" alt="" draggable="false">` : '❔');
function avatar(who) {
  return `<span class="avatar" data-who="${who}" role="img" aria-label="${esc(S.chars[who] ? charById(S.chars[who]).name : 'no character yet')}">${faceImg(who)}</span>`;
}

function setupView() {
  const chars = CHARACTERS.map((c, i) => `
    <label class="char">
      <input type="radio" name="char" value="${c.id}" ${i === 0 ? 'checked' : ''}>
      <span class="face" aria-hidden="true"><img src="assets/${c.id}.png" alt="" draggable="false"></span>
      <span class="nm">${esc(c.name)}</span>
      <span class="cute">Cute: ${c.cute}/10</span>
      <span class="ln">${esc(c.line)}</span>
    </label>`).join('');
  const invited = JOIN_CODE ? `<p class="done">You are invited to game ${esc(JOIN_CODE)}. Pick a character, type your name, then press Join game.</p>` : '';
  return `<section>
    <h2>Choose your character</h2>
    ${invited}
    <p class="meta">From cutest to... well. Pick wisely, your partner will see it.</p>
    <fieldset style="border:0;padding:0;margin:0"><legend class="sr-only">Your character</legend>
      <div class="chars">${chars}</div>
    </fieldset>
    <label for="name">Your name</label>
    <input id="name" autocomplete="nickname" value="${esc(S.names.a || (JOIN_CODE ? INVITED_NAME : ''))}">
    <h3>New game</h3>
    <button id="create" type="button">Start a new game</button>
    <h3>Join a game</h3>
    <label for="code">Game code</label>
    <input id="code" maxlength="5" autocapitalize="characters" autocomplete="off" value="${esc(JOIN_CODE)}">
    <button id="join" type="button">Join game</button>
  </section>
  <section class="extra">
    <h3>How it works</h3>
    <ul class="rules">
      <li>You both study. A question pops up on both laptops at a random moment, every ${GAP_MIN} to ${GAP_MAX} minutes.</li>
      <li>Answer in private. When you both lock in, both answers show at once.</li>
      <li>Lock in an answer: ${PTS_ANSWER} points. The singing dare: ${PTS_DARE}. Both answer: ${PTS_TEAM} more each.</li>
      <li>Guess your partner's answer right: ${PTS_GUESS} points. ${STREAK_AT} right in a row doubles the next one.</li>
      <li>Every ${5}th question comes with rapid fire: three this-or-that picks. ${PTS_RAPID} per match, ${PTS_SWEEP} extra for all three.</li>
      <li>React to each other's answers. Your character talks trash when you score.</li>
    </ul>
  </section>`;
}

function scoreBar() {
  const me = S.me, them = other(me);
  const st = (who) => (currentStreak(who) >= STREAK_AT ? ` <span class="streak" title="On a streak">🔥 ${currentStreak(who)}</span>` : '');
  return `<p class="title">${esc(teamTitle())}</p>
  <div class="scorebar" aria-label="Score">
    <div class="who">${avatar(me)}<span>${esc(meName())}${st(me)}<br><span class="pts">${score(me)} pts</span></span></div>
    <span class="vs" aria-hidden="true">vs</span>
    <div class="who"><span>${esc(partnerName())}${st(them)}<br><span class="pts">${score(them)} pts</span></span>${avatar(them)}</div>
  </div>
  ${tauntText ? `<p class="taunt" role="status">${esc(tauntText)}</p>` : ''}`;
}
function statusLine() {
  const sh = S.shared;
  const n = sh.phase === 'question' ? sh.q + 1 : Math.min(answeredCount() + 1, TOTAL);
  const done = answeredCount();
  const dots = (from, to) => Array.from({ length: to - from }, (_, i) => {
    const q = from + i;
    return `<span class="dot${q < done ? ' on' : ''}${q === n - 1 ? ' now' : ''}${QUESTIONS[q].dare ? ' dare' : ''}"></span>`;
  }).join('');
  return `<p class="meta">Question ${n} of ${TOTAL}. Level: ${LEVELS[levelOf(n - 1)]}.</p>
    <div class="journey" aria-hidden="true">
      <div class="leg"><span class="leg-name">Light</span><div class="dots">${dots(0, 15)}</div></div>
      <div class="leg"><span class="leg-name">Deeper</span><div class="dots">${dots(15, 30)}</div></div>
      <div class="leg"><span class="leg-name">Close</span><div class="dots">${dots(30, TOTAL)}</div></div>
    </div>`;
}

// Shown while the partner is not connected: the invite link, and a tip if it takes long.
function waitingHtml() {
  if (together()) return '';
  const tip = longWait()
    ? `<p class="meta">Still not connected. Check that ${esc(partnerName())} opened the link or typed code ${esc(S.room)},
       and that both laptops are online.</p>`
    : '';
  return `<div class="invite">
    <p>Waiting for ${esc(partnerName())}. Send this invite link:</p>
    <p class="code invite-link">${esc(inviteLink())}</p>
    <button id="copyInvite" type="button">Copy invite link</button>
    ${tip}
  </div>`;
}

// An invite link opened in a browser that already has a game: either the player's own link, or a different game.
let joinPrompt = !!(JOIN_CODE && S.room);
const stripJoin = () => history.replaceState(null, '', location.pathname + location.search.replace(/[?&]join=[^&]*/, '').replace(/^&/, '?'));
function joinPromptHtml() {
  if (JOIN_CODE === S.room) {
    return `<section>
      <h2>This is your own invite link</h2>
      <p>This browser already plays game ${esc(S.room)} as ${esc(meName())}, so the link opened your own seat again.
        Send the link to your partner and they open it on their laptop.</p>
      <p class="meta">To try both players on one laptop, open the link in a private window (Cmd+Shift+N, or Ctrl+Shift+N on
        Windows) or in a different browser.</p>
      <button id="dismissJoin" type="button">OK, back to my game</button>
    </section>`;
  }
  return `<section>
    <h2>Join game ${esc(JOIN_CODE)}?</h2>
    <p>This browser is already in game ${esc(S.room)}. Joining game ${esc(JOIN_CODE)} leaves game ${esc(S.room)} on this laptop.</p>
    <button id="switchGame" type="button">Join game ${esc(JOIN_CODE)}</button>
    <button id="dismissJoin" class="ghost" type="button">Stay in game ${esc(S.room)}</button>
  </section>`;
}

function gameView() {
  if (joinPrompt) return joinPromptHtml();
  const sh = S.shared;
  let body = '';
  if (sh.phase === 'idle') {
    body = `<section>
      <h2>Ready when you are</h2>
      ${scoreBar()}${statusLine()}${waitingHtml()}
      <button id="start" type="button">Start studying</button>
      ${nudgeBtnHtml()}${goalsHtml()}
      <p class="meta">Questions pop up on both laptops at random, every ${GAP_MIN} to ${GAP_MAX} minutes, while you are both here. Either of you can start.</p>
    </section>`;
  } else if (sh.phase === 'study') {
    body = `<section>
      <h2>Studying</h2>
      ${scoreBar()}${statusLine()}
      ${together()
        ? `<p class="big">Eyes on the books. Question ${answeredCount() + 1} will pop up when you least expect it.</p>${nudgeBtnHtml()}`
        : `<p class="big">Questions are paused until ${esc(partnerName())} is back.</p>${waitingHtml()}`}
      ${goalsHtml()}
    </section>`;
  } else if (sh.phase === 'question') {
    body = questionView();
  } else if (sh.phase === 'done') {
    body = `<section>
      <h2>You finished all 40 questions</h2>
      ${scoreBar()}
      <p>Final score: ${esc(meName())} ${score(S.me)}, ${esc(partnerName())} ${score(other(S.me))}. Together: ${esc(teamTitle())}.</p>
      ${leaderboardHtml()}
      <button id="openBook" type="button">Open the memory book</button>
    </section>`;
  }
  const extra = sh.phase !== 'done' ? `<button id="openBook" class="ghost" type="button">Memory book</button>` : '';
  return nudgeInHtml() + body + `<div class="extra">${extra}
    <form id="renameForm" class="rename"><label for="myName">Your name</label>
      <input id="myName" autocomplete="nickname" maxlength="40" value="${esc(nameDraft ?? S.names[S.me])}">
      <button type="submit" class="ghost">Save name</button></form>
    ${micBusy ? `<button type="button" class="ghost" disabled>Mic check: listening… 🎙️</button>`
      : `<button id="micCheck" type="button" class="ghost">Mic check 🎙️</button>`}
    <button id="leave" class="ghost" type="button">Leave game</button>
    <p class="meta">Game code: <span class="code">${esc(S.room)}</span></p></div>`;
}

// End of the game: who guessed the other better. Just the board and the confetti, no prize.
function leaderboardHtml() {
  const row = (who) => {
    const marks = Object.values(S.judged).map((byWho) => byWho[who]).filter((v) => v !== undefined);
    return { who, right: marks.filter(Boolean).length, total: marks.length, pts: score(who) };
  };
  const rows = [row(S.me), row(other(S.me))].sort((x, y) => y.right - x.right || y.pts - x.pts);
  const tie = rows[0].right === rows[1].right;
  const matched = Object.keys(S.rapid).reduce((n, q) => n + rapidMatches(+q), 0);
  return `<div class="board"><h3>Who knows who better</h3>
    <ol>${rows.map((r, i) => `<li>${i === 0 && !tie ? '👑 ' : ''}${faceImg(r.who, 'chat-face')} <strong>${esc(nameOf(r.who))}</strong>:
      guessed right ${r.right} of ${r.total}, ${r.pts} points</li>`).join('')}</ol>
    <p>${tie ? 'A tie! You know each other equally well.' : `${esc(nameOf(rows[0].who))} knows ${esc(nameOf(rows[1].who))} best.`}
      Rapid fire: ${matched} picks matched.</p></div>`;
}

function rapidHtml(q) {
  const pairs = rapidPairs(q);
  const mine = S.rapid[q]?.[S.me];
  const theirs = S.rapid[q]?.[other(S.me)];
  if (mine && theirs) {
    const m = rapidMatches(q);
    const rows = pairs.map((p, i) => `<li>${esc(p[0])} or ${esc(p[1])}: you ${esc(p[mine[i]])}, ${esc(partnerName())} ${esc(p[theirs[i]])} ${mine[i] === theirs[i] ? '✅' : '❌'}</li>`).join('');
    return `<div class="rapid"><h3>⚡ Rapid fire: ${m} of 3 matched${m === 3 ? ', sweep!' : ''}</h3><ul class="rules">${rows}</ul></div>`;
  }
  if (mine) return `<div class="rapid"><h3>⚡ Rapid fire locked</h3><p class="meta">Waiting for ${esc(partnerName())}.</p></div>`;
  const rows = pairs.map((p, i) => `
    <fieldset class="pick"><legend>${i + 1}.</legend>
      <button type="button" data-rapid="${i}" data-v="0" class="${rapidDraft[i] === 0 ? '' : 'ghost'}" aria-pressed="${rapidDraft[i] === 0}">${esc(p[0])}</button>
      <button type="button" data-rapid="${i}" data-v="1" class="${rapidDraft[i] === 1 ? '' : 'ghost'}" aria-pressed="${rapidDraft[i] === 1}">${esc(p[1])}</button>
    </fieldset>`).join('');
  return `<div class="rapid"><h3>⚡ Rapid fire: pick fast, match your partner</h3>
    <p class="meta">${PTS_RAPID} points per match, ${PTS_SWEEP} extra if all three match.</p>
    ${rows}<button id="rapidLock" type="button">Lock in picks</button></div>`;
}

function questionView() {
  const sh = S.shared;
  const q = sh.q;
  const qq = QUESTIONS[q];
  const mine = S.answers[q]?.[S.me];
  const theirs = S.answers[q]?.[other(S.me)];
  let inner = '';
  if (!mine) {
    const recBtn = `<button id="rec" type="button">${recorder ? 'Stop recording' : draft.voice ? 'Record again' : 'Record my dare'}</button>
      ${draft.voice ? `<audio id="preview" controls aria-label="Your voice note"></audio>
        <button id="delrec" class="ghost" type="button">Delete voice note</button>` : ''}`;
    inner = `
      ${theirs ? `<p class="done">${esc(partnerName())} has answered. Answer to see it.</p>` : ''}
      ${qq.dare ? `<p class="meta">Voice only. Worth ${PTS_DARE} points.</p>${recBtn}` : `
      <label for="ans">Your answer</label>
      <textarea id="ans">${esc(draft.text)}</textarea>
      <label for="guess">Your guess: what will ${esc(partnerName())} answer? (+${PTS_GUESS} if right)</label>
      <textarea id="guess">${esc(draft.guess)}</textarea>`}
      <button id="submit" type="button">Lock in my answer</button>`;
  } else if (!theirs) {
    inner = `<p>Your answer is locked in. Waiting for ${esc(partnerName())}.</p>`;
  } else {
    inner = revealHtml(q, true) + `<p class="meta">Studying resumes on its own in ${REVEAL_MIN} minutes, or press the button.</p>
      <button id="resume" type="button">Back to studying</button>`;
  }
  return `<section${arriveNext ? ' class="arrive"' : ''}>
    <h2>Pop! Question ${q + 1}</h2>
    ${scoreBar()}${statusLine()}
    ${isRapidQ(q) ? rapidHtml(q) : ''}
    <p class="question${qq.dare ? ' dare' : qq.spicy ? ' spicy' : ''}">${qq.dare ? '<span class="dare-tag">Dare</span><br>' : qq.spicy ? '<span class="dare-tag spicy-tag">Spicy 🌶️</span><br>' : ''}${esc(qq.text)}</p>
    ${inner}
  </section>`;
}

function revealHtml(q, live) {
  const me = S.me;
  const them = other(me);
  const qq = QUESTIONS[q];
  const card = (who) => {
    const a = S.answers[q][who];
    const guessOf = who === me ? partnerName() : meName();
    const got = S.reactions[q]?.[other(who)]; // reaction the other player gave to this answer
    let reactHtml = '';
    if (got) reactHtml = `<p class="reaction">${reactionById(got)?.emoji || ''} ${esc(nameOf(other(who)))} reacted: ${esc(reactionById(got)?.name || got)}</p>`;
    else if (live && who === them) reactHtml = `<p class="meta">React to ${esc(partnerName())}'s answer:</p>` +
      REACTIONS.map((r) => `<button type="button" class="ghost react" data-react="${r.id}" aria-label="${esc(r.name)}">${r.emoji} ${esc(r.name)}</button>`).join('');
    return `<article${live && flipNext === q ? ' class="flip"' : ''}>
      <h4>${avatar(who)} ${esc(nameOf(who))}</h4>
      ${a.text ? `<p>${esc(a.text)}</p>` : ''}
      ${a.voice ? `<audio controls data-key="${vKey(q, who)}" aria-label="Voice note from ${esc(nameOf(who))}"></audio>` : ''}
      ${qq.dare ? '' : `<p class="guess">Guessed ${esc(guessOf)} would say: ${a.guess ? esc(a.guess) : 'no guess'}</p>`}
      ${reactHtml}
    </article>`;
  };
  let judgeHtml = '';
  if (live && !qq.dare) {
    const j = S.judged[q]?.[them];
    const worth = streakBefore(them, q) >= STREAK_AT ? PTS_GUESS * 2 : PTS_GUESS;
    judgeHtml = j === undefined
      ? `<p>Did ${esc(partnerName())} guess you right?</p>
         <button data-judge="1" type="button">Yes, ${worth} points for ${esc(partnerName())}</button>
         <button data-judge="0" class="ghost" type="button">No</button>`
      : `<p class="meta">You marked ${esc(partnerName())}'s guess: ${j ? 'right' : 'missed'}.</p>`;
  }
  return `<div class="pair">${card(me)}${card(them)}</div>${judgeHtml}`;
}

function bookView() {
  const n = answeredCount();
  const items = [];
  for (let q = 0; q < n; q++) {
    items.push(`<div class="book-item"><h3>${q + 1}. ${esc(QUESTIONS[q].text)}</h3>${revealHtml(q, false)}</div>`);
  }
  return `<section>
    <h2>Memory book</h2>
    ${scoreBar()}
    <p class="meta">${n} of ${TOTAL} questions answered together.</p>
    <button id="closeBook" type="button">Back to the game</button>
    <button id="export" class="ghost" type="button">Save the memory book as a file</button>
    ${items.join('') || '<p>No answers yet. Start studying and wait for the first pop-up.</p>'}
  </section>`;
}

const audioUrls = [];
async function loadAudio() {
  audioUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  for (const el of document.querySelectorAll('audio[data-key]')) {
    const v = await vGet(el.dataset.key);
    if (!v) { el.replaceWith(Object.assign(document.createElement('p'), { className: 'meta', textContent: 'Voice note still syncing.' })); continue; }
    const u = URL.createObjectURL(new Blob([v.buf], { type: v.mime }));
    audioUrls.push(u);
    el.src = u;
  }
  const p = document.getElementById('preview');
  if (p && draft.voice) { const u = URL.createObjectURL(draft.voice.blob); audioUrls.push(u); p.src = u; }
}

function pickedChar() {
  return document.querySelector('input[name="char"]:checked')?.value || CHARACTERS[0].id;
}

function wire() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('create', () => {
    const name = $('#name').value.trim();
    if (!name) { announce('Type your name first.'); $('#name').focus(); return; }
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const ch = pickedChar();
    S = blank();
    S.me = 'a';
    S.names.a = name;
    S.chars.a = ch;
    S.room = Array.from(crypto.getRandomValues(new Uint32Array(5)), (x) => abc[x % abc.length]).join('');
    save();
    startSync();
    focusHeading = true;
    hearts(true);
    render(true);
    askNotify();
    announce(`Game created as ${charById(ch).name}. Your game code is ${S.room.split('').join(' ')}. Copy the invite link and send it to your partner.`);
  });
  on('join', () => {
    const name = $('#name').value.trim();
    const code = $('#code').value.trim().toUpperCase();
    if (!name) { announce('Type your name first.'); $('#name').focus(); return; }
    if (code.length !== 5) { announce('The game code has 5 letters.'); $('#code').focus(); return; }
    const ch = pickedChar();
    S = blank();
    S.me = 'b';
    S.names.b = name;
    S.chars.b = ch;
    S.room = code;
    save();
    askNotify();
    if (JOIN_CODE) stripJoin();
    startSync();
    focusHeading = true;
    hearts(true);
    render(true);
    announce(`Joined as ${charById(ch).name}. Connecting to your partner.`);
  });
  on('copyInvite', async () => {
    try { await navigator.clipboard.writeText(inviteLink()); announce('Invite link copied. Paste it to your partner.'); }
    catch { announce(`Copy failed. The link is ${inviteLink()}`); }
  });
  on('start', () => {
    askNotify();
    setShared({ phase: 'study', q: null, popAt: Date.now() + randomGap(), revealAt: null });
  });
  on('resume', resumeStudy);
  on('rec', toggleRecord);
  on('delrec', () => { draft.voice = null; announce('Voice note deleted.'); render(true); });
  on('submit', submitAnswer);
  on('rapidLock', submitRapid);
  on('openBook', () => { view = 'book'; focusHeading = true; render(true); });
  on('closeBook', () => { view = 'game'; focusHeading = true; render(true); });
  on('export', exportBook);
  on('nudge', sendNudge);
  on('heart', sendHeart);
  on('cheer', sendCheer);
  on('goalDone', goalDone);
  on('goalChange', () => { goalEditing = true; goalDraft = null; render(true); $('#goalInput')?.focus(); });
  on('micCheck', micCheck);
  const goalInput = $('#goalInput');
  if (goalInput) {
    goalInput.oninput = () => { goalDraft = goalInput.value; };
    $('#goalForm').onsubmit = (e) => {
      e.preventDefault();
      const text = goalInput.value.trim();
      if (!text) { announce('Type a goal first.'); return; }
      setGoal(text);
    };
  }
  document.querySelectorAll('[data-nudge]').forEach((b) => { b.onclick = () => replyNudge(b.dataset.nudge); });
  on('dismissJoin', () => { joinPrompt = false; stripJoin(); startSync(); focusHeading = true; render(true); });
  on('switchGame', () => {
    try { localStorage.removeItem(KEY); } catch {}
    location.reload(); // keeps ?join, so the setup screen opens with the code filled in
  });
  on('leave', () => {
    if (!confirm('Leave this game on this laptop? Your saved answers here will be removed.')) return;
    try { localStorage.removeItem(KEY); } catch {}
    location.reload();
  });
  const ans = $('#ans');
  if (ans) ans.oninput = () => { draft.text = ans.value; };
  const myName = document.getElementById('myName');
  if (myName) {
    myName.oninput = () => { nameDraft = myName.value; };
    document.getElementById('renameForm').onsubmit = (e) => {
      e.preventDefault();
      const name = myName.value.trim();
      nameDraft = null;
      if (!name) { announce('Type a name first.'); render(true); return; }
      if (name === S.names[S.me]) { announce(`Your name is ${name}.`); return; }
      S.names[S.me] = name;
      save();
      send({ t: 'hello', name, char: S.chars[S.me] });
      render(true);
      announce(`Name saved. You are now ${name}.`);
    };
  }
  const guess = $('#guess');
  if (guess) guess.oninput = () => { draft.guess = guess.value; };
  document.querySelectorAll('[data-judge]').forEach((b) => {
    b.onclick = () => judge(S.shared.q, b.dataset.judge === '1');
  });
  document.querySelectorAll('[data-react]').forEach((b) => {
    b.onclick = () => react(S.shared.q, b.dataset.react);
  });
  document.querySelectorAll('[data-rapid]').forEach((b) => {
    b.onclick = () => { rapidDraft[+b.dataset.rapid] = +b.dataset.v; render(true); };
  });
}

async function exportBook() {
  const n = answeredCount();
  const toData = async (k) => {
    const v = await vGet(k);
    if (!v) return '';
    const bytes = new Uint8Array(v.buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `<audio controls src="data:${v.mime};base64,${btoa(bin)}"></audio>`;
  };
  const rows = [];
  for (let q = 0; q < n; q++) {
    const parts = [];
    for (const who of ['a', 'b']) {
      const a = S.answers[q][who];
      const r = S.reactions[q]?.[other(who)];
      parts.push(`<h3>${faceOf(who)} ${esc(S.names[who] || who)}</h3>${a.text ? `<p>${esc(a.text)}</p>` : ''}${a.voice ? await toData(vKey(q, who)) : ''}
        ${QUESTIONS[q].dare ? '' : `<p><em>Guess: ${esc(a.guess || 'no guess')}</em></p>`}
        ${r ? `<p>${reactionById(r)?.emoji || ''} ${esc(S.names[other(who)])} reacted: ${esc(reactionById(r)?.name || r)}</p>` : ''}`);
    }
    rows.push(`<section><h2>${q + 1}. ${esc(QUESTIONS[q].text)}</h2>${parts.join('')}</section>`);
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Study Break memory book</title>
    <style>body{font:17px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#3d2a3a;background:#fbf5f8}section{border-top:1px solid #ecd9ea;padding:8px 0}h1,h2{color:#a86bb5}</style>
    <h1>Study Break memory book 💕</h1><p>${faceOf('a')} ${esc(S.names.a)} and ${faceOf('b')} ${esc(S.names.b)}. ${n} questions. ${esc(teamTitle())}.</p>${rows.join('')}</html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = 'study-break-memory-book.html';
  a.click();
  announce('Memory book saved to your downloads.');
}

// ---------- top bar buttons ----------

const compactBtn = $('#compact');
function setCompact(onOff) {
  document.body.classList.toggle('compact', onOff);
  compactBtn.setAttribute('aria-pressed', String(onOff));
  try { localStorage.setItem(KEY + ':compact', onOff ? '1' : ''); } catch {}
}
compactBtn.onclick = () => setCompact(!document.body.classList.contains('compact'));
try { setCompact(!!localStorage.getItem(KEY + ':compact')); } catch {}

const soundBtn = $('#sound');
function setSound(onOff) {
  soundOn = onOff;
  fx.setSound(onOff);
  soundBtn.textContent = onOff ? 'Sounds on' : 'Sounds off';
  soundBtn.setAttribute('aria-pressed', String(onOff));
  try { localStorage.setItem('studybreak:sound', onOff ? 'on' : 'off'); } catch {}
}
soundBtn.onclick = () => { setSound(!soundOn); announce(soundOn ? 'Sounds on.' : 'Sounds off.'); };
setSound(soundOn);

// ---------- boot ----------

hearts(false);
wireChat();
if (joinPrompt) focusHeading = true; // the invite question gets screen-reader focus first
render(true);
keepAwake();
if (S.room && !joinPrompt) startSync(); // wait for the answer before taking this seat (it would bump the other window)
setInterval(() => { tick(); render(); }, 500);
