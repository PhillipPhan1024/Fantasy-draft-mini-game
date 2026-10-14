const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

// ---- World constants (shared with client via 'config') ----
const CFG = {
  LANE_LEN: 6000,      // blue fountain x=0 -> red fountain x=LANE_LEN
  LANE_HALF: 300,      // lane spans y in [-LANE_HALF, LANE_HALF]
  PLAYER_R: 42,
  SPEED: 280,          // units / second
  MAX_PLAYERS: 12,
  RACE_TIME: 180,      // seconds before the race is force-ended
  COUNTDOWN: 3,
};
const SKILLS = {
  ashe:  { speed: 1100, r: 34, effect: 'stun', dur: 2 },
  trist: { speed: 850,  r: 48, effect: 'knockback', dist: 450 },
  karma: { speed: 700,  r: 40, effect: 'slow', dur: 2, factor: 0.45 },
};
const TICK = 1 / 30;

const rooms = new Map();

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function publicLobby(room) {
  return {
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, champ: p.champ, connected: p.connected,
    })),
  };
}

function broadcastLobby(room) { io.to(room.code).emit('lobby', publicLobby(room)); }

function startRace(room) {
  room.state = 'countdown';
  room.shots = [];
  room.finishOrder = [];
  room.nextShot = 1.5;
  room.shotId = 0;
  const list = [...room.players.values()];
  const gap = (CFG.LANE_HALF * 2 - 80) / Math.max(1, list.length - 1);
  list.forEach((p, i) => {
    Object.assign(p, {
      x: 60, y: list.length === 1 ? 0 : -CFG.LANE_HALF + 40 + gap * i,
      input: { dx: 0, dy: 0 }, stun: 0, slow: 0, kb: 0, finished: false, finishTime: null,
    });
  });
  room.startAt = Date.now() + CFG.COUNTDOWN * 1000;
  broadcastLobby(room);
  io.to(room.code).emit('raceStart', { startAt: room.startAt, serverNow: Date.now() });
  room.timer = setInterval(() => tick(room), TICK * 1000);
}

function spawnShots(room) {
  const kinds = Object.keys(SKILLS);
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    room.shots.push({
      id: room.shotId++, kind,
      x: CFG.LANE_LEN - 500, // fired from the red nexus
      y: (Math.random() * 2 - 1) * (CFG.LANE_HALF - 20),
      hit: new Set(),
    });
  }
  room.nextShot = 0.35 + Math.random() * 1.0;
}

function tick(room) {
  const now = Date.now();
  if (now < room.startAt) return;
  if (room.state === 'countdown') { room.state = 'race'; broadcastLobby(room); }
  const elapsed = (now - room.startAt) / 1000;
  const dt = TICK;

  // players
  for (const p of room.players.values()) {
    if (p.finished) continue;
    p.stun = Math.max(0, p.stun - dt);
    p.slow = Math.max(0, p.slow - dt);
    if (p.kb > 0) {
      const step = Math.min(p.kb, 1500 * dt);
      p.x -= step; p.kb -= step;
    } else if (p.stun <= 0) {
      const sp = CFG.SPEED * (p.slow > 0 ? SKILLS.karma.factor : 1);
      p.x += p.input.dx * sp * dt;
      p.y += p.input.dy * sp * dt;
    }
    p.x = Math.max(30, p.x);
    p.y = Math.max(-CFG.LANE_HALF + CFG.PLAYER_R, Math.min(CFG.LANE_HALF - CFG.PLAYER_R, p.y));
    if (p.x >= CFG.LANE_LEN) {
      p.finished = true;
      p.x = CFG.LANE_LEN;
      p.finishTime = elapsed;
      room.finishOrder.push(p.id);
      io.to(room.code).emit('finished', { id: p.id, name: p.name, place: room.finishOrder.length, time: elapsed });
    }
  }

  // skill shots
  room.nextShot -= dt;
  if (room.nextShot <= 0) spawnShots(room);
  for (const s of room.shots) {
    const def = SKILLS[s.kind];
    s.x -= def.speed * dt;
    for (const p of room.players.values()) {
      if (p.finished || s.hit.has(p.id)) continue;
      const dx = p.x - s.x, dy = p.y - s.y, rr = def.r + CFG.PLAYER_R;
      if (dx * dx + dy * dy > rr * rr) continue;
      s.hit.add(p.id);
      if (def.effect === 'stun') p.stun = Math.max(p.stun, def.dur);
      else if (def.effect === 'slow') p.slow = Math.max(p.slow, def.dur);
      else if (def.effect === 'knockback') p.kb = def.dist;
      io.to(room.code).emit('hit', { id: p.id, kind: s.kind });
    }
  }
  room.shots = room.shots.filter(s => s.x > -200);

  io.to(room.code).volatile.emit('state', {
    t: elapsed,
    players: [...room.players.values()].map(p => ({
      id: p.id, x: Math.round(p.x), y: Math.round(p.y),
      stun: p.stun > 0, slow: p.slow > 0, kb: p.kb > 0, finished: p.finished,
    })),
    shots: room.shots.map(s => ({ id: s.id, k: s.kind, x: Math.round(s.x), y: Math.round(s.y) })),
  });

  const allDone = [...room.players.values()].every(p => p.finished || !p.connected);
  if (allDone || elapsed >= CFG.RACE_TIME) endRace(room);
}

