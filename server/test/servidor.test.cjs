'use strict';
// Pruebas del servidor de salas: arranca server.js en un puerto libre con datos temporales y comprueba que las
// peticiones raras no lo tumban, que el pase de tele no se salta con rutas codificadas y que una partida completa
// (sala, jugador, canciones, récord) funciona.   Se ejecutan con:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');

let child, dir, port, base;
const sockets = [];
// 6 notas de medio segundo (120 BPM → pulso de 125 ms): Do Re Mi Fa Sol La
const SONG = '#TITLE:Demo\n#ARTIST:Prueba\n#BPM:120\n#GAP:0\n: 0 4 0 Ho\n: 4 4 2 la\n: 8 4 4 que\n- 12\n: 12 4 5 tal\n: 16 4 7 es\n: 20 4 9 tás\nE\n';
const NOTAS = [60, 62, 64, 65, 67, 69];   // nota MIDI de cada medio segundo

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gramola-test-'));
  // Como en producción: las canciones viven dentro de la carpeta web (web/songs)
  const web = path.join(dir, 'web'), songs = path.join(web, 'songs');
  fs.mkdirSync(path.join(songs, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Gramola</title>');
  fs.writeFileSync(path.join(songs, 'demo', 'demo.txt'), SONG);
  // El servidor lee la partitura con el mismo lector que la tele
  fs.mkdirSync(path.join(web, 'js'));
  fs.copyFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'ultrastar.js'), path.join(web, 'js', 'ultrastar.js'));
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', WEB_DIR: web, SONGS_DIR: songs, DATA_DIR: path.join(dir, 'data'), ADMIN_HOST: '', MAX_ROOMS: '6' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El servidor no arrancó')), 10000);
    let out = '';
    child.stdout.on('data', b => {
      out += b;
      const m = out.match(/escuchando en 127\.0\.0\.1:(\d+)/);
      if (m) { port = +m[1]; base = `http://127.0.0.1:${port}`; clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', b => process.stderr.write(b));
    child.once('exit', code => { clearTimeout(timer); reject(new Error('El servidor se ha parado: ' + code)); });
  });
});
after(async () => {
  for (const ws of sockets) ws.terminate();
  if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// Petición en bruto (fetch normaliza «//» y «..» por su cuenta; aquí queremos mandar la ruta tal cual)
function raw(route, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, res => {
      let text = ''; res.on('data', b => { text += b; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const vivo = async () => assert.equal((await raw('/api/health')).status, 200, 'el servidor tiene que seguir vivo');
const ws = () => { const s = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(s); return s; };
const msg = async s => JSON.parse((await once(s, 'message'))[0]);
async function abrirSala() {
  const host = ws(); await once(host, 'open');
  host.send(JSON.stringify({ type: 'host' }));
  const m = await msg(host);
  if (m.type === 'room') { host._esHost = true; host._sala = m; }
  return [host, m];
}

test('cookies y cuerpos mal formados no tumban el servidor', async () => {
  assert.equal((await raw('/api/songs', { cookie: 'gtv=%' })).status, 403);
  assert.equal((await raw('/api/admin/auth/status', { host: `admin.localhost:${port}`, cookie: 'gadm=%' })).status, 200);
  for (const body of ['null', '[]', '"texto"', '{', '']) {
    assert.equal((await raw('/api/tv-pass', {}, 'POST', body)).status, 400, 'tv-pass con ' + JSON.stringify(body));
    assert.equal((await raw('/api/records', {}, 'POST', body)).status, 400, 'records con ' + JSON.stringify(body));
  }
  assert.equal((await raw('/%E0%A4')).status, 400);
  assert.equal((await raw('/%00')).status, 400);
  await vivo();
});

test('las canciones solo se sirven con pase de tele, también con rutas codificadas o con «..»', async () => {
  for (const r of ['/songs/demo/demo.txt', '/%73ongs/demo/demo.txt', '//songs/demo/demo.txt', '/app/../songs/demo/demo.txt', '/songs%2Fdemo%2Fdemo.txt', '/./songs/demo/demo.txt']) {
    assert.equal((await raw(r)).status, 403, r);
  }
  assert.equal((await raw('/api/songs')).status, 403);
  assert.equal((await raw('/')).status, 200);
});

test('un WebSocket abierto desde otra web se rechaza; desde la propia web o sin Origin, no', async () => {
  const intento = headers => new Promise(resolve => {
    const s = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers }); sockets.push(s);
    s.on('open', () => resolve('abierto')); s.on('unexpected-response', (_, res) => resolve('rechazado ' + res.statusCode)); s.on('error', e => resolve('error ' + e.message));
  });
  assert.match(await intento({ origin: 'https://malo.example' }), /^rechazado|^error/);
  assert.equal(await intento({ origin: `http://localhost:${port}` }), 'abierto');
  assert.equal(await intento({ origin: 'https://micro.gramola.test', host: 'gramola.test' }), 'abierto');
  assert.equal(await intento({}), 'abierto');
  await vivo();
});

test('la telemetría solo la manda una tele con sala y solo la ve el admin', async () => {
  assert.equal((await raw('/api/telemetry', {}, 'POST', '{"fps":60}')).status, 403);
  assert.equal((await raw('/api/telemetry')).status, 401);
});

test('sala, jugador, canciones y récord funcionan juntos', async () => {
  const [host, room] = await abrirSala();
  assert.equal(room.type, 'room');
  assert.match(room.code, /^[A-Z]{4}$/);
  const k = '?k=' + room.token;
  const list = await raw('/api/songs' + k);
  assert.equal(list.status, 200);
  assert.equal(JSON.parse(list.text)[0].title, 'Demo');
  assert.equal((await raw('/songs/demo/demo.txt' + k)).status, 200);
  assert.equal((await raw('/%73ongs/demo/demo.txt' + k)).status, 200);
  assert.equal((await raw('/api/telemetry' + k, {}, 'POST', '{"fps":60,"screen":"sing"}')).status, 200);
  // Jugador
  const player = ws(); await once(player, 'open');
  player.send(JSON.stringify({ type: 'join', code: room.code, name: 'Prueba' }));
  const joined = await msg(player);
  assert.equal(joined.type, 'joined');
  assert.equal((await msg(host)).type, 'players');
  // Récords: solo objetos de jugador, canciones de la biblioteca y una canción cantada en esta sala
  const post = body => raw('/api/records', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ code: room.code, token: room.token, ...body }));
  assert.equal((await post({ song: 'demo', players: [null] })).status, 400);
  assert.equal((await post({ song: 'demo', players: 'nada' })).status, 400);
  assert.equal((await post({ song: 'inventada', players: [{ name: 'Prueba', score: 9999 }] })).status, 400);
  const sin = await post({ song: 'demo', title: 'Demo', players: [{ id: joined.id, name: 'Prueba', score: 9999, streak: 3 }] });
  assert.equal(sin.status, 403, 'sin haber cantado no hay récord: ' + sin.text);
  assert.equal(JSON.parse(sin.text).error, 'sesion');
  await vivo();
});

test('el récord no puede pasar de lo que el servidor ha visto cantar', async () => {
  const [host, room] = await abrirSala();
  assert.equal(room.type, 'room');
  const entra = async nombre => { const p = ws(); await once(p, 'open'); p.send(JSON.stringify({ type: 'join', code: room.code, name: nombre })); const j = await msg(p); await msg(host); return [p, j]; };
  const [ana, jAna] = await entra('Ana'), [bea, jBea] = await entra('Bea');
  const post = body => raw('/api/records', { 'content-type': 'application/json' }, 'POST', JSON.stringify({ code: room.code, token: room.token, song: 'demo', ...body }));
  // Empieza la canción: Ana y Bea cantan (margen Normal: ±2 semitonos). El reloj de la tele va a 0.
  host.send(JSON.stringify({ type: 'sing', song: 'demo', duo: false, delay: 0, singers: [{ id: jAna.id, part: 0, tol: 2 }, { id: jBea.id, part: 0, tol: 2 }] }));
  await new Promise(r => setTimeout(r, 150));   // que el servidor lea la partitura
  const t0 = Date.now();
  host.send(JSON.stringify({ type: 'clock', pos: 0, playing: true, lat: 0 }));
  // Antes de acabar no se admite el récord
  assert.equal((await post({ players: [{ id: jAna.id, score: 5000 }] })).status, 403);
  // Ana canta toda la canción afinada; Bea solo la primera mitad; nadie más canta
  await new Promise(resolve => {
    const it = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      if (t >= 3.3) { clearInterval(it); return resolve(); }
      const n = NOTAS[Math.min(5, Math.floor(t / 0.5))];
      ana.send(JSON.stringify({ type: 'pitch', n, v: 0.5, lat: 0 }));
      if (t < 1.5) bea.send(JSON.stringify({ type: 'pitch', n: n + 12, v: 0.5, lat: 0 }));   // una octava arriba: cuenta igual
    }, 40);
  });
  await new Promise(r => setTimeout(r, 100));
  // La tele dice que las dos han hecho 10.000 y que un tal «Nadie» (id inventado) también
  const r = await post({ players: [{ id: jAna.id, name: 'Ana', score: 10000, streak: 6 }, { id: jBea.id, name: 'Bea', score: 10000, streak: 6 }, { id: 999, name: 'Nadie', score: 10000 }] });
  assert.equal(r.status, 200, r.text);
  const saved = JSON.parse(r.text).players;
  const sAna = saved.find(p => p.name === 'Ana'), sBea = saved.find(p => p.name === 'Bea');
  console.log('    guardado:', JSON.stringify(saved));
  assert.ok(sAna && sAna.score >= 9000 && sAna.score <= 10000, 'Ana cantó entera: ' + JSON.stringify(saved));
  assert.ok(sBea && sBea.score >= 4000 && sBea.score <= 7000, 'Bea cantó la mitad: ' + JSON.stringify(saved));
  assert.ok(sBea.streak <= 3 + 3, 'la racha de Bea también se recorta');
  assert.ok(!saved.find(p => p.name === 'Nadie'), 'quien no está en la sala no puntúa');
  // No se puede volver a guardar la misma canción
  assert.equal((await post({ players: [{ id: jAna.id, score: 10000 }] })).status, 409);
  const rec = JSON.parse((await raw('/api/records')).text);
  assert.equal(rec.songs.demo.name, 'Ana');
  assert.equal(rec.singers.Bea.best, sBea.score);
  assert.equal(rec.plays.demo, 1);
  await vivo();
});

