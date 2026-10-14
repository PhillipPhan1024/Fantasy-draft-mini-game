/* Authoritative game engine. Runs in the HOST's browser (no backend needed, so it works on GitHub Pages).
   send(connId, type, data) talks to one player, broadcast(type, data) to everyone. */
(function (root) {
  const CFG = {
    LANE_LEN: 8400,      // blue fountain x=0 -> red fountain; ~30s at full speed
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

  class RoomEngine {
    constructor(code, send, broadcast) {
      Object.assign(this, { code, send, broadcast });
      this.players = new Map();   // id -> player
      this.conns = new Map();     // connId -> player id
      this.state = 'lobby';
      this.hostId = null;
      this.shots = [];
    }

    publicLobby() {
      return {
        code: this.code, state: this.state, hostId: this.hostId,
        players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, champ: p.champ, connected: p.connected })),
      };
    }
    lobby() { this.broadcast('lobby', this.publicLobby()); }

    handle(connId, type, data, ack = () => {}) {
      const pid = this.conns.get(connId);
      const p = this.players.get(pid);
      switch (type) {
        case 'hello': return this.send(connId, 'config', { CFG, SKILLS });
        case 'join': return this.join(connId, data || {}, ack);
        case 'pickChamp': {
          if (!p || this.state === 'race' || this.state === 'countdown' || typeof data !== 'string') return;
          const taken = [...this.players.values()].some(q => q.id !== pid && q.champ === data);
          if (!taken) { p.champ = data.slice(0, 40); this.lobby(); }
          return;
        }
        case 'start':
          if (this.hostId !== pid || (this.state !== 'lobby' && this.state !== 'results')) return;
          for (const q of [...this.players.values()]) if (!q.connected) this.players.delete(q.id);
          for (const q of this.players.values()) if (!q.champ) q.champ = 'Teemo';
          return this.startRace();
        case 'backToLobby':
          if (this.hostId !== pid || this.state !== 'results') return;
          this.state = 'lobby'; return this.lobby();
        case 'input': {
          if (!p || !p.input) return;
          let dx = Number(data?.dx) || 0, dy = Number(data?.dy) || 0;
          const m = Math.hypot(dx, dy);
          if (m > 1) { dx /= m; dy /= m; }
          p.input = { dx, dy };
        }
      }
    }

    join(connId, { name }, ack) {
      name = String(name || '').trim().slice(0, 16);
      if (!name) return ack({ error: 'Enter a name' });
      // Reconnect: same name takes over a disconnected slot (e.g. phone locked mid-race)
      let p = [...this.players.values()].find(q => q.name.toLowerCase() === name.toLowerCase());
      if (p && p.connected) return ack({ error: 'Name already taken' });
      if (!p) {
        if (this.state !== 'lobby') return ack({ error: 'Race already in progress' });
        if (this.players.size >= CFG.MAX_PLAYERS) return ack({ error: 'Room is full (12)' });
        p = { id: Math.random().toString(36).slice(2, 10), name, champ: null };
        this.players.set(p.id, p);
      }
      p.connected = true;
      p.connId = connId;
      this.conns.set(connId, p.id);
      if (!this.hostId) this.hostId = p.id;
      ack({ ok: true, id: p.id, code: this.code, results: this.state === 'results' ? this.lastResults : null });
      this.lobby();
      if (this.state === 'race' || this.state === 'countdown')
        this.send(connId, 'raceStart', { startAt: this.startAt, serverNow: Date.now() });
    }

    disconnect(connId) {
      const p = this.players.get(this.conns.get(connId));
      this.conns.delete(connId);
      if (!p || p.connId !== connId) return;
      p.connected = false;
      if (p.input) p.input = { dx: 0, dy: 0 };
      if (this.state === 'lobby' && p.id !== this.hostId) this.players.delete(p.id);
      this.lobby();
    }

    startRace() {
      this.state = 'countdown';
      this.shots = []; this.finishOrder = []; this.nextShot = 1.5; this.shotId = 0;
      const list = [...this.players.values()];
      const gap = (CFG.LANE_HALF * 2 - 80) / Math.max(1, list.length - 1);
      list.forEach((p, i) => Object.assign(p, {
        x: 60 + (i % 2) * 90, y: list.length === 1 ? 0 : -CFG.LANE_HALF + 40 + gap * i,
        input: { dx: 0, dy: 0 }, stun: 0, slow: 0, kb: 0, finished: false, finishTime: null,
      }));
      this.startAt = Date.now() + CFG.COUNTDOWN * 1000;
      this.lobby();
      this.broadcast('raceStart', { startAt: this.startAt, serverNow: Date.now() });
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), TICK * 1000);
    }

    spawnShots() {
      const kinds = Object.keys(SKILLS);
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.shots.push({
          id: this.shotId++, kind: kinds[Math.floor(Math.random() * kinds.length)],
          x: CFG.LANE_LEN - 500, // fired from the red nexus
          y: (Math.random() * 2 - 1) * (CFG.LANE_HALF - 20),
          hit: new Set(),
        });
      }
      this.nextShot = 0.35 + Math.random() * 1.0;
    }

    tick() {
      const now = Date.now();
      if (now < this.startAt) return;
      if (this.state === 'countdown') { this.state = 'race'; this.lobby(); }
      const elapsed = (now - this.startAt) / 1000, dt = TICK, R = CFG.PLAYER_R;
      const racing = [...this.players.values()].filter(p => !p.finished);

      for (const p of racing) {
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
      }
      // champions block each other: push overlapping circles apart
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < racing.length; i++) for (let j = i + 1; j < racing.length; j++) {
          const a = racing[i], b = racing[j];
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d >= R * 2) continue;
          if (d < 0.01) { dx = 0; dy = 1; d = 1; }
          const push = (R * 2 - d) / 2;
          a.x -= dx / d * push; a.y -= dy / d * push;
          b.x += dx / d * push; b.y += dy / d * push;
        }
      }
      for (const p of racing) {
        p.x = Math.max(30, p.x);
        p.y = Math.max(-CFG.LANE_HALF + R, Math.min(CFG.LANE_HALF - R, p.y));
        if (p.x >= CFG.LANE_LEN) {
          p.finished = true; p.x = CFG.LANE_LEN; p.finishTime = elapsed;
          this.finishOrder.push(p.id);
          this.broadcast('finished', { id: p.id, name: p.name, place: this.finishOrder.length, time: elapsed });
        }
      }

      this.nextShot -= dt;
      if (this.nextShot <= 0) this.spawnShots();
      for (const s of this.shots) {
        const def = SKILLS[s.kind];
        s.x -= def.speed * dt;
        for (const p of racing) {
          if (p.finished || s.hit.has(p.id)) continue;
          const dx = p.x - s.x, dy = p.y - s.y, rr = def.r + R;
          if (dx * dx + dy * dy > rr * rr) continue;
          s.hit.add(p.id);
          if (def.effect === 'stun') p.stun = Math.max(p.stun, def.dur);
          else if (def.effect === 'slow') p.slow = Math.max(p.slow, def.dur);
          else p.kb = def.dist;
          this.broadcast('hit', { id: p.id, kind: s.kind });
        }
      }
      this.shots = this.shots.filter(s => s.x > -200);

      this.broadcast('state', {
        t: elapsed,
        players: [...this.players.values()].map(p => ({
          id: p.id, x: Math.round(p.x), y: Math.round(p.y),
          stun: p.stun > 0, slow: p.slow > 0, kb: p.kb > 0, finished: p.finished,
        })),
        shots: this.shots.map(s => ({ id: s.id, k: s.kind, x: Math.round(s.x), y: Math.round(s.y) })),
      });

      const allDone = [...this.players.values()].every(p => p.finished || !p.connected);
      if (allDone || elapsed >= CFG.RACE_TIME) this.endRace();
    }

    endRace() {
      clearInterval(this.timer);
      this.timer = null;
      this.state = 'results';
      const finished = this.finishOrder.map(id => this.players.get(id));
      const rest = [...this.players.values()].filter(p => !p.finished).sort((a, b) => b.x - a.x);
      this.lastResults = [...finished, ...rest].map((p, i) => ({
        place: i + 1, id: p.id, name: p.name, champ: p.champ,
        time: p.finished ? p.finishTime : null,
        progress: Math.min(1, p.x / CFG.LANE_LEN),
      }));
      this.broadcast('results', this.lastResults);
      this.lobby();
    }
  }

  root.RoomEngine = RoomEngine;
  if (typeof module !== 'undefined') module.exports = { RoomEngine, CFG, SKILLS };
})(typeof window !== 'undefined' ? window : globalThis);
