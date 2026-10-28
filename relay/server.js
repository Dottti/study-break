// Study Break relay: passes messages between the two laptops in a game. Stores nothing.
// Each laptop opens wss://<relay>/?room=CODE&who=a|b. Messages from one go to the other in the same room.
// The relay also tells each side when the partner is here ({ t: '_here', here: true|false }).
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const ORIGINS = [/^https:\/\/dottti\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const rooms = new Map(); // code -> { a: socket, b: socket }

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`Study Break relay. ${rooms.size} room(s) open.\n`);
});
const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 * 1024 }); // voice notes up to ~2 minutes

const tell = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || '').toUpperCase();
  const who = url.searchParams.get('who');
  const origin = req.headers.origin || '';
  if (!/^[A-Z0-9]{5}$/.test(room) || !['a', 'b'].includes(who) || !ORIGINS.some((o) => o.test(origin))) {
    ws.close(4000, 'bad request');
    return;
  }
  const other = who === 'a' ? 'b' : 'a';
  const r = rooms.get(room) || {};
  rooms.set(room, r);
  // The newest window wins: an older one for the same player is told and closed.
  if (r[who]) r[who].close(4001, 'opened elsewhere');
  r[who] = ws;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  tell(ws, { t: '_here', here: !!r[other] });
  tell(r[other], { t: '_here', here: true });

  ws.on('message', (data, isBinary) => {
    if (!isBinary && r[who] === ws && r[other]) r[other].send(data.toString());
  });
  ws.on('close', () => {
    if (r[who] !== ws) return;
    delete r[who];
    tell(r[other], { t: '_here', here: false });
    if (!r.a && !r.b) rooms.delete(room);
  });
});

// A laptop that closed its lid never says goodbye. Ping every 15 s and drop sockets that stop answering.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 15000);

http.listen(PORT, () => console.log(`relay on ${PORT}`));
