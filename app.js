// Study Break: two people study on their own laptops; each break unlocks one question.
// Sync is peer-to-peer (PeerJS). Each laptop keeps its own full copy of the game.
import { QUESTIONS, LEVELS, levelOf } from './questions.js';

const params = new URLSearchParams(location.search);
const PROFILE = params.get('p') || '';          // ?p=2 gives a second player in the same browser (testing)
const UNIT = params.has('fast') ? 1000 : 60000; // ?fast makes "minutes" seconds (testing)
const KEY = 'studybreak' + PROFILE;
const TOTAL = QUESTIONS.length;
const other = (w) => (w === 'a' ? 'b' : 'a');

// ---------- state ----------

function blank() {
  return {
    me: null, room: null,
    names: { a: '', b: '' },
    shared: { v: 0, phase: 'idle', endsAt: null, breakQ: null, focusMin: 25, breakMin: 5 },
    answers: {}, // answers[q][who] = { text, guess, voice, at }
    judged: {},  // judged[q][who] = true/false: was who's guess right (marked by the other player)
  };
}
let S = load() || blank();
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
}

const meName = () => S.names[S.me] || 'You';
const partnerName = () => S.names[other(S.me)] || 'your partner';
const both = (q) => !!(S.answers[q] && S.answers[q].a && S.answers[q].b);
function answeredCount() {
  let n = 0;
  while (n < TOTAL && both(n)) n++;
  return n;
}
const score = (who) => Object.values(S.judged).filter((j) => j[who] === true).length;

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
    send({ t: 'hello', name: S.names[S.me] });
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
  } else if (d.t === 'voice') {
    await vPut(d.key, { mime: d.mime, buf: d.buf });
  } else if (d.t === 'judge') {
    S.judged[d.q] ||= {};
    S.judged[d.q][d.who] = d.val;
    if (d.who === S.me) announce(d.val ? `${partnerName()} says you guessed right. Point for you.` : `${partnerName()} says your guess missed.`);
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
    chime(true);
    notify('Break time', QUESTIONS[sh.breakQ]);
    announce(`Break time. Question ${sh.breakQ + 1}: ${QUESTIONS[sh.breakQ]}`);
    focusHeading = true;
  } else if (sh.phase === 'focus') {
    chime(false);
    announce(`Focus time. ${sh.focusMin} minutes.`);
  } else if (sh.phase === 'done') {
    chime(true);
    announce('You finished all 40 questions.');
    focusHeading = true;
  } else if (sh.phase === 'idle') {
    announce('Studying stopped.');
  }
}

// ---------- sound, notifications, screen reader ----------

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
  const text = draft.text.trim();
  if (!text && !draft.voice) { announce('Type an answer or record a voice note first.'); return; }
  if (draft.voice) {
    const buf = await draft.voice.blob.arrayBuffer();
    await vPut(vKey(q, S.me), { mime: draft.voice.mime, buf });
    send({ t: 'voice', key: vKey(q, S.me), mime: draft.voice.mime, buf });
  }
  const answer = { text, guess: draft.guess.trim(), voice: !!draft.voice, at: Date.now() };
  S.answers[q] ||= {};
  S.answers[q][S.me] = answer;
  send({ t: 'answer', q, answer });
  draft = { text: '', guess: '', voice: null };
  announce(both(q) ? 'Locked in. Answers are showing.' : `Locked in. Waiting for ${partnerName()}.`);
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
  announce(val ? `Point for ${partnerName()}.` : 'No point this time.');
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
  el.textContent = connNote || (conn && conn.open ? `Connected with ${partnerName()}` : `Waiting for ${partnerName()}. Game code ${S.room}`);
}

