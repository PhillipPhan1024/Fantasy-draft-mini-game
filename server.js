// Serves the static client and runs one RoomEngine (public/engine.js) per room.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomEngine, CFG, SKILLS } = require('./public/engine.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + '/public'));

const rooms = new Map(); // code -> RoomEngine

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

io.on('connection', socket => {
  let engine = null;
  socket.emit('msg', { t: 'config', d: { CFG, SKILLS } });

  const enter = (code, ack) => {
    engine = rooms.get(code);
    if (!engine) return ack({ error: 'Room not found' });
    socket.join(code);
    ack({ ok: true, code });
  };
  socket.on('create', (_, ack) => {
    const code = makeCode();
    rooms.set(code, new RoomEngine(code,
      (connId, t, d) => io.to(connId).emit('msg', { t, d }),
      (t, d) => io.to(code).emit('msg', { t, d })));
    enter(code, ack);
  });
  socket.on('enter', (code, ack) => enter(String(code || '').toUpperCase(), ack));
  socket.on('msg', ({ t, d } = {}, ack) => engine?.handle(socket.id, t, d, ack));

  socket.on('disconnect', () => {
    if (!engine) return;
    engine.disconnect(socket.id);
    if (![...engine.players.values()].some(p => p.connected)) {
      clearInterval(engine.timer);
      rooms.delete(engine.code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rift Race running on http://localhost:${PORT}`));