test('con el tope de salas alcanzado la tele recibe un error en vez de colgar el servidor', async () => {
  // Las pruebas anteriores han dejado salas abiertas y el tope es 6: en pocas más tiene que llegar el aviso
  let d = null, abiertas = 0;
  for (let i = 0; i < 8 && !(d && d.type === 'error'); i++) { [, d] = await abrirSala(); if (d.type === 'room') abiertas++; }
  assert.equal(d.type, 'error');
  assert.equal(d.code, 'busy');
  assert.ok(abiertas >= 1, 'antes del tope se abren salas');
  await vivo();
});

test('al cerrar la sala con «nuevo código» los móviles salen y la tele recibe la sala nueva', async () => {
  // (una tele con sala pide «nuevo código»: la sala vieja se cierra y la nueva ocupa su hueco, aunque esté al tope)
  const host = sockets.find(s => s.readyState === 1 && s._esHost);
  assert.ok(host, 'hace falta una tele con sala abierta');
  const room = host._sala;
  const player = ws(); await once(player, 'open');
  player.send(JSON.stringify({ type: 'join', code: room.code, name: 'Ana' }));
  await msg(player); await msg(host);
  // (los avisos se esperan por tipo y con el oyente puesto antes de pedir: el «roster» del alta puede llegar entre medias)
  const esperar = (s, type) => new Promise(r => { const f = d => { const m = JSON.parse(d); if (m.type === type) { s.off('message', f); r(m); } }; s.on('message', f); });
  const pCerrada = esperar(player, 'closed'), pNueva = esperar(host, 'room');
  host.send(JSON.stringify({ type: 'new-code' }));
  const closed = await pCerrada;
  assert.equal(closed.type, 'closed');
  const nueva = await pNueva;
  assert.equal(nueva.type, 'room');
  assert.notEqual(nueva.code, room.code);
  await vivo();
});