function render(force) {
  renderConn();
  const sh = S.shared;
  const key = [view, S.room, sh.v, JSON.stringify(S.answers[sh.breakQ] || {}), JSON.stringify(S.judged), !!recorder, !!draft.voice, S.names.a, S.names.b].join('|');
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

function setupView() {
  return `<section>
    <h2>Set up</h2>
    <p class="meta">Study on your own laptops. Every focus block unlocks one question for both of you.</p>
    <label for="name">Your name</label>
    <input id="name" autocomplete="given-name" value="${esc(S.names.a || '')}">
    <h3>New game</h3>
    <button id="create" type="button">Start a new game</button>
    <h3>Join a game</h3>
    <label for="code">Game code</label>
    <input id="code" maxlength="5" autocapitalize="characters" autocomplete="off">
    <button id="join" type="button">Join game</button>
  </section>`;
}

function statusLine() {
  const sh = S.shared;
  const n = sh.phase === 'break' ? sh.breakQ + 1 : Math.min(answeredCount() + 1, TOTAL);
  return `<p class="meta">Question ${n} of ${TOTAL}. Level: ${LEVELS[levelOf(n - 1)]}.
    Score: ${esc(meName())} ${score(S.me)}, ${esc(partnerName())} ${score(other(S.me))}.</p>`;
}

function gameView() {
  const sh = S.shared;
  let body = '';
  if (sh.phase === 'idle') {
    body = `<section>
      <h2>Ready when you are</h2>
      ${statusLine()}
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
      ${statusLine()}
      <p class="timer" id="timer">${fmt(sh.endsAt - Date.now())}</p>
      <p class="meta">Question ${answeredCount() + 1} unlocks when the timer ends.</p>
      <button id="stop" class="ghost" type="button">Stop studying</button>
    </section>`;
  } else if (sh.phase === 'break') {
    body = breakView();
  } else if (sh.phase === 'done') {
    body = `<section>
      <h2>You finished all 40 questions</h2>
      <p>Final score: ${esc(meName())} ${score(S.me)}, ${esc(partnerName())} ${score(other(S.me))}.</p>
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
  const mine = S.answers[q]?.[S.me];
  const theirs = S.answers[q]?.[other(S.me)];
  let inner = '';
  if (!mine) {
    inner = `
      ${theirs ? `<p class="done">${esc(partnerName())} has answered. Answer to see it.</p>` : ''}
      <label for="ans">Your answer</label>
      <textarea id="ans">${esc(draft.text)}</textarea>
      <button id="rec" type="button">${recorder ? 'Stop recording' : draft.voice ? 'Record again' : 'Record a voice note'}</button>
      ${draft.voice ? `<audio id="preview" controls aria-label="Your voice note"></audio>
        <button id="delrec" class="ghost" type="button">Delete voice note</button>` : ''}
      <label for="guess">Your guess: what will ${esc(partnerName())} answer?</label>
      <textarea id="guess">${esc(draft.guess)}</textarea>
      <button id="submit" type="button">Lock in my answer</button>`;
  } else if (!theirs) {
    inner = `<p>Your answer is locked in. Waiting for ${esc(partnerName())}.</p>`;
  } else {
    inner = revealHtml(q, true);
  }
  return `<section>
    <h2>Break: question ${q + 1}</h2>
    ${statusLine()}
    <p class="question">${esc(QUESTIONS[q])}</p>
    ${inner}
    <p class="meta">Break ends in <span id="timer">${fmt(sh.endsAt - Date.now())}</span>.</p>
    <button id="stop" class="ghost" type="button">Stop studying</button>
  </section>`;
}

function revealHtml(q, withJudge) {
  const me = S.me;
  const them = other(me);
  const card = (who) => {
    const a = S.answers[q][who];
    const guessOf = who === me ? partnerName() : meName();
    return `<article>
      <h4>${esc(who === me ? meName() : partnerName())}</h4>
      ${a.text ? `<p>${esc(a.text)}</p>` : ''}
      ${a.voice ? `<audio controls data-key="${vKey(q, who)}" aria-label="Voice note from ${esc(S.names[who] || who)}"></audio>` : ''}
      <p class="guess">Guessed ${esc(guessOf)} would say: ${a.guess ? esc(a.guess) : 'no guess'}</p>
    </article>`;
  };
  let judgeHtml = '';
  if (withJudge) {
    const j = S.judged[q]?.[them];
    judgeHtml = j === undefined
      ? `<p>Did ${esc(partnerName())} guess you right?</p>
         <button data-judge="1" type="button">Yes, point for ${esc(partnerName())}</button>
         <button data-judge="0" class="ghost" type="button">No</button>`
      : `<p class="meta">You marked ${esc(partnerName())}'s guess: ${j ? 'right' : 'missed'}.</p>`;
  }
  return `<div class="pair">${card(me)}${card(them)}</div>${judgeHtml}`;
}

function bookView() {
  const n = answeredCount();
  const items = [];
  for (let q = 0; q < n; q++) {
    items.push(`<div class="book-item"><h3>${q + 1}. ${esc(QUESTIONS[q])}</h3>${revealHtml(q, false)}</div>`);
  }
  return `<section>
    <h2>Memory book</h2>
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

function wire() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('create', () => {
    const name = $('#name').value.trim();
    if (!name) { announce('Type your name first.'); $('#name').focus(); return; }
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    S = blank();
    S.me = 'a';
    S.names.a = name;
    S.room = Array.from(crypto.getRandomValues(new Uint32Array(5)), (x) => abc[x % abc.length]).join('');
    save();
    startPeer();
    focusHeading = true;
    render(true);
    announce(`Game created. Your game code is ${S.room.split('').join(' ')}. Send it to your partner.`);
  });
  on('join', () => {
    const name = $('#name').value.trim();
    const code = $('#code').value.trim().toUpperCase();
    if (!name) { announce('Type your name first.'); $('#name').focus(); return; }
    if (code.length !== 5) { announce('The game code has 5 letters.'); $('#code').focus(); return; }
    S = blank();
    S.me = 'b';
    S.names.b = name;
    S.room = code;
    save();
    startPeer();
    focusHeading = true;
    render(true);
    announce('Joined. Connecting to your partner.');
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
      parts.push(`<h3>${esc(S.names[who] || who)}</h3>${a.text ? `<p>${esc(a.text)}</p>` : ''}${a.voice ? await toData(vKey(q, who)) : ''}
        <p><em>Guess: ${esc(a.guess || 'no guess')}</em></p>`);
    }
    rows.push(`<section><h2>${q + 1}. ${esc(QUESTIONS[q])}</h2>${parts.join('')}</section>`);
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Study Break memory book</title>
    <style>body{font:17px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px}section{border-top:1px solid #ddd;padding:8px 0}</style>
    <h1>Study Break memory book</h1><p>${esc(S.names.a)} and ${esc(S.names.b)}. ${n} questions.</p>${rows.join('')}</html>`;
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

render(true);
if (S.room) startPeer();
setInterval(tick, 250);
