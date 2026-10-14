/* Rift Race client */
const socket = net;
const DIAG = -Math.PI / 4;           // world +x (toward red) points up-right on screen
const $ = s => document.querySelector(s);
let CFG, SKILLS;
let myId = null, lobby = null, roomCode = null;
let ddVer = '14.24.1';
let champs = [];                      // [{id,name}]
const imgCache = {};
const SPELL_ICON = { ashe: 'EnchantedCrystalArrow', trist: 'TristanaR', karma: 'KarmaQ', janna: 'EyeOfTheStorm' };
const SKILL_NAME = { ashe: 'Ashe R', trist: 'Tristana R', karma: 'Karma Q' };
const SKILL_COLOR = { ashe: '#9fe8ff', trist: '#ff8a2a', karma: '#e05cff' };

function img(url) {
  if (!imgCache[url]) { const i = new Image(); i.src = url; imgCache[url] = i; }
  return imgCache[url];
}
const champUrl = id => `https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/champion/${id}.png`;
const spellUrl = k => `https://ddragon.leagueoflegends.com/cdn/${ddVer}/img/spell/${SPELL_ICON[k]}.png`;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

// ---------------- Champions ----------------
async function loadChamps() {
  try {
    ddVer = (await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json())[0];
    const data = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVer}/data/en_US/champion.json`)).json()).data;
    champs = Object.values(data).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    champs = 'Ahri Akali Ashe Darius Draven Ekko Ezreal Garen Jinx Karma LeeSin Lux MasterYi MissFortune Nasus Teemo Thresh Tristana Vayne Yasuo Zed'
      .split(' ').map(id => ({ id, name: id }));
  }
  renderChampGrid();
}
loadChamps();

function renderChampGrid() {
  const q = $('#champ-search').value.trim().toLowerCase();
  const me = lobby?.players.find(p => p.id === myId);
  const taken = new Set((lobby?.players || []).filter(p => p.id !== myId).map(p => p.champ));
  $('#champ-grid').innerHTML = champs.filter(c => c.name.toLowerCase().includes(q)).map(c =>
    `<div class="champ ${me?.champ === c.id ? 'mine' : ''} ${taken.has(c.id) ? 'taken' : ''}" data-id="${c.id}">
      <img loading="lazy" src="${champUrl(c.id)}" alt="">${c.name}</div>`).join('');
}
$('#champ-search').addEventListener('input', renderChampGrid);
$('#champ-grid').addEventListener('click', e => {
  const el = e.target.closest('.champ');
  if (el) socket.emit('pickChamp', el.dataset.id);
});

// ---------------- Join / Lobby ----------------
$('#name').value = localStorage.getItem('rr-name') || '';
const urlCode = new URLSearchParams(location.search).get('room');
if (urlCode) $('#code').value = urlCode;

const busy = on => document.querySelectorAll('#screen-join button').forEach(b => (b.disabled = on));
async function join(create) {
  const name = $('#name').value.trim();
  if (!name) return ($('#join-err').textContent = 'Enter a name');
  localStorage.setItem('rr-name', name);
  goFullscreen();
  let code = $('#code').value.trim().toUpperCase();
  busy(true); $('#join-err').textContent = create ? 'Creating room…' : 'Connecting…';
  try {
    if (create) {
      code = await net.host();
    } else {
      if (!code) throw 'Enter a room code';
      await net.connect(code);
    }
  } catch (e) { busy(false); return ($('#join-err').textContent = String(e)); }
  busy(false); $('#join-err').textContent = '';
  socket.emit('join', { name }, res => {
    if (res.error) return ($('#join-err').textContent = res.error);
    myId = res.id; roomCode = res.code;
    history.replaceState(null, '', `?room=${res.code}`);
    if (res.results) showResults(res.results);
  });
}
$('#btn-create').onclick = () => join(true);
$('#btn-join').onclick = () => join(false);
function goFullscreen() {
  const el = document.documentElement;
  try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {}); } catch {}
  try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch {}
}

socket.on('config', c => { CFG = c.CFG; SKILLS = c.SKILLS; });
socket.on('hostLost', () => {
  show('screen-join');
  $('#code').value = roomCode || '';
  $('#join-err').textContent = 'Lost connection. Tap Join to rejoin (same name).';
});

socket.on('lobby', l => {
  lobby = l;
  $('#room-code').textContent = l.code;
  const isHost = l.hostId === myId;
  $('#player-list').innerHTML = l.players.map(p =>
    `<li class="${p.id === myId ? 'me' : ''} ${p.connected ? '' : 'off'}">
      ${p.champ ? `<img src="${champUrl(p.champ)}">` : '<span class="ph"></span>'}
      ${esc(p.name)}${p.id === l.hostId ? ' 👑' : ''}</li>`).join('');
  $('#btn-start').classList.toggle('hidden', !isHost);
  $('#btn-again').classList.toggle('hidden', !isHost);
  $('#lobby-hint').textContent = `${l.players.length}/12 players · ` +
    (isHost ? 'Start when everyone has picked.' : 'Waiting for host…');
  $('#share-link').value = `${location.origin}${location.pathname}?room=${l.code}`;
  renderChampGrid();
  if (l.state === 'lobby') show('screen-lobby');
  else if ((l.state === 'race' || l.state === 'countdown') && !$('#screen-game').classList.contains('active')) startGameView();
});
$('#share-link').onclick = e => {
  const url = e.target.value;
  if (navigator.share) navigator.share({ title: 'Rift Race', text: `Join my Rift Race room ${roomCode}`, url }).catch(() => {});
  else { e.target.select(); navigator.clipboard?.writeText(url); }
};
$('#btn-start').onclick = () => socket.emit('start');
$('#btn-again').onclick = () => socket.emit('backToLobby');

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------- Race ----------------
const canvas = $('#canvas'), ctx = canvas.getContext('2d');
let state = null;            // latest server snapshot
const view = {};             // id -> smoothed {x,y}
let startAt = 0, clockOffset = 0, raceTime = 0;

socket.on('raceStart', ({ startAt: s, serverNow }) => {
  clockOffset = serverNow - Date.now();
  startAt = s;
  state = null;
  for (const k in view) delete view[k];
  $('#feed').innerHTML = '';
  startGameView();
});
function startGameView() {
  show('screen-game');
  resize();
  buildProgress();
}
socket.on('state', s => { state = s; raceTime = s.t; });
socket.on('hit', ({ id, kind }) => {
  if (id === myId && navigator.vibrate) navigator.vibrate(kind === 'trist' ? 200 : 80);
  feed(`${pname(id)} hit by ${SKILL_NAME[kind]}`, SKILL_COLOR[kind]);
});
socket.on('blocked', ({ id, kind }) => feed(`🛡️ ${pname(id)} blocked ${SKILL_NAME[kind]}`, '#9fe8ff'));
socket.on('finished', ({ id, place, time }) => {
  feed(`🏁 ${pname(id)} finished #${place} (${time.toFixed(1)}s)`, '#c8aa6e');
  if (id === myId) banner(`#${place}!`, 3000);
});
socket.on('results', showResults);

