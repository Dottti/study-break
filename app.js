// Study Break: two people study on their own laptops; each break unlocks one question.
// Sync is peer-to-peer (PeerJS). Each laptop keeps its own full copy of the game.
import { QUESTIONS, LEVELS, levelOf } from './questions.js';
import { CHARACTERS, charById, titleFor } from './characters.js';

const params = new URLSearchParams(location.search);
const PROFILE = params.get('p') || '';          // ?p=2 gives a second player in the same browser (testing)
const UNIT = params.has('fast') ? 1000 : 60000; // ?fast makes "minutes" seconds (testing)
const KEY = 'studybreak' + PROFILE;
const TOTAL = QUESTIONS.length;
const other = (w) => (w === 'a' ? 'b' : 'a');

// Points
const PTS_ANSWER = 5;   // lock in an answer
const PTS_DARE = 10;    // a dare done by voice
const PTS_TEAM = 3;     // both answered the same question
const PTS_GUESS = 10;   // partner says your guess was right

// ---------- state ----------

function blank() {
  return {
    me: null, room: null,
    names: { a: '', b: '' },
    chars: { a: '', b: '' },
    shared: { v: 0, phase: 'idle', endsAt: null, breakQ: null, focusMin: 25, breakMin: 5 },
    answers: {}, // answers[q][who] = { text, guess, voice, at }
    judged: {},  // judged[q][who] = true/false: was who's guess right (marked by the other player)
  };
}
let S = load() || blank();
S.chars ||= { a: '', b: '' };
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
}

const nameOf = (who) => S.names[who] || (who === S.me ? 'You' : 'your partner');
const meName = () => nameOf(S.me);
const partnerName = () => nameOf(other(S.me));
const faceOf = (who) => (S.chars[who] ? charById(S.chars[who]).emoji : '❔');
const both = (q) => !!(S.answers[q] && S.answers[q].a && S.answers[q].b);
function answeredCount() {
  let n = 0;
  while (n < TOTAL && both(n)) n++;
  return n;
}
function score(who) {
  let pts = 0;
  for (const [q, byWho] of Object.entries(S.answers)) {
    if (!byWho[who]) continue;
    pts += QUESTIONS[q].dare ? PTS_DARE : PTS_ANSWER;
    if (both(q)) pts += PTS_TEAM;
    if (S.judged[q]?.[who] === true) pts += PTS_GUESS;
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
  send({ t: 'full', shared: S.shared, answers: S.answers, judged: S.judged, voices: await vKeys() });
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
    for (const [q, byWho] of Object.entries(d.answers || {}))
      for (const [w, a] of Object.entries(byWho)) {
        S.answers[q] ||= {};
        if (!S.answers[q][w]) { S.answers[q][w] = a; if (w === from) announcePartnerAnswer(+q); }
      }
    for (const [q, byWho] of Object.entries(d.judged || {}))
      for (const [w, j] of Object.entries(byWho)) {
        S.judged[q] ||= {};
        if (S.judged[q][w] === undefined) S.judged[q][w] = j;
      }
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
    if (both(d.q)) hearts(true);
  } else if (d.t === 'voice') {
    await vPut(d.key, { mime: d.mime, buf: d.buf });
  } else if (d.t === 'judge') {
    S.judged[d.q] ||= {};
    S.judged[d.q][d.who] = d.val;
    if (d.who === S.me) {
      if (d.val) { hearts(true); announce(`${partnerName()} says you guessed right. Plus ${PTS_GUESS} points for you.`); }
      else announce(`${partnerName()} says your guess missed. No points this time.`);
    }
  }
  checkDone();
  save();
  render();
}

// Newer version wins. On a tie, player a's copy wins so both laptops agree.
function applyShared(inc, from) {
  if (!inc) return;
  const cur = S.shared;
  if (inc.v > cur.v || (inc.v === cur.v && from === 'a' && JSON.stringify(inc) !== JSON.stringify(cur))) {
    const before = cur.phase;
    S.shared = inc;
    if (inc.phase !== before) onPhase();
  }
}
function setShared(patch) {
  S.shared = { ...S.shared, ...patch, v: S.shared.v + 1 };
  save();
  send({ t: 'state', shared: S.shared });
  onPhase();
  render(true);
}

// ---------- timer ----------

