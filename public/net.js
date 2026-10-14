/* Thin socket.io wrapper. API: net.emit(type, data, ack), net.on(type, cb), net.host(), net.connect(code). */
(function () {
  const socket = io();
  const handlers = {};
  const dispatch = (type, data) => (handlers[type] || []).forEach(cb => cb(data));
  socket.on('msg', m => dispatch(m.t, m.d));
  socket.on('disconnect', () => dispatch('hostLost'));
  const req = (ev, data) => new Promise((resolve, reject) =>
    socket.timeout(8000).emit(ev, data, (err, res) => err ? reject('Server not responding') : res.error ? reject(res.error) : resolve(res.code)));

  window.net = {
    on(type, cb) { (handlers[type] = handlers[type] || []).push(cb); },
    emit(type, data, ack) { socket.emit('msg', { t: type, d: data }, ack); },
    host: () => req('create'),
    connect: code => req('enter', code),
  };
})();