function pname(id) { return esc(lobby?.players.find(p => p.id === id)?.name || '?'); }
function pchamp(id) { return lobby?.players.find(p => p.id === id)?.champ; }
function feed(html, color) {
  const d = document.createElement('div');
  d.innerHTML = html; d.style.borderColor = color;
  $('#feed').prepend(d);
  setTimeout(() => d.remove(), 4000);
  while ($('#feed').children.length > 5) $('#feed').lastChild.remove();
}
let bannerTimer;
function banner(text, ms) {
  $('#banner').textContent = text;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => ($('#banner').textContent = ''), ms);
}

function buildProgress() {
  $('#progress-track').innerHTML = (lobby?.players || []).map(p =>
    `<div class="dot ${p.id === myId ? 'me' : ''}" data-id="${p.id}" style="left:0;background-image:url(${champUrl(p.champ || 'Teemo')})"></div>`).join('');
}

// ---------------- Joystick ----------------
const joy = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
const JOY_R = 55;
const zone = $('#joy-zone'), base = $('#joy-base'), knob = $('#joy-knob');
function setBase(x, y) { base.style.left = x + 'px'; base.style.top = y + 'px'; base.style.bottom = 'auto'; }
setBase(110, innerHeight - 110);
zone.addEventListener('pointerdown', e => {
  joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY;
  zone.setPointerCapture(e.pointerId);
  setBase(e.clientX, e.clientY); moveJoy(e);
});
zone.addEventListener('pointermove', e => { if (e.pointerId === joy.id) moveJoy(e); });
const endJoy = e => {
  if (e.pointerId !== joy.id) return;
  joy.id = null; joy.dx = joy.dy = 0; knob.style.transform = '';
  setBase(110, innerHeight - 110);
};
zone.addEventListener('pointerup', endJoy);
zone.addEventListener('pointercancel', endJoy);
function moveJoy(e) {
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
  const m = Math.hypot(dx, dy);
  if (m > JOY_R) { dx *= JOY_R / m; dy *= JOY_R / m; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  joy.dx = dx / JOY_R; joy.dy = dy / JOY_R;
}
// Janna shield button (Space on desktop)
const shieldBtn = $('#btn-shield');
shieldBtn.addEventListener('pointerdown', e => { e.preventDefault(); socket.emit('shield'); });
addEventListener('keydown', e => { if (e.code === 'Space') socket.emit('shield'); });
function updateShieldBtn(p) {
  if (!p) return;
  shieldBtn.style.backgroundImage = `url(${spellUrl('janna')})`;
  shieldBtn.classList.toggle('active', !!p.sh);
  shieldBtn.classList.toggle('cooling', p.cd > 0 || !!p.finished);
  $('#shield-cd').textContent = p.cd > 0 ? Math.ceil(p.cd) : '';
}
// keyboard fallback for desktop testing
const keys = {};
addEventListener('keydown', e => (keys[e.key.toLowerCase()] = true));
addEventListener('keyup', e => (keys[e.key.toLowerCase()] = false));

let lastSent = '';
setInterval(() => {
  if (!$('#screen-game').classList.contains('active')) return;
  let dx = joy.dx, dy = joy.dy;
  if (joy.id === null) {
    dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  }
  // joystick is in screen space; the lane is drawn rotated, so rotate input back into world space
  const c = Math.cos(-DIAG), s = Math.sin(-DIAG);
  [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
  const msg = `${dx.toFixed(2)},${dy.toFixed(2)}`;
  if (msg !== lastSent) { lastSent = msg; socket.emit('input', { dx, dy }); }
}, 50);

// ---------------- Rendering ----------------
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  if (joy.id === null) setBase(110, innerHeight - 110);
}
addEventListener('resize', resize);

function drawMap(L, H) {
  // jungle
  ctx.fillStyle = '#16301c'; ctx.fillRect(-3000, -4000, L + 6000, 8000);
  ctx.fillStyle = '#1d3b22';
  for (let x = -2800; x < L + 3000; x += 400) for (let y = -3600; y < 3600; y += 400)
    if (((x + y) / 400) % 2 === 0) ctx.fillRect(x, y, 200, 200);
  // river: winds from baron pit (top) to dragon pit (bottom) and passes UNDER mid lane
  riverAt(L / 2);
  // walls along the lane
  ctx.fillStyle = '#3a3a33';
  ctx.fillRect(-1500, -H - 70, L + 3000, 70); ctx.fillRect(-1500, H, L + 3000, 70);
  // lane
  ctx.fillStyle = '#7a6844'; ctx.fillRect(-1500, -H, L + 3000, H * 2);
  ctx.strokeStyle = '#8f7b52'; ctx.lineWidth = 6;
  for (let x = -1400; x < L + 1500; x += 260) { ctx.beginPath(); ctx.moveTo(x, -H + 40 + (x % 520 ? 0 : 200)); ctx.lineTo(x + 90, -H + 70 + (x % 520 ? 0 : 200)); ctx.stroke(); }
  const m = L / 2;
  // shallow river bank tint where mid lane crosses the river
  ctx.fillStyle = 'rgba(70,120,110,.35)'; ctx.fillRect(m - 239, -H, 478, H * 2); // matches river banks (230 + half stroke)
  // bases
  base_(0, '#0a5c9e', '#3cc0ff', 1); base_(L, '#9e0a1e', '#ff4b5c', -1);
  // finish line
  ctx.fillStyle = '#fff';
  for (let y = -H; y < H; y += 40) { ctx.fillRect(L + ((y / 40) % 2 ? 0 : 20), y, 20, 20); ctx.fillRect(L + ((y / 40) % 2 ? 20 : 0), y + 20, 20, 20); }
  // dragon/baron pits for flavor
  pit(m, -1300, '#5a2e7a'); pit(m, 1300, '#7a4a1e'); // baron / dragon
}
function base_(x, dark, light, dir) {
  ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, 0, 650, 0, Math.PI * 2); ctx.fill();
  // fountain
  ctx.fillStyle = light; ctx.globalAlpha = .5;
  ctx.beginPath(); ctx.arc(x, 0, 220, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = light; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(x, 0, 220, 0, Math.PI * 2); ctx.stroke();
  // nexus
  const nx = x + dir * 500;
  ctx.save(); ctx.translate(nx, 0); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = light; ctx.shadowColor = light; ctx.shadowBlur = 40;
  ctx.fillRect(-60, -60, 120, 120); ctx.restore();
  // towers: inhib, inner, outer
  const H = CFG.LANE_HALF;
  for (const off of [900, 1900, 3000]) tower(x + dir * off, -H * 0.55, light), tower(x + dir * off, H * 0.55, light);
}
function riverAt(m) {
  // straight where it crosses mid lane (|y| < 800) so both banks line up, winding toward baron / dragon beyond
  const W = 230, S = 800;
  ctx.fillStyle = '#245f86';
  ctx.strokeStyle = '#3f8fb5'; ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(m - W - 300, -3800);
  ctx.bezierCurveTo(m - W - 600, -2400, m - W, -1600, m - W, -S);
  ctx.lineTo(m - W, S);
  ctx.bezierCurveTo(m - W, 1600, m - W + 600, 2400, m - W + 300, 3800);
  ctx.lineTo(m + W + 300, 3800);
  ctx.bezierCurveTo(m + W + 600, 2400, m + W, 1600, m + W, S);
  ctx.lineTo(m + W, -S);
  ctx.bezierCurveTo(m + W, -1600, m + W - 600, -2400, m + W - 300, -3800);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
function tower(x, y, c) {
  ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(x, y, 45, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
}
function pit(x, y, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, 350, 250, 0, 0, Math.PI * 2); ctx.fill(); }

function drawShot(s) {
  const r = SKILLS[s.k].r, c = SKILL_COLOR[s.k];
  ctx.save(); ctx.translate(s.x, s.y);
  // trail
  const g = ctx.createLinearGradient(0, 0, r * 6, 0);
  g.addColorStop(0, c); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(0, -r * .6, r * 6, r * 1.2);
  ctx.shadowColor = c; ctx.shadowBlur = 25;
  if (s.k === 'ashe') {
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-r * 1.6, 0); ctx.lineTo(r, -r * .7); ctx.lineTo(r * .5, 0); ctx.lineTo(r, r * .7); ctx.fill();
  } else {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  const icon = img(spellUrl(s.k));
  if (icon.complete && icon.naturalWidth) {
    ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(0, 0, r * .6, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(icon, -r * .6, -r * .6, r * 1.2, r * 1.2);
  }
  ctx.restore();
}

function drawPlayer(p, v, now) {
  const R = CFG.PLAYER_R, me = p.id === myId;
  ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(-DIAG);
  if (p.gh) ctx.globalAlpha = 0.55;
  if (p.slow) { ctx.strokeStyle = '#e05cff'; ctx.lineWidth = 6; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.arc(0, 0, R + 10, now / 300, now / 300 + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, R * .9, R, R * .35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  const im = img(champUrl(pchamp(p.id) || 'Teemo'));
  if (im.complete && im.naturalWidth) ctx.drawImage(im, -R, -R, R * 2, R * 2); else { ctx.fillStyle = '#444'; ctx.fill(); }
  if (p.stun) { ctx.fillStyle = 'rgba(150,220,255,.45)'; ctx.fill(); }
  if (p.kb) { ctx.fillStyle = 'rgba(255,120,40,.45)'; ctx.fill(); }
  ctx.restore();
  ctx.lineWidth = me ? 5 : 3; ctx.strokeStyle = me ? '#0ac8b9' : '#c8aa6e';
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  if (p.sh) {
    ctx.fillStyle = 'rgba(200,240,255,.25)'; ctx.strokeStyle = 'rgba(220,250,255,.9)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, R + 14 + Math.sin(now / 120) * 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (p.stun) {
    ctx.fillStyle = '#ffe14d'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) { const a = now / 200 + i * 2.09; ctx.fillText('★', Math.cos(a) * R, -R - 14 + Math.sin(a) * 8); }
  }
  ctx.fillStyle = me ? '#0ac8b9' : '#f0e6d2'; ctx.font = `bold ${me ? 22 : 18}px sans-serif`; ctx.textAlign = 'center';
  ctx.lineWidth = 4; ctx.strokeStyle = '#000';
  const label = lobby?.players.find(q => q.id === p.id)?.name || '';
  ctx.strokeText(label, 0, -R - 34); ctx.fillText(label, 0, -R - 34);
  ctx.restore();
}

function frame() {
  requestAnimationFrame(frame);
  if (!$('#screen-game').classList.contains('active') || !CFG) return;
  const now = performance.now();
  const W = canvas.width, Hc = canvas.height;
  // countdown
  const toStart = startAt - (Date.now() + clockOffset);
  if (toStart > 0) banner(Math.ceil(toStart / 1000));
  else if (toStart > -900) banner('GO!');
  else if ($('#banner').textContent === 'GO!') banner('');

  const players = state ? state.players : (lobby?.players || []).map((p, i, a) => ({ id: p.id, x: 60, y: a.length === 1 ? 0 : -CFG.LANE_HALF + 40 + (CFG.LANE_HALF * 2 - 80) / (a.length - 1) * i }));
  for (const p of players) {
    const v = view[p.id] || (view[p.id] = { x: p.x, y: p.y });
    v.x += (p.x - v.x) * 0.35; v.y += (p.y - v.y) * 0.35;
  }
  const me = view[myId] || { x: 0, y: 0 };
  // camera locked on me; scale so the lane (+ some margin) fills screen height
  const scale = Math.min(W, Hc * 1.6) / (CFG.LANE_HALF * 2 + 700);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#16301c'; ctx.fillRect(0, 0, W, Hc);
  ctx.translate(W / 2, Hc / 2); ctx.scale(scale, scale); ctx.rotate(DIAG); ctx.translate(-me.x, -me.y);
  drawMap(CFG.LANE_LEN, CFG.LANE_HALF);
  if (state) for (const s of state.shots) drawShot(s);
  // draw others first, me on top
  for (const p of players) if (p.id !== myId) drawPlayer(p, view[p.id], now);
  const mp = players.find(p => p.id === myId); if (mp) drawPlayer(mp, me, now);
  updateShieldBtn(mp);

  // HUD
  for (const p of players) {
    const d = document.querySelector(`#progress-track .dot[data-id="${p.id}"]`);
    if (d) d.style.left = Math.min(100, (p.x / CFG.LANE_LEN) * 100) + '%';
  }
  const t = Math.max(0, raceTime);
  $('#timer').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}
requestAnimationFrame(frame);

// ---------------- Results (Mario Kart style: last -> first) ----------------
function showResults(results) {
  show('screen-results');
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  const tbody = $('#results tbody');
  tbody.innerHTML = results.map(r => `
    <tr class="${r.place <= 3 ? 'p' + r.place : ''} ${r.id === myId ? 'me' : ''}">
      <td class="place">${ord(r.place)}</td>
      <td><img src="${champUrl(r.champ || 'Teemo')}"></td>
      <td>${esc(r.name)}</td>
      <td class="time">${r.time != null ? r.time.toFixed(2) + 's' : 'DNF ' + Math.round(r.progress * 100) + '%'}</td>
    </tr>`).join('');
  const rows = [...tbody.children];
  // reveal from last place upward; slow down for the podium
  let delay = 400;
  for (let i = rows.length - 1; i >= 0; i--) {
    const place = i + 1;
    delay += place <= 3 ? 1300 : 550;
    setTimeout(() => {
      rows[i].classList.add('show');
      rows[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (place === 1) confetti();
    }, delay);
  }
}
function confetti() {
  const colors = ['#c8aa6e', '#0ac8b9', '#e84057', '#fff3b0', '#9fe8ff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2 + Math.random() * 2.5 + 's';
    c.style.animationDelay = Math.random() * .8 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 6000);
  }
}
