// Study Break: two people study on their own laptops. Questions pop up at random while they study.
// Sync is peer-to-peer (PeerJS). Each laptop keeps its own full copy of the game.
import { QUESTIONS, LEVELS, levelOf } from './questions.js?v=4';
import { CHARACTERS, charById, titleFor } from './characters.js?v=4';
import { REACTIONS, reactionById, isRapidQ, rapidPairs, tauntFor } from './extras.js?v=4';

const params = new URLSearchParams(location.search);
const PROFILE = params.get('p') || '';          // ?p=2 gives a second player in the same browser (testing)
const UNIT = params.has('fast') ? 1000 : 60000; // ?fast makes "minutes" seconds (testing)
const KEY = 'studybreak' + PROFILE;
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
  };
}
let S = load() || blank();
for (const k of ['chars', 'reactions', 'rapid']) S[k] ||= k === 'chars' ? { a: '', b: '' } : {};
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

let peer = null;
let conn = null;
const peerId = (who) => `studybreak-v1-${S.room}-${who}`;

function startPeer() {
  if (peer || !S.room) return;
  peer = new Peer(peerId(S.me), { debug: 0 });
  peer.on('open', tryConnect);
  peer.on('connection', setupConn);
  peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 3000));
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') {
      connNote = 'Study Break is already open in another window. Use that one.';
      renderConn();
    } else if (e.type !== 'peer-unavailable') {
      console.warn('peer error', e.type);
    }
  });
  setInterval(tryConnect, 5000);
}
function tryConnect() {
  if (peer && peer.open && !(conn && conn.open)) setupConn(peer.connect(peerId(other(S.me)), { reliable: true }));
}
function setupConn(c) {
  c.on('open', () => {
    const was = conn && conn.open;
    conn = c;
    send({ t: 'hello', name: S.names[S.me], char: S.chars[S.me] });
    sendFull();
    if (!was) { announce(`${partnerName()} is connected.`); renderConn(); }
  });
  c.on('data', handle);
  c.on('close', () => {
    if (conn === c) { conn = null; announce(`${partnerName()} left.`); renderConn(); }
  });
}
function send(msg) {
  if (conn && conn.open) conn.send({ ...msg, from: S.me });
}
async function sendFull() {
  send({ t: 'full', shared: S.shared, answers: S.answers, judged: S.judged, reactions: S.reactions, rapid: S.rapid, voices: await vKeys() });
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
    if (d.name) S.names[from] = d.name;
    if (d.char) S.chars[from] = d.char;
    bump(from);
  } else if (d.t === 'full') {
    applyShared(d.shared, from);
    mergeMap(S.answers, d.answers, (q, w) => { if (w === from) announcePartnerAnswer(q); });
    mergeMap(S.judged, d.judged);
    mergeMap(S.reactions, d.reactions);
    mergeMap(S.rapid, d.rapid);
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
    if (both(d.q)) hearts(true);
  } else if (d.t === 'voice') {
    await vPut(d.key, { mime: d.mime, buf: d.buf });
  } else if (d.t === 'judge') {
    S.judged[d.q] ||= {};
    S.judged[d.q][d.who] = d.val;
    if (d.who === S.me) {
      if (d.val) { hearts(true); announce(`${partnerName()} says you guessed right. Plus ${guessPoints(S.me, d.q)} points for you.`); taunt(S.me, 'point'); }
      else announce(`${partnerName()} says your guess missed. No points this time.`);
    }
  } else if (d.t === 'react') {
    S.reactions[d.q] ||= {};
    S.reactions[d.q][from] = d.r;
    const r = reactionById(d.r);
    if (r) { announce(`${partnerName()} reacted to your answer: ${r.name}.`); bump(from); }
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
  if (sh.phase === 'study' && sh.popAt && Date.now() >= sh.popAt) {
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
  if (sh.phase === 'question') {
    const qq = QUESTIONS[sh.q];
    if (draftQ !== sh.q) { draft = { text: '', guess: '', voice: null }; rapidDraft = [null, null, null]; draftQ = sh.q; }
    chime(true);
    notify('Study Break', qq.text);
    announce(`Pop! Question ${sh.q + 1}${qq.dare ? ', a dare' : qq.spicy ? ', spicy one' : ''}${isRapidQ(sh.q) ? ', with rapid fire' : ''}: ${qq.text}`);
    focusHeading = true;
  } else if (sh.phase === 'study') {
    chime(false);
    announce('Back to studying. The next question will pop up when you least expect it.');
    focusHeading = true;
  } else if (sh.phase === 'done') {
    chime(true);
    hearts(true);
    announce('You finished all 40 questions.');
    focusHeading = true;
  } else if (sh.phase === 'idle') {
    announce('Studying stopped.');
  }
}

// ---------- sound, notifications, screen reader, hearts ----------

let audioCtx = null;
let soundOn = true;
try { soundOn = localStorage.getItem('studybreak:sound') !== 'off'; } catch {}
function chime(up) {
  if (!soundOn) return;
  try {
    audioCtx ||= new AudioContext();
    const notes = up ? [523, 784] : [784, 523];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      const t0 = audioCtx.currentTime + i * 0.22;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0);
      o.stop(t0 + 0.55);
    });
  } catch {}
}
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
function bump(who) {
  document.querySelectorAll(`.avatar[data-who="${who}"]`).forEach((el) => {
    el.classList.remove('bounce');
    void el.offsetWidth;
    el.classList.add('bounce');
  });
}
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