let lastWarn = null;
function tick() {
  const sh = S.shared;
  if ((sh.phase === 'focus' || sh.phase === 'break') && sh.endsAt) {
    const left = sh.endsAt - Date.now();
    if (left <= 0) {
      if (sh.phase === 'focus') {
        setShared({ phase: 'break', breakQ: answeredCount(), endsAt: Date.now() + sh.breakMin * UNIT });
      } else {
        setShared({ phase: 'focus', breakQ: null, endsAt: Date.now() + sh.focusMin * UNIT });
      }
      return;
    }
    const warnKey = `${sh.phase}-${sh.endsAt}`;
    const mins = sh.phase === 'focus' ? sh.focusMin : sh.breakMin;
    if (left <= UNIT && mins > 1 && lastWarn !== warnKey) {
      lastWarn = warnKey;
      announce(sh.phase === 'focus' ? 'One minute until the next question.' : 'One minute left in the break.');
    }
  }
  const t = document.getElementById('timer');
  if (t && sh.endsAt) t.textContent = fmt(sh.endsAt - Date.now());
}
function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function checkDone() {
  if (answeredCount() >= TOTAL && S.shared.phase !== 'done') {
    S.shared = { ...S.shared, phase: 'done', endsAt: null, breakQ: null, v: S.shared.v + 1 };
    send({ t: 'state', shared: S.shared });
    onPhase();
  }
}

