// Comprueba, contra el servidor que está corriendo, que la lista de canciones lleva `sinVoz` cuando el fichero
// existe, y que el filtro en vivo se sirve con su tipo. Abre una sala de verdad (WebSocket), coge el pase de tele
// y pide /api/songs como lo haría la tele.
//
//   node tools/verificar-sin-voz.cjs [http://127.0.0.1:8877]
//
// Necesita el módulo `ws` del servidor: se lanza desde la raíz del repo (server/node_modules).
const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8877';

let WebSocket;
try { WebSocket = require('ws'); } catch { WebSocket = require(path.join(__dirname, '..', 'server', 'node_modules', 'ws')); }

const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
const esperar = ms => new Promise(r => setTimeout(r, ms)); 

ws.on('open', () => ws.send(JSON.stringify({ type: 'host' })));
ws.on('message', async raw => {
  let m;
  try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type === 'error') { console.error('el servidor no abre sala:', m.code, m.msg); process.exit(1); }
  if (m.type !== 'room') return;
  const { code, token } = m;
  const k = encodeURIComponent(token);
  const songs = await (await fetch(`${BASE}/api/songs?k=${k}`, { headers: { host: new URL(BASE).host } })).json().catch(e => ({ error: e.message }));
  if (!Array.isArray(songs)) { console.error('la lista de canciones no llegó:', JSON.stringify(songs).slice(0, 200)); process.exit(1); }
  const con = songs.filter(s => s.sinVoz), sinAudio = songs.filter(s => !s.audioUrl && !s.txt);
  console.log(`sala ${code}: ${songs.length} canciones · con sin-voz.mp3: ${con.length}`);
  for (const s of con.slice(0, 3)) console.log('  ', s.title, '->', s.sinVoz);
  // y el fichero de la primera, que se pueda pedir de verdad
  if (con.length) {
    const u = BASE + '/' + con[0].sinVoz.replace(/^\//, '').replace(/&amp;/g, '&') + '&k=' + k;   // el pase de tele, como lo pone el puente
    const r = await fetch(u, { headers: { host: new URL(BASE).host, range: 'bytes=0-1023' } });
    console.log(`  ${new URL(u).pathname.split('/').pop()}: HTTP ${r.status} · ${r.headers.get('content-type')} · ${(r.headers.get('content-length') || '?')} bytes en el primer trozo`);
    if (r.status >= 400) process.exit(1);
  }
  const w = await fetch(`${BASE}/tv/quita-voces-worklet.js`);
  const txt = await w.text();
  console.log(`  filtro en vivo: HTTP ${w.status} · registraProcessor: ${/registerProcessor\('quita-voces'/.test(txt)}`);
  const app = await (await fetch(`${BASE}/app/`)).text();
  console.log(`  menú de la tele: fila «Quitar voces»: ${app.includes('Quitar voces')}`);
  const ok = con.length > 0 && w.status === 200 && /registerProcessor\('quita-voces'/.test(txt) && app.includes('Quitar voces');
  if (sinAudio.length) console.log(`  (${sinAudio.length} canciones sin audio: revisar)`);
  console.log(ok ? 'BIEN' : 'FALLA');
  try { ws.terminate(); } catch {}
  setTimeout(() => process.exit(ok ? 0 : 1), 120);
});
ws.on('error', e => { console.error('no se pudo conectar al servidor:', e.message); process.exit(1); });
setTimeout(() => { console.error('sin respuesta del servidor en 8 s'); process.exit(1); }, 8000);