// ---------- answering ----------

let draft = { text: '', guess: '', voice: null }; // voice = { blob, mime }
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
  if (both(q)) { hearts(true); announce(`Locked in. Plus ${got + PTS_TEAM} points. Answers are showing.`); }
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
  if (val) { hearts(true); announce(`${guessPoints(who, q)} points for ${partnerName()}.`); taunt(who, 'point'); }
  else announce('No point this time.');
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
  if (m === 3) { hearts(true); announce(`Rapid fire: all three matched. ${PTS_RAPID * 3 + PTS_SWEEP} points each.`); taunt(S.me, 'sweep'); }
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
  el.textContent = connNote || (conn && conn.open ? `${faceOf(other(S.me))} ${partnerName()} is here` : `Waiting for ${partnerName()}. Game code ${S.room}`);
}

function render(force) {
  renderConn();
  const sh = S.shared;
  const key = [view, S.room, sh.v, JSON.stringify(S.answers[sh.q] || {}), JSON.stringify(S.judged), JSON.stringify(S.reactions[sh.q] || {}),
    JSON.stringify(S.rapid[sh.q] || {}), !!recorder, !!draft.voice, S.names.a, S.names.b, S.chars.a, S.chars.b, score('a'), score('b'), tauntText].join('|');
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
  if (focusHeading) {
    focusHeading = false;
    const h = main.querySelector('h2');
    if (h) { h.tabIndex = -1; h.focus(); }
  } else if (keep && document.getElementById(keep.id)) {
    const el = document.getElementById(keep.id);
    el.focus();
    if (keep.s != null && el.setSelectionRange) try { el.setSelectionRange(keep.s, keep.e); } catch {}
  }
}

function avatar(who) {
  return `<span class="avatar" data-who="${who}" role="img" aria-label="${esc(S.chars[who] ? charById(S.chars[who]).name : 'no character yet')}">${faceOf(who)}</span>`;
}