function onPhase() {
  const sh = S.shared;
  // A half-typed answer survives until a new question comes up.
  if (sh.phase === 'break' && sh.breakQ !== draftQ) { draft = { text: '', guess: '', voice: null }; draftQ = sh.breakQ; }
  if (sh.phase === 'break') {
    const qq = QUESTIONS[sh.breakQ];
    chime(true);
    notify('Break time', qq.text);
    announce(`Break time. Question ${sh.breakQ + 1}${qq.dare ? ', a dare' : qq.spicy ? ', spicy one' : ''}: ${qq.text}`);
    focusHeading = true;
  } else if (sh.phase === 'focus') {
    chime(false);
    announce(`Focus time. ${sh.focusMin} minutes.`);
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
function chime(up) {
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
  if (S.shared.phase === 'break' && S.shared.breakQ === q) {
    announce(S.answers[q][S.me] ? `${partnerName()} answered. Answers are showing.` : `${partnerName()} has answered. Your turn.`);
  }
}
const HEART_SET = ['💗', '💖', '💕', '❤️', '🩷', '💘'];
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

// ---------- voice recording ----------

let draft = { text: '', guess: '', voice: null }; // voice = { blob, mime }
let draftQ = S.shared.breakQ;
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
  const q = S.shared.breakQ;
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
  checkDone();
  save();
  focusHeading = true;
  render(true);
}

function judge(q, val) {
  const who = other(S.me);
  S.judged[q] ||= {};
  S.judged[q][who] = val;
  send({ t: 'judge', q, who, val });
  if (val) { hearts(true); announce(`${PTS_GUESS} points for ${partnerName()}.`); }
  else announce('No point this time.');
  save();
  render(true);
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
  const key = [view, S.room, sh.v, JSON.stringify(S.answers[sh.breakQ] || {}), JSON.stringify(S.judged), !!recorder, !!draft.voice,
    S.names.a, S.names.b, S.chars.a, S.chars.b, score('a'), score('b')].join('|');
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
    <h3>How points work</h3>
    <ul class="rules">
      <li>Lock in an answer: ${PTS_ANSWER} points. The singing dare: ${PTS_DARE}.</li>
      <li>Both of you answer the same question: ${PTS_TEAM} more each.</li>
      <li>Guess your partner's answer right: ${PTS_GUESS} points. Your partner is the judge.</li>
    </ul>
  </section>`;
}

function scoreBar() {
  const me = S.me, them = other(me);
  return `<p class="title">${esc(teamTitle())}</p>
  <div class="scorebar" aria-label="Score">
    <div class="who">${avatar(me)}<span>${esc(meName())}<br><span class="pts">${score(me)} pts</span></span></div>
    <span class="vs" aria-hidden="true">vs</span>
    <div class="who"><span>${esc(partnerName())}<br><span class="pts">${score(them)} pts</span></span>${avatar(them)}</div>
  </div>`;
}
function statusLine() {
  const sh = S.shared;
  const n = sh.phase === 'break' ? sh.breakQ + 1 : Math.min(answeredCount() + 1, TOTAL);
  return `<p class="meta">Question ${n} of ${TOTAL}. Level: ${LEVELS[levelOf(n - 1)]}.</p>`;
}

function gameView() {
  const sh = S.shared;
  let body = '';
  if (sh.phase === 'idle') {
    body = `<section>
      <h2>Ready when you are</h2>
      ${scoreBar()}${statusLine()}
      <div class="row extra">
        <div><label for="focusMin">Focus minutes</label><input id="focusMin" type="number" min="1" max="120" value="${sh.focusMin}"></div>
        <div><label for="breakMin">Break minutes</label><input id="breakMin" type="number" min="1" max="60" value="${sh.breakMin}"></div>
      </div>
      <button id="start" type="button">Start studying</button>
      <p class="meta">The next question unlocks when the focus timer ends. Either of you can start.</p>
    </section>`;
  } else if (sh.phase === 'focus') {
    body = `<section>
      <h2>Focus time</h2>
      ${scoreBar()}${statusLine()}
      <p class="timer" id="timer">${fmt(sh.endsAt - Date.now())}</p>
      <p class="meta">Question ${answeredCount() + 1} unlocks when the timer ends. Eyes on the books.</p>
      <button id="stop" class="ghost" type="button">Stop studying</button>
    </section>`;
  } else if (sh.phase === 'break') {
    body = breakView();
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

function breakView() {
  const sh = S.shared;
  const q = sh.breakQ;
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
    inner = revealHtml(q, true);
  }
  return `<section>
    <h2>Break: question ${q + 1}</h2>
    ${scoreBar()}${statusLine()}
    <p class="question${qq.dare ? ' dare' : qq.spicy ? ' spicy' : ''}">${qq.dare ? '<span class="dare-tag">Dare</span><br>' : qq.spicy ? '<span class="dare-tag spicy-tag">Spicy 🌶️</span><br>' : ''}${esc(qq.text)}</p>
    ${inner}
    <p class="meta">Break ends in <span id="timer">${fmt(sh.endsAt - Date.now())}</span>.</p>
    <button id="stop" class="ghost" type="button">Stop studying</button>
  </section>`;
}

function revealHtml(q, withJudge) {
  const me = S.me;
  const them = other(me);
  const qq = QUESTIONS[q];
  const card = (who) => {
    const a = S.answers[q][who];
    const guessOf = who === me ? partnerName() : meName();
    return `<article>
      <h4>${avatar(who)} ${esc(nameOf(who))}</h4>
      ${a.text ? `<p>${esc(a.text)}</p>` : ''}
      ${a.voice ? `<audio controls data-key="${vKey(q, who)}" aria-label="Voice note from ${esc(nameOf(who))}"></audio>` : ''}
      ${qq.dare ? '' : `<p class="guess">Guessed ${esc(guessOf)} would say: ${a.guess ? esc(a.guess) : 'no guess'}</p>`}
    </article>`;
  };
  let judgeHtml = '';
  if (withJudge && !qq.dare) {
    const j = S.judged[q]?.[them];
    judgeHtml = j === undefined
      ? `<p>Did ${esc(partnerName())} guess you right?</p>
         <button data-judge="1" type="button">Yes, ${PTS_GUESS} points for ${esc(partnerName())}</button>
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
    ${items.join('') || '<p>No answers yet. Finish a focus block to unlock the first question.</p>'}
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
    const f = Math.max(1, Math.min(120, +$('#focusMin').value || 25));
    const b = Math.max(1, Math.min(60, +$('#breakMin').value || 5));
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
    setShared({ phase: 'focus', focusMin: f, breakMin: b, breakQ: null, endsAt: Date.now() + f * UNIT });
  });
  on('stop', () => setShared({ phase: 'idle', endsAt: null, breakQ: null }));
  on('rec', toggleRecord);
  on('delrec', () => { draft.voice = null; announce('Voice note deleted.'); render(true); });
  on('submit', submitAnswer);
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
    b.onclick = () => judge(S.shared.breakQ, b.dataset.judge === '1');
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
      parts.push(`<h3>${faceOf(who)} ${esc(S.names[who] || who)}</h3>${a.text ? `<p>${esc(a.text)}</p>` : ''}${a.voice ? await toData(vKey(q, who)) : ''}
        ${QUESTIONS[q].dare ? '' : `<p><em>Guess: ${esc(a.guess || 'no guess')}</em></p>`}`);
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

// ---------- compact ("widget") view ----------

const compactBtn = $('#compact');
function setCompact(onOff) {
  document.body.classList.toggle('compact', onOff);
  compactBtn.setAttribute('aria-pressed', String(onOff));
  try { localStorage.setItem(KEY + ':compact', onOff ? '1' : ''); } catch {}
}
compactBtn.onclick = () => setCompact(!document.body.classList.contains('compact'));
try { setCompact(!!localStorage.getItem(KEY + ':compact')); } catch {}

// ---------- boot ----------

hearts(false);
render(true);
if (S.room) startPeer();
setInterval(tick, 250);
