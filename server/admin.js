'use strict';
/**
 * Portal de administración (subdominio admin.): todo el juego a la vista y bajo control.
 *
 * - Entrada SOLO con Touch ID / passkeys (WebAuthn). Sin contraseñas. La primera llave se da de alta con un enlace de
 *   un solo uso que se genera por SSH:  node server/alta.js   (válido 30 min).
 * - Salas y jugadores en directo, con acciones (echar, cerrar, mensaje, recargar la tele).
 * - Canciones: ficha completa, cabecera del .txt editable, ficheros, subir canciones nuevas, retirar/restaurar,
 *   Megamix (automático o a mano) y volumen (normalizar), carátulas (iTunes, propia o la anterior).
 * - Récords, actividad, estadísticas por día, telemetría de las teles, estado del servidor y copia de los datos.
 *
 * El dominio no va escrito en el código: el portal responde en el host que empiece por «admin.» (o en ADMIN_HOST).
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const SESSION_HOURS = 12;
const SID = 'gadm';

module.exports = function admin(ctx) {
  const { DATA_DIR, SONGS_DIR, WEB_DIR, rooms, COLORS } = ctx;
  const RETIRED_DIR = path.join(DATA_DIR, 'retiradas');
  const TOOLS_DIR = path.join(__dirname, '..', 'tools');
  const AUTH_FILE = path.join(DATA_DIR, 'admin.json');
  const ALTA_FILE = path.join(DATA_DIR, 'admin-alta.json');
  const STATS_FILE = path.join(DATA_DIR, 'stats.json');
  const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
  const started = Date.now();

  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(data)); fs.renameSync(f + '.tmp', f); };
  const writeAtomic = ctx.writeAtomic || ((f, data) => { fs.writeFileSync(f + '.tmp', data); fs.renameSync(f + '.tmp', f); });
  const copyAtomic = (a, b) => { fs.copyFileSync(a, b + '.tmp'); fs.renameSync(b + '.tmp', b); };
  // (los ficheros de datos importantes: si están rotos se apartan con fecha en vez de pisarlos en silencio)
  const leerJson = ctx.leerJson || readJson;

  // ===================================================================== estadísticas y actividad
  const stats = leerJson(STATS_FILE, { days: {}, totals: {} });
  let events = leerJson(EVENTS_FILE, []);
  if (!Array.isArray(events)) events = [];
  let dirty = false;
  const today = () => new Date().toISOString().slice(0, 10);
  function day() {
    const d = today();
    return stats.days[d] || (stats.days[d] = { rooms: 0, joins: 0, plays: 0, songBytes: 0, peakRooms: 0, peakPlayers: 0, tvs: 0, admin: 0 });
  }
  function count(k, n = 1) { day()[k] = (day()[k] || 0) + n; stats.totals[k] = (stats.totals[k] || 0) + n; dirty = true; }
  function ev(kind, text, extra) {
    events.push({ t: Date.now(), kind, text, ...(extra || {}) });
    if (events.length > 2000) events = events.slice(-1500);
    dirty = true;
  }
  function peaks() {
    let players = 0;
    for (const r of rooms.values()) for (const p of r.players.values()) if (p.ws || p.bot) players++;
    const d = day();
    if (rooms.size > d.peakRooms) { d.peakRooms = rooms.size; dirty = true; }
    if (players > d.peakPlayers) { d.peakPlayers = players; dirty = true; }
  }
  function flush() {
    dirty = false;
    const keys = Object.keys(stats.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete stats.days[k];
    try { writeJson(STATS_FILE, stats); writeJson(EVENTS_FILE, events); } catch (e) { console.error('admin: no se pudieron guardar las estadísticas', e.message); }
  }
  setInterval(() => { peaks(); if (dirty) flush(); }, 15000).unref();

  // ===================================================================== autenticación (WebAuthn)
  const auth = leerJson(AUTH_FILE, { keys: [], sessions: [] });
  if (!Array.isArray(auth.keys)) auth.keys = []; if (!Array.isArray(auth.sessions)) auth.sessions = [];
  const saveAuth = () => writeJson(AUTH_FILE, auth);
  const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
  const hash = s => crypto.createHash('sha256').update(s).digest('hex');
  const challenges = new Map();   // id -> { challenge, kind, at }

  const isAdminHost = host => {
    const h = String(host || '').toLowerCase();
    return process.env.ADMIN_HOST ? h === process.env.ADMIN_HOST.toLowerCase() : /^admin\./.test(h);
  };
  const rpOf = req => String(req.headers.host || '').split(':')[0];
  const originOf = req => {
    const h = String(req.headers.host || '');
    return (/(^|\.)localhost(:|$)|^127\.0\.0\.1(:|$)/.test(h) ? 'http://' : 'https://') + h;
  };
  function cookie(req, name) {
    const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
    try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }   // una cookie mal codificada no tumba nada
  }
  const secure = req => originOf(req).startsWith('https') ? '; Secure' : '';
  function sessionOf(req) {
    const sid = cookie(req, SID);
    if (!sid) return null;
    const h = hash(sid), now = Date.now();
    return auth.sessions.find(s => s.id === h && s.exp > now) || null;
  }
  const isAuthed = req => isAdminHost(req.headers.host) && !!sessionOf(req);
  function openSession(req, res, keyId) {
    const sid = rand();
    const now = Date.now();
    auth.sessions = auth.sessions.filter(s => s.exp > now);
    auth.sessions.push({ id: hash(sid), key: keyId, ip: ipOf(req), ua: String(req.headers['user-agent'] || '').slice(0, 300), at: now, exp: now + SESSION_HOURS * 3600e3 });
    saveAuth();
    res.setHeader('set-cookie', `${SID}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure(req)}`);
  }
  const ipOf = req => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  function altaValid(token) {
    if (!token || typeof token !== 'string') return false;
    const a = readJson(ALTA_FILE, []);
    return a.some(t => t.token === token && !t.used && t.exp > Date.now());
  }
  function altaUse(token) {
    const a = readJson(ALTA_FILE, []).filter(t => t.exp > Date.now() && !t.used && t.token !== token);
    writeJson(ALTA_FILE, a);
  }
  function chalSave(res, challenge, kind, req) {
    const id = rand(16);
    challenges.set(id, { challenge, kind, at: Date.now() });
    for (const [k, v] of challenges) if (Date.now() - v.at > 5 * 60e3) challenges.delete(k);
    res.setHeader('set-cookie', `gchal=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=300${secure(req)}`);
  }
  function chalTake(req, kind) {
    const id = cookie(req, 'gchal');
    const c = id && challenges.get(id);
    if (id) challenges.delete(id);
    if (!c || c.kind !== kind || Date.now() - c.at > 5 * 60e3) throw httpErr(400, 'La petición ha caducado. Vuelve a intentarlo.');
    return c.challenge;
  }
  const fresh = s => s && Date.now() - s.at < 10 * 60e3;

  // ===================================================================== utilidades HTTP
  function httpErr(code, msg) { const e = new Error(msg); e.code = code; return e; }
  function json(res, code, data) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > max) { reject(httpErr(413, 'Demasiado grande')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
      req.on('close', () => reject(httpErr(400, 'Petición cortada')));
    });
  }
  async function body(req) {
    const b = await readRaw(req, 64 * 1024);
    if (!b.length) return {};
    try { return JSON.parse(b.toString('utf8')); } catch { throw httpErr(400, 'JSON no válido'); }
  }

  // ===================================================================== canciones
  const safeName = n => {
    n = String(n || '').normalize('NFC');
    if (!n || n.length > 200 || n === '.' || n === '..' || /[\/\\\0]/.test(n) || n.startsWith('.')) throw httpErr(400, 'Nombre no válido');
    return n;
  };
  const songDir = (id, mustExist = true) => {
    const d = path.join(SONGS_DIR, safeName(id));
    if (mustExist && !fs.existsSync(d)) throw httpErr(404, 'No existe esa canción');
    return d;
  };
  // Nombre del audio según la cabecera (#MP3 o #AUDIO): un nombre de fichero dentro de la carpeta, nada de rutas
  const audioOf = h => { const a = h.MP3 || h.AUDIO; return a && !/[\/\\\0]/.test(a) && a !== '..' && a !== '.' ? a : null; };
  // Cerrojo por carpeta: no se lanzan dos ffmpeg a la vez sobre el mismo audio (igualar volumen, Megamix)
  const ocupadas = new Set();
  async function conCerrojo(dir, fn) {
    if (ocupadas.has(dir)) throw httpErr(409, 'Esta canción ya se está procesando; espera a que acabe');
    ocupadas.add(dir);
    try { return await fn(); } finally { ocupadas.delete(dir); }
  }
  function readText(file) {
    const buf = fs.readFileSync(file);
    const u = buf.toString('utf8');
    return u.includes('�') ? buf.toString('latin1') : u.replace(/^﻿/, '');
  }
  const txtsOf = dir => fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.txt')).sort((a, b) => a.length - b.length);
  function headerOf(dir) {
    const t = txtsOf(dir)[0];
    if (!t) return {};
    const h = {};
    for (const line of readText(path.join(dir, t)).split(/\r?\n/)) {
      const m = line.match(/^#([A-Za-z0-9]+):(.*)$/);
      if (m) h[m[1].toUpperCase()] = m[2].trim();
      else if (line && !line.startsWith('#')) break;
    }
    return h;
  }
  function setHeader(dir, tags) {
    for (const t of txtsOf(dir)) {
      const p = path.join(dir, t);
      const lines = readText(p).split(/\r?\n/);
      let firstBody = lines.findIndex(l => l && !l.startsWith('#'));
      if (firstBody < 0) firstBody = lines.length;
      for (const [k0, v0] of Object.entries(tags)) {
        const k = String(k0).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!k) continue;
        const v = String(v0 ?? '').replace(/[\r\n]/g, ' ').trim();
        const i = lines.findIndex((l, j) => j < firstBody && new RegExp('^#' + k + ':', 'i').test(l));
        if (i >= 0) {
          if (v) lines[i] = `#${k}:${v}`; else { lines.splice(i, 1); firstBody--; }
        } else if (v) {
          lines.splice(firstBody, 0, `#${k}:${v}`); firstBody++;
        }
      }
      writeAtomic(p, lines.join('\r\n'));   // (el .txt que lee la tele nunca queda a medias)
    }
    ctx.songsChanged();
  }
  function dirSize(d) {
    let n = 0;
    try { for (const f of fs.readdirSync(d, { withFileTypes: true })) n += f.isDirectory() ? dirSize(path.join(d, f.name)) : fs.statSync(path.join(d, f.name)).size; } catch {}
    return n;
  }
  function songExtra(dir) {
    const files = [];
    try {
      for (const f of fs.readdirSync(dir)) {
        const st = fs.statSync(path.join(dir, f));
        if (st.isFile()) files.push({ name: f, size: st.size, mtime: st.mtimeMs });
      }
    } catch {}
    return {
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      size: files.reduce((a, f) => a + f.size, 0),
      volumen: readJson(path.join(dir, 'volumen.json'), null),
      caratula: readJson(path.join(dir, 'caratula.json'), null),
      megamixInfo: readJson(path.join(dir, 'megamix.json'), null),
    };
  }
  function songsList() {
    const list = ctx.scanSongs(true);
    const rec = ctx.records();
    return list.map(s => {
      const dir = path.join(SONGS_DIR, s.id);
      const x = songExtra(dir);
      return {
        ...s, size: x.size, lufs: x.volumen ? x.volumen.antes_lufs : null, normalized: !!x.volumen,
        megamixOrigin: x.megamixInfo ? x.megamixInfo.origen || 'marcado' : null,
        coverSource: x.caratula ? x.caratula.origen || 'itunes' : 'original', draft: x.files.some(f => f.name === 'borrador.json'), hasVoice: x.files.some(f => f.name === 'voz-tono.json'), plays: rec.plays[s.id] || 0, record: rec.songs[s.id] || null,
        added: Math.min(...x.files.map(f => f.mtime).filter(Boolean), Date.now()),
      };
    });
  }
  function run(cmd, args, opts = {}) {
    return new Promise(resolve => {
      // En su propio grupo de procesos: al agotarse el tiempo se mata también el ffmpeg que haya lanzado python
      const p = spawn(cmd, args, { ...opts, detached: true });
      let out = '', err = '';
      p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
      const to = setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); } }, opts.timeout || 300000);
      p.on('close', code => { clearTimeout(to); resolve({ code, out: out.trim(), err: err.trim().slice(-2000) }); });
      p.on('error', e => { clearTimeout(to); resolve({ code: -1, out: '', err: e.message }); });
    });
  }
  // (la carpeta se guarda en «d» antes de vaciar sys.argv, que las herramientas leen al importarse)
  const py = (code, dir) => run('python3', ['-I', '-c', `import sys; d = sys.argv[1]; sys.argv = ['x']; sys.path.insert(0, ${JSON.stringify(TOOLS_DIR)}); ${code}`, dir], { cwd: dir });
  // Portadas: iTunes (600×600) y Deezer (1000×1000); se devuelven juntas para elegir
  async function deezerSearch(q) {
    const r = await fetch('https://api.deezer.com/search?' + new URLSearchParams({ q, limit: '40' }), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw httpErr(502, 'Deezer no responde (' + r.status + ')');
    const j = await r.json();
    const seen = new Set();
    return (j.data || []).filter(x => x.album && x.album.cover_xl).map(x => ({
      source: 'deezer', art: x.album.cover_xl, thumb: x.album.cover_medium || x.album.cover_xl,
      album: x.album.title, artist: x.artist ? x.artist.name : '', track: x.title, year: '',
    })).filter(x => !seen.has(x.art) && seen.add(x.art));
  }
  async function coverSearch(q, src) {
    const jobs = [];
    if (src !== 'deezer') jobs.push(itunesSearch(q).catch(() => []));
    if (src !== 'itunes') jobs.push(deezerSearch(q).catch(() => []));
    const [a = [], b = []] = await Promise.all(jobs);
    const out = [];   // intercaladas: una de cada fuente
    for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
    return out;
  }
  async function itunesSearch(q) {
    const u = 'https://itunes.apple.com/search?' + new URLSearchParams({ term: q, entity: 'song', limit: '40', country: 'ES' });
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw httpErr(502, 'iTunes no responde (' + r.status + ')');
    const j = await r.json();
    const seen = new Set();
    return (j.results || []).filter(x => x.artworkUrl100).map(x => ({
      source: 'itunes', art: x.artworkUrl100.replace('100x100bb', '600x600bb'), thumb: x.artworkUrl100.replace('100x100bb', '200x200bb'),
      album: x.collectionName, artist: x.artistName, track: x.trackName, year: (x.releaseDate || '').slice(0, 4),
    })).filter(x => !seen.has(x.art) && seen.add(x.art));
  }
  function setCover(dir, file, meta) {
    const h = headerOf(dir);
    const car = path.join(dir, 'caratula.json');
    const prev = readJson(car, null);
    // Se guarda cuál era la portada original la primera vez que se cambia, para poder volver
    const antes = prev ? prev.antes : (h.COVER || null);
    setHeader(dir, { COVER: file });
    writeJson(car, { antes, ...(meta || {}), cambiada: new Date().toISOString() });
  }

  // ===================================================================== salas en detalle
  function roomsDetail() {
    const now = Date.now();
    return [...rooms.values()].map(r => ({
      code: r.code, createdAt: r.createdAt, hostOnline: !!r.host, emptySince: r.emptySince,
      host: r.hostInfo || null, state: r.state ? { screen: r.state.screen, song: r.state.song || null, mode: r.state.mode || null, turn: r.state.turn || null, singers: r.state.singers || [] } : null,
      stateAt: r.stateAt || null,
      players: [...r.players.values()].sort((a, b) => a.slot - b.slot).map(p => ({
        id: p.id, slot: p.slot, name: p.name, color: COLORS[p.slot - 1], online: !!p.ws, bot: !!p.bot, photo: !!p.photo,
        joinedAt: p.joinedAt || null, lat: p.lat ?? null, singing: p.pitchAt ? now - p.pitchAt < 3000 : false,
        lastNote: p.lastN ?? null, vol: p.lastV ?? null, info: p.info || null,
      })),
    }));
  }

  // ===================================================================== servidor
  function versionNow() {
    try { const m = fs.readFileSync(path.join(WEB_DIR, 'app', 'index.html'), 'utf8').match(/Versión ([0-9.]+)/); return m ? m[1] : '?'; } catch { return '?'; }
  }
  let sizeCache = { at: 0 };
  function serverInfo() {
    if (Date.now() - sizeCache.at > 60000) {
      let disk = null;
      try { const s = fs.statfsSync(SONGS_DIR); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch {}
      sizeCache = { at: Date.now(), songs: dirSize(SONGS_DIR), retired: dirSize(RETIRED_DIR), data: dirSize(DATA_DIR), disk };
    }
    const m = process.memoryUsage();
    return {
      version: versionNow(), node: process.version, pid: process.pid, uptime: Math.round((Date.now() - started) / 1000),
      host: os.hostname(), load: os.loadavg(), cpus: os.cpus().length, memTotal: os.totalmem(), memFree: os.freemem(),
      rss: m.rss, heap: m.heapUsed, osUptime: os.uptime(),
      sizes: { songs: sizeCache.songs, retired: sizeCache.retired, data: sizeCache.data }, disk: sizeCache.disk,
      sockets: ctx.wsCount(), ffmpeg: ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].some(f => fs.existsSync(f)),
    };
  }

  // ===================================================================== rutas
  const routes = [];
  const on = (method, pattern, fn, open = false) => routes.push({ method, re: new RegExp('^/api/admin' + pattern + '$'), fn, open });

  // --- acceso
  on('GET', '/auth/status', (req, res, m, url) => json(res, 200, { authenticated: !!sessionOf(req), hasKeys: auth.keys.length > 0, setupValid: altaValid(url.searchParams.get('setup')) }), true);
  on('POST', '/auth/register/options', async (req, res) => {
    const b = await body(req), s = sessionOf(req);
    if (!altaValid(b.setup) && !fresh(s)) throw httpErr(401, s ? 'Para añadir una llave, sal y vuelve a entrar con Touch ID (tiene que ser una entrada reciente).' : 'Necesitas un enlace de alta válido.');
    const o = await generateRegistrationOptions({
      rpName: 'Gramola · Admin', rpID: rpOf(req), userName: 'admin@gramola', userDisplayName: 'Administración de Gramola',
      attestationType: 'none', excludeCredentials: auth.keys.map(k => ({ id: k.id, transports: k.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    chalSave(res, o.challenge, 'register', req);
    json(res, 200, o);
  }, true);
  on('POST', '/auth/register/verify', async (req, res) => {
    const b = await body(req), s = sessionOf(req), viaAlta = altaValid(b.setup);
    if (!viaAlta && !fresh(s)) throw httpErr(401, 'Para añadir una llave, sal y vuelve a entrar con Touch ID.');
    const v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: chalTake(req, 'register'), expectedOrigin: originOf(req), expectedRPID: rpOf(req), requireUserVerification: true });
    if (!v.verified || !v.registrationInfo) throw httpErr(400, 'No se ha podido verificar la llave.');
    const c = v.registrationInfo.credential;
    const name = String(b.name || '').trim().slice(0, 60) || 'Llave';
    auth.keys.push({ id: c.id, pk: Buffer.from(c.publicKey).toString('base64'), counter: c.counter, transports: c.transports || [], name, at: Date.now(), used: null });
    saveAuth();
    if (viaAlta) altaUse(b.setup);
    ev('admin', `Llave de Touch ID añadida: ${name}`, { ip: ipOf(req) });
    if (!s) openSession(req, res, c.id);
    json(res, 200, { ok: true });
  }, true);
  on('POST', '/auth/login/options', async (req, res) => {
    if (!auth.keys.length) throw httpErr(400, 'Aún no hay ninguna llave dada de alta.');
    const o = await generateAuthenticationOptions({ rpID: rpOf(req), allowCredentials: auth.keys.map(k => ({ id: k.id, transports: k.transports })), userVerification: 'required' });
    chalSave(res, o.challenge, 'login', req);
    json(res, 200, o);
  }, true);
  on('POST', '/auth/login/verify', async (req, res) => {
    const b = await body(req);
    const expectedChallenge = chalTake(req, 'login');
    const k = auth.keys.find(x => x.id === String(b.response && b.response.id || ''));
    if (!k) throw httpErr(401, 'Esta llave no está dada de alta.');
    const v = await verifyAuthenticationResponse({
      response: b.response, expectedChallenge, expectedOrigin: originOf(req), expectedRPID: rpOf(req), requireUserVerification: true,
      credential: { id: k.id, publicKey: new Uint8Array(Buffer.from(k.pk, 'base64')), counter: k.counter, transports: k.transports },
    });
    if (!v.verified) throw httpErr(401, 'No se ha podido verificar tu Touch ID.');
    k.counter = v.authenticationInfo.newCounter; k.used = Date.now();
    openSession(req, res, k.id);
    count('admin');
    ev('admin', `Entrada al admin (${k.name})`, { ip: ipOf(req) });
    json(res, 200, { ok: true });
  }, true);
  on('POST', '/auth/logout', (req, res) => {
    const s = sessionOf(req);
    if (s) { auth.sessions = auth.sessions.filter(x => x !== s); saveAuth(); }
    res.setHeader('set-cookie', `${SID}=; Path=/; Max-Age=0${secure(req)}`);
    json(res, 200, { ok: true });
  }, true);
  on('GET', '/auth/keys', (req, res) => {
    const s = sessionOf(req), now = Date.now();
    json(res, 200, {
      keys: auth.keys.map(k => ({ id: k.id, name: k.name, at: k.at, used: k.used, current: k.id === s.key })),
      sessions: auth.sessions.filter(x => x.exp > now).map(x => ({ id: x.id.slice(0, 10), ip: x.ip, ua: x.ua, at: x.at, exp: x.exp, current: x === s })),
      fresh: fresh(s),
    });
  });
  on('DELETE', '/auth/keys/(.+)', (req, res, m) => {
    if (auth.keys.length <= 1) throw httpErr(400, 'No puedes borrar la última llave: te quedarías fuera.');
    const id = decodeURIComponent(m[1]), k = auth.keys.find(x => x.id === id);
    auth.keys = auth.keys.filter(x => x.id !== id);
    auth.sessions = auth.sessions.filter(x => x.key !== id);
    saveAuth();
    ev('admin', `Llave borrada: ${k ? k.name : id}`);
    json(res, 200, { ok: true });
  });
  on('POST', '/auth/revoke-others', (req, res) => {
    const s = sessionOf(req), n = auth.sessions.length - 1;
    auth.sessions = [s]; saveAuth();
    ev('admin', `Cerradas ${n} sesiones del admin`);
    json(res, 200, { closed: n });
  });

  // --- directo
  on('GET', '/live', (req, res) => {
    peaks();
    let players = 0, singing = 0;
    for (const r of rooms.values()) for (const p of r.players.values()) { if (p.ws) players++; if (p.pitchAt && Date.now() - p.pitchAt < 3000) singing++; }
    json(res, 200, { now: Date.now(), rooms: roomsDetail(), counts: { rooms: rooms.size, tvs: [...rooms.values()].filter(r => r.host).length, players, singing }, today: day(), lastEvents: events.slice(-30).reverse() });
  });
  const roomOf = code => { const r = rooms.get(String(code).toUpperCase()); if (!r) throw httpErr(404, 'Esa sala ya no existe'); return r; };
  on('POST', '/rooms/([A-Z]{4})/close', (req, res, m) => {
    const r = roomOf(m[1]);
    ctx.sendTo(r.host, { type: 'admin', action: 'toast', text: 'La sala se ha cerrado desde la administración' });
    ctx.closeRoom(r);
    ev('admin', `Sala ${m[1]} cerrada desde el admin`);
    json(res, 200, { ok: true });
  });
  on('POST', '/rooms/([A-Z]{4})/kick', async (req, res, m) => {
    const r = roomOf(m[1]), b = await body(req), p = r.players.get(+b.p);
    if (!p) throw httpErr(404, 'Ese jugador ya no está');
    ctx.sendTo(p.ws, { type: 'kicked' }); p.ws && p.ws.close();
    r.players.delete(p.id); ctx.announce(r);
    ev('admin', `${p.name} expulsado de la sala ${r.code} desde el admin`);
    json(res, 200, { ok: true });
  });
  on('POST', '/rooms/([A-Z]{4})/message', async (req, res, m) => {
    const r = roomOf(m[1]), b = await body(req), text = String(b.text || '').trim().slice(0, 140);
    if (!text) throw httpErr(400, 'Escribe el mensaje');
    ctx.sendTo(r.host, { type: 'admin', action: 'toast', text });
    if (b.phones) for (const p of r.players.values()) ctx.sendTo(p.ws, { type: 'admin', action: 'toast', text });
    ev('admin', `Mensaje a la sala ${r.code}: «${text}»`);
    json(res, 200, { ok: true });
  });
  on('POST', '/rooms/([A-Z]{4})/reload', async (req, res, m) => {
    const r = roomOf(m[1]), b = await body(req);
    if (b.phones) {   // los móviles de la sala (tras un despliegue del micro)
      let n = 0;
      for (const p of r.players.values()) if (p.ws) { ctx.sendTo(p.ws, { type: 'admin', action: 'reload' }); n++; }
      ev('admin', `Recarga de ${n} móviles de la sala ${r.code}`);
      return json(res, 200, { ok: true, phones: n });
    }
    if (!r.host) throw httpErr(400, 'La tele de esa sala no está conectada');
    ctx.sendTo(r.host, { type: 'admin', action: 'reload' });
    ev('admin', `Recarga de la tele de la sala ${r.code}`);
    json(res, 200, { ok: true });
  });
  on('GET', '/rooms/([A-Z]{4})/photo/(\\d+)', (req, res, m) => {
    const p = roomOf(m[1]).players.get(+m[2]);
    if (!p || !p.photo) throw httpErr(404, 'Sin foto');
    const buf = Buffer.from(p.photo.split(',')[1], 'base64');
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
    res.end(buf);
  });
  on('POST', '/broadcast', async (req, res) => {
    const b = await body(req), text = String(b.text || '').trim().slice(0, 140);
    if (!text) throw httpErr(400, 'Escribe el mensaje');
    let n = 0;
    for (const r of rooms.values()) {
      if (r.host) { ctx.sendTo(r.host, { type: 'admin', action: 'toast', text }); n++; }
      if (b.phones) for (const p of r.players.values()) ctx.sendTo(p.ws, { type: 'admin', action: 'toast', text });
    }
    ev('admin', `Aviso a todas las salas (${n} teles): «${text}»`);
    json(res, 200, { tvs: n });
  });

  // --- resumen y estadísticas
  on('GET', '/overview', (req, res) => {
    const days = Object.keys(stats.days).sort().slice(-60).map(d => ({ day: d, ...stats.days[d] }));
    const rec = ctx.records();
    const plays = Object.entries(rec.plays || {}).sort((a, b) => b[1] - a[1]);
    const byId = new Map(ctx.scanSongs().map(s => [s.id, s]));
    json(res, 200, {
      days, totals: stats.totals, server: serverInfo(), songs: byId.size,
      top: plays.slice(0, 15).map(([id, n]) => ({ id, n, title: byId.get(id) ? byId.get(id).title : id, artist: byId.get(id) ? byId.get(id).artist : '', exists: byId.has(id) })),
      singers: Object.keys(rec.singers || {}).length, totalPlays: plays.reduce((a, x) => a + x[1], 0),
    });
  });
  on('GET', '/events', (req, res, m, url) => {
    const since = +url.searchParams.get('since') || 0, kind = url.searchParams.get('kind');
    json(res, 200, events.filter(e => e.t > since && (!kind || e.kind === kind)).slice(-1000).reverse());
  });
  on('GET', '/telemetry', (req, res) => json(res, 200, ctx.telemetry().slice().reverse()));
  on('GET', '/server', (req, res) => { sizeCache.at = 0; json(res, 200, serverInfo()); });
  on('POST', '/server/restart', (req, res) => {
    ev('admin', 'Reinicio del servidor desde el admin');
    flush();
    try { ctx.saveRooms && ctx.saveRooms(); } catch {}
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 400);   // systemd lo vuelve a levantar (Restart=always) y restaura las salas
  });
  on('GET', '/backup', (req, res) => {
    // (con las llaves de Touch ID y las novedades: sin admin.json hay que volver a dar de alta por SSH)
    const data = { at: new Date().toISOString(), version: versionNow(), records: ctx.records(), stats, events, novedades: ctx.novedades(), admin: auth };
    res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="gramola-datos-${today()}.json"`, 'cache-control': 'no-store' });
    res.end(JSON.stringify(data, null, 1));
  });

  // --- canciones
  on('GET', '/songs', (req, res) => json(res, 200, songsList()));
  on('GET', '/songs/([^/]+)', (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id);
    const s = ctx.scanSongs(true).find(x => x.id === id) || null;
    const rec = ctx.records();
    json(res, 200, { id, song: s, header: headerOf(dir), txts: txtsOf(dir), ...songExtra(dir), plays: rec.plays[id] || 0, record: rec.songs[id] || null });
  });
  // --- editor: el .txt que usa la tele (el mismo que elige el servidor), con versiones anteriores guardadas
  const VER_DIR = path.join(DATA_DIR, 'versiones');
  const chartFile = dir => { const f = fs.readdirSync(dir).find(x => x.toLowerCase().endsWith('.txt')); if (!f) throw httpErr(404, 'Esta canción no tiene .txt'); return f; };
  const verDir = id => path.join(VER_DIR, safeName(id));
  on('GET', '/songs/([^/]+)/chart', (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id), f = chartFile(dir), h = headerOf(dir);
    const base = '/songs/' + encodeURIComponent(id) + '/';
    const has = n => fs.existsSync(path.join(dir, n));
    json(res, 200, {
      id, file: f, text: readText(path.join(dir, f)),
      audio: (h.MP3 || h.AUDIO) ? base + encodeURIComponent(h.MP3 || h.AUDIO) : null,
      vocals: has('voz.mp3') ? base + 'voz.mp3?v=' + Math.round(fs.statSync(path.join(dir, 'voz.mp3')).mtimeMs) : null,
      pitch: has('voz-tono.json') ? base + 'voz-tono.json?v=' + Math.round(fs.statSync(path.join(dir, 'voz-tono.json')).mtimeMs) : null,
      tramos: has('voz-tramos.json') ? base + 'voz-tramos.json?v=' + Math.round(fs.statSync(path.join(dir, 'voz-tramos.json')).mtimeMs) : null,
      megamix: readJson(path.join(dir, 'megamix.json'), null),
      draft: has('borrador.json'),
    });
  });
  on('PUT', '/songs/([^/]+)/chart', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id), f = chartFile(dir);
    let b;
    try { b = JSON.parse((await readRaw(req, 2 * 1024 * 1024)).toString('utf8') || '{}'); } catch { throw httpErr(400, 'JSON no válido'); }
    const text = String((b && b.text) || '');
    if (!/^#TITLE:/m.test(text) || !/^#BPM:/m.test(text) || !/^[:*FRG]\s*-?\d+\s+\d+\s+-?\d+/m.test(text)) throw httpErr(400, 'El .txt no es válido (falta TITLE, BPM o notas)');
    const vd = verDir(id);
    fs.mkdirSync(vd, { recursive: true });
    fs.copyFileSync(path.join(dir, f), path.join(vd, new Date().toISOString().replace(/[:.]/g, '-') + '.txt'));
    const old = fs.readdirSync(vd).sort();
    for (const x of old.slice(0, Math.max(0, old.length - 60))) fs.unlinkSync(path.join(vd, x));
    writeAtomic(path.join(dir, f), text.replace(/\r?\n/g, '\r\n'));
    ctx.songsChanged();
    ev('songs', `Editor: «${id}» guardada${b.note ? ' (' + String(b.note).slice(0, 80) + ')' : ''}`);
    json(res, 200, { ok: true });
  });
  on('GET', '/songs/([^/]+)/versions', (req, res, m) => {
    const id = decodeURIComponent(m[1]); songDir(id);
    let l = []; try { l = fs.readdirSync(verDir(id)).filter(x => x.endsWith('.txt')).sort().reverse(); } catch {}
    json(res, 200, l.map(n => ({ name: n, size: fs.statSync(path.join(verDir(id), n)).size })));
  });
  on('GET', '/songs/([^/]+)/versions/([^/]+)', (req, res, m) => {
    const id = decodeURIComponent(m[1]), n = safeName(decodeURIComponent(m[2])), f = path.join(verDir(id), n);
    if (!fs.existsSync(f)) throw httpErr(404, 'No existe esa versión');
    json(res, 200, { text: readText(f) });
  });

  // ===================================================================== creación de canciones (trabajador en el propio servidor)
  // Cola en data/trabajos/<id>/ (job.json + entradas + resultados). El trabajador (tools/trabajador/trabajador.py)
  // pide trabajo con su clave, descarga el audio, procesa y sube los resultados; el servidor instala la canción
  // como BORRADOR (no sale en la tele hasta «Publicar»).
  const JOBS = path.join(DATA_DIR, 'trabajos');
  const WORKER_FILE = path.join(DATA_DIR, 'trabajador.json');
  // Lo que deja el trabajador junto a la canción: la voz sola, su tono y los tramos de voz con lo que dice (reconocimiento)
  const VOZ_FILES = ['voz.mp3', 'voz-tono.json', 'voz-tramos.json', 'sin-voz.mp3'];   // (sin-voz.mp3: la música sin la voz, para la tele)
  let worker = { seen: 0, host: '', job: null };
  const jobPath = (id, f = 'job.json') => path.join(JOBS, safeName(id), f);
  const jobGet = id => { const j = readJson(jobPath(id), null); if (!j) throw httpErr(404, 'No existe ese trabajo'); return j; };
  const jobPut = j => { j.updated = Date.now(); writeJson(jobPath(j.id), j); return j; };
  const jobsAll = () => { let l = []; try { l = fs.readdirSync(JOBS).map(d => readJson(path.join(JOBS, d, 'job.json'), null)).filter(Boolean); } catch {} return l.sort((a, b) => b.created - a.created); };
  const folderFor = (artista, titulo) => {
    const base = `${artista} - ${titulo}`.replace(/[\/\\:*?"<>|\0]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150) || 'Canción';
    let n = base, k = 2;
    while (fs.existsSync(path.join(SONGS_DIR, n))) n = `${base} (${k++})`;
    return n;
  };
  on('GET', '/jobs', (req, res) => json(res, 200, { jobs: jobsAll().slice(0, 100), worker: { ...worker, configured: fs.existsSync(WORKER_FILE) } }));
  on('POST', '/jobs', async (req, res) => {
    const b = await body(req), id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    let j;
    if (b.kind === 'spotify') {
      // Solo una canción suelta: nada de álbumes, listas, artistas ni vídeos
      const u = String(b.url || '').trim();
      const m = u.match(/^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})(?:[/?#].*)?$/);
      if (!m) throw httpErr(400, /spotify/i.test(u) ? 'Solo se puede importar una canción suelta (enlace de canción, no de álbum, lista ni artista)' : 'Pega el enlace de una canción de Spotify');
      const dup = jobsAll().find(x => x.kind === 'spotify' && x.trackId === m[1] && ['pendiente', 'procesando'].includes(x.state));
      if (dup) throw httpErr(409, 'Esa canción ya se está descargando');
      j = { id, kind: 'spotify', trackId: m[1], url: 'https://open.spotify.com/track/' + m[1], titulo: 'Canción de Spotify', artista: '', state: 'pendiente', created: Date.now() };
    } else if (b.kind === 'analizar') {
      const sid = String(b.song || ''); songDir(sid);
      const hh = headerOf(songDir(sid));
      const IDIOMA = { spanish: 'es', english: 'en', catalan: 'ca', french: 'fr', italian: 'it', portuguese: 'pt', german: 'de', galician: 'gl', basque: 'eu' };
      j = { id, kind: 'analizar', song: sid, titulo: hh.TITLE || sid, artista: hh.ARTIST || '', idioma: IDIOMA[String(hh.LANGUAGE || '').trim().toLowerCase()] || null, state: 'pendiente', created: Date.now() };
    } else {
      const titulo = String(b.titulo || '').trim().slice(0, 120), artista = String(b.artista || '').trim().slice(0, 120), letra = String(b.letra || '').slice(0, 30000);
      if (!titulo || !artista) throw httpErr(400, 'Faltan el título o el artista');
      if (letra.split('\n').filter(l => l.trim()).length < 2) throw httpErr(400, 'Pega la letra (una frase por línea)');
      const folder = folderFor(artista, titulo);
      j = { id, kind: 'crear', titulo, artista, idioma: String(b.idioma || 'es').slice(0, 5), anio: String(b.anio || '').slice(0, 4), folder, audioName: folder + '.mp3', state: 'subiendo', created: Date.now() };
      fs.mkdirSync(path.join(JOBS, id), { recursive: true });
      fs.writeFileSync(jobPath(id, 'letra.txt'), letra);
      if (b.lrc) fs.writeFileSync(jobPath(id, 'letra.lrc'), String(b.lrc).slice(0, 60000));
    }
    fs.mkdirSync(path.join(JOBS, id), { recursive: true });
    jobPut(j);
    ev('songs', j.kind === 'crear' ? `Creación pedida: «${j.artista} - ${j.titulo}»` : `Análisis de voz pedido: «${j.song}»`);
    json(res, 200, j);
  });
  on('PUT', '/jobs/([^/]+)/audio', async (req, res, m) => {
    const j = jobGet(m[1]);
    if (j.kind !== 'crear') throw httpErr(400, 'Este trabajo no lleva audio');
    const buf = await readRaw(req, 60 * 1024 * 1024);
    if (buf.length < 50000) throw httpErr(400, 'El audio no es válido');
    const ext = /\.(mp3|m4a|ogg|wav|flac|opus)$/i.exec(String(req.headers['x-name'] || ''))?.[1]?.toLowerCase() || 'mp3';
    // Se guarda tal cual; si no es MP3, el servidor lo pasa a MP3 (la tele y el trabajador lo leen igual)
    fs.writeFileSync(jobPath(j.id, 'entrada.' + ext), buf);
    if (ext !== 'mp3') {
      const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', jobPath(j.id, 'entrada.' + ext), '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', jobPath(j.id, 'entrada.mp3')]);
      if (r.code !== 0) throw httpErr(400, 'No se pudo convertir el audio: ' + r.err);
      try { fs.unlinkSync(jobPath(j.id, 'entrada.' + ext)); } catch {}   // (el original ya no hace falta: no se guardan dos audios)
    }
    j.state = 'pendiente'; j.size = buf.length; jobPut(j);
    json(res, 200, j);
  });
  // Borrador (audio ya descargado): se completa con la letra y pasa a la cola de creación
  on('POST', '/jobs/([^/]+)/continuar', async (req, res, m) => {
    const j = jobGet(m[1]), b = await body(req);
    if (j.state !== 'borrador') throw httpErr(400, 'Este trabajo no es un borrador');
    const titulo = String(b.titulo || '').trim().slice(0, 120), artista = String(b.artista || '').trim().slice(0, 120), letra = String(b.letra || '').slice(0, 30000);
    if (!titulo || !artista) throw httpErr(400, 'Faltan el título o el artista');
    if (letra.split('\n').filter(l => l.trim()).length < 2) throw httpErr(400, 'Pega la letra (una frase por línea)');
    fs.writeFileSync(jobPath(j.id, 'letra.txt'), letra);
    if (b.lrc) fs.writeFileSync(jobPath(j.id, 'letra.lrc'), String(b.lrc).slice(0, 60000));
    const folder = folderFor(artista, titulo);
    Object.assign(j, { kind: 'crear', origen: 'spotify', titulo, artista, idioma: String(b.idioma || 'es').slice(0, 5), anio: String(b.anio || '').slice(0, 4), folder, audioName: folder + '.mp3', state: 'pendiente', progress: 0, msg: '' });
    jobPut(j);
    ev('songs', `Creación pedida (desde Spotify): «${artista} - ${titulo}»`);
    json(res, 200, j);
  });
  on('PATCH', '/jobs/([^/]+)', async (req, res, m) => {   // guardar a medias lo escrito en un borrador
    const j = jobGet(m[1]), b = await body(req);
    if (j.state !== 'borrador') throw httpErr(400, 'Solo se pueden editar los borradores');
    for (const k of ['titulo', 'artista', 'idioma', 'anio']) if (b[k] != null) j[k] = String(b[k]).slice(0, 120);
    if (b.letra != null) fs.writeFileSync(jobPath(j.id, 'letra.txt'), String(b.letra).slice(0, 30000));
    jobPut(j); json(res, 200, j);
  });
  on('GET', '/jobs/([^/]+)/(audio|portada|letra)', (req, res, m) => {
    const j = jobGet(m[1]), f = jobPath(j.id, m[2] === 'audio' ? 'entrada.mp3' : m[2] === 'portada' ? 'portada.jpg' : 'letra.txt');
    if (!fs.existsSync(f)) throw httpErr(404, 'No hay');
    const st = fs.statSync(f), type = m[2] === 'audio' ? 'audio/mpeg' : m[2] === 'portada' ? 'image/jpeg' : 'text/plain; charset=utf-8';
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg && m[2] === 'audio' && (rg[1] || rg[2])) {
      const a = rg[1] ? +rg[1] : st.size - +rg[2], e = rg[1] && rg[2] ? Math.min(+rg[2], st.size - 1) : st.size - 1;
      if (!(a >= 0 && a <= e && a < st.size)) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${e}/${st.size}`, 'content-length': e - a + 1, 'cache-control': 'no-store' });
      return fs.createReadStream(f, { start: a, end: e }).on('error', () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size, 'cache-control': 'no-store' });
    fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
  on('POST', '/jobs/([^/]+)/retry', (req, res, m) => { const j = jobGet(m[1]); j.state = 'pendiente'; j.error = null; j.progress = 0; j.msg = ''; jobPut(j); json(res, 200, j); });
  on('DELETE', '/jobs/([^/]+)', async (req, res, m) => { jobGet(m[1]); await fsp.rm(path.join(JOBS, safeName(m[1])), { recursive: true, force: true }); json(res, 200, { ok: true }); });
  on('POST', '/worker/token', (req, res) => {
    const token = rand(32);
    writeJson(WORKER_FILE, { hash: hash(token), created: Date.now() });
    ev('admin', 'Clave nueva para el trabajador de creación de canciones');
    json(res, 200, { token });
  });
  // Borradores: publicar (deja de ser borrador y, si se quiere, entra en Novedades)
  // Si ya hay otra canción con el mismo artista y título, se pregunta: sustituirla (la nueva ocupa su carpeta y se queda
  // con su historial; la antigua va a Retiradas) o publicar las dos.
  on('POST', '/songs/([^/]+)/publish', async (req, res, m) => {
    let id = decodeURIComponent(m[1]), dir = songDir(id);
    const b = await body(req), h = headerOf(dir), key = normKey(h.ARTIST) + '|' + normKey(h.TITLE);
    const otra = ctx.scanSongs(true).find(s => s.id !== id && !s.draft && normKey(s.artist) + '|' + normKey(s.title) === key);
    if (otra && b.sustituir == null) return json(res, 409, { error: 'Ya hay una canción igual', dup: otra.id, dupTitle: `${otra.artist} - ${otra.title}` });
    try { fs.unlinkSync(path.join(dir, 'borrador.json')); } catch {}
    const nv = ctx.novedades();
    if (otra && b.sustituir === true) {
      fs.mkdirSync(RETIRED_DIR, { recursive: true });
      const viejo = path.join(SONGS_DIR, otra.id);
      fs.renameSync(viejo, path.join(RETIRED_DIR, `${otra.id} (sustituida ${new Date().toISOString().slice(0, 10)} ${Date.now() % 100000})`));
      fs.renameSync(dir, viejo);
      if (nv[id]) { delete nv[id]; }
      ev('songs', `«${otra.id}» sustituida por la versión nueva (la anterior está en Retiradas)`);
      id = otra.id;
    }
    if (b.novedad !== false) nv[id] = nv[id] || Date.now();
    ctx.saveNovedades();
    ctx.songsChanged();
    ev('songs', `Publicada: «${id}»${b.novedad !== false ? ' (en Novedades)' : ''}`);
    json(res, 200, { ok: true, id });
  });
  // Volver a encajar (canción en preparación): se reutilizan su audio y su letra con el método actual
  on('POST', '/songs/([^/]+)/reencajar', (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id);
    if (!fs.existsSync(path.join(dir, 'borrador.json'))) throw httpErr(400, 'Solo se pueden volver a encajar las canciones en preparación');
    const j = jobsAll().find(x => x.kind === 'crear' && x.song === id && fs.existsSync(jobPath(x.id, 'entrada.mp3')) && fs.existsSync(jobPath(x.id, 'letra.txt')));
    if (!j) throw httpErr(404, 'No se encuentran el audio y la letra con los que se creó');
    if (['pendiente', 'procesando'].includes(j.state)) return json(res, 200, j);
    Object.assign(j, { state: 'pendiente', reencajar: true, progress: 0, msg: '', error: null });
    jobPut(j);
    ev('songs', `Volver a encajar pedido: «${id}»`);
    json(res, 200, j);
  });
  on('GET', '/preparacion', (req, res) => {
    const l = ctx.scanSongs(true).filter(s => s.draft).map(s => {
      const dir = path.join(SONGS_DIR, s.id), b = readJson(path.join(dir, 'borrador.json'), {});
      const key = normKey(s.artist) + '|' + normKey(s.title);
      const otra = ctx.scanSongs().find(x => x.id !== s.id && !x.draft && normKey(x.artist) + '|' + normKey(x.title) === key);
      let editada = null; try { editada = fs.readdirSync(path.join(VER_DIR, s.id)).length; } catch {}
      return { ...s, creada: b.creada || null, dup: otra ? otra.id : null, editada };
    });
    json(res, 200, l.sort((a, b) => (b.creada || 0) - (a.creada || 0)));
  });

  // ===================================================================== letras
  // Búsqueda de la letra por artista y título: LRCLIB (base abierta, a menudo sincronizada por líneas) y, de reserva,
  // Genius y songlyrics (dos de las fuentes de SimonIT/spotifylyrics). Se devuelve una frase por línea, sin marcas
  // tipo [Estribillo]; si es sincronizada, también el LRC.
  const UA = { 'user-agent': 'Gramola karaoke (+https://github.com/nuvolacat/Gramola.link)' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function getJson(u, tries = 3) {
    for (let k = 0; k < tries; k++) {
      try {
        const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
        if (r.status === 404) return null;
        if (r.ok) return await r.json();
      } catch {}
      await sleep(1500 * (k + 1));
    }
    return null;
  }
  const decodeHtml = s => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
  function limpiarLetra(txt) {
    return String(txt || '').replace(/\r/g, '').split('\n')
      .map(l => l.replace(/^\[\d+:\d+(?:[.:]\d+)?\]\s*/g, '').replace(/^\[\d+:\d+(?:[.:]\d+)?\]\s*/g, '').trim())
      .filter(l => l && !/^\[.*\]$/.test(l) && !/^\(.*\)$/.test(l) && !/^(instrumental|♪+)$/i.test(l))
      .join('\n');
  }
  async function lrclib(artista, titulo, dur) {
    const base = 'https://lrclib.net/api/';
    const q = new URLSearchParams({ artist_name: artista, track_name: titulo });
    if (dur) q.set('duration', Math.round(dur));
    let r = await getJson(base + 'get?' + q);
    if (!r || !(r.syncedLyrics || r.plainLyrics)) {
      const s = await getJson(base + 'search?' + new URLSearchParams({ artist_name: artista, track_name: titulo }));
      const ok = (Array.isArray(s) ? s : []).filter(x => !x.instrumental && (x.syncedLyrics || x.plainLyrics));
      // Con duración conocida, la versión más parecida (evita directos y remezclas); si no, la primera sincronizada
      ok.sort((a, b) => (dur ? Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur) : 0) || (!!b.syncedLyrics - !!a.syncedLyrics));
      r = ok[0] || null;
    }
    if (!r || !(r.syncedLyrics || r.plainLyrics)) return null;
    return { fuente: 'LRCLIB', sincronizada: !!r.syncedLyrics, lrc: r.syncedLyrics || null, texto: limpiarLetra(r.syncedLyrics || r.plainLyrics) };
  }
  async function genius(artista, titulo) {
    const s = await getJson('https://genius.com/api/search/song?' + new URLSearchParams({ q: `${artista} ${titulo}`, per_page: '5' }), 2);
    const hits = (s && s.response && s.response.sections && s.response.sections[0] && s.response.sections[0].hits) || [];
    const a = normKey(artista).slice(0, 6);
    const h = hits.map(x => x.result).find(x => x && normKey(x.primary_artist && x.primary_artist.name).includes(a) && x.url);
    if (!h) return null;
    const r = await fetch(h.url, { headers: UA, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r || !r.ok) return null;
    const html = await r.text();
    const parts = [...html.matchAll(/<div[^>]+data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>(?=\s*(?:<div[^>]+data-lyrics-container|<div class="(?:LyricsFooter|RightSidebar)|<\/div>))/g)].map(m => decodeHtml(m[1]));
    // Fuera la cabecera de la página («20 Contributors … Lyrics», «Translations», idiomas…) de las primeras líneas
    const L = limpiarLetra(parts.join('\n')).split('\n');
    while (L.length && (/contributors?|lyrics$|^translations?$|^(english|español|deutsch|français|italiano|português|català)$/i.test(L[0]))) L.shift();
    const texto = L.filter(l => !/^\d+\s+contributors?/i.test(l) && !/^you might also like/i.test(l) && !/embed$/i.test(l)).join('\n');
    return texto.split('\n').length >= 4 ? { fuente: 'Genius', sincronizada: false, texto } : null;
  }
  async function songlyrics(artista, titulo) {
    const slug = s => normKeySpaced(s).replace(/ /g, '-');
    const r = await fetch(`https://www.songlyrics.com/${slug(artista)}/${slug(titulo)}-lyrics/`, { headers: UA, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r || !r.ok) return null;
    const m = (await r.text()).match(/<p id="songLyricsDiv"[^>]*>([\s\S]*?)<\/p>/);
    const texto = m ? limpiarLetra(decodeHtml(m[1])) : '';
    return texto.split('\n').length >= 4 && !/we do not have the lyrics/i.test(texto) ? { fuente: 'songlyrics', sincronizada: false, texto } : null;
  }
  const normKeySpaced = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  async function buscarLetra(artista, titulo, dur) {
    const t = String(titulo).replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*(remaster|version|live|mix|edit).*$/i, '').trim();
    for (const f of [() => lrclib(artista, t, dur), () => genius(artista, t), () => songlyrics(artista, t)]) {
      try { const r = await f(); if (r && r.texto) return r; } catch {}
    }
    return null;
  }
  on('GET', '/letras', async (req, res, m, url) => {
    const a = String(url.searchParams.get('artista') || '').trim(), ti = String(url.searchParams.get('titulo') || '').trim();
    if (!a || !ti) throw httpErr(400, 'Pon el artista y el título');
    const r = await buscarLetra(a, ti, +url.searchParams.get('duracion') || 0);
    if (!r) throw httpErr(404, 'No se ha encontrado la letra en LRCLIB, Genius ni songlyrics');
    json(res, 200, r);
  });

  // Novedades: marcar o quitar varias de golpe
  on('POST', '/novedades', async (req, res) => {
    const b = await body(req), nv = ctx.novedades();
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(id => fs.existsSync(path.join(SONGS_DIR, safeName(id))));
    if (!ids.length) throw httpErr(400, 'No hay canciones seleccionadas');
    const now = Date.now();
    for (const id of ids) { if (b.on) nv[id] = nv[id] || now; else delete nv[id]; }
    ctx.saveNovedades();
    ev('songs', `${b.on ? 'Marcadas como Novedades' : 'Quitadas de Novedades'}: ${ids.length} ${ids.length === 1 ? 'canción' : 'canciones'}${ids.length <= 5 ? ' (' + ids.join(', ') + ')' : ''}`);
    json(res, 200, { ok: true, total: Object.keys(nv).length });
  });
  on('PATCH', '/songs/([^/]+)/header', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id), b = await body(req);
    if (!b.tags || typeof b.tags !== 'object') throw httpErr(400, 'Faltan los datos');
    setHeader(dir, b.tags);
    ev('songs', `Datos cambiados en «${id}»: ${Object.keys(b.tags).join(', ')}`);
    json(res, 200, { ok: true, header: headerOf(dir) });
  });
  on('POST', '/songs/([^/]+)/rename', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id), b = await body(req), to = safeName(b.to);
    const dest = path.join(SONGS_DIR, to);
    if (fs.existsSync(dest)) throw httpErr(409, 'Ya hay una canción con ese nombre de carpeta');
    fs.renameSync(dir, dest);
    try { if (fs.existsSync(verDir(id))) fs.renameSync(verDir(id), verDir(to)); } catch {}   // (las versiones del editor siguen a la canción)
    const nv = ctx.novedades();
    if (nv[id]) { nv[to] = nv[id]; delete nv[id]; ctx.saveNovedades(); }
    const rec = ctx.records();
    for (const k of ['plays', 'songs']) if (rec[k] && rec[k][id] !== undefined) { rec[k][to] = rec[k][id]; delete rec[k][id]; }
    ctx.saveRecords(); ctx.songsChanged();
    ev('songs', `Carpeta renombrada: «${id}» → «${to}»`);
    json(res, 200, { ok: true, id: to });
  });
  on('POST', '/songs/([^/]+)/retire', (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id);
    fs.mkdirSync(RETIRED_DIR, { recursive: true });
    let dest = path.join(RETIRED_DIR, id);
    if (fs.existsSync(dest)) dest += ' (' + Date.now() + ')';
    fs.renameSync(dir, dest);
    const nv = ctx.novedades();
    if (nv[id]) { delete nv[id]; ctx.saveNovedades(); }
    ctx.songsChanged();
    ev('songs', `Canción retirada: «${id}»`);
    json(res, 200, { ok: true });
  });
  on('GET', '/retired', (req, res) => {
    let l = [];
    try { l = fs.readdirSync(RETIRED_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => { const dir = path.join(RETIRED_DIR, d.name); const h = headerOf(dir); return { id: d.name, title: h.TITLE || d.name, artist: h.ARTIST || '', size: dirSize(dir), at: fs.statSync(dir).mtimeMs }; }); } catch {}
    json(res, 200, l.sort((a, b) => b.at - a.at));
  });
  on('POST', '/retired/([^/]+)/restore', (req, res, m) => {
    const id = safeName(decodeURIComponent(m[1])), src = path.join(RETIRED_DIR, id);
    if (!fs.existsSync(src)) throw httpErr(404, 'No está entre las retiradas');
    const to = id.replace(/ \(\d+\)$/, '');
    if (fs.existsSync(path.join(SONGS_DIR, to))) throw httpErr(409, 'Ya hay una canción activa con ese nombre');
    fs.renameSync(src, path.join(SONGS_DIR, to));
    ctx.songsChanged();
    ev('songs', `Canción restaurada: «${to}»`);
    json(res, 200, { ok: true });
  });
  on('DELETE', '/retired/([^/]+)', async (req, res, m) => {
    const id = safeName(decodeURIComponent(m[1])), src = path.join(RETIRED_DIR, id);
    if (!fs.existsSync(src)) throw httpErr(404, 'No está entre las retiradas');
    await fsp.rm(src, { recursive: true, force: true });
    ev('songs', `Canción borrada definitivamente: «${id}»`);
    json(res, 200, { ok: true });
  });
  // Ficheros: subir (cuerpo en bruto, hasta 60 MB) y borrar. Subir a una carpeta que no existe crea la canción.
  on('PUT', '/songs/([^/]+)/files/([^/]+)', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), name = safeName(decodeURIComponent(m[2]));
    if (!/\.(txt|mp3|m4a|ogg|opus|wav|jpe?g|png|webp|mp4|webm|json)$/i.test(name)) throw httpErr(400, 'Tipo de fichero no admitido');
    const dir = songDir(id, false);
    const buf = await readRaw(req, 60 * 1024 * 1024);
    const nueva = !fs.existsSync(dir);
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(path.join(dir, name), buf);   // (un .mp3 de 60 MB a medias no se sirve nunca a una tele)
    ctx.songsChanged();
    ev('songs', `${nueva ? 'Canción nueva' : 'Fichero subido'}: «${id}/${name}» (${(buf.length / 1048576).toFixed(1)} MB)`);
    json(res, 200, { ok: true });
  });
  on('DELETE', '/songs/([^/]+)/files/([^/]+)', (req, res, m) => {
    // (también los que empiezan por punto: .DS_Store y ._Cancion.mp3 que deja un Mac al copiar)
    const id = decodeURIComponent(m[1]), dir = songDir(id), name = decodeURIComponent(m[2]).normalize('NFC');
    if (!name || name.length > 200 || name === '.' || name === '..' || /[\/\\\0]/.test(name)) throw httpErr(400, 'Nombre no válido');
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) throw httpErr(404, 'No existe ese fichero');
    fs.unlinkSync(f);
    ctx.songsChanged();
    ev('songs', `Fichero borrado: «${id}/${name}»`);
    json(res, 200, { ok: true });
  });
  on('POST', '/songs/([^/]+)/megamix', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id), b = await body(req);
    let r;
    if (b.mode === 'none') {
      for (const f of ['megamix.json', 'megamix.mp3']) try { fs.unlinkSync(path.join(dir, f)); } catch {}
      r = { code: 0, out: 'fuera del Megamix' };
    } else if (b.mode === 'manual') {
      const a = Math.round(+b.start), e = Math.round(+b.end);
      if (!(a >= 0 && e - a >= 5000 && e - a <= 90000)) throw httpErr(400, 'El estribillo tiene que durar entre 5 y 90 segundos');
      const audio = audioOf(headerOf(dir));
      if (!audio || !fs.existsSync(path.join(dir, audio))) throw httpErr(400, 'La canción no tiene audio');
      const off = Math.max(0, a - 5000);
      // (se corta a un temporal y se renombra al final: nunca queda un megamix.mp3 a medias)
      r = await conCerrojo(dir, () => run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, audio), '-ss', (off / 1000).toFixed(3), '-to', ((e + 3000) / 1000).toFixed(3), '-vn', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', path.join(dir, 'megamix.mp3.tmp')]));
      if (r.code === 0) { fs.renameSync(path.join(dir, 'megamix.mp3.tmp'), path.join(dir, 'megamix.mp3')); writeJson(path.join(dir, 'megamix.json'), { file: 'megamix.mp3', offset: off, start: a, end: e, origen: 'manual' }); r.out = 'ok · estribillo manual ' + Math.round((e - a) / 1000) + ' s'; }
      else try { fs.unlinkSync(path.join(dir, 'megamix.mp3.tmp')); } catch {}
    } else {
      r = await conCerrojo(dir, () => py('import megamix; print(megamix.preparar(d, forzar=True, auto=True))', dir));
    }
    ctx.songsChanged();
    ev('songs', `Megamix de «${id}»: ${r.code === 0 ? r.out : 'error'}`);
    if (r.code !== 0) throw httpErr(500, 'No se pudo: ' + (r.err || r.out));
    json(res, 200, { ok: true, result: r.out, megamix: readJson(path.join(dir, 'megamix.json'), null) });
  });
  on('POST', '/songs/([^/]+)/normalize', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id);
    const r = await conCerrojo(dir, () => py('import normalizar; print(normalizar.una(d)[1])', dir));
    ctx.songsChanged();
    ev('songs', `Volumen de «${id}»: ${r.code === 0 ? r.out : 'error'}`);
    if (r.code !== 0) throw httpErr(500, 'No se pudo: ' + (r.err || r.out));
    json(res, 200, { ok: true, result: r.out });
  });
  on('POST', '/songs/([^/]+)/measure', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id), audio = audioOf(headerOf(dir));
    if (!audio) throw httpErr(400, 'Sin audio');
    const r = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', path.join(dir, audio), '-vn', '-af', 'loudnorm=I=-12:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']);
    const j = (r.err.match(/\{[^{}]*"input_i"[^{}]*\}/s) || [])[0];
    if (!j) throw httpErr(500, 'No se pudo medir');
    json(res, 200, JSON.parse(j));
  });

  // --- carátulas
  on('GET', '/covers/search', async (req, res, m, url) => {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
    if (!q) throw httpErr(400, 'Escribe qué buscar');
    json(res, 200, await coverSearch(q, url.searchParams.get('src')));
  });
  on('POST', '/songs/([^/]+)/cover', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id), b = await body(req);
    if (b.file) {   // una imagen que ya está en la carpeta
      const f = safeName(b.file);
      if (!fs.existsSync(path.join(dir, f)) || !/\.(jpe?g|png|webp)$/i.test(f)) throw httpErr(400, 'Esa imagen no está en la carpeta');
      setCover(dir, f, { origen: 'carpeta' });
    } else if (b.restore) {
      const c = readJson(path.join(dir, 'caratula.json'), null);
      if (!c || !c.antes) throw httpErr(400, 'No hay ninguna portada anterior guardada');
      setHeader(dir, { COVER: c.antes });
      fs.unlinkSync(path.join(dir, 'caratula.json'));
    } else {
      const u = new URL(String(b.url || ''));
      const src = /(^|\.)mzstatic\.com$/.test(u.hostname) ? 'itunes' : /(^|\.)dzcdn\.net$/.test(u.hostname) ? 'deezer' : null;
      if (u.protocol !== 'https:' || !src) throw httpErr(400, 'Solo portadas de iTunes o Deezer');
      const r = await fetch(u, { signal: AbortSignal.timeout(20000), redirect: 'error' });   // (sin seguir redirecciones: la portada viene de donde se ha dicho)
      if (!r.ok) throw httpErr(502, 'No se pudo descargar la portada');
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000 || buf.length > 8e6) throw httpErr(502, 'La portada descargada no es válida');
      const name = 'cover-' + src + '.jpg';
      fs.writeFileSync(path.join(dir, name), buf);
      setCover(dir, name, { origen: src, disco: b.album || null, año: b.year || null, url: u.href });
    }
    ctx.songsChanged();
    ev('songs', `Portada cambiada en «${id}»${b.restore ? ' (vuelta a la anterior)' : b.album ? ` (${b.album})` : ''}`);
    json(res, 200, { ok: true });
  });
  on('PUT', '/songs/([^/]+)/cover-upload', async (req, res, m) => {
    const id = decodeURIComponent(m[1]), dir = songDir(id);
    const type = String(req.headers['content-type'] || '');
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
    if (!ext) throw httpErr(400, 'Sube una imagen JPG, PNG o WebP');
    const buf = await readRaw(req, 8 * 1024 * 1024);
    for (const e of ['jpg', 'png', 'webp']) try { fs.unlinkSync(path.join(dir, 'cover-propia.' + e)); } catch {}
    fs.writeFileSync(path.join(dir, 'cover-propia.' + ext), buf);
    setCover(dir, 'cover-propia.' + ext, { origen: 'propia' });
    ctx.songsChanged();
    ev('songs', `Portada propia subida en «${id}»`);
    json(res, 200, { ok: true });
  });

  // --- récords
  on('GET', '/records', (req, res) => json(res, 200, ctx.records()));
  on('DELETE', '/records/song/([^/]+)', (req, res, m) => {
    const id = decodeURIComponent(m[1]), rec = ctx.records();
    delete rec.songs[id]; ctx.saveRecords();
    ev('records', `Récord borrado de «${id}»`);
    json(res, 200, { ok: true });
  });
  on('DELETE', '/records/plays/([^/]+)', (req, res, m) => {
    const id = decodeURIComponent(m[1]), rec = ctx.records();
    delete rec.plays[id]; ctx.saveRecords();
    ev('records', `Contador de veces cantada a cero en «${id}»`);
    json(res, 200, { ok: true });
  });
  on('DELETE', '/records/singer/([^/]+)', (req, res, m) => {
    const name = decodeURIComponent(m[1]), rec = ctx.records();
    delete rec.singers[name];
    for (const [k, v] of Object.entries(rec.songs)) if (v && v.name === name) delete rec.songs[k];
    ctx.saveRecords();
    ev('records', `Cantante borrado del Salón de la fama: ${name}`);
    json(res, 200, { ok: true });
  });
  on('POST', '/records/rename-singer', async (req, res) => {
    const b = await body(req), rec = ctx.records();
    const from = String(b.from || ''), to = String(b.to || '').trim().slice(0, 16);
    if (!rec.singers[from] || !to) throw httpErr(400, 'Datos no válidos');
    const a = rec.singers[from], t = rec.singers[to];
    rec.singers[to] = t ? { songs: a.songs + t.songs, best: Math.max(a.best, t.best), streak: Math.max(a.streak, t.streak) } : a;
    delete rec.singers[from];
    for (const v of Object.values(rec.songs)) if (v && v.name === from) v.name = to;
    ctx.saveRecords();
    ev('records', `Cantante renombrado: ${from} → ${to}${t ? ' (fusionado)' : ''}`);
    json(res, 200, { ok: true });
  });
  on('POST', '/records/reset', async (req, res) => {
    const b = await body(req);
    if (b.confirm !== 'BORRAR') throw httpErr(400, 'Escribe BORRAR para confirmar');
    const rec = ctx.records();
    writeJson(path.join(DATA_DIR, `records-copia-${Date.now()}.json`), rec);
    rec.songs = {}; rec.singers = {}; if (b.plays) rec.plays = {};
    ctx.saveRecords();
    ev('records', 'Salón de la fama vaciado (copia guardada en los datos)');
    json(res, 200, { ok: true });
  });

  // ===================================================================== API del trabajador (clave propia, no Touch ID)
  function workerOk(req) {
    const w = readJson(WORKER_FILE, null), m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
    return !!(w && m && crypto.timingSafeEqual(Buffer.from(hash(m[1])), Buffer.from(w.hash)));
  }
  const normKey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, '');
  async function instalar(j) {
    const src = p => jobPath(j.id, p);
    if (j.kind === 'spotify') {
      // Descargada: queda como BORRADOR de creación (falta la letra), con sus datos y la carátula de Spotify
      const meta = readJson(src('meta.json'), {});
      Object.assign(j, { titulo: meta.titulo || j.titulo, artista: meta.artista || '', album: meta.album || '', anio: meta.anio || '', duracion: meta.duracion || 0 });
      const k = normKey(j.artista) + '|' + normKey(j.titulo);
      const same = ctx.scanSongs(true).find(s => normKey(s.artist) + '|' + normKey(s.title) === k);
      j.dup = same ? same.id : null;
      j.state = 'borrador';
      ev('songs', `Descargada de Spotify: «${j.artista} - ${j.titulo}» (borrador)${j.dup ? ' · ya existe en la biblioteca' : ''}`);
      // La letra se busca en segundo plano (LRCLIB, Genius, songlyrics pueden tardar más de un minuto entre reintentos):
      // el trabajador recibe su respuesta enseguida y no da por fallida la descarga por un tiempo de espera agotado
      (async () => {
        try {
          const l = await buscarLetra(j.artista, j.titulo, j.duracion);
          // Puede haber pasado un minuto: se relee el trabajo de disco y solo se toca si sigue siendo un borrador sin
          // letra (si el admin ya escribió la suya o pulsó «Continuar», no se pisa nada)
          const cur = readJson(jobPath(j.id), null);
          if (!l || !cur || cur.state !== 'borrador' || fs.existsSync(src('letra.txt'))) return;
          fs.writeFileSync(src('letra.txt'), l.texto); if (l.lrc) fs.writeFileSync(src('letra.lrc'), l.lrc);
          jobPut({ ...cur, letraFuente: l.fuente + (l.sincronizada ? ' (sincronizada)' : '') });
        } catch {}
      })();
      return;
    }
    if (j.kind === 'analizar') {
      const dir = songDir(j.song);
      for (const f of VOZ_FILES) if (fs.existsSync(src(f))) fs.copyFileSync(src(f), path.join(dir, f));
      ev('songs', `Voz analizada: «${j.song}»`);
      return;
    }
    // Volver a encajar una canción que sigue en preparación: mismas carpeta y portada; la versión anterior se guarda
    if (j.reencajar && j.song && fs.existsSync(path.join(SONGS_DIR, j.song, 'borrador.json'))) {
      const dir = path.join(SONGS_DIR, j.song), f = chartFile(dir), vd = verDir(j.song);
      fs.mkdirSync(vd, { recursive: true });
      fs.copyFileSync(path.join(dir, f), path.join(vd, new Date().toISOString().replace(/[:.]/g, '-') + '-antes-de-reencajar.txt'));
      // la cabecera de la canción (portada, año, Megamix…) se conserva; solo cambian GAP, BPM y las notas
      const nuevo = readText(src('cancion.txt')), viejo = readText(path.join(dir, f));
      const cab = viejo.split(/\r?\n/).filter(l => /^#/.test(l) && !/^#(GAP|BPM|RELATIVE):/i.test(l));
      const de = nuevo.split(/\r?\n/), cuerpo = de.filter(l => !/^#/.test(l)), gb = de.filter(l => /^#(GAP|BPM):/i.test(l));
      writeAtomic(path.join(dir, f), [...cab, ...gb, ...cuerpo].join('\r\n'));
      for (const x of VOZ_FILES) if (fs.existsSync(src(x))) copyAtomic(src(x), path.join(dir, x));
      j.reencajar = false;
      ctx.songsChanged();
      ev('songs', `Vuelta a encajar: «${j.song}» (la versión anterior está en Versiones)`);
      py('import megamix; print(megamix.preparar(d, forzar=True, auto=True))', dir).catch(() => {});
      return;
    }
    const folder = fs.existsSync(path.join(SONGS_DIR, j.folder)) ? folderFor(j.artista, j.titulo) : j.folder;
    const dir = path.join(SONGS_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });
    copyAtomic(src('entrada.mp3'), path.join(dir, j.audioName));
    copyAtomic(src('cancion.txt'), path.join(dir, folder + '.txt'));
    for (const f of VOZ_FILES) if (fs.existsSync(src(f))) copyAtomic(src(f), path.join(dir, f));
    writeJson(path.join(dir, 'borrador.json'), { trabajo: j.id, creada: Date.now() });
    j.song = folder;
    ctx.songsChanged();
    ev('songs', `Canción creada (borrador): «${folder}»`);
    // Portada (la de Spotify si viene de allí; si no, la primera de iTunes), volumen igualado y Megamix: en segundo plano
    const portadaSpotify = fs.existsSync(src('portada.jpg'));
    if (portadaSpotify) { fs.copyFileSync(src('portada.jpg'), path.join(dir, 'cover-spotify.jpg')); setCover(dir, 'cover-spotify.jpg', { origen: 'spotify', disco: j.album || null, año: j.anio || null }); }
    (async () => {
      if (!portadaSpotify) try {
        const r = (await coverSearch(`${j.artista} ${j.titulo}`, 'itunes'))[0];
        if (r) {
          const buf = Buffer.from(await (await fetch(r.art, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
          if (buf.length > 2000) { fs.writeFileSync(path.join(dir, 'cover-itunes.jpg'), buf); setCover(dir, 'cover-itunes.jpg', { origen: 'itunes', disco: r.album, año: r.year, url: r.art }); }
        }
      } catch {}
      await conCerrojo(dir, () => py('import normalizar; print(normalizar.una(d)[1])', dir)).catch(() => {});
      await conCerrojo(dir, () => py('import megamix; print(megamix.preparar(d, forzar=True, auto=True))', dir)).catch(() => {});
      ctx.songsChanged();
    })();
  }
  const wroutes = [];
  const won = (method, pattern, fn) => wroutes.push({ method, re: new RegExp('^/api/worker' + pattern + '$'), fn });
  // Trabajos viejos: lo que queda en data/trabajos/ (audio de entrada, voz, partitura) solo sirve para «volver a
  // encajar» una canción en preparación. A los 30 días, si ya no está en preparación, se borra
  function limpiarTrabajos() {
    try {
      for (const j of jobsAll()) {
        if (!['hecho', 'error'].includes(j.state) || Date.now() - (j.finished || j.updated || j.created || 0) < 30 * 86400e3) continue;
        if (j.song && fs.existsSync(path.join(SONGS_DIR, j.song, 'borrador.json'))) continue;
        fs.rmSync(path.join(JOBS, safeName(j.id)), { recursive: true, force: true });
      }
    } catch (e) { console.error('trabajos: no se pudieron limpiar', e.message); }
  }
  setTimeout(limpiarTrabajos, 60e3).unref(); setInterval(limpiarTrabajos, 6 * 3600e3).unref();
  won('POST', '/next', async (req, res) => {
    const b = await body(req);
    // Si el trabajador reaparece tras más de un minuto callado con un trabajo a medias, es que se reinició: el trabajo
    // vuelve a la cola ahora y no a los 20 min
    if (worker.job && worker.seen && Date.now() - worker.seen > 60e3) {
      const x = jobsAll().find(j => j.id === worker.job);
      if (x && x.state === 'procesando') { x.retries = (x.retries || 0) + 1; x.state = x.retries > 1 ? 'error' : 'pendiente'; x.msg = 'El trabajador se reinició: vuelve a la cola'; if (x.state === 'error') x.error = 'El trabajador se ha caído dos veces con este trabajo'; jobPut(x); }
      worker.job = null;
    }
    worker = { seen: Date.now(), host: String(b.host || '').slice(0, 60), job: worker.job, version: String(b.version || '').slice(0, 20) };
    // Un trabajo que lleva 20 min sin dar señales (el trabajador se reinició a medias) vuelve a la cola, una vez:
    // si vuelve a pasar, se da por fallido (si no, un audio que revienta al trabajador se repetiría sin fin)
    for (const x of jobsAll()) if (x.state === 'procesando' && Date.now() - (x.updated || 0) > 20 * 60e3) {
      x.retries = (x.retries || 0) + 1;
      if (x.retries > 1) { x.state = 'error'; x.error = 'El trabajador se ha caído dos veces con este trabajo (¿audio demasiado largo?)'; ev('songs', `Error en el trabajo «${x.artista} - ${x.titulo}»: ${x.error}`); }
      else { x.state = 'pendiente'; x.msg = 'Vuelve a la cola'; }
      jobPut(x);
    }
    const pend = jobsAll().reverse().filter(x => x.state === 'pendiente');
    const j = pend.find(x => x.kind === 'spotify') || pend[0];   // las descargas de Spotify son rápidas: primero
    if (!j) return json(res, 200, {});
    const out = { ...j };
    if (j.kind === 'crear') {
      // (la letra se lee antes de marcarlo «procesando»: si falta, el trabajo queda en error y no en el limbo)
      try { out.letra = fs.readFileSync(jobPath(j.id, 'letra.txt'), 'utf8'); } catch { j.state = 'error'; j.error = 'Falta la letra del trabajo'; jobPut(j); return json(res, 200, {}); }
      try { out.lrc = fs.readFileSync(jobPath(j.id, 'letra.lrc'), 'utf8'); } catch {}
    }
    j.state = 'procesando'; j.started = Date.now(); j.progress = 0; j.msg = 'Empezando'; j.worker = worker.host; jobPut(j);
    worker.job = j.id;
    Object.assign(out, { state: j.state, started: j.started, progress: 0, msg: j.msg, worker: j.worker });
    json(res, 200, out);
  });
  won('GET', '/jobs/([^/]+)/input', (req, res, m) => {
    const j = jobGet(m[1]);
    let f;
    if (j.kind === 'crear') f = jobPath(j.id, 'entrada.mp3');
    else { const dir = songDir(j.song), a = audioOf(headerOf(dir)); f = a ? path.join(dir, a) : ''; }
    if (!fs.existsSync(f)) throw httpErr(404, 'Falta el audio');
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': fs.statSync(f).size });
    fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
  });
  won('POST', '/jobs/([^/]+)/progress', async (req, res, m) => {
    const j = jobGet(m[1]), b = await body(req);
    j.progress = Math.max(0, Math.min(100, +b.p || 0)); j.msg = String(b.msg || '').slice(0, 200); jobPut(j);
    worker.seen = Date.now();
    json(res, 200, { ok: true, cancel: j.state !== 'procesando' });
  });
  won('PUT', '/jobs/([^/]+)/result/([^/]+)', async (req, res, m) => {
    const j = jobGet(m[1]), name = decodeURIComponent(m[2]);
    if (!['cancion.txt', ...VOZ_FILES, 'entrada.mp3', 'portada.jpg', 'meta.json'].includes(name)) throw httpErr(400, 'Fichero no admitido');
    fs.writeFileSync(jobPath(j.id, name), await readRaw(req, 40 * 1024 * 1024));
    json(res, 200, { ok: true });
  });
  won('POST', '/jobs/([^/]+)/done', async (req, res, m) => {
    const j = jobGet(m[1]), b = await body(req);
    worker.job = null; worker.seen = Date.now();
    if (b.ok) {
      try { await instalar(j); if (j.state !== 'borrador') j.state = 'hecho'; j.progress = 100; j.msg = String(b.msg || 'Hecho').slice(0, 200); }
      catch (e) { j.state = 'error'; j.error = 'Al instalar: ' + e.message; }
    } else { j.state = 'error'; j.error = String(b.error || 'Error').slice(0, 2000); }
    j.finished = Date.now(); jobPut(j);
    if (j.state === 'error') ev('songs', `Error en el trabajo «${j.artista} - ${j.titulo}»: ${j.error.slice(0, 120)}`);
    json(res, 200, { ok: true });
  });

  // ===================================================================== entrada HTTP
  const PAGE = { '/': 'index.html', '/admin.css': 'admin.css', '/admin.js': 'admin.js', '/webauthn.js': 'webauthn.js', '/editor.js': 'editor.js', '/editor.css': 'editor.css' };
  async function handle(req, res, url) {
    if (!isAdminHost(req.headers.host)) {
      if (url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/api/worker/')) { json(res, 404, { error: 'No encontrado' }); return true; }
      return false;
    }
    if (url.pathname.startsWith('/api/worker/')) {
      for (const r of wroutes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re); if (!m) continue;
        try { if (!workerOk(req)) throw httpErr(401, 'Clave del trabajador no válida'); await r.fn(req, res, m, url); }
        catch (e) { if (!res.headersSent) json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message || 'Error' }); if (!e.code) console.error('trabajador:', e); }
        return true;
      }
      json(res, 404, { error: 'No encontrado' }); return true;
    }
    if (!url.pathname.startsWith('/api/admin/')) {
      // Canciones: con sesión de admin se pueden escuchar y ver aquí; el resto de ficheros del juego, como en la web
      // Ficheros del juego (también la app de la tele, para la vista previa del editor)
      if (/^\/(songs|assets|vendor|audio|js|tv|app|fonts)\//.test(url.pathname) || ['/app', '/api/songs', '/api/records', '/api/health'].includes(url.pathname)) return false;
      const f = PAGE[url.pathname];
      if (!f) { res.writeHead(302, { location: '/' }); res.end(); return true; }
      const file = path.join(WEB_DIR, 'admin', f);
      const type = f.endsWith('.css') ? 'text/css; charset=utf-8' : f.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
      res.writeHead(200, {
        'content-type': type, 'cache-control': 'no-cache', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow',
        'content-security-policy': "default-src 'self'; img-src 'self' data: blob: https://*.mzstatic.com https://*.dzcdn.net; media-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
      });
      // La página lleva la versión en las direcciones de sus ficheros: cada despliegue obliga a bajarlos de nuevo
      if (f === 'index.html') { try { res.end(fs.readFileSync(file, 'utf8').replaceAll('%%V%%', versionNow())); } catch { res.end(); } return true; }
      fs.createReadStream(file).on('error', () => res.end()).pipe(res);
      return true;
    }
    const sub = url.pathname;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = sub.match(r.re);
      if (!m) continue;
      try {
        if (!r.open) {
          if (!sessionOf(req)) throw httpErr(401, 'Entra con Touch ID');
          // Las peticiones que cambian algo tienen que venir de la propia página (además de la cookie SameSite=Strict)
          if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== originOf(req)) throw httpErr(403, 'Origen no permitido');
        }
        await r.fn(req, res, m, url);
      } catch (e) {
        if (!res.headersSent) json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message || 'Error' });
        if (!e.code) console.error('admin:', e);
      }
      return true;
    }
    json(res, 404, { error: 'No encontrado' });
    return true;
  }

  return { handle, isAuthed, ev, count, peaks, flush };
};