function endRace(room) {
  clearInterval(room.timer);
  room.timer = null;
  room.state = 'results';
  const list = [...room.players.values()];
  const finished = room.finishOrder.map(id => room.players.get(id));
  const rest = list.filter(p => !p.finished).sort((a, b) => b.x - a.x);
  const results = [...finished, ...rest].map((p, i) => ({
    place: i + 1, id: p.id, name: p.name, champ: p.champ,
    time: p.finished ? p.finishTime : null,
    progress: Math.min(1, p.x / CFG.LANE_LEN),
  }));
  room.lastResults = results;
  console.log(`[${room.code}] results:`, results.map(r => `${r.place}. ${r.name}`).join(', '));
  io.to(room.code).emit('results', results);
  broadcastLobby(room);
}

io.on('connection', socket => {
  let room = null;
  let pid = null;
  socket.emit('config', { CFG, SKILLS });

  socket.on('join', ({ name, code, create }, ack) => {
    name = String(name || '').trim().slice(0, 16);
    if (!name) return ack({ error: 'Enter a name' });
    if (create) {
      code = makeCode();
      rooms.set(code, { code, players: new Map(), state: 'lobby', hostId: null, shots: [] });
    }
    code = String(code || '').trim().toUpperCase();
    const r = rooms.get(code);
    if (!r) return ack({ error: 'Room not found' });

    // Reconnect: same name takes over a disconnected slot (e.g. phone locked mid-race)
    let p = [...r.players.values()].find(q => q.name.toLowerCase() === name.toLowerCase());
    if (p && p.connected) return ack({ error: 'Name already taken' });
    if (!p) {
      if (r.state !== 'lobby') return ack({ error: 'Race already in progress' });
      if (r.players.size >= CFG.MAX_PLAYERS) return ack({ error: 'Room is full (12)' });
      p = { id: Math.random().toString(36).slice(2, 10), name, champ: null };
      r.players.set(p.id, p);
    }
    p.connected = true;
    p.socketId = socket.id;
    if (!r.hostId || !r.players.get(r.hostId)?.connected) r.hostId = p.id;
    room = r; pid = p.id;
    socket.join(code);
    ack({ ok: true, id: p.id, code, results: r.state === 'results' ? r.lastResults : null });
    broadcastLobby(r);
  });

  socket.on('pickChamp', champ => {
    if (!room || room.state === 'race' || room.state === 'countdown') return;
    const p = room.players.get(pid);
    const taken = [...room.players.values()].some(q => q.id !== pid && q.champ === champ);
    if (p && !taken && typeof champ === 'string') { p.champ = champ.slice(0, 40); broadcastLobby(room); }
  });

  socket.on('start', () => {
    if (!room || room.hostId !== pid) return;
    if (room.state !== 'lobby' && room.state !== 'results') return;
    for (const p of room.players.values()) if (!p.connected) room.players.delete(p.id);
    for (const p of room.players.values()) if (!p.champ) p.champ = 'Teemo';
    startRace(room);
  });

  socket.on('backToLobby', () => {
    if (!room || room.hostId !== pid || room.state !== 'results') return;
    room.state = 'lobby';
    broadcastLobby(room);
  });

  socket.on('input', ({ dx, dy }) => {
    const p = room?.players.get(pid);
    if (!p || !p.input) return;
    dx = Number(dx) || 0; dy = Number(dy) || 0;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    p.input = { dx, dy };
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const p = room.players.get(pid);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      if (p.input) p.input = { dx: 0, dy: 0 };
      if (room.state === 'lobby') room.players.delete(pid);
      if (room.hostId === pid) {
        const next = [...room.players.values()].find(q => q.connected);
        room.hostId = next ? next.id : null;
      }
    }
    if (![...room.players.values()].some(q => q.connected)) {
      clearInterval(room.timer);
      rooms.delete(room.code);
    } else broadcastLobby(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rift Race running on http://localhost:${PORT}`));