test('en la red de casa la app del micro se sirve sin subdominio y sin certificado', async () => {
  // (montaje: el manifiesto y el service worker tienen que llegar aunque no se esté en el subdominio micro.)
  const web = path.join(dir, 'web');
  fs.mkdirSync(path.join(web, 'm'), { recursive: true });
  fs.writeFileSync(path.join(web, 'm', 'index.html'), '<!doctype html><title>Micro de prueba</title>');
  fs.writeFileSync(path.join(web, 'm', 'manifest.webmanifest'), '{}');
  fs.writeFileSync(path.join(web, 'm', 'sw.js'), '// sw');
  const lan = { host: `127.0.0.1:${port}` };
  assert.equal((await raw('/manifest.webmanifest', lan)).status, 200, 'sin manifiesto no hay botón de instalar');
  assert.equal((await raw('/sw.js', lan)).status, 200, 'sin service worker, tampoco');
  assert.match((await raw('/m/', lan)).text, /Micro de prueba/, '/m tiene que ser la app del micro');
  assert.doesNotMatch((await raw('/', lan)).text, /Micro/, 'la raíz sigue siendo la web informativa');
  // Un dominio sí manda al subdominio micro.
  const dom = { host: 'gramola.test' };
  assert.equal((await raw('/m', dom)).status, 301);
  assert.match((await raw('/m', dom)).headers.location, /^https:\/\/micro\.gramola\.test/);
  // Y el dominio principal no se entera de lo de abajo: esos ficheros siguen sin servirse fuera del subdominio.
  assert.equal((await raw('/manifest.webmanifest', dom)).status, 404, 'el dominio principal no cambia');
  assert.equal((await raw('/sw.js', dom)).status, 404, 'el dominio principal no cambia');
  await vivo();
});