function setupView() {
  const chars = CHARACTERS.map((c, i) => `
    <label class="char">
      <input type="radio" name="char" value="${c.id}" ${i === 0 ? 'checked' : ''}>
      <span class="face" aria-hidden="true">${c.emoji}</span>
      <span class="nm">${esc(c.name)}</span>
      <span class="cute">Cute: ${c.cute}/10</span>
      <span class="ln">${esc(c.line)}</span>
    </label>`).join('');
  return `<section>
    <h2>Choose your character</h2>
    <p class="meta">From cutest to... well. Pick wisely, your partner will see it.</p>
    <fieldset style="border:0;padding:0;margin:0"><legend class="sr-only">Your character</legend>
      <div class="chars">${chars}</div>
    </fieldset>
    <label for="name">Your name</label>
    <input id="name" autocomplete="given-name" value="${esc(S.names.a || '')}">
    <h3>New game</h3>
    <button id="create" type="button">Start a new game</button>
    <h3>Join a game</h3>
    <label for="code">Game code</label>
    <input id="code" maxlength="5" autocapitalize="characters" autocomplete="off">
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
  return `<p class="meta">Question ${n} of ${TOTAL}. Level: ${LEVELS[levelOf(n - 1)]}.</p>`;
}

function gameView() {
  const sh = S.shared;
  let body = '';
  if (sh.phase === 'idle') {
    body = `<section>
      <h2>Ready when you are</h2>
      ${scoreBar()}${statusLine()}
      <button id="start" type="button">Start studying</button>
      <p class="meta">Questions pop up on both laptops at random, every ${GAP_MIN} to ${GAP_MAX} minutes. Either of you can start.</p>
    </section>`;
  } else if (sh.phase === 'study') {
    body = `<section>
      <h2>Studying</h2>
      ${scoreBar()}${statusLine()}
      <p class="big">Eyes on the books. Question ${answeredCount() + 1} will pop up when you least expect it.</p>
      <button id="stop" class="ghost" type="button">Stop studying</button>
    </section>`;
  } else if (sh.phase === 'question') {
    body = questionView();
  } else if (sh.phase === 'done') {
    body = `<section>
      <h2>You finished all 40 questions</h2>
      ${scoreBar()}
      <p>Final score: ${esc(meName())} ${score(S.me)}, ${esc(partnerName())} ${score(other(S.me))}. Together: ${esc(teamTitle())}.</p>
      <button id="openBook" type="button">Open the memory book</button>
    </section>`;
  }
  const extra = sh.phase !== 'done' ? `<button id="openBook" class="ghost" type="button">Memory book</button>` : '';
  return body + `<div class="extra">${extra}
    <button id="leave" class="ghost" type="button">Leave game</button>
    <p class="meta">Game code: <span class="code">${esc(S.room)}</span></p></div>`;
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
  return `<section>
    <h2>Pop! Question ${q + 1}</h2>
    ${scoreBar()}${statusLine()}
    ${isRapidQ(q) ? rapidHtml(q) : ''}
    <p class="question${qq.dare ? ' dare' : qq.spicy ? ' spicy' : ''}">${qq.dare ? '<span class="dare-tag">Dare</span><br>' : qq.spicy ? '<span class="dare-tag spicy-tag">Spicy 🌶️</span><br>' : ''}${esc(qq.text)}</p>
    ${inner}
    <button id="stop" class="ghost" type="button">Stop studying</button>
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
    return `<article>
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
    startPeer();
    focusHeading = true;
    hearts(true);
    render(true);
    announce(`Game created as ${charById(ch).name}. Your game code is ${S.room.split('').join(' ')}. Send it to your partner.`);
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
    startPeer();
    focusHeading = true;
    hearts(true);
    render(true);
    announce(`Joined as ${charById(ch).name}. Connecting to your partner.`);
  });
  on('start', () => {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
    setShared({ phase: 'study', q: null, popAt: Date.now() + randomGap(), revealAt: null });
  });
  on('stop', () => setShared({ phase: 'idle', q: null, popAt: null, revealAt: null }));
  on('resume', resumeStudy);
  on('rec', toggleRecord);
  on('delrec', () => { draft.voice = null; announce('Voice note deleted.'); render(true); });
  on('submit', submitAnswer);
  on('rapidLock', submitRapid);
  on('openBook', () => { view = 'book'; focusHeading = true; render(true); });
  on('closeBook', () => { view = 'game'; focusHeading = true; render(true); });
  on('export', exportBook);
  on('leave', () => {
    if (!confirm('Leave this game on this laptop? Your saved answers here will be removed.')) return;
    try { localStorage.removeItem(KEY); } catch {}
    location.reload();
  });
  const ans = $('#ans');
  if (ans) ans.oninput = () => { draft.text = ans.value; };
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
    <style>body{font:17px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#4a1c2b;background:#fff0f4}section{border-top:1px solid #ffc7d8;padding:8px 0}h1{color:#e63968}</style>
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
  soundBtn.textContent = onOff ? 'Sounds on' : 'Sounds off';
  soundBtn.setAttribute('aria-pressed', String(onOff));
  try { localStorage.setItem('studybreak:sound', onOff ? 'on' : 'off'); } catch {}
}
soundBtn.onclick = () => { setSound(!soundOn); announce(soundOn ? 'Sounds on.' : 'Sounds off.'); };
setSound(soundOn);

// ---------- boot ----------

hearts(false);
render(true);
if (S.room) startPeer();
setInterval(tick, 500);
