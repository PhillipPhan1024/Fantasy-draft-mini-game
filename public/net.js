/* Socket-like transport over WebRTC (PeerJS). The room creator's browser runs RoomEngine;
   everyone else connects to it peer-to-peer. API: net.emit(type, data, ack), net.on(type, cb). */
(function () {
  const PREFIX = 'rift-race-v1-';
  const handlers = {};
  const acks = {};
  let rid = 0, peer = null, hostConn = null, engine = null;
  const conns = new Map(); // host side: connId -> DataConnection

  function dispatch(type, data) { (handlers[type] || []).forEach(cb => cb(data)); }

  const net = {
    isHost: false,
    on(type, cb) { (handlers[type] = handlers[type] || []).push(cb); },
    emit(type, data, ack) {
      if (engine) return engine.handle('local', type, data, ack);
      if (!hostConn?.open) return ack?.({ error: 'Not connected to host' });
      const id = ack ? ++rid : 0;
      if (ack) acks[id] = ack;
      hostConn.send({ t: type, d: data, rid: id });
    },

    // Create a room: this browser becomes the game server.
    host(code) {
      return new Promise((resolve, reject) => {
        peer = new Peer(PREFIX + code);
        peer.on('error', err => reject(err.type === 'unavailable-id' ? 'Room code in use, try again' : 'Connection error: ' + err.type));
        peer.on('open', () => {
          net.isHost = true;
          const send = (connId, type, data) => {
            if (connId === 'local') dispatch(type, data);
            else { const c = conns.get(connId); if (c?.open) c.send({ t: type, d: data }); }
          };
          const broadcast = (type, data) => {
            dispatch(type, data);
            for (const c of conns.values()) if (c.open) c.send({ t: type, d: data });
          };
          engine = new RoomEngine(code, send, broadcast);
          peer.on('connection', conn => {
            const connId = conn.connectionId;
            conn.on('open', () => conns.set(connId, conn));
            conn.on('data', m => engine.handle(connId, m.t, m.d, m.rid ? res => conn.send({ t: 'ack', rid: m.rid, d: res }) : undefined));
            conn.on('close', () => { conns.delete(connId); engine.disconnect(connId); });
          });
          engine.handle('local', 'hello');
          resolve();
        });
      });
    },

    // Join someone else's room.
    connect(code) {
      return new Promise((resolve, reject) => {
        if (!peer || peer.destroyed) peer = new Peer();
        const go = () => {
          hostConn = peer.connect(PREFIX + code, { reliable: true });
          const timer = setTimeout(() => reject('Room not found'), 8000);
          hostConn.on('open', () => { clearTimeout(timer); hostConn.send({ t: 'hello' }); resolve(); });
          hostConn.on('data', m => {
            if (m.t === 'ack') { acks[m.rid]?.(m.d); delete acks[m.rid]; }
            else dispatch(m.t, m.d);
          });
          hostConn.on('close', () => dispatch('hostLost'));
        };
        peer.on('error', err => reject(err.type === 'peer-unavailable' ? 'Room not found' : 'Connection error: ' + err.type));
        if (peer.open) go(); else peer.on('open', go);
      });
    },
  };
  window.net = net;
})();
