// Puente entre el diseño de la tele (Gramola TV.dc.html, intacto) y lo real:
// sala y móviles (WebSocket), canciones UltraStar, audio, voz de los móviles, récords, ajustes,
// calibración, música de menús y avisos. tools/build-tv.py inserta en el diseño unos enganches que llaman aquí.
'use strict';
window.GR = (() => {
  const COLORS = ['#FF4FA3', '#3FD0FF', '#FFD23F', '#7CFF6B', '#B38CFF', '#FF8A3D', '#4FFFD8', '#FF5A5A'];
  const SHAPES = ['●', '▲', '■', '◆', '★', '⬢', '♥', 'ϟ'];
  const CV = [['#201e1d', '#ec3013', '#f3f2f2'], ['#F2C230', '#ec3013', '#201e1d'], ['#2FA9D6', '#201e1d', '#201e1d'], ['#d7d3d3', '#201e1d', '#201e1d'], ['#ec3013', '#F2C230', '#f3f2f2'], ['#2E6B55', '#eae7e7', '#f3f2f2']];
  const SL = 0.04;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const SS = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  };

  // Arrays que el diseño usa como constantes: se rellenan con lo real (mismo objeto, contenido nuevo)
  const PLAYERS = COLORS.map((c, i) => ['', c, SHAPES[i], null, false, false]); // [nombre, color, forma, id, bot, online]
  // Relleno mientras cargan (el diseño lee SONGS[songSel] en algunas pantallas)
  const SONGS = [{ id: '', title: '', artist: '', dur: '', year: 0, lang: '', diff: 1, duo: false, rec: '—', plays: 0, cv: CV[0], genre: '', song: { lines: [], tracks: [[]] } }];
  const REC2 = [], REC3 = [];
  const LANGS = ['Todos'], DECS = ['Todas'], GENS = ['Todos'];

  const G = {
    PLAYERS, SONGS, REC2, REC3, LANGS, DECS, GENS,
    g: null, net: null, room: null, token: null, players: [],
    charts: new Map(), loaded: 0, toLoad: 1, ready: false,
    frames: {}, audio: null, clock: null,
    stats: { resets: 0, steps: [], seeks: 0 },
  };
  const g = () => G.g || window.__g;

  // ------------------------------------------------------------------ ajustes guardados
  // Ajustes guardados: cada valor dentro de su rango (un localStorage tocado a mano no deja la pantalla en blanco)
  G.loadSettings = def => {
    const s = { ...def, ...LS.get('gramola-ajustes', {}) }, R = { diff: [0, 2], delay: [0, 400], music: [0, 10], fx: [0, 10], trail: [0, 1], lyr: [0, 1], lang: [0, 1], voz: [0, 2], vozModo: [0, 2] };
    for (const k in R) { const v = Number(s[k]); s[k] = Number.isFinite(v) ? Math.max(R[k][0], Math.min(R[k][1], Math.round(v))) : def[k]; }
    return s;
  };
  let lastSettings = '';
  function persistSettings(st) {
    const j = JSON.stringify(st);
    if (j !== lastSettings) { lastSettings = j; LS.set('gramola-ajustes', st); applyVolumes(); vozAplicar(st); }
  }

  // ------------------------------------------------------------------ red
  // Vista previa del editor del admin (/app/?preview=1, dentro de un iframe): sin sala ni móviles; canta la canción
  // que mande el editor (aunque no esté guardada) desde el punto que diga, con pausa.
  G.preview = /[?&]preview=1/.test(location.search);
  async function connect() {
    if (G.preview) { loadSongs(); return; }
    const { Net } = await import('/js/net.js');
    G.net = new Net(onMessage, st => {
      G.netOk = st === 'open';
      if (st === 'open') { G.lostAt = 0; const c = g(); if (c && (c.state.err === 'server' || c.state.err === 'lost')) c.setState({ err: null, errBusy: false }); }
      else if (!G.lostAt) G.lostAt = performance.now();
    });
    // La sala se recuerda en la pestaña (recarga) y, durante 3 min, en el aparato (reinicio de la app de la tele)
    const recordada = () => { const s = LS.get('g-sala', null); return s && s.code && s.token && Date.now() - (+s.at || 0) < 3 * 60e3 ? s : null; };
    G.net.connect(() => { const r = recordada(); return { type: 'host', code: SS.get('g-room') || (r && r.code), token: SS.get('g-token') || (r && r.token) }; });
  }

  function olvidarSala() {
    G.room = null; G.token = null;
    try { sessionStorage.removeItem('g-room'); sessionStorage.removeItem('g-token'); localStorage.removeItem('g-sala'); } catch {}
  }
  function onMessage(m) {
    const c = g();
    if (m.type === 'room') {
      // «Sala perdida» solo si el código cambia sin haberlo pedido (Ajustes → Nuevo código lo pide a propósito)
      const lost = (G.room && G.room !== m.code && !m.recovered && !G.expectNew) || !!G.cerradaDesdeAdmin;
      if (lost) G.lostFrom = G.room || G.lostFrom || null;
      const tokenCambiado = !!G.token && G.token !== m.token;   // (con «Nuevo código» las direcciones de audio llevan ?k= nuevo)
      G.expectNew = false; G.cerradaDesdeAdmin = false;
      G.room = m.code; G.token = m.token;
      SS.set('g-room', m.code); SS.set('g-token', m.token);
      LS.set('g-sala', { code: m.code, token: m.token, at: Date.now() });   // (si la app de la tele se reinicia, no solo se recarga)
      // Pase de tele (cookie) para poder leer las canciones; después, cargarlas. Si la petición falla (red a medias al
      // arrancar) se reintenta con espera creciente: si no, la tele se quedaba en «Cargando… 95 %» para siempre
      const pase = (wait = 1000) => fetch('/api/tv-pass', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: m.code, token: m.token }) })
        .then(r => { if (r.ok) { if (!G.ready || lost || tokenCambiado) loadSongs(); } else if (r.status !== 403) throw new Error(); })
        .catch(() => { if (G.room === m.code) setTimeout(() => pase(Math.min(8000, wait * 2)), wait); });
      pase();
      setPlayers(m.players, true);
      if (c) c.setState({ room: m.code });
      if (lost && c) c.setState({ err: 'lost' });
    } else if (m.type === 'players') setPlayers(m.players);
    else if (m.type === 'pitch') onPitch(m);
    else if (m.type === 'photo') {
      // Como URL blob: (la plantilla del diseño trocea los estilos por «;» y una data: URL lleva uno)
      if (G.photos[m.p]) URL.revokeObjectURL(G.photos[m.p]);
      G.photos[m.p] = null;
      if (m.data) fetch(m.data).then(r => r.blob()).then(b => { G.photos[m.p] = URL.createObjectURL(b); const cc = g(); cc && cc.setState({}); }).catch(() => {});
      else if (c) c.setState({});
    }
    else if (m.type === 'input') {
      const k = { up: 'u', down: 'd', left: 'l', right: 'r', ok: 'ok', back: 'back', y: 'y', x: 'x' }[m.key];
      // En la sala, Y añade un simulado y X echa al último: eso solo desde el mando de la tele, no desde un móvil
      if (k && c && !(c.state.screen === 'lobby' && (k === 'y' || k === 'x'))) c.act(k);
    } else if (m.type === 'full-attempt') { if (c) { if (c.state.screen === 'sing') c.toast(`${String(m.name || 'Alguien').slice(0, 16)} ha intentado entrar: la sala está llena`); else c.setState({ err: 'full' }); } }
    // La sala se ha cerrado desde la administración: se pide otra (la pantalla avisa de que se ha perdido la sala)
    else if (m.type === 'closed') { olvidarSala(); G.cerradaDesdeAdmin = true; if (G.net) G.net.send({ type: 'host' }); }
    else if (m.type === 'replaced') {
      // Otra pantalla ha abierto esta misma sala (pestaña duplicada): esta deja de reclamarla, si no se la robarían
      // la una a la otra sin parar; al reconectar pedirá una sala nueva
      olvidarSala();
      if (c) c.toast('Esta sala se ha abierto en otra pantalla');
    }
    // El servidor no admite más salas ahora mismo: se avisa y se vuelve a pedir una al cabo de medio minuto
    else if (m.type === 'error' && m.code === 'busy') { olvidarSala(); if (c) c.toast(String(m.msg || 'El servidor está lleno; se vuelve a intentar enseguida').slice(0, 140)); setTimeout(() => { if (!G.room && G.net) G.net.send({ type: 'host' }); }, 30000); }
    // Órdenes desde la administración: un aviso en pantalla o recargar la app
    else if (m.type === 'admin') {
      if (m.action === 'reload') setTimeout(() => location.reload(), 300);
      else if (m.action === 'toast' && c && m.text) c.toast(String(m.text).slice(0, 140));
    }
  }

  // Jugadores reales → PLAYERS del diseño (en orden de llegada)
  function setPlayers(list, silent) {
    const c = g();
    const before = new Map(G.players.map(p => [p.id, p]));
    const idxAntes = new Map(G.players.map((p, i) => [p.id, i]));
    const order = G.players.map(p => p.id).filter(id => list.some(p => p.id === id));
    for (const p of list) if (!order.includes(p.id)) order.push(p.id);
    G.players = order.map(id => list.find(p => p.id === id));
    G.players.forEach((p, i) => {
      PLAYERS[i] = [p.name, COLORS[p.slot - 1], SHAPES[p.slot - 1], p.id, !!p.bot, !!p.online];
    });
    for (let i = G.players.length; i < 8; i++) PLAYERS[i] = ['', COLORS[i], SHAPES[i], null, false, false];
    if (!c) return;
    const upd = { count: G.players.length };
    // Equipos de Pásalo y filas de Preparar van por posición: si alguien se va, cada jugador conserva lo suyo
    const movido = G.players.some((p, i) => idxAntes.get(p.id) !== i);
    if (movido) {
      const re = (arr, def) => { const out = arr.slice(); G.players.forEach((p, i) => { const oi = idxAntes.get(p.id); out[i] = oi != null && arr[oi] !== undefined ? arr[oi] : def(i); }); return out; };
      if (c.state.party && Array.isArray(c.state.party.tOf)) upd.party = { ...c.state.party, tOf: re(c.state.party.tOf, i => i % (c.state.party.nT || 2)) };
      if (Array.isArray(c.state.setup) && c.state.setup.length) upd.setup = re(c.state.setup, i => c.state.setup[i] || { on: true, diff: c.state.settings.diff, side: i % 2 === 0 ? 0 : 2 });
    }
    G.players.forEach((p, i) => {
      const b = before.get(p.id);
      if (!b && !silent) { upd.justJ = i; c.toast(p.name + ' se ha unido'); clearTimeout(c.jT); c.jT = setTimeout(() => c.setState({ justJ: null }), 650); }
      else if (b && b.online && !p.online) {
        c.toast(p.name + ' se ha desconectado');
        if (c.state.screen !== 'sing') { G.micLost = p.name; upd.err = 'mic'; }
      }
    });
    for (const [id, b] of before) if (!G.players.some(p => p.id === id)) c.toast(b.name + ' ha salido de la sala');
    c.setState(upd);
  }

  // Fotos de los jugadores (cámara frontal del móvil): solo en memoria
  G.photos = {};
  G.photoOf = (id, col) => { const d = id && G.photos[id]; return d ? { ph: 'url("' + d + '") center / cover no-repeat', phw: 56, pho: '2px solid ' + (col || '#201e1d') } : { ph: 'none', phw: 0, pho: 'none' }; };
  G.isOff = i => i < G.players.length && !PLAYERS[i][5];
  G.addBot = c => { if (G.players.length >= 8) return c.setState({ err: 'full' }); G.net && G.net.send({ type: 'bot' }); };
  G.kickLast = c => {
    const p = G.players[G.players.length - 1];
    if (!p) return c.toast('No hay nadie en la sala');
    G.net.send({ type: 'kick', p: p.id });
  };
  G.newCode = c => { G.expectNew = true; G.net.send({ type: 'new-code' }); G.players = []; c.setState({ count: 0 }); c.toast('Sala nueva: los móviles deben volver a entrar'); };

  // Direcciones públicas: salen del dominio donde está la tele (no van escritas en el código).
  // El micro vive en el subdominio micro.; en pruebas locales (IP o localhost), en /m/index.html.
  const local = () => /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(location.hostname);
  G.webHost = () => location.hostname.replace(/^(www|micro)\./, '');
  G.microHost = () => local() ? location.host + '/m' : 'micro.' + G.webHost();
  G.microUrl = () => local() ? location.origin + '/m/index.html' : 'https://' + G.microHost() + '/';
  // ------------------------------------------------------------------ QR real de la sala
  let qrEl = null, qrFor = null;
  G.qr = el => { if (el) qrEl = el; drawQR(); return true; };
  function drawQR() {
    // Se recuerda por lienzo: el diseño crea un lienzo nuevo cada vez que se entra en la sala
    // (fuera de la sala el lienzo ya no está en la página: no se regenera el QR a cada fotograma)
    if (!qrEl || !qrEl.isConnected || !G.room || !window.qrcode || qrEl._qrFor === G.room) return;
    qrEl._qrFor = qrFor = G.room;
    const q = window.qrcode(0, 'H');   // corrección máxima: aguanta la «o» del logo en el centro
    q.addData(G.microUrl() + '?s=' + G.room);
    q.make();
    const n = q.getModuleCount(), S = qrEl.width, s = S / n, c = qrEl.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, S, S); c.fillStyle = '#201e1d';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) c.fillRect(Math.floor(x * s), Math.floor(y * s), Math.ceil(s), Math.ceil(s));
    // La «o» de Gramola en el centro: hueco blanco alineado a la rejilla (~20 % del ancho) y el símbolo en negro
    if (qrLogo) {
      let m = Math.round(n * 0.24); if ((n - m) % 2) m++;
      const o = (n - m) / 2 * s, w = m * s, pad = w * 0.12;
      c.fillStyle = '#fff'; c.fillRect(Math.floor(o), Math.floor(o), Math.ceil(w), Math.ceil(w));
      c.drawImage(qrLogo, o + pad, o + pad, w - 2 * pad, w - 2 * pad);
    } else qrEl._qrFor = null;   // aún cargando el símbolo: se vuelve a dibujar en cuanto llegue
  }
  // Símbolo de la marca en el negro del QR (tinta) para el centro
  let qrLogo = null;
  (() => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 300;
      const x = cv.getContext('2d'); x.drawImage(im, 0, 0, 300, 300);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = '#201e1d'; x.fillRect(0, 0, 300, 300);
      qrLogo = cv; if (qrEl) qrEl._qrFor = null; drawQR();
    };
    im.src = '/assets/logo/simbolo-claro.png';
  })();

  // ------------------------------------------------------------------ canciones
  // Títulos limpios para la tele: sin lo que va entre paréntesis o corchetes y con mayúscula al principio de cada
  // palabra, salvo las vocales sueltas «a e i o u» y la «y» (la primera palabra, siempre). El resto de cada palabra no se toca.
  G.cleanTitle = t => {
    let s = String(t || '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s+/g, ' ').trim();
    if (!s) s = String(t || '').trim();
    let first = true;
    return s.replace(/[^\s]+/g, w => {
      const m = w.match(/^([^\p{L}\p{N}]*)(\p{L})(.*)$/u);
      if (!m) { if (/\p{N}/u.test(w)) first = false; return w; }
      const [, pre, l, rest] = m;
      const suelta = !rest && /^[aeiouyAEIOUY]$/.test(l) && !pre;
      const out = first || !suelta ? pre + l.toLocaleUpperCase('es') + rest : pre + l.toLocaleLowerCase('es') + rest;
      first = false;
      return out;
    });
  };
  async function loadSongs() {
    let list = [];
    const K = G.token ? 'k=' + encodeURIComponent(G.token) : '';
    const withK = u => K ? u + (u.includes('?') ? '&' : '?') + K : u;
    G.withK = withK;
    try { list = await (await fetch(withK(G.preview ? '/api/songs?preparacion=1' : '/api/songs'), { cache: 'no-store' })).json(); } catch {}
    let rec = { songs: {}, singers: {}, plays: {} };
    try { rec = await (await fetch('/api/records', { cache: 'no-store' })).json(); } catch {}
    G.records = rec;
    const { parseUltraStar, decodeText } = await import('/js/ultrastar.js');
    G.toLoad = list.length + 1; G.loaded = 1;
    const out = [];
    // Las letras y notas se leen todas al arrancar (son ficheros pequeños): así la partida empieza al instante
    await Promise.all(list.map(async (e, i) => {
      try {
        // Rutas absolutas: la página del diseño usa <base href="/tv/">
        const txt = '/' + e.txt.replace(/^\//, '');
        if (e.cover) e.cover = withK('/' + e.cover.replace(/^\//, ''));
        const song = parseUltraStar(decodeText(await (await fetch(withK(txt))).arrayBuffer()));
        const base = txt.slice(0, txt.lastIndexOf('/') + 1);
        song.audioUrl = song.audio ? withK(base + encodeURIComponent(song.audio)) : null;
        song.sinVoz = e.sinVoz ? withK('/' + e.sinVoz.replace(/^\//, '')) : null;   // pre-procesada por el trabajador (Demucs)
        song.videoUrl = song.video ? base + encodeURIComponent(song.video) : null;
        if (song.audioUrl) out[i] = { e, song };
      } catch {}
      G.loaded++;
    }));
    SONGS.length = 0;
    out.filter(Boolean).forEach(({ e, song }) => {
      const h = [...e.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      SONGS.push({
        id: e.id, title: G.cleanTitle(e.title), artist: e.artist,
        dur: e.duration ? `${Math.floor(e.duration / 60)}:${String(e.duration % 60).padStart(2, '0')}` : '–',
        year: e.year || 0, lang: langName(e.language), diff: e.difficulty || 2, duo: !!e.duet || song.tracks.length > 1,
        rec: '—', plays: 0, genre: e.genre || '', entry: e, song, isNew: !!e.isNew, newAt: e.newAt || 0,
        cv: e.cover ? ['url("' + e.cover + '") center / cover no-repeat #201e1d', 'transparent', 'transparent'] : CV[h % CV.length],
      });
    });
    if (!SONGS.length) SONGS.push({ id: '', title: '', artist: '', dur: '', year: 0, lang: '', diff: 1, duo: false, rec: '—', plays: 0, cv: CV[0], genre: '', song: { lines: [], tracks: [[]] } });
    refreshRecords();
    // Filtros con lo que hay de verdad
    const uniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es'));
    LANGS.splice(1, LANGS.length, ...uniq(SONGS.map(s => s.lang)));
    GENS.splice(1, GENS.length, ...uniq(SONGS.map(s => s.genre)));
    DECS.splice(1, DECS.length, ...[...new Set(SONGS.filter(s => s.year).map(s => String(Math.floor(s.year / 10) * 10).slice(2)))].sort((a, b) => dec(a) - dec(b)));
    G.ready = true;
    const c = g();
    if (c) c.setState({ jq: G.jq(), songF: 0 });
    if (G.preview) previewReady();
  }
  function previewReady() {
    if (!g()) return setTimeout(previewReady, 200);
    parent.postMessage({ type: 'gramola-preview-ready' }, location.origin);
  }
  if (G.preview) addEventListener('message', async e => {
    if (e.origin !== location.origin || !e.data) return;
    const d = e.data, c = g();
    if (!c) return;
    if (d.type === 'gramola-preview') {
      const idx = SONGS.findIndex(s => s.id === d.id);
      if (idx < 0) return parent.postMessage({ type: 'gramola-preview-error', msg: 'La canción no está cargada' }, location.origin);
      if (d.txt) {   // lo que hay en el editor ahora mismo, aunque no esté guardado
        const { parseUltraStar } = await import('/js/ultrastar.js');
        const s = parseUltraStar(d.txt), old = SONGS[idx].song;
        s.audioUrl = old.audioUrl; s.videoUrl = null;
        SONGS[idx].song = s;
      }
      const P0 = PLAYERS[0];
      c.setState({ mode: 'sing', songSel: idx, paused: false, err: null, singers: [{ id: null, bot: false, name: d.name || 'Vista previa', color: P0[1], shape: P0[2], tol: 1, team: 0, part: 0 }] }, () => {
        c.startSing();
        const at = Math.max(0, (d.at || 0) / 1000);
        const go = () => { if (G.audio && G.audio.readyState >= 1) { G.audio.currentTime = at; } else setTimeout(go, 50); };
        if (at > 0.5) go();
      });
    } else if (d.type === 'gramola-preview-pause') {
      if (c.state.screen === 'sing' && !!c.state.paused !== !!d.paused) c.act('menu');
    } else if (d.type === 'gramola-preview-stop') {
      stopAudio(); c.chart = null; c.setState({ screen: 'menu', paused: false });
    }
  });
  const dec = d => (+d < 30 ? 2000 : 1900) + +d;
  G.decadeStart = d => dec(d);
  function langName(l) {
    const x = (l || '').toLowerCase();
    if (/espa|castell|spanish/.test(x)) return 'Castellano';
    if (/catal/.test(x)) return 'Català';
    if (/ingl|english/.test(x)) return 'Inglés';
    return l || '';
  }
  function refreshRecords() {
    G.songsRev = (G.songsRev || 0) + 1;   // (la lista de canciones del diseño se recalcula solo cuando cambia algo: biblioteca, récords o filtros)
    const R = G.records || { songs: {}, singers: {}, plays: {} };
    SONGS.forEach(s => {
      const r = R.songs[s.id];
      s.rec = r && r.score ? `${fmt(r.score)} · ${r.name}` : '—';
      s.plays = R.plays[s.id] || 0;
    });
    const best = name => {
      let b = null;
      for (const [id, r] of Object.entries(R.songs)) if (r.name === name && (!b || r.score > b.score)) b = { ...r, id };
      return b;
    };
    const sg = Object.entries(R.singers);
    REC2.splice(0, REC2.length, ...sg.sort((a, b) => b[1].songs - a[1].songs).slice(0, 8).map(([n, v]) => {
      const b = best(n);
      return [n, `${v.songs} ${v.songs === 1 ? 'canción' : 'canciones'}`, b ? `${fmt(b.score)} · ${b.title || ''}` : '—'];
    }));
    REC3.splice(0, REC3.length, ...sg.sort((a, b) => b[1].streak - a[1].streak).slice(0, 8).map(([n, v]) => {
      const b = best(n);
      return [n, `×${v.streak}`, b ? b.title || '' : '—'];
    }));
  }
  const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  G.jq = () => {
    const idx = SONGS.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx.slice(0, 5);
  };
  G.randSong = () => (SONGS.length ? Math.floor(Math.random() * SONGS.length) : 0);
  G.bootK = (ts, t0) => Math.min(Math.max(0, Math.min(1, (ts - t0) / 2600)), G.ready ? 1 : 0.95 * G.loaded / Math.max(1, G.toLoad));

  // ------------------------------------------------------------------ partitura UltraStar → formato del diseño
  G.chartFor = (skills, duo) => {
    const c = g();
    if (G.mega) return megaChart(c, skills);
    const S = SONGS[c.state.songSel];
    if (!S) return null;
    const song = S.song, K = skills.length;
    const duet = song.tracks.length > 1;
    const tracks = duo && duet ? [[song.tracks[0], [0]], [song.tracks[1], [1]]] : [[song.tracks[0], null]];
    // (las notas anteriores a #START no se cantan: fuera del carril y de la cuenta, que si no salían «Fallo» en ráfaga)
    const all = song.tracks[0].flatMap(l => l.notes).concat(duet && duo ? song.tracks[1].flatMap(l => l.notes) : []).filter(n => n.weight && !(song.start && n.end <= song.start));
    const lo = all.length ? Math.min(...all.map(n => n.midi)) : 60, hi = all.length ? Math.max(...all.map(n => n.midi)) : 72;
    const range = Math.max(12, hi - lo);
    const notes = [], phrases = [];
    for (const [lines, fixed] of tracks) {
      lines.forEach((l, li) => {
        // Canción normal en Dúo: las frases se reparten (una cada uno), como en el diseño
        const parts = fixed || (duo ? [li % 2] : [0, 1]);
        const p = { notes: [], start: l.start / 1000, end: l.end / 1000, parts };
        for (const u of l.notes) {
          if (song.start && u.end <= song.start) continue;
          const type = u.type === 'golden' ? 'gold' : u.type === 'free' ? 'free' : u.type === 'rap' || u.type === 'rapgolden' ? 'rap' : 'n';
          const dur = Math.max(0.06, (u.end - u.start) / 1000);
          const n = { s: u.text.replace(/~/g, ''),   // «~» = la sílaba anterior se alarga (marca de UltraStar, no se canta)
          p: u.midi - lo, midi: u.midi, start: u.start / 1000, dur, type, i: notes.length, q: [], off: [], parts };
          for (let k = 0; k < K; k++) { const r = Math.random(); n.q[k] = r < skills[k] ? 'good' : r < skills[k] + 0.2 ? 'partial' : 'miss'; n.off[k] = (Math.random() < 0.5 ? -1 : 1) * (1.8 + Math.random()); }
          if (type !== 'free') n.sl = Array.from({ length: K }, () => new Array(Math.max(1, Math.ceil(dur / SL))).fill(0));
          p.notes.push(n); notes.push(n);
        }
        if (p.notes.length) phrases.push(p);
      });
    }
    notes.sort((a, b) => a.start - b.start).forEach((n, i) => (n.i = i));
    phrases.sort((a, b) => a.start - b.start);
    const unitP = [0, 1].map(q => { let tot = 0; notes.forEach(n => { if (n.sl && n.parts.includes(q)) tot += Math.max(1, Math.ceil(n.dur / SL)) * (n.type === 'gold' ? 2 : 1); }); return tot ? 10000 / tot : 0; });
    const last = notes.length ? Math.max(...notes.map(n => n.start + n.dur)) : 10;
    // #END (ms): la canción acaba ahí aunque el audio siga
    const endMs = parseFloat(String((song.head && song.head.END) || '0').replace(',', '.')) || 0;
    const chart = { notes, phrases, duration: endMs > 0 ? Math.min(last + 2.5, endMs / 1000) : last + 2.5, end: endMs > 0 ? endMs / 1000 : 0, unitP, range, lo, song, songIdx: c.state.songSel };
    startAudio(chart, S);
    return chart;
  };

  // Tamaño del título en la ficha de la lista para que quepa entero (hueco de ~840 px; de 56 px a 30 px como mínimo)
  const fitC = document.createElement('canvas').getContext('2d'), fitMemo = new Map();
  G.fitTitle = t => {
    t = t || ''; if (fitMemo.has(t)) return fitMemo.get(t);
    fitC.font = '800 56px Archivo'; const w = fitC.measureText(t).width * 0.98;   // letter-spacing -0,02em
    const fs = w <= 830 ? 56 : Math.max(30, Math.floor(56 * 830 / w));
    if (document.fonts && document.fonts.check && document.fonts.check('800 56px Archivo')) fitMemo.set(t, fs);
    return fs;
  };
  // ------------------------------------------------------------------ portadas en la pantalla de bienvenida
  // Tres filas de portadas difuminadas que se desplazan de derecha a izquierda; cada pocos segundos una de la
  // fila de arriba o de abajo se enfoca y se queda nítida ~4 s. Portadas sin repetir (se comparan las imágenes).
  // Cinco filas: tres grandes y, en los huecos, dos de portadas más pequeñas (cada una a su velocidad)
  const BV = { GAP: 26, ROWS: [{ y: 40, v: 34, s: 230 }, { y: 287, v: 52, s: 125 }, { y: 425, v: 22, s: 230 }, { y: 672, v: 60, s: 125 }, { y: 810, v: 42, s: 230 }], OP: 0.3, ON: 4, FADE: 0.6 };
  const bv = { covers: [], loading: false, pending: 0, cv: null, rows: null, hl: null, next: 0, t: 0, q: 0 };
  function bvLoad() {
    if (bv.loading) return; bv.loading = true;
    const urls = [...new Set(SONGS.map(S => S.entry && S.entry.cover).filter(Boolean))];
    for (let i = urls.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [urls[i], urls[j]] = [urls[j], urls[i]]; }
    const hashes = [];
    const lista = urls.slice(0, 90); bv.pending = lista.length;
    lista.forEach(u => {
      const img = new Image();
      img.onerror = () => bv.pending--;
      img.onload = () => {
        bv.pending--;
        // Huella de 8×8 en grises para descartar portadas iguales (mismo disco, distinto fichero)
        const h = document.createElement('canvas'); h.width = h.height = 8; const hx = h.getContext('2d', { willReadFrequently: true });
        hx.drawImage(img, 0, 0, 8, 8); const d = hx.getImageData(0, 0, 8, 8).data, g = [];
        for (let i = 0; i < 64; i++) g.push(d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11);
        const m = g.reduce((a, b) => a + b, 0) / 64, bits = g.map(v => v > m);
        if (hashes.some(o => o.filter((b, i) => b !== bits[i]).length <= 6)) return;
        hashes.push(bits);
        // Versión borrosa con desenfoque de verdad (no una miniatura ampliada, que se ve pixelada)
        const bl = document.createElement('canvas'); bl.width = bl.height = 160; const bx = bl.getContext('2d');
        bx.filter = 'blur(7px)'; bx.drawImage(img, -16, -16, 192, 192); bx.filter = 'none';
        // Se guarda una copia a 320 px (como mucho se dibuja a ese tamaño), no la imagen entera: 90 portadas de
        // 600-1000 px descodificadas eran decenas de MB vivos para siempre en la tele
        const sm = document.createElement('canvas'); sm.width = sm.height = 320; sm.getContext('2d').drawImage(img, 0, 0, 320, 320);
        img.src = '';
        bv.covers.push({ img: sm, bl });
      };
      img.src = u;
    });
  }
  function bvRows() {
    return BV.ROWS.map((r, ri) => { const st = r.s + BV.GAP, per = Math.ceil(1920 / st) + 2;
      return { ...r, st, tiles: Array.from({ length: per }, (_, i) => ({ x: i * st + (ri * 97) % st, c: null })) }; });
  }
  G.bvDebug = () => ({ portadas: bv.covers.length, filas: !!bv.rows, cargando: bv.loading, enfocada: bv.hl ? +(performance.now() / 1000 - bv.hl.t0).toFixed(2) : null });
  // Siguiente portada que no esté ya a la vista en ninguna fila
  function bvTake() {
    if (!bv.covers.length) return null;
    const usadas = new Set(bv.rows ? bv.rows.flatMap(r => r.tiles.map(tl => tl.c)) : []);
    for (let i = 0; i < bv.covers.length; i++) { const c = bv.covers[bv.q++ % bv.covers.length]; if (!usadas.has(c)) return c; }
    return bv.covers[bv.q++ % bv.covers.length];
  }
  function welcomeCovers(c, s) {
    if (s.screen !== 'welcome') { bv.t = 0; return; }
    const host = document.querySelector('[data-screen-label="TV-01b Bienvenida"]');
    if (!host) return;
    if (!bv.covers.length && SONGS.length) bvLoad();
    let cv = host.querySelector('#g-portadas');
    if (!cv) {
      cv = document.createElement('canvas'); cv.id = 'g-portadas'; cv.width = 1920; cv.height = 1080;
      cv.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;z-index:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease-out';
      if (!document.getElementById('g-portadas-css')) {   // el contenido de la bienvenida, por encima de las portadas
        const st = document.createElement('style'); st.id = 'g-portadas-css';
        st.textContent = '[data-screen-label="TV-01b Bienvenida"] > *:not(#g-portadas){position:relative;z-index:1}'
          // resplandor blanco bajo el logo de nuvola y la versión, para que no se mezclen con las portadas
          + '[data-screen-label="TV-01b Bienvenida"] img[alt="nuvola"]{filter:drop-shadow(0 0 6px #fff) drop-shadow(0 0 14px #fff) drop-shadow(0 0 22px rgba(255,255,255,.9))}'
          + '[data-screen-label="TV-01b Bienvenida"] > div:first-of-type > div:first-child{filter:drop-shadow(0 0 10px #fff) drop-shadow(0 0 24px #fff) drop-shadow(0 0 40px rgba(255,255,255,.85))}'
          + '[data-screen-label="TV-01b Bienvenida"] > div:last-child span{text-shadow:0 0 6px #fff,0 0 14px #fff,0 0 22px #fff,0 0 30px rgba(255,255,255,.9)}';
        document.head.appendChild(st);
      }
      host.insertBefore(cv, host.firstChild); bv.rows = null;
    }
    // Empezar cuando estén todas cargadas (o haya de sobra para no repetir)
    if (!bv.rows && bv.pending > 0 && bv.covers.length < 36) return;
    if (!bv.covers.length) return;
    if (!bv.rows) { bv.rows = bvRows(); bv.rows.forEach(r => r.tiles.forEach(tl => (tl.c = null))); bv.rows.forEach(r => r.tiles.forEach(tl => (tl.c = bvTake()))); requestAnimationFrame(() => (cv.style.opacity = 1)); }
    const now = performance.now() / 1000, dt = bv.t ? Math.min(0.1, now - bv.t) : 0; bv.t = now;
    const x = cv.getContext('2d'); x.clearRect(0, 0, 1920, 1080); x.imageSmoothingEnabled = true;
    // Elegir la siguiente portada que se enfoca: fila de arriba o de abajo, a la vista y que siga a la vista 4 s
    if (!bv.hl && now > bv.next) {
      const cands = [];
      bv.rows.forEach((row, ri) => row.tiles.forEach(tl => {
        const T = row.s, x1 = tl.x - row.v * (BV.ON + 1), cx = tl.x + T / 2, cx1 = x1 + T / 2;
        if (tl.x < 120 || x1 < 40 || tl.x + T > 1800) return;
        // fila de abajo: solo en los laterales, para no tapar «Pulsa ✕ para continuar»
        if (ri === bv.rows.length - 1 && !((cx < 560 && cx1 < 560) || (cx1 > 1360 && cx > 1360))) return;
        cands.push({ ri, tl });
      }));
      if (cands.length) { const k = cands[Math.floor(Math.random() * cands.length)]; bv.hl = { tl: k.tl, t0: now, s: bv.rows[k.ri].s }; }
    }
    let hlK = 0;
    if (bv.hl) {
      const e = now - bv.hl.t0, F = BV.FADE;
      hlK = e < F ? e / F : e < BV.ON - F ? 1 : e < BV.ON ? (BV.ON - e) / F : 0;
      hlK = hlK * hlK * (3 - 2 * hlK);   // suavizado
      if (e >= BV.ON) { bv.hl = null; bv.next = now + 1.5 + Math.random() * 2.5; }
    }
    let hlDraw = null;
    bv.rows.forEach(r => {
      r.tiles.forEach(tl => {
        tl.x -= r.v * dt;
        if (tl.x < -r.s - 10) { tl.x += r.tiles.length * r.st; if (!bv.hl || bv.hl.tl !== tl) tl.c = bvTake(); }
        if (!tl.c || tl.x > 1930) return;
        if (bv.hl && bv.hl.tl === tl) { hlDraw = { tl, y: r.y, T: r.s }; return; }
        x.globalAlpha = BV.OP; x.drawImage(tl.c.bl, tl.x, r.y, r.s, r.s);
      });
    });
    if (hlDraw) {   // la enfocada: crece un poco, pasa de difuminada a nítida y gana opacidad
      const { tl, y, T } = hlDraw, sc = 1 + (T < 200 ? 0.25 : 0.12) * hlK, w = T * sc, cx = tl.x + T / 2, cy = y + T / 2;
      x.save(); x.globalAlpha = BV.OP + (1 - BV.OP) * hlK;
      if (hlK > 0.02) { x.shadowColor = 'rgba(32,30,29,' + (0.35 * hlK) + ')'; x.shadowBlur = 30 * hlK; x.shadowOffsetY = 12 * hlK; x.fillStyle = '#fff'; x.fillRect(cx - w / 2 - 6, cy - w / 2 - 6, w + 12, w + 12); x.shadowColor = 'transparent'; }
      x.drawImage(tl.c.bl, cx - w / 2, cy - w / 2, w, w);
      x.globalAlpha = (BV.OP + (1 - BV.OP) * hlK) * hlK; x.drawImage(tl.c.img, cx - w / 2, cy - w / 2, w, w);
      x.restore();
    }
    x.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ portada de fondo en la pantalla de canto
  // La portada del disco, difuminada y tenue detrás del carril. Se dibuja en una imagen diminuta (160×90) que se
  // amplía a pantalla completa: sale suave y no cuesta nada a la tele (un filtro blur de CSS a 1080p sí).
  const FONDO = { W: 160, H: 90, OP: 0.55 };
  function singBg(c, s) {
    const host = c.singC && c.singC.parentElement;
    if (!host) return;
    let el = host.querySelector('#g-fondo');
    if (!el) {
      el = document.createElement('canvas'); el.id = 'g-fondo'; el.width = FONDO.W; el.height = FONDO.H;
      el.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none;transition:opacity 600ms ease-out;opacity:0';
      host.insertBefore(el, host.firstChild);
    }
    const S = SONGS[s.songSel], key = s.mode === 'jukebox' ? 'nada' : S && S.entry && S.entry.cover;
    if (el._for === key) return;
    el._for = key; el.style.opacity = 0;
    if (!key || key === 'nada') return;
    const img = new Image();
    img.onload = () => {
      if (el._for !== key) return;
      const x = el.getContext('2d'), r = Math.max(FONDO.W / img.width, FONDO.H / img.height), w = img.width * r, h = img.height * r;
      x.clearRect(0, 0, FONDO.W, FONDO.H); x.filter = 'blur(1.5px) saturate(1.1)';
      x.drawImage(img, (FONDO.W - w) / 2, (FONDO.H - h) / 2, w, h); x.filter = 'none';
      el.style.opacity = FONDO.OP;
    };
    img.src = key;
  }

  // ------------------------------------------------------------------ símbolos de los botones según el mando
  // Con un mando de PlayStation conectado, las ayudas muestran ✕ ○ □ △ L1 R1; con uno de Xbox, A B X Y LB RB;
  // sin mando (mando de la tele, teclado), los del diseño. Cambian solas al conectar o desconectar el mando.
  // Sin mando a la vista, las ayudas son las del mando a distancia de la tele: OK, Atrás y los botones de colores
  // (rojo=Y, verde=X, amarillo=L, azul=R). Los colores van como marcas de uso privado que se convierten en puntos de
  // color al pintarse (dotsWatch y gkHtml); las letras no servían porque el mando de la tele no las tiene.
  const GLYPHS = {
    tele: { ok: 'OK', back: '←', x: '', y: '', l: '', r: '', lr: '', menu: '≡' },
    ps: { ok: '✕', back: '○', x: '□', y: '△', l: 'L1', r: 'R1', lr: 'L1 R1', menu: '≡' },
    xbox: { ok: 'A', back: 'B', x: 'X', y: 'Y', l: 'LB', r: 'RB', lr: 'LB RB', menu: '≡' },
  };
  // Los navegadores no muestran el mando hasta que se pulsa un botón tras cargar: se recuerda el último que se usó
  let padKind = (() => { try { return GLYPHS[localStorage.getItem('gramola-mando')] ? localStorage.getItem('gramola-mando') : 'tele'; } catch { return 'tele'; } })(), padCheck = 0, padSeen = false;
  const padSave = k => { try { localStorage.setItem('gramola-mando', k); } catch {} };
  function detectPad() {
    let pads = [];
    try { pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(p => p && p.connected); } catch {}
    const id = pads.map(p => p.id).join(' ');
    // Primero Xbox (Microsoft, 045e): su nombre también contiene «Wireless Controller», como el de Sony (054c)
    return /045e|xbox|xinput/i.test(id) ? 'xbox' : /054c|dualsense|dualshock|playstation|wireless controller/i.test(id) ? 'ps' : pads.length ? 'xbox' : 'tele';
  }
  // Mando en la tele: LG (y otras) envía la cruceta y algunos botones como teclas además de por la API del mando.
  // Si la misma orden llega por las dos vías en menos de 200 ms, la segunda se descarta y se apunta que ese botón
  // de esa vía ('pad' = botones y cruceta, 'stick' = palanca) ya llega por teclas: desde entonces se ignora en el sondeo.
  G.inAct = (c, a, src) => {
    const t = performance.now(), m = c._padMir || (c._padMir = {}), L = c._lastIn;
    if (src !== 'key' && m[src + a]) return false;
    if (L && L.a === a && L.src !== src && t - L.t < 200) {
      const other = src === 'key' ? L.src : src;
      if (other !== 'key') m[other + a] = true;
      return false;
    }
    c._lastIn = { a, t, src };
    return true;
  };
  // Con mando conectado (PlayStation o Xbox, según se detecte al pulsar un botón), sus símbolos; sin mando, los del
  // mando a distancia de la tele
  G.gk = () => GLYPHS[padKind] || GLYPHS.tele;
  // Ratón (escritorio): la página esconde el puntero (en la tele no hay ratón); al moverlo se enseña y a los 2,5 s
  // quieto se vuelve a esconder, como en cualquier app de salón
  // El puntero es propio: la flecha plana del logo de bages.link, en rojo con contorno de tinta, a 72 px (el punto
  // activo es la punta)
  const CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="1.5 1 24 24"><path d="M4 3l16 7.5-6.6 2.1L10.6 21z" fill="#ec3013" stroke="#201e1d" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke"/></svg>';
  const CURSOR = `url('data:image/svg+xml;utf8,${encodeURIComponent(CURSOR_SVG)}') 8 6, auto`;
  // Los elementos clicables del diseño llevan «cursor:pointer» (la mano): todo hereda el puntero del cuerpo, así se ve
  // siempre la flecha propia (y nada cuando está escondida)
  { const st = document.createElement('style'); st.textContent = 'body * { cursor: inherit !important; }'; document.head.appendChild(st); }
  let mouseT = 0;
  addEventListener('mousemove', () => {
    G.mouseAt = performance.now();
    // Durante el arranque (logo, aviso y carga) no se enseña: a partir de la bienvenida
    const c = g();
    if (!c || ['splash', 'boot'].includes(c.state.screen)) return;
    document.documentElement.style.cursor = CURSOR; document.body.style.cursor = CURSOR;
    clearTimeout(mouseT);
    mouseT = setTimeout(() => { document.documentElement.style.cursor = ''; document.body.style.cursor = ''; }, 2500);
  }, { passive: true });
  G.padKind = () => padKind;
  const DOT = { '': '#e4262c', '': '#2eaa4a', '': '#f2c230', '': '#2f7de1' };
  const DOT_KEY = { '': 'y', '': 'x', '': 'l', '': 'r', '': 'lr' };
  const dotHtml = ch => `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${DOT[ch]};margin:0 2px;vertical-align:middle"></span>`;
  const htmlEsc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Ayuda de un botón como HTML (para los paneles que se pintan con innerHTML: Megamix, Créditos)
  G.gkHtml = k => [...(G.gk()[k] || '')].map(ch => DOT[ch] ? dotHtml(ch) : htmlEsc(ch)).join('');
  // Las ayudas del diseño salen como texto ({{ gk.y }}): cuando el texto es una marca de color se cambia por puntos,
  // y cuando vuelve a haber mando se restaura el símbolo del mando
  let dotsAt = 0;
  function dotsWatch() {
    const now = performance.now();
    if (now - dotsAt < 300) return;
    dotsAt = now;
    for (const el of document.querySelectorAll('span.sc-interp')) {
      const t = el.textContent, key = el.dataset.gKey;
      if (DOT_KEY[t]) { el.dataset.gKey = DOT_KEY[t]; el.innerHTML = [...t].map(dotHtml).join(''); }
      else if (key && padKind !== 'tele' && t !== G.gk()[key]) el.textContent = G.gk()[key];
      else if (key && padKind === 'tele' && !t) { /* ya son puntos */ }
    }
  }
  function padWatch(c) {
    const now = performance.now();
    if (now - padCheck < 500) return;
    padCheck = now;
    let k = detectPad();
    if (k !== 'tele') padSeen = true;
    else if (!padSeen) return;               // aún no se ha pulsado nada: se mantiene el último mando usado
    if (k !== padKind) { padKind = k; padSave(k); c.setState({}); if (megaUI) megaRender(c); }
  }
  addEventListener('gamepadconnected', () => (padCheck = 0));
  addEventListener('gamepaddisconnected', () => { padCheck = 0; padSeen = true; });
  // Una tecla sin ningún mando a la vista viene del mando de la tele (o del teclado): ya se puede decidir
  addEventListener('keydown', () => setTimeout(() => { if (detectPad() === 'tele') { padSeen = true; padCheck = 0; } }, 150), true);

  // ------------------------------------------------------------------ lista de canciones en rejilla
  // Dos filas que se desplazan en horizontal, agrupadas (letra del título o del artista, o década según el orden),
  // con la marca de cada grupo y una tira de letras abajo. ←→ salta de columna (dos canciones), ↑↓ cambia de fila.
  const GRID = { W: 180, TH: 242, GAP: 12, ROWGAP: 10, GROUP: 72, LEFT: 96 + 64, VIEW: 1920 };
  let gridCache = null;
  const ORD_NAMES = ['A–Z', 'Artista', 'Década', 'Más cantadas'];
  // Novedades (marcadas en la administración): primero, en su propio grupo «★», de la más reciente a la más antigua
  G.newFirst = l => { const n = l.filter(S => S.isNew).sort((a, b) => (b.newAt || 0) - (a.newAt || 0)); return n.length ? n.concat(l.filter(S => !S.isNew)) : l; };
  const initialOf = t => { const ch = (t || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[¡¿"'(.\s]+/, '').charAt(0).toUpperCase(); return /[A-ZÑ]/.test(ch) ? ch : '#'; };
  function gridLayout(list, ord) {
    if (gridCache && gridCache.list === list && gridCache.ord === ord && gridCache.n === list.length) return gridCache;
    const o = ORD_NAMES[ord] || 'A–Z';
    const keyOf = S => S.isNew ? '★' : o === 'A–Z' ? initialOf(S.title) : o === 'Artista' ? initialOf(S.artist) : o === 'Década' ? (S.year ? String(Math.floor(S.year / 10) * 10).slice(2) + 's' : '—') : '';
    const cols = [], pos = [], tags = [];
    let x = GRID.LEFT, key = null, inCol = 2;
    list.forEach((S, i) => {
      const k = keyOf(S);
      if (k !== key) {                                    // grupo nuevo: columna nueva con su marca
        if (key !== null) x += GRID.GROUP - GRID.GAP;
        key = k; inCol = 2;
        if (k) tags.push({ l: k, x: x - 60, col: cols.length });
      }
      if (inCol === 2) { cols.push({ x, items: [] }); inCol = 0; x += GRID.W + GRID.GAP; }
      const c = cols.length - 1;
      cols[c].items.push(i); pos[i] = { c, r: inCol }; inCol++;
    });
    gridCache = { list, ord, n: list.length, cols, pos, tags, width: x + 96 };
    return gridCache;
  }
  G.songGrid = (c, list, sf) => {
    const s = c.state, L = gridLayout(list, s.ord), gz = s.zone === 'grid';
    if (!list.length) return { tiles: [], tags: [], abc: [], tx: 0, tr: '260ms' };
    const p = L.pos[Math.min(sf, list.length - 1)] || { c: 0, r: 0 };
    const fx = L.cols[p.c].x;
    // Desplazamiento: el foco se queda en el tercio izquierdo; sin pasarse de los bordes. Si la ficha se eligió con el
    // ratón (clic), la lista NO se mueve: solo el mando y el teclado la desplazan
    const want = -Math.max(0, Math.min(fx - 560, L.width - GRID.VIEW));
    const maxTx = Math.max(0, L.width - GRID.VIEW);
    const tx = G.gridMouse && G.gridTx != null && -G.gridTx <= maxTx ? G.gridTx : want;
    G.gridTx = tx;
    // Paso de página con los botones: desplazamiento más largo y suave que el salto de ficha en ficha
    const tr = performance.now() < (G.gridSmoothUntil || 0) ? '720ms cubic-bezier(.25,.8,.25,1)' : '260ms cubic-bezier(.2,.8,.2,1)';
    const lo = -tx - 400, hi = -tx + GRID.VIEW + 400;
    const tiles = [];
    L.cols.forEach((col, ci) => {
      if (col.x < lo || col.x > hi) return;
      col.items.forEach((i, r) => {
        const S = list[i], on = i === sf && gz;
        tiles.push({ x: col.x, y: 8 + r * (GRID.TH + GRID.ROWGAP), w: GRID.W, h: GRID.TH, ch: GRID.W,
          bg: S.cv[0], blk: S.cv[1], fg: S.cv[2], ini: (S.title || '').split(' ').filter(w => w).slice(0, 2).map(w => w[0]).join('').toUpperCase(), fs: Math.round(GRID.W * 0.24),
          title: S.title, artist: S.artist, nw: S.isNew ? 'block' : 'none', tbg: on ? '#ec3013' : '#fff', c1: on ? '#fff' : '#201e1d', c2: on ? 'rgba(255,255,255,.85)' : '#6b6767',
          sh: on ? '0 14px 34px rgba(32,30,29,.28)' : '0 1px 0 rgba(32,30,29,.08)', t: on ? 'scale(1.06)' : 'scale(1)', z: on ? 5 : 1,
          click: () => { if (on) c.startSetup(); else { G.gridMouse = true; c.setState({ songF: i, zone: 'grid' }); } } });
      });
    });
    const curTag = L.tags.filter(t => t.col <= p.c).pop();
    const tags = L.tags.filter(t => t.x > lo - 100 && t.x < hi).map(t => ({ l: t.l, x: t.x, y: 8, bg: curTag && t === curTag ? '#ec3013' : '#201e1d' }));
    const abc = L.tags.map(t => ({ l: t.l, bg: curTag && t === curTag ? '#ec3013' : 'transparent', fg: curTag && t === curTag ? '#fff' : '#9b9797' }));
    return { tiles, tags, abc, tx, tr };
  };
  // Movimiento del foco en la rejilla; null = no lo gestiona (↑ desde la fila de arriba → filtros)
  // Botones ‹ › junto a los filtros: una pantalla de fichas adelante o atrás (la lista se desplaza suave)
  G.gridPage = (c, dir) => {
    const s = c.state, list = c.songsList();
    if (!list.length) return;
    const L = gridLayout(list, s.ord), sf = Math.min(s.songF, list.length - 1), p = L.pos[sf] || { c: 0, r: 0 };
    const paso = GRID.VIEW - GRID.LEFT - 96;   // lo que cabe en pantalla
    const x0 = L.cols[p.c].x + dir * paso;
    let ci = 0, best = Infinity;
    L.cols.forEach((col, i) => { const d = Math.abs(col.x - x0); if (d < best) { best = d; ci = i; } });
    if (ci === p.c) ci = Math.max(0, Math.min(L.cols.length - 1, p.c + dir));
    const col = L.cols[ci], i = col.items[Math.min(p.r, col.items.length - 1)];
    G.gridMouse = false; G.gridSmoothUntil = performance.now() + 800;
    c.setState({ songF: i, zone: 'grid' });
  };
  G.gridMove = (c, list, sf, a) => {
    if (!list.length || !'lrud'.includes(a)) return null;
    const L = gridLayout(list, c.state.ord), p = L.pos[Math.min(sf, list.length - 1)];
    if (!p) return null;
    const col = L.cols[p.c];
    if (a === 'u') return p.r === 1 ? col.items[0] : null;
    if (a === 'd') return col.items[1] != null ? col.items[1] : sf;
    const nc = L.cols[p.c + (a === 'r' ? 1 : -1)];
    if (!nc) return sf;
    return nc.items[Math.min(p.r, nc.items.length - 1)];
  };

  // ------------------------------------------------------------------ Créditos (Ajustes → Créditos, △ en la bienvenida)
  // Qué es Gramola y de quién es cada pieza que usa. Texto fijo; se pinta con el mismo estilo del diseño (1920×1080
  // escalado) y se recorre con la cruceta.
  const CREDITOS = [
    ['Un proyecto libre y sin ánimo de lucro', [
      'Gramola es software libre, publicado con licencia MIT en github.com/nuvolacat/Gramola.link. No tiene ningún fin comercial: no se cobra, no se cobrará y no existe ningún beneficio económico, directo ni indirecto, por su uso. No hay publicidad, ni suscripciones, ni recogida de datos con fines comerciales.',
      'Es una aplicación hecha por y para los amantes del karaoke, con todo el respeto hacia los artistas, autores, intérpretes y discográficas de las canciones. Gramola no tiene relación alguna con ellos ni con sus representantes, y no reclama ningún derecho sobre las obras.',
      'Si eres titular de derechos y quieres que se retire cualquier contenido, escribe a soporte@gramola.link y se atenderá la petición.',
      'Gramola es un proyecto de NUVOLACAT, con diseño original de NUVOLACAT. © NUVOLACAT.',
    ]],
    ['Tipografía', [
      'Archivo, de Omnibus-Type · Licencia SIL Open Font License 1.1 · servida a través de Google Fonts.',
    ]],
    ['En la tele y en el móvil', [
      'React 18.3.1 · Meta Platforms, Inc. · Licencia MIT.',
      'Babel Standalone 7.29 · Licencia MIT.',
      'qrcode.js · Kazuhiko Arase · Licencia MIT (el código QR de la sala).',
      'jsQR · Cosmo Wolfe · Licencia Apache 2.0 (lectura del QR con la cámara del móvil).',
      'Detección de tono: implementación propia del algoritmo YIN (de Cheveigné y Kawahara, 2002).',
      'Efectos de sonido y aplausos: sintetizados por el propio proyecto.',
      'Música del menú: creada con SUNO.AI.',
    ]],
    ['Servidor', [
      'Node.js · ws (WebSocket) · Licencia MIT.',
      'SimpleWebAuthn · Licencia MIT (acceso a la administración con Touch ID y llaves de acceso).',
    ]],
    ['Creación de canciones (herramientas de administración)', [
      'FFmpeg · Licencias LGPL y GPL.',
      'PyTorch y torchaudio · Licencia BSD.',
      'Demucs (separación de la voz) · Meta · Licencia MIT.',
      'MMS, alineador forzado de Meta AI (encaje de la letra con la voz) · modelo con licencia CC BY-NC 4.0, uso no comercial.',
      'torchcrepe (tono de la voz; modelo CREPE de Kim, Salamon, Li y Bello, 2018) · Licencia MIT.',
      'librosa · Licencia ISC. NumPy y SciPy · Licencia BSD. python-soundfile y libsndfile · Licencias BSD y LGPL.',
      'Pyphen (separación en sílabas) con los diccionarios de LibreOffice · Licencias GPL, LGPL y MPL.',
      'Formato de canción UltraStar (.txt), creado por la comunidad de UltraStar y UltraStar Deluxe.',
    ]],
    ['Servicios de terceros consultados', [
      'LRCLIB, base de datos abierta de letras sincronizadas.',
      'Genius y SongLyrics, para letras que no están en LRCLIB.',
      'iTunes Search API (Apple) y Deezer API, para las carátulas.',
      'Las carátulas, letras y grabaciones pertenecen a sus titulares y se usan únicamente para identificar y reproducir cada canción en el karaoke.',
    ]],
    ['Infraestructura', [
      'Alojado en Ubuntu con Apache y Plesk, detrás de Cloudflare, con certificados de Let’s Encrypt.',
    ]],
  ];
  let credUI = null;   // { el, box, cont, y, max }
  function creditsRender(c) {
    const u = credUI; if (!u) return;
    const ink = '#201e1d', red = '#ec3013';
    const secs = CREDITOS.map(([t, ps]) => `<div style="display:flex;flex-direction:column;gap:14px"><div style="font-size:30px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${red}">${esc(t)}</div>${ps.map(p => `<div style="font-size:30px;line-height:1.35;font-weight:400;color:${ink}">${esc(p)}</div>`).join('')}</div>`).join('');
    const key = (k, l) => `<div style="display:flex;align-items:center;gap:12px"><div style="min-width:48px;height:48px;padding:0 8px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;border:2px solid ${ink};border-radius:24px">${k}</div><span style="font-size:26px;font-weight:600">${esc(l)}</span></div>`;
    u.box.innerHTML = `<div style="position:absolute;inset:0;padding:54px 96px;box-sizing:border-box;display:flex;flex-direction:column;gap:28px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid ${ink};padding-bottom:20px"><span style="font-size:28px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${red}">Créditos</span><span style="font-size:28px;font-weight:600;color:#4a4646">Gramola ${esc(((document.querySelector('script[src*="gramola-bridge.js"]') || {}).src || '').split('?v=')[1] || '')}</span></div>
      <div style="position:relative;flex:1;overflow:hidden"><div id="g-cred" style="position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;gap:40px;padding-bottom:40px;transition:transform 180ms ease-out">${secs}</div>
        <div style="position:absolute;left:0;right:0;bottom:0;height:60px;background:linear-gradient(to bottom,rgba(243,242,242,0),#f3f2f2)"></div></div>
      <div style="display:flex;justify-content:flex-end;gap:40px">${key('↕', 'Desplazar')}<span id="g-cred-volver">${key(G.gkHtml('back'), 'Volver')}</span></div></div>`;
    u.cont = u.box.querySelector('#g-cred');
    u.y = 0; creditsScroll(0);
    // Ratón: clic en «Volver» cierra; la rueda desplaza el texto
    u.box.querySelector('#g-cred-volver').onclick = e => { e.stopPropagation(); creditsClose(); whoosh(); };
    u.box.onwheel = e => { e.preventDefault(); creditsScroll(e.deltaY); };
  }
  function creditsScroll(d) {
    const u = credUI; if (!u || !u.cont) return;
    const vis = u.cont.parentElement.clientHeight, max = Math.max(0, u.cont.scrollHeight - vis + 40);
    u.y = Math.max(0, Math.min(max, u.y + d));
    u.cont.style.transform = `translateY(${-u.y}px)`;
  }
  function creditsLayout(c) {
    if (!credUI) return;
    const sc = (c && c.state.scale) || Math.min(innerWidth / 1920, innerHeight / 1080);
    credUI.box.style.transform = `translate(-50%,-50%) scale(${sc})`;
  }
  function creditsClose() { if (credUI) { credUI.el.remove(); credUI = null; } }
  G.creditsOpen = c => {
    if (credUI) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:40;background:#0e0f0f';
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:50%;top:50%;width:1920px;height:1080px;background:#f3f2f2;color:#201e1d;font-family:Archivo,sans-serif;overflow:hidden';
    el.appendChild(box); document.body.appendChild(el);
    credUI = { el, box, cont: null, y: 0, screen: c.state.screen };
    creditsLayout(c); creditsRender(c); whoosh();
  };
  G.creditsKey = (c, a) => {
    if (!credUI) return false;
    if (c.state.screen !== credUI.screen) { creditsClose(); return false; }
    if (a === 'd') creditsScroll(160);
    else if (a === 'u') creditsScroll(-160);
    else if (a === 'r') creditsScroll(720);
    else if (a === 'l') creditsScroll(-720);
    else if (a === 'back' || a === 'ok' || a === 'menu') { creditsClose(); whoosh(); }
    return true;
  };

  // ------------------------------------------------------------------ Megamix
  // Estribillos seguidos de 4, 6 u 8 canciones (solo las que traen el estribillo marcado: megamix.mp3 recortado
  // por tools/megamix.py). Una sola partitura con los tramos encadenados; el audio va por Web Audio (la tele LG
  // solo reproduce un medio a la vez) con fundido cruzado: la siguiente entra cuando acaba el estribillo.
  const MX = { XF: 3, FIRST_IN: 1.2 };
  G.mega = null;      // partida en curso: { idx: [...], segs, ctx, t0, ... }
  let megaUI = null;  // pantalla de elección: { el, n, list, f }
  let megaWant = false; // abrirla en cuanto el menú esté en pantalla
  const megaSongs = () => SONGS.map((S, i) => i).filter(i => SONGS[i].entry && SONGS[i].entry.megamix);
  const artistKey = a => (a || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s*(?:,|&| y | ft\.?| feat\.?| con )\s*/)[0].trim();
  function megaPick(n) {
    const all = megaSongs();
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const out = [], seen = new Set();
    for (const i of all) { const k = artistKey(SONGS[i].artist); if (!seen.has(k)) { seen.add(k); out.push(i); } if (out.length === n) return out; }
    for (const i of all) { if (!out.includes(i)) out.push(i); if (out.length === n) break; }   // por si no hay artistas de sobra
    return out;
  }
  const segLen = i => { const m = SONGS[i].entry.megamix; return (m.end - m.offset) / 1000; };
  const mmss = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const megaTotal = list => list.reduce((a, i) => a + segLen(i), 0) + MX.XF;

  // Pantalla de elección (encima del menú, con el mismo estilo del diseño)
  const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function megaRender(c) {
    const u = megaUI; if (!u) return;
    const ink = '#201e1d', red = '#ec3013', NS = [4, 6, 8];
    const tiles = NS.map((n, i) => { const on = u.f === i; return `<div style="flex:1;height:200px;padding:24px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;background:${on ? red : '#fff'};color:${on ? '#fff' : ink};border-right:${i < 2 ? '2px solid ' + ink : 'none'};outline:${on ? '2px solid ' + ink : 'none'};outline-offset:-2px;transform:${on ? 'scale(1.05)' : 'none'};box-shadow:${on ? '0 18px 40px rgba(32,30,29,.38), 0 4px 12px rgba(32,30,29,.22)' : 'none'};position:relative;z-index:${on ? 2 : 1}"><span style="font-size:96px;font-weight:300;line-height:.9;letter-spacing:-0.04em">${n}</span><span style="font-size:28px;font-weight:800">canciones${on && u.list.length ? ' · ' + mmss(megaTotal(u.list)) : ''}</span></div>`; }).join('');
    const cards = u.list.map((i, k) => { const S = SONGS[i]; return `<div style="display:flex;gap:16px;align-items:center;min-width:0"><span style="font-size:24px;font-weight:800;color:${red};width:36px;flex-shrink:0">${String(k + 1).padStart(2, '0')}</span><div style="width:88px;height:88px;flex-shrink:0;background:${esc(S.cv[0])}"></div><div style="display:flex;flex-direction:column;min-width:0"><span style="font-size:28px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(S.title)}</span><span style="font-size:24px;color:#6b6767;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(S.artist)}</span></div></div>`; }).join('');
    const key = (k, l, fill) => `<div style="display:flex;align-items:center;gap:12px"><div style="min-width:48px;height:48px;padding:0 8px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;${fill ? 'background:' + ink + ';color:#f3f2f2' : 'border:2px solid ' + ink}">${k}</div><span style="font-size:28px;font-weight:${fill ? 800 : 600};white-space:nowrap">${l}</span></div>`;
    u.box.innerHTML = `<div style="position:absolute;inset:0;padding:54px 96px;box-sizing:border-box;display:flex;flex-direction:column;gap:36px">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid ${ink};padding-bottom:20px"><span style="font-size:28px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${red}">Megamix</span><span style="font-size:28px;font-weight:600;color:#6b6767">${megaSongs().length} canciones con estribillo</span></div>
      <div style="display:flex;flex-direction:column;gap:12px"><div style="font-size:120px;font-weight:300;line-height:.9;letter-spacing:-0.045em">¿Cuántas canciones?</div><div style="font-size:36px;color:#4a4646">El estribillo de cada una, seguidas y sin parar. Sin repetir artista.</div></div>
      <div style="display:flex;border:2px solid ${ink};background:#fff">${tiles}</div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px 32px;flex:1;align-content:start">${cards}</div>
      <div style="display:flex;justify-content:flex-end;gap:40px">${key('↔', 'Cuántas')}${key(G.gkHtml('y'), 'Otra lista')}${key(G.gkHtml('back'), 'Volver')}${key(G.gkHtml('ok'), 'Empezar', true)}</div></div>`;
  }
  function megaLayout(c) {
    if (!megaUI) return;
    const sc = (c && c.state.scale) || Math.min(innerWidth / 1920, innerHeight / 1080);
    megaUI.box.style.transform = `translate(-50%,-50%) scale(${sc})`;
  }
  G.megaOpen = c => {
    if (megaSongs().length < 4) { c.toast('No hay canciones suficientes para el Megamix'); return; }
    if (!megaUI) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:40;background:#0e0f0f';
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;left:50%;top:50%;width:1920px;height:1080px;background:#f3f2f2;color:#201e1d;font-family:Archivo,sans-serif;overflow:hidden';
      el.appendChild(box); document.body.appendChild(el);
      megaUI = { el, box, f: 1, list: [] };
    }
    megaUI.f = Math.min(megaUI.f, 2);
    megaUI.list = megaPick([4, 6, 8][megaUI.f]);
    megaLayout(c); megaRender(c); whoosh();
  };
  function megaClose() { if (megaUI) { megaUI.el.remove(); megaUI = null; } }
  G.megaKey = (c, a) => {
    const s = c.state;
    if (megaUI) {
      if (s.screen !== 'menu') { megaClose(); return false; }
      if (a === 'l' || a === 'r') { const f0 = megaUI.f; megaUI.f = Math.max(0, Math.min(2, megaUI.f + (a === 'r' ? 1 : -1))); if (megaUI.f !== f0) { megaUI.list = megaPick([4, 6, 8][megaUI.f]); megaRender(c); zup(); } }
      else if (a === 'y' || a === 'x') { megaUI.list = megaPick([4, 6, 8][megaUI.f]); megaRender(c); beep(880, 0.05, 0.12); }
      else if (a === 'back' || a === 'menu') { megaClose(); whoosh(); }
      else if (a === 'ok') megaBegin(c, megaUI.list.slice());
      return true;
    }
    // En «Preparar partida» del Megamix, Volver regresa a la elección de canciones
    if (G.mega && s.screen === 'setup' && a === 'back') { G.mega = null; megaWant = true; c.go('menu', { menuF: 2 }); return true; }
    return false;
  };
  function megaBegin(c, idx) {
    megaClose();
    G.mega = { idx };
    const N = c.state.count;
    const setup = Array.from({ length: N }, (_, i) => ({ on: !c.isOff(i), diff: c.state.settings.diff, side: i % 2 === 0 ? 0 : 2 }));
    c.go('setup', { mode: 'sing', songSel: idx[0], setup, setupF: 0 });
  }
  // Ficha de la partida (en Preparar, cuenta atrás y resultados): «Megamix · N canciones»
  G.megaCard = s => {
    if (!G.mega || !['setup', 'count', 'results'].includes(s.screen)) return null;
    const L = G.mega.idx, a = L.map(i => SONGS[i].artist);
    return { title: 'Megamix', artist: a.slice(0, 3).join(', ') + (a.length > 3 ? ' y ' + (a.length - 3) + ' más' : ''),
      dur: mmss(megaTotal(L)), year: L.length + ' canciones', lang: 'Varios', duo: false, diff: 2, rec: '—', cv: SONGS[L[0]].cv };
  };
  // Resultados del Megamix: «Otra canción» → otra lista; «Repetir» → la misma; «Menú» → menú
  G.megaRes = (c, i) => {
    if (!G.mega) return false;
    if (i === 0) { G.mega = null; megaWant = true; c.go('menu', { menuF: 2 }); return true; }
    if (i === 2) { G.mega = null; return false; }
    return false;
  };
  // Entre canción y canción, en lugar de «Interludio musical»: la que viene
  G.interText = (c, cur) => {
    // Fuera de un cambio de canción del Megamix no se escribe nada: en la pausa se ve ya la frase que viene
    if (!G.mega || cur.seg == null || !c.chart) return '';
    const P = c.chart.phrases, i = P.indexOf(cur), prev = i > 0 ? P[i - 1] : null;
    if (prev && prev.seg === cur.seg) return '';
    const S = SONGS[G.mega.idx[cur.seg]];
    return S ? S.title + ' · ' + S.artist : '';
  };

  // Partitura encadenada: el tramo k empieza en T[k] (tiempo de la partida); la siguiente entra cuando acaba
  // el estribillo de la anterior, que sigue sonando 3 s mientras se funde.
  function megaChart(c, skills) {
    const L = G.mega.idx, K = skills.length;
    const segs = []; let T = 0;
    for (const i of L) { const m = SONGS[i].entry.megamix; segs.push({ i, T, off: m.offset / 1000, a: m.start / 1000, b: m.end / 1000, url: G.withK('/' + m.url.replace(/^\//, '')) }); T += (m.end - m.offset) / 1000; }
    const all = [];
    segs.forEach(sg => SONGS[sg.i].song.tracks[0].forEach(l => { if (l.start / 1000 >= sg.a - 0.25 && l.start / 1000 < sg.b) l.notes.forEach(n => n.weight && all.push(n.midi)); }));
    const lo = Math.min(...all), hi = Math.max(...all), range = Math.max(12, hi - lo);
    const notes = [], phrases = [];
    segs.forEach((sg, k) => {
      const v = ms => sg.T + ms / 1000 - sg.off;     // tiempo de la canción → tiempo de la partida
      SONGS[sg.i].song.tracks[0].forEach(l => {
        if (l.start / 1000 < sg.a - 0.25 || l.start / 1000 >= sg.b) return;
        const p = { notes: [], start: v(l.start), end: v(l.end), parts: [0, 1], seg: k };
        for (const u of l.notes) {
          const type = u.type === 'golden' ? 'gold' : u.type === 'free' ? 'free' : u.type === 'rap' || u.type === 'rapgolden' ? 'rap' : 'n';
          const dur = Math.max(0.06, (u.end - u.start) / 1000);
          const n = { s: u.text.replace(/~/g, ''),   // «~» = la sílaba anterior se alarga (marca de UltraStar, no se canta)
          p: u.midi - lo, midi: u.midi, start: v(u.start), dur, type, i: notes.length, q: [], off: [], parts: [0, 1], seg: k };
          for (let q = 0; q < K; q++) { const r = Math.random(); n.q[q] = r < skills[q] ? 'good' : r < skills[q] + 0.2 ? 'partial' : 'miss'; n.off[q] = (Math.random() < 0.5 ? -1 : 1) * (1.8 + Math.random()); }
          if (type !== 'free') n.sl = Array.from({ length: K }, () => new Array(Math.max(1, Math.ceil(dur / SL))).fill(0));
          p.notes.push(n); notes.push(n);
        }
        if (p.notes.length) phrases.push(p);
      });
    });
    notes.sort((x, y) => x.start - y.start).forEach((n, i) => (n.i = i));
    phrases.sort((x, y) => x.start - y.start);
    const unitP = [0, 1].map(q => { let tot = 0; notes.forEach(n => { if (n.sl && n.parts.includes(q)) tot += Math.max(1, Math.ceil(n.dur / SL)) * (n.type === 'gold' ? 2 : 1); }); return tot ? 10000 / tot : 0; });
    const lastSeg = segs[segs.length - 1];
    const chart = { notes, phrases, duration: lastSeg.T + (lastSeg.b - lastSeg.off) + MX.XF, unitP, range, lo, song: SONGS[L[0]].song, songIdx: L[0], mega: true };
    megaAudio(chart, segs);
    return chart;
  }
  // Audio: un AudioContext propio (se suspende en la pausa y su reloj es el de la partida)
  function megaAudio(chart, segs) {
    stopAudio();
    G.songEnded = false;   // (si la canción anterior llegó al final, el Megamix no puede «acabar» en su primer fotograma)
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const M = Object.assign(G.mega, { ctx, segs, t0: null, cur: -1, chart, master: ctx.createGain() });
    M.master.gain.value = vol('music'); M.master.connect(ctx.destination);
    const load = k => { const sg = segs[k]; if (!sg || sg.p) return; sg.p = fetch(sg.url).then(r => r.arrayBuffer()).then(ab => new Promise((ok, ko) => { const x = ctx.decodeAudioData(ab, ok, ko); if (x && x.catch) x.catch(ko); })).then(b => (sg.buf = b)).catch(() => (sg.failed = true)); };
    load(0); load(1);
    M.load = load;
    segs[0].p.then(() => {
      if (G.mega !== M) return;
      // Sin el primer estribillo (descarga o descodificación fallida) no se arranca mudo: aviso como con una canción
      if (segs[0].failed) { const c = g(); if (c) { c.chart = null; G.failed = 'Megamix'; c.setState({ err: 'song' }); } return; }
      ctx.resume(); M.t0 = ctx.currentTime + 0.25; megaSchedule(M, 0);
    });
    menuMusic(false);
  }
  function megaSchedule(M, k) {
    const sg = M.segs[k]; if (!sg || sg.src || !sg.buf) return;
    const ctx = M.ctx, at = M.t0 + sg.T, now = ctx.currentTime, late = Math.max(0, now - at);
    const src = ctx.createBufferSource(), gn = ctx.createGain();
    src.buffer = sg.buf; src.connect(gn); gn.connect(M.master);
    const st = Math.max(at, now), fin = M.t0 + sg.T + (sg.b - sg.off);   // fin del estribillo
    const fadeIn = k === 0 ? MX.FIRST_IN : MX.XF;
    gn.gain.setValueAtTime(0, st);
    gn.gain.linearRampToValueAtTime(1, Math.max(st + 0.05, at + fadeIn));
    gn.gain.setValueAtTime(1, Math.max(st + 0.1, fin));
    gn.gain.linearRampToValueAtTime(0, Math.max(st + 0.2, fin + MX.XF));
    src.start(st, late);
    sg.src = src;
  }
  // Reloj de la partida y tareas del Megamix (lo llama audioNow en cada fotograma)
  function megaNow() {
    const M = G.mega;
    if (!M || !M.ctx || M.t0 == null) return 0;
    const now = M.ctx.currentTime - M.t0;
    // Programar la siguiente con tiempo y precargar las que vienen; soltar las ya terminadas
    M.segs.forEach((sg, k) => {
      if (now > sg.T - 8) { M.load(k); M.load(k + 1); if (sg.buf && !sg.src) megaSchedule(M, k); }
      if (sg.buf && now > sg.T + (sg.b - sg.off) + MX.XF + 1) { sg.buf = null; }
    });
    // Título y portada de la canción que suena (a mitad del fundido)
    let cur = 0; M.segs.forEach((sg, k) => { if (now >= sg.T + (k ? MX.XF / 2 : 0)) cur = k; });
    if (cur !== M.cur) { M.cur = cur; const c = g(); if (c) c.setState({ songSel: M.segs[cur].i }); }
    return Math.max(0, now);
  }
  function megaPause(paused) {
    const M = G.mega; if (!M || !M.ctx || M.t0 == null) return;
    const v = vol('music');
    if (paused && M.ctx.state === 'running' && !M.pausing) {
      // fundido corto en vez de cortar en seco (aquí el reloj de la partida es el del audio: mejor no alargarlo)
      M.pausing = true; whoosh(0.85);
      const t = M.ctx.currentTime; M.master.gain.cancelScheduledValues(t); M.master.gain.setValueAtTime(v, t); M.master.gain.setTargetAtTime(0, t, 0.08);
      setTimeout(() => { M.ctx.suspend(); M.pausing = false; }, 350);
    } else if (!paused && M.ctx.state === 'suspended' && !M.pausing) {
      M.ctx.resume().then(() => { const t = M.ctx.currentTime; M.master.gain.cancelScheduledValues(t); M.master.gain.setValueAtTime(0, t); M.master.gain.linearRampToValueAtTime(v, t + 0.18); });
    }
  }
  function megaStop() {
    const M = G.mega; if (!M || !M.ctx) return;
    try { M.ctx.close(); } catch {}
    M.ctx = null; M.segs && M.segs.forEach(sg => { sg.src = null; sg.buf = null; sg.p = null; });
  }
  G.megaVolume = () => { const M = G.mega; if (M && M.master) M.master.gain.value = vol('music'); };

  // ------------------------------------------------------- quitar voces (filtro en vivo)
  // Dos caminos, y el bueno manda:
  //   1. Si la canción tiene `sin-voz.mp3` (la dejó el pre-procesador con Demucs en el servidor), al empezar se pone
  //      esa pista y no se procesa nada: es voz separada de verdad y no cuesta ni un cálculo.
  //   2. Si no la tiene, este filtro de centro (STFT, AudioWorklet) quita lo que va centrado. Sirve, pero baja también
  //      lo que comparta banda y centro con la voz.
  const QV_URL = '/tv/quita-voces-worklet.js';
  const QV_LAT = { s: 0 };            // retardo del filtro en segundos (lo declara el propio procesador)
  let vozNivel = 0, qvProm = null;
  function moduloQV(ctx) {
    if (!ctx || !ctx.audioWorklet) return Promise.resolve(false);   // navegador sin AudioWorklet: se queda sin filtro
    if (!qvProm) qvProm = ctx.audioWorklet.addModule(QV_URL).then(() => true)
      .catch(e => { console.warn('[quitar voces] no se pudo cargar el filtro:', e && e.message); return false; });
    return qvProm;
  }
  const pistaSinVoz = S => !!(S && S.song && S.song.sinVoz);
  // Ajustes → Voz de la canción: 0 quitada (con la pista preparada; si no la hay, se quita en vivo), 1 en vivo, 2 entera
  const quierePreparada = (st, S) => (((st && st.vozModo) | 0) === 0 && pistaSinVoz(S));
  const nivelFiltro = st => {
    const modo = (st && st.vozModo) | 0;
    if (modo === 2) return 0;                       // entera: no se toca
    if (modo === 1) return Math.max(1, (st && st.voz) | 0);   // en vivo: al menos suave, si no no haría nada
    return 2;                                       // quitada sin pista preparada: en vivo y fuerte
  };
  function vozPoner(g, nivel) {
    if (!g || !g.ctx || g.dead) return;
    if (g.qv) { g.qv.port.postMessage({ nivel }); return; }
    if (!nivel || g.qvPidiendo) return;
    g.qvPidiendo = true;
    moduloQV(g.ctx).then(ok => {
      g.qvPidiendo = false;
      if (!ok || g.dead || g.qv) return;
      try {
        const n = new AudioWorkletNode(g.ctx, 'quita-voces', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
        n.port.onmessage = e => { const d = e.data || {}; if (d.type === 'listo') QV_LAT.s = +d.latencia || 0; };
        g.src.disconnect();          // (el mismo nodo, sin volver a crear el medio: no hay hueco ni salto)
        g.src.connect(n); n.connect(g.dry);
        g.qv = n;
        n.port.postMessage({ nivel: vozNivel });
      } catch (e) { console.warn('[quitar voces]', e && e.message); }
    });
  }
  function vozAplicar(st) {
    st = st || {};
    const c = g(), a = G.audio;
    if (!c || !a) return;
    const S = SONGS[c.state.songSel];
    const pre = quierePreparada(st, S);
    // Cambiar de pista a mitad de canción: mismo <audio>, así el grafo de Web Audio sigue enganchado y el reloj no salta.
    if (Boolean(a._sinVoz) !== Boolean(pre) && a._cambiarPista) a._cambiarPista(pre);
    vozNivel = pre ? 0 : nivelFiltro(st);
    if (a._g) vozPoner(a._g, vozNivel);
  }
  G.vozAplicar = vozAplicar;

  // ------------------------------------------------------------------ audio de la canción y reloj
  function startAudio(chart, S) {
    stopAudio();
    // Ajustes → Voz de la canción: quitada (con la pista preparada; si no la hay, en vivo), en vivo o entera.
    const st = (g() && g().state.settings) || {};
    const conSinVoz = quierePreparada(st, S);            // pre-procesada: la voz ya no está en el fichero
    vozNivel = conSinVoz ? 0 : nivelFiltro(st);
    const a = new Audio(conSinVoz ? S.song.sinVoz : S.song.audioUrl);
    a._sinVoz = conSinVoz;
    // Cambiar de pista a mitad de canción (Ajustes → Voz): mismo elemento, así el grafo de Web Audio sigue enganchado
    // y el reloj del audio no salta de golpe: se recoloca en el mismo segundo y sigue sonando.
    a._cambiarPista = pre => {
      const cc = g();
      const SS = cc && SONGS[cc.state.songSel];
      const url = pre ? (SS && SS.song && SS.song.sinVoz) : (SS && SS.song && SS.song.audioUrl);
      if (!url) return;
      const pos = a.currentTime, sonando = !a.paused;
      a._sinVoz = pre;
      a.addEventListener('loadedmetadata', () => {
        try { a.currentTime = pos; } catch (_) { }
        if (sonando) a.play().catch(() => { });
      }, { once: true });
      a.src = url;
      a.load();
    };
    a.preload = 'auto';
    a.volume = vol('music');
    G.audio = a; G.clock = { at: 0, perf: 0, playing: false };
    G.songEnded = false;
    a.addEventListener('ended', () => (G.songEnded = true));
    // (si el audio falla mientras aún se ve la cuenta atrás o la transición, también hay que avisar: antes se ignoraba
    // y la partida se quedaba clavada en 0:00)
    a.addEventListener('error', () => { const c = g(); if (c && G.audio === a && c.chart === chart) { c.chart = null; c.setState({ err: 'song' }); G.failed = S.title; } });
    a.addEventListener('loadedmetadata', () => { if (isFinite(a.duration)) chart.duration = chart.end ? Math.min(chart.end, a.duration) : Math.max(chart.duration, a.duration); }, { once: true });
    if (S.song.start) a.currentTime = S.song.start / 1000;
    songGraph(a);
    a.play().catch(() => {});
    menuMusic(false);
    // El servidor lleva su propia cuenta de la puntuación con la voz que reenvía (docs/PUNTUACION.md): le decimos qué se
    // canta, con qué margen cada cantante y el ajuste del micro; después, cada segundo, dónde va el reloj (G.update)
    const c = g();
    if (G.net && !G.preview && c) {
      const singers = (c.state.singers || []).filter(s => s.id != null && !s.bot).map(s => ({ id: s.id, part: s.part === 1 ? 1 : 0, tol: (s.tol || 1) / G.PRECISION }));
      G.net.send({ type: 'sing', song: S.id, duo: c.state.mode === 'duo', delay: (c.state.settings && c.state.settings.delay) || 0, singers });
      G.clockSent = 0;
    }
  }
  function sendClock(c, pos) {
    if (!G.net || G.preview || G.mega) return;
    G.clockSent = performance.now();
    G.net.send({ type: 'clock', pos, playing: !(c && c.state.paused) && !!G.audio && !G.audio.paused && !G.audio._pausing, lat: Math.round(G.net.halfLatency || 0) });
  }
  // Pausa suave: la canción pasa por Web Audio y, al pausar, se desvanece poco a poco (~0,6 s) en vez de cortarse
  // en seco; luego se vuelve al punto exacto donde se pulsó pausa, para que al seguir no se salte nada.
  const PAUSA = { OUT: 0.6, IN: 0.35 };
  function songGraph(a) {
    if (a._g !== undefined) return a._g;
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== 'running') return (a._g = null);   // sin contexto activo, mejor sin fundido que sin sonido
    try {
      const src = ctx.createMediaElementSource(a), dry = ctx.createGain();
      src.connect(dry); dry.connect(ctx.destination);
      a._g = { ctx, dry, src, qv: null, dead: false };
      // La pista pre-procesada ya viene sin voz: el filtro en vivo no se mete (solo estropearía lo que queda).
      if (vozNivel && !a._sinVoz) vozPoner(a._g, vozNivel);
    } catch { a._g = null; }
    return a._g;
  }
  function songPause(a) {
    if (a._pausing || a.paused) return;
    whoosh(0.85);   // el «whooom» de las transiciones, mientras la canción se desvanece
    const g = songGraph(a);
    if (!g) { a.pause(); return; }
    a._pausing = true;
    const t = g.ctx.currentTime, at = a.currentTime;
    g.dry.gain.cancelScheduledValues(t); g.dry.gain.setValueAtTime(g.dry.gain.value, t);
    g.dry.gain.setTargetAtTime(0, t, PAUSA.OUT / 4);   // caída exponencial, natural al oído
    setTimeout(() => { a.pause(); try { a.currentTime = at; } catch {} a._pausing = false; }, PAUSA.OUT * 1000 + 40);
  }
  function songResume(a) {
    if (a._pausing) return;
    const g = a._g;
    if (g) { const t = g.ctx.currentTime; g.dry.gain.cancelScheduledValues(t); g.dry.gain.setValueAtTime(0.0001, t); g.dry.gain.exponentialRampToValueAtTime(1, t + PAUSA.IN); }
    a.play().catch(() => {});
  }
  function stopAudio() { megaStop(); if (G.audio) { if (G.audio._g) G.audio._g.dead = true; G.audio.pause(); G.audio.removeAttribute('src'); G.audio.load(); G.audio = null; } }
  G.stopAudio = stopAudio;   // (el diseño lo llama si se cancela la transición hacia el canto)
  // Retraso de salida del audio de un AudioContext (lo que tarda el sonido en salir por los altavoces de la tele).
  // Cuando la canción suena por Web Audio, el reloj de la letra y las cajas lo descuenta para ir con lo que se oye.
  G.AV_EXTRA = 0;   // ajuste fino manual (s), por si una tele concreta lo necesita
  const outLat = ctx => ctx ? Math.min(0.5, (ctx.outputLatency || 0) + (ctx.baseLatency || 0)) : 0;
  // (el filtro de quitar voces añade su ventana de retardo: se descuenta igual que la salida del AudioContext)
  const latCancion = g => outLat(g.ctx) + (g.qv ? QV_LAT.s : 0);
  G.outLat = () => ({ cancion: G.audio && G.audio._g ? +latCancion(G.audio._g).toFixed(3) : 0, megamix: G.mega && G.mega.ctx ? +outLat(G.mega.ctx).toFixed(3) : 0 });
  function audioNow() {
    if (G.mega && G.mega.ctx) return Math.max(0, megaNow() - outLat(G.mega.ctx) - G.AV_EXTRA);
    return Math.max(0, audioNowRaw() - (G.audio && G.audio._g ? latCancion(G.audio._g) : 0) - G.AV_EXTRA);
  }
  function audioNowRaw() {
    const a = G.audio;
    if (!a) return 0;
    const at = a.currentTime, p = performance.now() / 1000, ck = G.clock;
    if (a.paused) { ck.playing = false; return at; }
    // Algunas teles actualizan currentTime a saltos (cada ~250 ms): no corregir de golpe salvo desvío grande,
    // y si no, acercarse poco a poco al valor real para que las notas se deslicen sin tirones.
    const pred = ck.at + p - ck.perf;
    if (!ck.playing || Math.abs(at - pred) > 0.5) { Object.assign(ck, { at, perf: p, playing: true }); G.stats.resets++; }
    else if (at !== ck.raw) {
      if (ck.rawAt) G.stats.steps.push(p - ck.rawAt);
      if (G.stats.steps.length > 50) G.stats.steps.shift();
      ck.rawAt = p;
      ck.at += (at - pred) * 0.06;
    }
    ck.raw = at;
    return ck.at + p - ck.perf;
  }
  // Videoclip: sigue al reloj de la canción (#VIDEOGAP), se pausa con ella y se recoloca si se desvía
  function syncVideo(c) {
    const v = document.querySelector('video[data-gramola="videoclip"]');
    if (!v || !c.chart || !G.audio) return;
    const S = SONGS[c.state.songSel];
    const gap = S && S.song ? (S.song.videoGap || 0) / 1000 : 0;
    const want = audioNow() - gap;
    v.muted = true;
    if (c.state.paused || G.audio.paused || want < 0) { if (!v.paused) v.pause(); if (want < 0 && v.currentTime > 0.05) v.currentTime = 0; return; }
    // Recolocar el vídeo solo si se desvía de verdad (cada salto del vídeo se nota como un tirón)
    if (v.readyState >= 1 && Math.abs(v.currentTime - want) > 0.3 && (!isFinite(v.duration) || want < v.duration)) { v.currentTime = want; G.stats.seeks++; }
    if (v.paused && (!isFinite(v.duration) || want < v.duration)) v.play().catch(() => {});
  }
  // ------------------------------------------------------------------ rendimiento
  G.hudEvery = 0.5;
  let bgFrame = 0, bgDrawn = false;
  G.skipBg = c => {
    const s = c.state;
    if (s.screen !== 'sing' || !c.chart || c.bgK == null || c.bgK < 0.999) { bgDrawn = false; return false; }
    if (G.cam.active && c.variant() === 'C') {
      if (!bgDrawn && c.bgC) { const x = c.bgC.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#000'; x.fillRect(0, 0, 1920, 1080); bgDrawn = true; }
      return true;
    }
    return (bgFrame++ % 3) !== 0; // fondo animado lento: a ~20 fps
  };
  // Cronómetro: cuánto tarda cada parte por fotograma (para la telemetría)
  G.timing = { update: 0, sing: 0, bg: 0, n: 0, renders: 0, renderMs: 0 };
  function timeMethods(c) {
    if (c.__timed) return;
    c.__timed = true;
    for (const [m, k] of [['update', 'update'], ['drawSing', 'sing'], ['drawBg', 'bg']]) {
      if (typeof c[m] !== 'function') continue;
      const orig = c[m].bind(c);
      c[m] = function () { const t = performance.now(); const r = orig.apply(null, arguments); G.timing[k] += performance.now() - t; if (k === 'sing') G.timing.n++; return r; };
    }
    if (typeof c.render === 'function') {
      const r0 = c.render.bind(c);
      c.render = function () { const t = performance.now(); const r = r0(); G.timing.renders++; G.timing.renderMs += performance.now() - t; return r; };
    }
  }
  // ------------------------------------------------------------------ cámara de fondo
  // Si hay una cámara (p. ej. la Logitech por USB), su imagen va de fondo en el canto (variante oscura del diseño);
  // si no, la variante clara del diseño.
  G.cam = { available: false, active: false, el: null, stream: null, error: null, label: '' };
  async function probeCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('sin getUserMedia');
      const st = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      G.cam.available = true; G.cam.label = (st.getVideoTracks()[0] || {}).label || 'cámara';
      st.getTracks().forEach(t => t.stop());
    } catch (e) { G.cam.available = false; G.cam.error = e.name || String(e); }
  }
  async function cameraOn(c) {
    if (!G.cam.available || G.cam.active) return;
    G.cam.active = true;
    try {
      G.cam.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (!G.cam.el) {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.autoplay = true; v.setAttribute('muted', ''); v.id = 'gramola-cam';
        Object.assign(v.style, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', objectFit: 'cover', transform: 'scaleX(-1)', display: 'none' });
        G.cam.el = v;
      }
      if (c.bgC && c.bgC.parentNode && G.cam.el.parentNode !== c.bgC.parentNode) c.bgC.parentNode.insertBefore(G.cam.el, c.bgC.nextSibling);
      G.cam.el.srcObject = G.cam.stream;
      await G.cam.el.play().catch(() => {});
    } catch (e) { G.cam.active = false; G.cam.error = e.name || String(e); }
  }
  function cameraOff() {
    if (G.cam.stream) G.cam.stream.getTracks().forEach(t => t.stop());
    G.cam.stream = null; G.cam.active = false;
    if (G.cam.el) { G.cam.el.style.display = 'none'; G.cam.el.srcObject = null; }
  }
  G.cameraState = () => G.cam.available ? (G.cam.active ? 'cámara activa: ' + G.cam.label : 'cámara disponible: ' + G.cam.label) : 'sin cámara' + (G.cam.error ? ' (' + G.cam.error + ')' : '');

  // ------------------------------------------------------------------ carril por frases
  // Las notas de la frase actual ocupan todo el ancho (sin desplazamiento ni flecha). Al acertar, la caja se
  // rellena con el color del cantante; si desafina, su voz se pinta fuera de la caja, a la altura que canta.
  const INK = '#201e1d', GOLD = '#F2C230', SLOT = 0.04;
  function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  G.pageLane = function (c, L, part, ks, light) {
    const ch = this.chart, now = this.now, S = this.state.singers, cols = S.map(s => s.color), K = ks.length;
    const PH = part == null ? ch.phrases : ch.phrases.filter(p => p.parts.includes(part));
    if (!PH.length) return;
    // Página = frase actual (o la siguiente si ya terminó la anterior)
    let pi = G.lyrIdx(PH, now);
    if (pi < 0) pi = PH.length - 1;
    const ph = PH[pi];
    const t0 = ph.start, t1 = Math.max(ph.end, t0 + 0.5);
    const x0 = light ? L.x + 60 : 140, x1 = light ? L.x + L.w - 60 : 1920 - 480; // en oscuro, a la derecha van los marcadores
    const xOf = t => x0 + (t - t0) / (t1 - t0) * (x1 - x0);
    const ps = ph.notes.filter(n => n.type !== 'free' || true).map(n => n.p);
    let lo = Math.min(...ps) - 2, hi = Math.max(...ps) + 2;
    if (hi - lo < 10) { const m = (hi + lo) / 2; lo = m - 5; hi = m + 5; }
    const top = L.y + 34, bot = L.y + L.h - 34;
    const yOf = p => bot - (Math.max(lo - 1.5, Math.min(hi + 1.5, p)) - lo) / (hi - lo) * (bot - top);
    const H = K <= 1 ? 32 : Math.min(48, 26 + K * 4);
    c.save(); c.beginPath(); c.rect(0, L.y, 1920, L.h); c.clip();
    if (light) { // carril blanco del diseño (variante clara)
      c.fillStyle = G.laneAlpha < 1 ? 'rgba(255,255,255,' + G.laneAlpha + ')' : '#fff'; c.fillRect(L.x, L.y, L.w, L.h);
      c.fillStyle = INK; c.fillRect(L.x, L.y, L.w, 2); c.fillRect(L.x, L.y + L.h - 2, L.w, 2);
      c.fillStyle = '#eae7e7'; for (let p = Math.ceil(lo); p <= hi; p += 2) c.fillRect(L.x, yOf(p), L.w, 2);
    }
    // Cajas de la frase
    for (const n of ph.notes) {
      const x = xOf(n.start), w = Math.max(10, xOf(n.start + n.dur) - x), y = yOf(n.p) - H / 2, R = Math.min(6, H / 2, w / 2);
      if (n.type === 'free') { c.setLineDash([10, 8]); c.lineWidth = 2; c.strokeStyle = light ? '#7d7979' : 'rgba(243,242,242,0.7)'; rr(c, x + 1, y + 1, w - 2, H - 2, R); c.stroke(); c.setLineDash([]); continue; }
      rr(c, x, y, w, H, R); c.save(); c.clip();
      if (n.type === 'gold') { c.fillStyle = 'rgba(242,194,48,0.35)'; c.fillRect(x, y, w, H); }
      else if (n.type === 'rap' && !light && this.stripeD) { c.fillStyle = c.createPattern(this.stripeD, 'repeat'); c.fillRect(x, y, w, H); }
      else if (n.type === 'rap' && light && this.stripeL) { c.fillStyle = c.createPattern(this.stripeL, 'repeat'); c.fillRect(x, y, w, H); }
      else { c.fillStyle = light ? '#eae7e7' : 'rgba(243,242,242,0.62)'; c.fillRect(x, y, w, H); }
      // Relleno por cantante (franjas si cantan varios) según las ranuras acertadas
      const sh = H / K;
      ks.forEach((k, q) => {
        const sl = n.sl && n.sl[k]; if (!sl) return;
        c.fillStyle = n.type === 'gold' && K === 1 ? GOLD : cols[k];
        const sw = w / sl.length; let i = 0;
        while (i < sl.length) { if (sl[i]) { let j = i; while (j < sl.length && sl[j]) j++; c.fillRect(x + i * sw, y + q * sh, (j - i) * sw + 0.5, sh); i = j; } else i++; }
      });
      if (K > 1) { c.fillStyle = 'rgba(32,30,29,0.25)'; for (let q = 1; q < K; q++) c.fillRect(x, y + q * sh - 0.5, w, 1); }
      c.restore();
      c.lineWidth = 2; c.strokeStyle = n.type === 'gold' ? (light ? '#9A7400' : GOLD) : INK; rr(c, x + 1, y + 1, w - 2, H - 2, Math.max(0, R - 1)); c.stroke();
    }
    // Vibrato: dos ondas suaves y entrelazadas con brillo del color del cantante, más destellos que titilan,
    // desde que se detecta hasta donde va la voz
    for (const n of ph.notes) {
      if (!n.vibFrom) continue;
      ks.forEach((k, q) => {
        const from = n.vibFrom[k]; if (from == null) return;
        const xa = xOf(Math.max(from, n.start)), xb = xOf(Math.min(n.start + n.dur, now));
        const yc = yOf(n.p) - H / 2 + (K > 1 ? (q + 0.5) * H / K : H / 2);
        if (xb - xa < 4) return;
        const amp = (K > 1 ? H / K : H) * 0.85, wl = 150, col = cols[k];
        c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
        const wave = ph0 => { c.beginPath(); for (let x = xa; x <= xb; x += 3) { const env = Math.min(1, (x - xa) / 40, (xb - x) / 25 + 0.25);
          const y = yc + amp * env * Math.sin((x - xa) / wl * Math.PI * 2 - now * 5 + ph0); x === xa ? c.moveTo(x, y) : c.lineTo(x, y); } };
        for (const ph0 of [0, Math.PI]) {
          wave(ph0); c.strokeStyle = col; c.globalAlpha = 0.18; c.lineWidth = 12; c.stroke();   // halo
          wave(ph0); c.globalAlpha = 0.35; c.lineWidth = 6; c.stroke();
          wave(ph0); c.strokeStyle = '#fff'; c.globalAlpha = 0.85; c.lineWidth = 2; c.stroke(); // hilo de luz
        }
        // Destellos: puntos fijos a lo largo del tramo que se encienden y apagan a ritmos distintos
        for (let i = 0, x = xa + 5; x < xb - 4; i++, x += 8) {
          const seed = Math.sin((n.i * 31 + k * 7 + i) * 12.9898) * 43758.5453, r = seed - Math.floor(seed);
          const tw = 0.5 + 0.5 * Math.sin(now * (6 + r * 8) + r * 20); if (tw < 0.3) continue;
          const yy = yc + (r - 0.5) * H * 0.7, sz = 1.5 + 2.5 * tw * r;
          c.globalAlpha = tw; c.fillStyle = r > 0.55 ? '#F2C230' : '#fff';
          c.beginPath(); c.moveTo(x, yy - sz * 2); c.lineTo(x + sz * 0.5, yy - sz * 0.5); c.lineTo(x + sz * 2, yy); c.lineTo(x + sz * 0.5, yy + sz * 0.5);
          c.lineTo(x, yy + sz * 2); c.lineTo(x - sz * 0.5, yy + sz * 0.5); c.lineTo(x - sz * 2, yy); c.lineTo(x - sz * 0.5, yy - sz * 0.5); c.closePath(); c.fill();
        }
        c.restore();
      });
    }
    // Voz desafinada (o entre notas): fuera de la caja, a la altura que se canta
    ks.forEach((k, q) => {
      const hist = this.hist[k] || [], sg = S[k], col = cols[k];
      c.fillStyle = col; c.strokeStyle = INK; c.lineWidth = 1.5;
      for (let i = 0; i < hist.length; i++) {
        const e = hist[i];
        if (e.p == null || e.t < t0 - 0.05 || e.t > t1 + 0.05 || e.t > now) continue;
        const n = ph.notes.find(m => e.t >= m.start && e.t < m.start + m.dur && m.type !== 'free');
        if (n && Math.abs(e.p - n.p) <= G.tolOf(sg, n)) continue; // acertado: ya está en la caja
        const nx = hist[i + 1] && hist[i + 1].t - e.t < 0.12 ? hist[i + 1].t : e.t + SLOT;
        const x = xOf(e.t), w = Math.max(3, xOf(nx) - x + 1), y = yOf(e.p) + (q - (K - 1) / 2) * 3 - H * 0.22;
        c.globalAlpha = 0.85; c.fillRect(x, y, w, H * 0.44); c.globalAlpha = 1;
      }
    });
    // Línea de avance (fina) para saber por dónde va la frase
    if (now >= t0 && now <= t1) { c.fillStyle = light ? 'rgba(32,30,29,0.3)' : 'rgba(243,242,242,0.55)'; c.fillRect(xOf(now) - 1, L.y + 14, 2, L.h - 28); }
    // Las chispas salen de la posición actual
    L.rx = Math.max(x0, Math.min(x1, xOf(now)));
    // Cuenta atrás antes de la primera frase (como en el diseño)
    const f0 = PH[0].start;
    // (sin el 3-2-1 sobre el carril: la barra de aproximación de la letra ya marca cuándo entrar)
    c.restore();
  };

  // Videoclips desactivados (01-nov-2026): la LG no reproduce un segundo vídeo; en su lugar, la cámara o el fondo claro
  G.videoUrl = () => null;

  // ------------------------------------------------------------------ voz de los móviles
  function onPitch(m) {
    const f = G.frames[m.p] || (G.frames[m.p] = { low: true });
    f.n = m.n; f.v = m.v; f.lat = m.lat || 0; f.at = performance.now();
    // Calibración: arranques de voz («pa»)
    if (G.cal && G.cal.on) {
      if (f.low && m.v > 0.12) {
        f.low = false;
        const when = performance.now() - f.lat - (G.net ? G.net.halfLatency : 0);
        G.cal.onsets.push(when);
      } else if (!f.low && m.v < 0.05) f.low = true;
    }
  }
  // Listón de afinación (01-nov-2026, pedido del usuario): con 0,5 basta un 50 % de precisión → márgenes ÷ 0,5
  // (Fácil ±4 · Normal ±2 · Difícil ±1 semitonos). Y la voz cuenta aunque llegue unos ms antes/después de la nota.
  G.PRECISION = 0.5;
  G.TIME_MARGIN = 0.07;
  G.tolOf = (sg, n) => sg.tol / G.PRECISION + (n && n.type === 'rap' ? 0.6 : 0);
  // Retraso total de un cantante (s): ajuste del micro + red del móvil + red de la tele
  const delayOf = (c, f) => ((c.state.settings.delay || 0) + (f ? f.lat : 0) + (G.net ? G.net.halfLatency : 0)) / 1000;

  // Vibrato: en notas largas, la voz oscila alrededor de la nota de forma regular (4–8,5 veces por segundo,
  // 0,3–2,2 semitonos de pico a pico). Recibe las lecturas del móvil [{t, m}] (m = nota MIDI decimal).
  G.laneAlpha = 0.8;   // carril blanco algo transparente: deja ver la portada de fondo
  G.VIB = { MIN_NOTE: 0.8, RATE: [4, 8.5], EXTENT: [0.3, 2.2], BONUS: 0.5 };
  G.vibrato = samples => {
    if (!samples || samples.length < 12) return null;
    const ms = samples.map(s => s.m).sort((a, b) => a - b), med = ms[ms.length >> 1];
    const pts = samples.filter(s => Math.abs(s.m - med) <= 2.5);
    if (pts.length < 12) return null;
    const span = pts[pts.length - 1].t - pts[0].t;
    if (span < 0.5) return null;
    // Quitar la tendencia (si la nota sube o baja poco a poco no es vibrato)
    const n = pts.length, mt = pts.reduce((a, p) => a + p.t, 0) / n, mm = pts.reduce((a, p) => a + p.m, 0) / n;
    let sxy = 0, sxx = 0; pts.forEach(p => { sxy += (p.t - mt) * (p.m - mm); sxx += (p.t - mt) ** 2; });
    const slope = sxx ? sxy / sxx : 0;
    const raw = pts.map(p => p.m - (mm + slope * (p.t - mt)));
    const r = raw;   // sin suavizar: con 25 lecturas/s un suavizado aplana los vibratos rápidos; la histéresis filtra el ruido
    // Cruces por cero con histéresis → frecuencia y regularidad de la oscilación
    const H = 0.09, cross = []; let sign = 0;
    r.forEach((v, i) => { const s = v > H ? 1 : v < -H ? -1 : 0; if (s && sign && s !== sign) cross.push(pts[i].t); if (s) sign = s; });
    if (cross.length < 4) return { ok: false, rate: 0, extent: 0 };
    const rate = (cross.length - 1) / (2 * (cross[cross.length - 1] - cross[0]));
    const iv = cross.slice(1).map((c, i) => c - cross[i]), mi = iv.reduce((a, b) => a + b, 0) / iv.length;
    const cv = Math.sqrt(iv.reduce((a, b) => a + (b - mi) ** 2, 0) / iv.length) / mi;
    const extent = Math.PI * raw.reduce((a, v) => a + Math.abs(v), 0) / n;   // pico a pico aproximado
    const ok = rate >= G.VIB.RATE[0] && rate <= G.VIB.RATE[1] && extent >= G.VIB.EXTENT[0] && extent <= G.VIB.EXTENT[1] && cv <= 0.5;
    return { ok, rate: +rate.toFixed(2), extent: +extent.toFixed(2), cv: +cv.toFixed(2) };
  };

  // Sustituye a update(dt) del diseño: misma lógica, pero con la voz real y el reloj del audio
  G.update = (c, dt) => {
    const ch = c.chart;
    if (!ch) return;
    megaPause(c.state.paused);
    if (c.state.paused) { if (G.audio && !G.audio.paused && !G.audio._pausing) { const at = audioNow(); songPause(G.audio); sendClock(c, at); } return; }
    if (G.audio && G.audio.paused && !G.songEnded) { songResume(G.audio); G.clockSent = 0; }
    const S = c.state.singers, K = S.length, duel = c.state.mode === 'duel';
    const now = audioNow();
    c.now = now;
    if (!G.clockSent || performance.now() - G.clockSent > 1000) sendClock(c, now);
    // La nota activa en t: primero la que lo contiene de verdad; si no hay, la que lo alcanza con el margen (antes, con
    // dos notas pegadas, el margen de la anterior «robaba» la primera ranura de la siguiente y el 100 % era imposible)
    const actAt = (t, part, m = 0) => {
      let near = null;
      for (const n of ch.notes) {
        if (n.type === 'free' || !n.parts.includes(part)) continue;
        if (t >= n.start && t < n.start + n.dur) return n;
        if (!near && m && t >= n.start - m && t < n.start + n.dur + m) near = n;
      }
      return near;
    };
    for (let k = 0; k < K; k++) {
      const sg = S[k];
      const f = sg.id != null ? G.frames[sg.id] : null;
      let sung = null, a = null, t = now;
      if (sg.bot || sg.id == null) {
        // Cantante simulado: exactamente como en el diseño
        a = actAt(now, sg.part);
        if (a) {
          const kk = (now - a.start) / a.dur, q = a.q[k];
          let err;
          if (q === 'good') err = 0.25 * Math.sin(now * 9 + a.i + k * 1.7);
          else if (q === 'partial') err = kk < 0.55 ? 0.3 * Math.sin(now * 8 + k) : 0.3 + (kk - 0.55) * 4.5;
          else err = a.off[k] + 0.3 * Math.sin(now * 7 + k);
          const tgt = a.p + err;
          sung = kk < 0.12 && c.lastP[k] != null ? c.lastP[k] + (tgt - c.lastP[k]) * (kk / 0.12) : tgt;
        }
      } else {
        // Voz real: la muestra que llega ahora se cantó hace «retraso» segundos
        t = now - delayOf(c, f);
        a = actAt(t, sg.part, G.TIME_MARGIN);
        const fresh = f && performance.now() - f.at < 160 && f.n != null && f.v > 0.02;
        if (fresh) {
          const ref = a ? a.midi : (c.lastRef && c.lastRef[k]) || (ch.lo + 6);
          let midi = f.n;
          const diff = ((midi - ref) % 12 + 18) % 12 - 6; // octava indiferente
          sung = (ref - ch.lo) + diff;
          if (!c.lastRef) c.lastRef = [];
          if (a) c.lastRef[k] = a.midi;
          // Vibrato: en notas largas se guardan las lecturas (una por cada una que llega del móvil) y se mira en vivo
          if (a && a.sl && a.dur >= G.VIB.MIN_NOTE) {
            if (!c.vibAt) c.vibAt = [];
            if (c.vibAt[k] !== f.at) {
              c.vibAt[k] = f.at;
              const vs = ((a.vib || (a.vib = []))[k] || (a.vib[k] = []));
              vs.push({ t, m: f.n - 12 * Math.round((f.n - a.midi) / 12) });
              if (!a.vibFrom) a.vibFrom = [];
              if (a.vibFrom[k] == null && vs.length >= 15 && vs.length % 2 === 0) {
                const win = vs.filter(s => s.t >= t - 0.9), res = G.vibrato(win);
                if (res && res.ok) a.vibFrom[k] = win[0].t;
              }
            }
          }
        }
      }
      c.hit[k] = false;
      if (a && a.sl && sung != null) {
        const tol = G.tolOf(sg, a);
        c.hit[k] = Math.abs(sung - a.p) <= tol;
        const sl = a.sl[k], si = Math.min(sl.length - 1, Math.max(0, Math.floor((Math.min(Math.max(t, a.start), a.start + a.dur - 0.001) - a.start) / SL)));
        if (c.hit[k] && !sl[si]) { sl[si] = 1; c.score[k] += ch.unitP[sg.part] * (a.type === 'gold' ? 2 : 1); }
        if (c.hit[k] && Math.random() < (a.type === 'gold' ? 0.8 : 0.3) / Math.sqrt(K)) c.spawn(k, a.type === 'gold');
      }
      c.sung[k] = sung;
      if (sung != null) c.lastP[k] = sung;
      const h = c.hist[k];
      h.push({ t, p: sung });
      while (h.length && h[0].t < now - 15) h.shift();
      c.disp[k] += (c.score[k] - c.disp[k]) * Math.min(1, dt * 6);
    }
    // Cierre de notas y frases (con margen para que lleguen las últimas muestras)
    const done = now - 0.35;
    for (const n of ch.notes) {
      if (!n.done && done >= n.start + n.dur) {
        n.done = true;
        if (n.sl) for (let k = 0; k < K; k++) {
          if (!n.parts.includes(S[k].part)) continue;
          const r = n.sl[k].reduce((x, y) => x + y, 0) / n.sl[k].length;
          c.combo[k] = r > 0.6 ? c.combo[k] + 1 : 0;
          c.best[k] = Math.max(c.best[k], c.combo[k]);
          if (n.type === 'gold' && r > 0.6) c.goldHit[k]++;
          // Vibrato bien hecho en una nota bien cantada: la mitad de lo que vale la nota, de propina
          if (n.vibFrom && n.vibFrom[k] != null && r > 0.5) {
            const bonus = Math.min(Math.round(G.VIB.BONUS * ch.unitP[S[k].part] * n.sl[k].length * (n.type === 'gold' ? 2 : 1)), Math.max(0, 10000 - c.score[k]));   // (nunca por encima de 10.000)
            if (!bonus) continue;
            c.score[k] += bonus;
            if (!c.vibs) c.vibs = [];
            c.vibs[k] = (c.vibs[k] || 0) + 1;
            c.pops.push({ k, text: 'Vibrato +' + bonus, bg: '#F2C230', fg: '#201e1d', t0: now, dy: 52 });
          }
        }
      }
    }
    const C = { red: '#ec3013', ink: '#201e1d', n3: '#d7d3d3', n5: '#9b9797' };
    const rate = r => r > 0.9 ? ['Perfecto', C.red, '#fff'] : r > 0.75 ? ['Genial', C.ink, '#fff'] : r > 0.55 ? ['Bien', '#fff', C.ink] : r > 0.3 ? ['Regular', C.n3, C.ink] : ['Fallo', C.n5, C.ink];
    for (const ph of ch.phrases) {
      if (!ph.done && done >= ph.end) {
        ph.done = true;
        const ratio = k => { let h = 0, t = 0; ph.notes.forEach(n => { if (n.sl) { h += n.sl[k].reduce((x, y) => x + y, 0); t += n.sl[k].length; } }); return t ? h / t : null; };
        if (duel) c.teams().forEach((T, t) => { const rs = T.ks.map(ratio).filter(r => r != null); if (!rs.length) return; const R = rate(rs.reduce((x, y) => x + y, 0) / rs.length); c.pops.push({ team: t, text: R[0], bg: R[1], fg: R[2], t0: now }); });
        else for (let k = 0; k < K; k++) { if (!ph.parts.includes(S[k].part)) continue; const r = ratio(k); if (r == null) continue; const R = rate(r); c.pops.push({ k, text: R[0], bg: R[1], fg: R[2], t0: now }); }
      }
    }
    if (duel) {
      const av = c.teamAvg(c.score), tgt = 0.5 + 0.5 * Math.max(-1, Math.min(1, (av[1] - av[0]) / Math.max(800, (av[0] + av[1]) / 2)));
      c.tug += (tgt - c.tug) * Math.min(1, dt * 3);
      const ld = Math.abs(av[0] - av[1]) < 60 ? c.leader : av[0] > av[1] ? -1 : 1;
      if (ld !== c.leader && av[0] + av[1] > 400) { c.leader = ld; c.pops.push({ center: true, text: 'Se adelanta ' + c.teams()[ld < 0 ? 0 : 1].name, bg: C.red, fg: '#fff', t0: now }); }
    }
    c.parts = c.parts.filter(p => (p.life -= dt) > 0);
    c.parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; });
    if (G.songEnded || now >= ch.duration) { G.songEnded = false; stopAudio(); c.finishSing(); }
  };

  // ------------------------------------------------------------------ récords
  G.saveRecord = async (c, rows) => {
    const S = SONGS[c.state.songSel];
    if (!S || !G.room || G.mega || c.state.mode === 'jukebox' || c.state.mode === 'party') return;
    const sing = c.state.singers;
    // El récord lo decide el servidor (comprueba la voz que ha visto): la pantalla de resultados se corrige con su
    // respuesta: puntos recortados, «¡Récord!» solo si lo es de verdad, o aviso si no se ha podido guardar
    const ajustar = (ok, j) => {
      const R = c.state.results; if (!R || R.rows !== rows) return;
      if (!ok) { c.conf = []; c.setState({ results: { ...R, record: false } }); c.toast(j && j.error === 'sesion' ? 'El servidor no ha visto esta canción: sin récord' : 'No se ha podido guardar el récord'); return; }
      const por = new Map((j.players || []).map(p => [p.name, p]));
      let cambio = false;
      const nuevas = rows.map(r => { const p = por.get(r.name); if (!p) return r; if (p.score !== r.score || p.streak !== r.streak) cambio = true; return { ...r, score: p.score, streak: p.streak }; });
      nuevas.sort((a, b) => b.score - a.score);
      if (!j.isNew) c.conf = [];
      if (cambio || !!j.isNew !== !!R.record) c.setState({ results: { ...R, rows: nuevas, record: !!j.isNew } });
      if (cambio) c.toast('Puntos ajustados por el servidor');
    };
    try {
      const r = await fetch('/api/records', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: G.room, token: G.token, song: S.id, title: S.title, artist: S.artist,
          players: rows.map(r => ({ id: r.id, name: r.name, score: r.score, streak: r.streak, bot: !!(sing.find(s => s.name === r.name) || {}).bot })) }),
      });
      let j = null; try { j = await r.json(); } catch {}
      ajustar(r.ok, j);
      if (r.ok) { G.records = await (await fetch('/api/records', { cache: 'no-store' })).json(); refreshRecords(); }
    } catch { ajustar(false, null); }
  };

  // ------------------------------------------------------------------ avisos (errores reales)
  G.errAct = c => {
    const e = c.state.err;
    if (c.state.errBusy) return;
    if (e === 'server' || e === 'lost') {
      c.setState({ errBusy: true });
      if (G.net) { G.net.retry = 0; G.net.connect(); }
      setTimeout(() => { if (G.netOk) { c.setState({ err: null, errBusy: false }); c.toast('Conexión recuperada'); } else c.setState({ errBusy: false }); }, 1600);
    } else { c.setState({ err: null }); if (e === 'song') c.go(c.state.mode === 'party' ? 'party' : c.state.mode === 'jukebox' ? 'menu' : 'songs'); }   // (en Pásalo o Jukebox no se vuelve a Canciones con ese modo)
  };

  // ------------------------------------------------------------------ calibración real del retraso
  G.beats = (c, phase) => {
    clearInterval(c.bTimer);
    const c0 = c.state.calib;
    c.setState({ calib: { ...c0, phase, beat: -1, marks: [] } });
    G.cal = { on: true, onsets: [], clicks: [] };
    menuMusic(false);
    let b = 0;
    const ctxA = ensureCtx();
    c.bTimer = setInterval(() => {
      const cl = c.state.calib;
      // Marca del pulso anterior: arranque de voz más cercano a su pitido
      if (b > 0) {
        const t = G.cal.clicks[b - 1];
        const on = G.cal.onsets.filter(x => x > t - 150 && x < t + 550).sort((x, y) => Math.abs(x - t) - Math.abs(y - t))[0];
        if (on != null) {
          const d = Math.round(on - t);
          cl.marks = [...cl.marks, phase === 'measure' ? d : d - cl.manual];
        }
      }
      if (b >= 8) {
        clearInterval(c.bTimer);
        G.cal.on = false;
        const m = cl.marks.slice().sort((x, y) => x - y);
        if (m.length < 3) { c.setState({ calib: { ...cl, phase: 'idle', beat: -1 } }); c.toast('No te hemos oído: acerca el móvil y di «pa» con cada pitido'); return; }
        if (phase === 'measure') {
          const v = Math.max(0, Math.min(400, Math.round(m[m.length >> 1] / 5) * 5));
          c.setState({ calib: { ...cl, phase: 'done', beat: -1, ms: v, manual: v, f: 2 } });
          c.toast('Retraso medido: ' + v + ' ms');
        } else {
          const avg = Math.round(m.reduce((x, y) => x + y, 0) / m.length);
          c.setState({ calib: { ...cl, phase: 'done', beat: -1, f: Math.abs(avg) <= 20 ? 3 : 1 } });
          c.toast(Math.abs(avg) <= 20 ? 'Sincronizado: voz y música van a la vez' : 'Aún hay ' + avg + ' ms de desfase: ajusta a mano');
        }
        return;
      }
      G.cal.clicks.push(click(ctxA));
      c.setState({ calib: { ...cl, beat: b } });
      b++;
    }, 600);
  };

  // ------------------------------------------------------------------ música de menús, avances y efectos
  let actx = null;
  function ensureCtx() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (actx && actx.state === 'suspended') actx.resume(); return actx; }
  function click(a) {
    const now = performance.now();
    if (!a) return now;
    const t = a.currentTime + 0.01, o = a.createOscillator(), gn = a.createGain();
    o.frequency.value = 1000;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.5 * Math.max(0.3, vol('fx')), t + 0.003); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(gn).connect(a.destination); o.start(t); o.stop(t + 0.15);
    return now + 10 + ((a.outputLatency || a.baseLatency || 0) * 1000);
  }
  function beep(f, d, v = 0.15, when = 0) {
    const a = ensureCtx(); if (!a || vol('fx') <= 0) return;
    const t = a.currentTime + when, o = a.createOscillator(), gn = a.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(v * vol('fx'), t + 0.005); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(gn).connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
  // «Zzzuuuum» de transición: barrido de ruido filtrado (sube y baja) + cuerpo grave + eco que se apaga.
  // Sutil a propósito: da cuerpo al cambio de pantalla sin tapar la música.
  let echo = null, lastWhoosh = 0;
  function whoosh(strength = 1) {
    const a = ensureCtx();
    const v = vol('fx') * strength;
    if (!a || a.state !== 'running' || v <= 0) return;
    const now = performance.now();
    if (now - lastWhoosh < 250) return; // no amontonar dos seguidos
    lastWhoosh = now;
    if (!echo) {
      // Eco: retardo con realimentación y paso bajo dentro del bucle (cada repetición más apagada)
      const inp = a.createGain(), dl = a.createDelay(1), fb = a.createGain(), lp = a.createBiquadFilter(), wet = a.createGain();
      dl.delayTime.value = 0.19; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 2600; wet.gain.value = 0.45;
      inp.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(a.destination);
      echo = inp;
    }
    const t = a.currentTime + 0.01, D = 0.75;
    // Ruido blanco
    const len = Math.floor(a.sampleRate * D), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.32);   // zzzuu…
    bp.frequency.exponentialRampToValueAtTime(520, t + D);       // …uuum
    const gn = a.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.32 * v, t + 0.26);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + D);
    src.connect(bp).connect(gn);
    // Cuerpo grave
    const o = a.createOscillator(), og = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.3); o.frequency.exponentialRampToValueAtTime(60, t + D);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.22); og.gain.exponentialRampToValueAtTime(0.0001, t + D);
    o.connect(og);
    for (const n of [gn, og]) { n.connect(a.destination); n.connect(echo); }
    src.start(t); src.stop(t + D + 0.05); o.start(t); o.stop(t + D + 0.05);
  }
  G.whoosh = whoosh;
  let noiseBuf = null;
  function noiseOf(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (noiseBuf = b);
  }
  // «¡Zzzup!» al moverse entre opciones: un barrido corto hacia arriba (tono + soplo), suave
  function zup() {
    G.zupCount = (G.zupCount || 0) + 1;
    const a = ensureCtx(); if (!a || vol('fx') <= 0) return;
    const t = a.currentTime + 0.005, v = vol('fx'), D = 0.11;
    const o = a.createOscillator(), og = a.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(1750, t + D * 0.8);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.24 * v, t + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t + D);
    o.connect(og); og.connect(a.destination); o.start(t); o.stop(t + D + 0.02);
    const n = a.createBufferSource(), bp = a.createBiquadFilter(), ng = a.createGain();
    n.buffer = noiseOf(a); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(1500, t); bp.frequency.exponentialRampToValueAtTime(5200, t + D);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.0001, t + D);
    n.connect(bp); bp.connect(ng); ng.connect(a.destination); n.start(t, Math.random(), D + 0.02);
  }
  G.zup = zup;
  // Tras una tecla de dirección: si ha cambiado lo seleccionado (en cualquier pantalla), suena el «zzzup»
  const FOCO = s => JSON.stringify([s.screen, s.menuF, s.songF, s.zone, s.filterF, s.ord, s.lng, s.dec, s.gen, s.setupF, s.setup,
    s.pauseF, s.paF, s.resF, s.setF, s.settings, s.recTab, s.search && s.search.f, s.party, s.calib && s.calib.f]);
  G.navBefore = (c, a) => {
    G.gridMouse = false;   // (cualquier tecla o botón del mando: la lista vuelve a seguir al foco)
    if (!'udlr'.includes(a) || a.length !== 1) return;
    const antes = FOCO(c.state);
    requestAnimationFrame(() => requestAnimationFrame(() => { const s = c.state; if (s.screen === 'sing' && !s.paused) return; if (FOCO(s) !== antes) zup(); }));
  };


  // Aplausos del público al salir los resultados: grabación real de 6 s (CC0, Wikimedia Commons), por Web Audio
  // para no quitarle el reproductor a la música de fondo en la tele LG
  let applauseBuf = null, applauseP = null;
  function applauseLoad() {
    const a = ensureCtx(); if (!a) return Promise.resolve(null);
    if (!applauseP) applauseP = fetch('/audio/aplausos.mp3').then(r => r.arrayBuffer())
      .then(ab => new Promise((ok, ko) => { const x = a.decodeAudioData(ab, ok, ko); if (x && x.catch) x.catch(ko); }))
      .then(b => (applauseBuf = b)).catch(() => (applauseP = null));
    return applauseP;
  }
  G.applause = () => {
    const a = ensureCtx(); if (!a || vol('fx') <= 0) return;
    applauseLoad().then(b => { if (!b) return; const s = a.createBufferSource(), g = a.createGain();
      s.buffer = b; g.gain.value = vol('fx') * 0.9; s.connect(g); g.connect(a.destination); s.start(); });
  };
  setTimeout(applauseLoad, 4000);   // se precarga al poco de arrancar
  // Frase de la letra que toca: cada una se queda 0,35 s tras acabar, salvo que la siguiente empiece pronto
  // (entonces se cambia en cuanto acaba, para dejar al menos 1 s a la barra de aproximación).
  G.holdOf = (PH, i) => { const p = PH[i], n = PH[i + 1]; return n ? Math.max(0, Math.min(0.35, n.start - p.end - 1)) : 0.35; };
  G.lyrIdx = (PH, now) => PH.findIndex((p, i) => p.end + G.holdOf(PH, i) > now);
  // Barra de aproximación, antes de CADA frase: k = 1 (recién aparecida, a la izquierda) … 0 (toca cantar).
  // En la intro recorre desde el principio de la canción; tras un interludio, los 2,2 s en que ya se ve la frase;
  // entre frases, desde que aparece la frase nueva.
  G.leadK = (now, PH, ci) => {
    const cur = PH[ci];
    if (now >= cur.start) { const d = (now - cur.start) / 0.5; return d < 1 ? -Math.max(1e-4, d) : 0; }   // tras encajar: sigue y se desvanece (0,5 s)
    let from = 0;
    // Tras una pausa larga, la barra sale en los últimos 3 s (antes se ve la frase quieta, sin barra)
    if (ci > 0) { const pe = PH[ci - 1].end + G.holdOf(PH, ci - 1); from = cur.start - pe > 3 ? cur.start - 3 : pe; if (now < from) return 0; }
    const ld = Math.max(0.35, cur.start - from);
    return Math.max(0, Math.min(1, (cur.start - now) / ld));
  };
  // La barra es un dibujo fijo (degradado que se desvanece por la izquierda) que se desliza hacia la letra
  // y desaparece al tocarla. xr = donde empieza la letra (menos el margen); space = sitio libre a la izquierda.
  // Dónde empieza de verdad la tinta de la primera letra de la frase (sin el margen interno del glifo ni espacios)
  G.inkLeft = (c, notes, x, size, w) => {
    const n = notes.find(m => m.s && m.s.trim()); if (!n) return x;
    c.save(); let off = 0;
    for (const m of notes) { if (m === n) break; c.font = (m.type === 'free' ? 'italic 400 ' : w) + size + 'px Archivo'; off += c.measureText(m.s).width; }
    c.font = (n.type === 'free' ? 'italic 400 ' : w) + size + 'px Archivo';
    const mt = c.measureText(n.s); c.restore();
    return x + off - (mt.actualBoundingBoxLeft || 0) + 1;     // +1: que toque (se solapa 1 px)
  };
  G.leadBar = (c, xr, ym, h, col, k, space) => {
    if (!k || space < 40) return;
    const W = Math.min(240, space * 0.45), D = space - W, y = ym - h / 2, r = Math.min(5, h / 2);
    // k > 0: acercándose; k < 0: ya ha tocado la letra, sigue adelante por encima y se desvanece deprisa
    const a = k < 0 ? -k : 0, ease = 1 - Math.pow(1 - a, 3);
    const x = k > 0 ? xr - W - D * k : xr - W + W * 0.7 * ease, fade = k > 0 ? 1 : Math.pow(1 - a, 1.5);
    c.save(); rr(c, x, y, W, h, r); c.clip(); c.fillStyle = col;
    const n = 48, w = W / n;
    for (let i = 0; i < n; i++) { c.globalAlpha = fade * Math.pow((i + 1) / n, 1.6); c.fillRect(x + w * i, y, w + 0.6, h); }
    c.restore();
  };
  const vol = k => { const c = g(); const v = c ? c.state.settings[k] : 8; return Math.max(0, Math.min(10, v ?? 8)) / 10; };
  let menuEl = null, menuOn = false, prev = null, prevFor = null, prevTimer = null;
  function fade(el, to, ms, then) {
    clearInterval(el._f); const from = el.volume, t0 = performance.now();
    el._f = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / ms); el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k >= 1) { clearInterval(el._f); then && then(); } }, 30);
  }
  function menuMusic(on) {
    if (!menuEl) { menuEl = new Audio('/audio/menu.mp3'); menuEl.loop = true; menuEl.volume = 0; }
    if (on === menuOn) {
      // Reanudar (y subir el volumen) si quedó parada o muda, p. ej. tras un avance de canción
      if (on && !prev && (menuEl.paused || (menuEl.volume < vol('music') * 0.4 && !menuEl._fading))) {
        menuEl.play().catch(() => {});
        menuEl._fading = true; fade(menuEl, vol('music') * 0.8, 700, () => (menuEl._fading = false));
      }
      return;
    }
    menuOn = on;
    if (on && !prev) { menuEl.play().catch(() => {}); fade(menuEl, vol('music') * 0.8, 700); }
    else if (!on) { menuEl._off = performance.now(); fade(menuEl, 0, 350, () => menuEl.pause()); }
  }
  // Garantía: fuera de las pantallas con música, la de menús no puede sonar. En algunas teles play() arranca tarde
  // (después del pause() del fundido) y el volumen del elemento se ignora, así que se para a la fuerza.
  function menuGuard() {
    if (!menuEl || menuOn || menuEl.paused) return;
    if (performance.now() - (menuEl._off || 0) > 450) { clearInterval(menuEl._f); menuEl.volume = 0; menuEl.pause(); }
  }
  function applyVolumes() {
    if (menuEl && menuOn && !prev) menuEl.volume = vol('music') * 0.8;
    if (G.audio) G.audio.volume = vol('music');
    G.megaVolume && G.megaVolume();
    if (prev && !prev.dead) { const t = actx.currentTime; prev.g.gain.cancelScheduledValues(t); prev.g.gain.setValueAtTime(vol("music"), t); }
  }
  // ---- Avances de canción (Web Audio): la LG solo reproduce un medio a la vez y no salta de posición antes de
  // reproducir, así que se descarga solo el trozo del mp3 desde el minuto 1 (petición por rangos), se decodifica
  // y se funde con nodos de ganancia. Se precargan los trozos de las vecinas (±2).
  const CLIP = 30, XF = 0.7;
  const pcache = new Map();          // id de canción → { p: promesa de los bytes del trozo }
  const previewStart = S => {
    const l = S.song.lines, last = l.length ? l[l.length - 1].start / 1000 : 0;
    if (last > 75) return 60;                                    // el minuto uno de la canción
    const mid = l[Math.floor(l.length / 3)]; return Math.max(0, ((mid ? mid.start : 30000) - 2500) / 1000);
  };
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  function frameAt(u, i) {
    if (u[i] !== 0xFF || (u[i + 1] & 0xE0) !== 0xE0) return null;
    const ver = (u[i + 1] >> 3) & 3, layer = (u[i + 1] >> 1) & 3, bi = u[i + 2] >> 4, si = (u[i + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return null;
    const m1 = ver === 3, br = (m1 ? BR1 : BR2)[bi], sr = [44100, 48000, 32000][si] / (m1 ? 1 : ver === 2 ? 2 : 4);
    const len = Math.floor((m1 ? 144000 : 72000) * br / sr) + ((u[i + 2] >> 1) & 1);
    return { m1, br, sr, len, mono: (u[i + 3] >> 6) === 3 };
  }
  const get = (url, a, b) => fetch(url, { headers: { Range: `bytes=${a}-${b}` }, credentials: 'same-origin' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer().then(x => ({ full: r.status === 200, u: new Uint8Array(x) })); });
  async function clipBytes(url, st) {
    let h = await get(url, 0, 8191);
    if (h.full) return { whole: h.u };
    let u = h.u, base = 0, i = 0;
    if (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) {       // etiqueta ID3 (a veces con la carátula dentro)
      i = 10 + ((u[6] & 127) << 21 | (u[7] & 127) << 14 | (u[8] & 127) << 7 | (u[9] & 127)) + (u[5] & 0x10 ? 10 : 0);
      if (i + 4096 > u.length) { base = i; u = (await get(url, i, i + 8191)).u; i = 0; }
    }
    let f = null;
    for (; i < u.length - 4; i++) if ((f = frameAt(u, i)) && frameAt(u, i + f.len)) break; else f = null;
    if (!f) throw new Error('sin cabecera mp3');
    const start = base + i;
    let bps = f.br * 1000;
    const xo = i + 4 + (f.m1 ? (f.mono ? 17 : 32) : (f.mono ? 9 : 17)), tag = String.fromCharCode(...u.slice(xo, xo + 4));
    const rd = o => (u[o] << 24 | u[o + 1] << 16 | u[o + 2] << 8 | u[o + 3]) >>> 0;
    if ((tag === 'Xing' || tag === 'Info') && (u[xo + 7] & 3) === 3) {   // VBR: media real con frames y bytes
      const frames = rd(xo + 8), bytes = rd(xo + 12), dur = frames * (f.m1 ? 1152 : 576) / f.sr;
      if (dur > 0 && bytes > 0) bps = bytes * 8 / dur;
    } else if (String.fromCharCode(...u.slice(i + 36, i + 40)) === 'VBRI') {
      const bytes = rd(i + 46), frames = rd(i + 50), dur = frames * (f.m1 ? 1152 : 576) / f.sr;
      if (dur > 0 && bytes > 0) bps = bytes * 8 / dur;
    }
    const a = Math.floor(start + st * bps / 8), r = await get(url, a, a + Math.ceil((CLIP + 1) * bps / 8));
    if (r.full) return { whole: r.u };
    const c = r.u; let j = 0;                                     // cortar hasta el primer frame bueno
    for (; j < Math.min(c.length - 4, 20000); j++) { const g2 = frameAt(c, j); if (g2 && g2.sr === f.sr && frameAt(c, j + g2.len)) break; }
    return { part: c.subarray(j) };
  }
  const decode = ab => new Promise((ok, ko) => { const r = ensureCtx().decodeAudioData(ab, ok, ko); if (r && r.catch) r.catch(ko); });
  async function clipBuffer(e) {
    const b = await e.p;
    if (b.part) return decode(b.part.slice().buffer);
    // El servidor mandó el fichero entero: decodificar y quedarse con el trozo
    const all = await decode(b.whole.slice().buffer), ctx = ensureCtx();
    const s0 = Math.min(Math.floor(e.st * all.sampleRate), Math.max(0, all.length - all.sampleRate * CLIP));
    const n = Math.min(all.length - s0, Math.floor(CLIP * all.sampleRate)), out = ctx.createBuffer(all.numberOfChannels, n, all.sampleRate);
    for (let ch = 0; ch < all.numberOfChannels; ch++) out.copyToChannel(all.getChannelData(ch).subarray(s0, s0 + n), ch);
    return out;
  }
  function prepPreview(S) {
    if (!S || !S.id || !S.song || !S.song.audioUrl) return null;
    let e = pcache.get(S.id);
    if (!e) {
      const st = previewStart(S);
      e = { st, p: clipBytes(S.song.audioUrl, st) };
      e.p.catch(() => {});
      pcache.set(S.id, e);
    }
    return e;
  }
  function trimPreviews(keep) { for (const id of pcache.keys()) if (!keep.has(id)) pcache.delete(id); }
  // prev = avance sonando: { id, g: nodo de ganancia, src }
  function playClip(P, buf) {
    if (prev !== P) return;
    const ctx = ensureCtx(), t = ctx.currentTime, v = vol('music'), d = buf.duration;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gn = P.g;
    gn.gain.cancelScheduledValues(t);
    gn.gain.setValueAtTime(gn.gain.value, t);
    gn.gain.linearRampToValueAtTime(v, t + XF);
    if (d > XF * 3) { gn.gain.setValueAtTime(v, t + d - 1.2); gn.gain.linearRampToValueAtTime(0, t + d); }
    src.connect(gn);
    src.onended = () => { if (prev === P && P.src === src) playClip(P, buf); };   // en bucle, con fundido
    P.src = src; src.start(t);
  }
  function release(P) {
    if (!P) return;
    const ctx = ensureCtx(), t = ctx.currentTime;
    P.dead = true;
    P.g.gain.cancelScheduledValues(t); P.g.gain.setValueAtTime(P.g.gain.value, t); P.g.gain.linearRampToValueAtTime(0, t + XF);
    const s = P.src; P.src = null;
    setTimeout(() => { try { s && s.stop(); } catch {} try { P.g.disconnect(); } catch {} }, XF * 1000 + 100);
  }
  G.debugPreviews = () => ({ menu: menuEl && !menuEl.paused ? +menuEl.volume.toFixed(2) : 0, cache: pcache.size,
    sonando: prev ? [prev.id.slice(0, 22), +prev.g.gain.value.toFixed(2)] : null });
  function stopPreview() {
    clearTimeout(prevTimer); prevFor = null;
    const p = prev; prev = null; release(p);
    trimPreviews(new Set());
  }
  G.avanceDe = () => prevFor;   // (para las pruebas: qué canción está sonando de avance)
  function previewFor(list, idx) {
    const S = list[idx];
    if (!S || prevFor === S.id) return;
    prevFor = S.id;
    const keep = new Set();
    for (let d = -2; d <= 2; d++) { const N = list[idx + d]; if (N && prepPreview(N)) keep.add(N.id); }
    trimPreviews(keep);
    clearTimeout(prevTimer);
    // Un instante de espera por si se pasan canciones muy rápido; luego fundido cruzado
    prevTimer = setTimeout(() => {
      const e = prepPreview(S), ctx = ensureCtx();
      if (!e || !ctx) return;
      const old = prev;
      const P = { id: S.id, g: ctx.createGain(), src: null };
      P.g.gain.value = 0; P.g.connect(ctx.destination);
      prev = P;
      release(old);
      clipBuffer(e).then(buf => playClip(P, buf)).catch(() => { if (prev === P) { pcache.delete(S.id); } });
    }, 180);
  }
  // Mando de la tele: Atrás (461) → «Volver»; botones de colores → los que faltan en su mando
  addEventListener('keydown', e => {
    // Botones de colores (el mando de LG no tiene Y, X, LB ni RB): rojo=Y, verde=X, amarillo=LB, azul=RB
    const k = { 461: 'back', 403: 'y', 404: 'x', 405: 'lb', 406: 'rb' }[e.keyCode];
    if (k) { e.preventDefault(); e.stopPropagation(); const c = g(); if (c) c.act(k); }
  }, true);
  // Primer toque/tecla: los navegadores no dejan sonar nada antes
  const unlock = () => { ensureCtx(); if (menuOn && menuEl && menuEl.paused && !prev) menuEl.play().catch(() => {}); };
  addEventListener('keydown', unlock); addEventListener('pointerdown', unlock);

  // ------------------------------------------------------------------ cada fotograma
  let lastTr = null, lastRed = false, lastStep = null, lastScr2 = null;
  function transitions(s) {
    if (s.splashRed && !lastRed) whoosh(1.1);                 // nuvola → pantalla roja
    lastRed = !!s.splashRed;
    if (s.tr === 'out' && lastTr !== 'out') whoosh();          // empieza una transición
    else if (s.screen !== lastScr2 && lastScr2 !== null && s.tr !== 'in' && lastTr !== 'out' && s.screen !== 'sing') whoosh(); // cambio seco (sin animación)
    lastTr = s.tr; lastScr2 = s.screen;
    const step = s.screen === 'party' && s.party ? s.party.step : null;
    if (step && lastStep && step !== lastStep) whoosh(0.8);    // pasos de «Pasa el micro»
    lastStep = step;
  }
  const MUSIC_SCREENS = ['welcome', 'lobby', 'menu', 'setup', 'results', 'records', 'settings', 'party'];
  let lastScreen = null, lastCountN = null, lastState = '';
  G.tick = (c, ts) => {
    G.g = c;
    timeMethods(c);
    // El selector del Megamix va por encima del diseño: mientras haya un aviso (sala llena, micro…) se esconde para
    // que el aviso se vea y se pueda cerrar; al cerrarlo vuelve
    for (const u of [megaUI, credUI]) if (u) { const v = c.state.err ? 'hidden' : ''; if (u.el.style.visibility !== v) u.el.style.visibility = v; }
    if (credUI) creditsLayout(c);
    dotsWatch();
    if (!c.__lanes) {
      c.__lanes = true;
      c.drawLaneC = function (cx, L, part, ks) { return G.pageLane.call(c, cx, L, part, ks, false); };
      c.drawLane = function (cx, L, part, ks, A) { return G.pageLane.call(c, cx, L, part, ks, !!A); };
    }
    const s = c.state;
    transitions(s);
    padWatch(c);
    // Megamix: la pantalla de elección solo vive sobre el menú; la partida se suelta al volver a los menús
    if (megaUI) { if (s.screen !== 'menu') megaClose(); else megaLayout(c); }
    if (megaWant && s.screen === 'menu' && s.tr !== 'out') { megaWant = false; G.megaOpen(c); }
    if (G.mega && s.screen === 'setup') G.mega.live = true;   // (mientras sale la animación del menú, aún se ve «menu»)
    if (G.mega && G.mega.live && ['menu', 'songs', 'lobby', 'welcome', 'records', 'settings', 'party'].includes(s.screen)) { megaStop(); G.mega = null; }
    // Cámara de fondo desactivada: el canto va siempre con el fondo claro
    if (false) {
      if (!G.cam.probed) { G.cam.probed = true; probeCamera().then(() => { if (G.cam.available && c.state.screen === 'sing') { c.setState({ variant: 'C' }); cameraOn(c); } }); }
      else if (G.cam.available) cameraOn(c);
    }
    if (s.screen !== 'sing' && G.cam.active) cameraOff();
    if (s.screen === 'sing' && s.mode !== 'jukebox') {
      const want = 'A';
      if (lastScreen !== 'sing' && c.variant() !== want) c.setState({ variant: want });
    }
    if (G.cam.el) G.cam.el.style.display = s.screen === 'sing' && G.cam.active && c.variant() === 'C' ? 'block' : 'none';
    if (s.screen === 'sing') syncVideo(c);
    if (s.screen === 'sing') singBg(c, s);
    welcomeCovers(c, s);
    if (G.room && s.room !== G.room) c.setState({ room: G.room });
    drawQR();
    persistSettings(s.settings);
    // Música de menús
    menuMusic(MUSIC_SCREENS.includes(s.screen) && !(s.screen === 'party' && s.party && s.party.step === 'turn' && false));
    menuGuard();
    // Avance de la canción enfocada
    // El avance sigue siempre a la canción que enseña la ficha: también al cambiar los filtros (década, idioma…) o al
    // buscar, que cambian la lista aunque el foco se quede en la misma posición (antes seguía sonando la de antes)
    if (s.screen === 'songs' && G.ready) {
      const l = c.songsList();
      if (l.length) previewFor(l, Math.min(s.songF, l.length - 1));
      else if (prev || prevFor) stopPreview();
    } else if (prev || prevFor || pcache.size) stopPreview();
    // Pitidos de la cuenta atrás
    if (s.screen === 'count' && s.countN !== lastCountN) { lastCountN = s.countN; beep(880, 0.08, 0.2); }
    if (s.screen !== 'count') lastCountN = null;
    // Resultados: aplausos del público (una vez por partida)
    if (s.screen === 'results' && lastScreen !== 'results') G.applause();
    // Al salir del canto, parar la canción
    if (lastScreen === 'sing' && s.screen !== 'sing') stopAudio();
    if (s.screen !== lastScreen) { if (s.screen === 'results' && s.results && s.results.record) [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.18, 0.16, i * 0.09)); lastScreen = s.screen; }
    // Sin conexión con el servidor durante más de 3 s → aviso del diseño
    // (en el arranque se da más margen, 10 s, pero también se avisa: antes se quedaba en «Cargando… 95 %» sin más)
    if (!G.netOk && G.lostAt && performance.now() - G.lostAt > (s.screen === 'boot' ? 10000 : 3000) && !s.err && !['splash', 'welcome'].includes(s.screen)) c.setState({ err: G.room ? 'lost' : 'server' });
    // Estado para los móviles
    const screen = s.screen === 'count' ? 'countdown' : s.screen === 'sing' && s.mode !== 'jukebox' && !s.paused ? 'sing' : s.screen === 'sing' && s.paused ? 'pause' : s.screen === 'calib' ? 'calibrate' : s.screen === 'setup' ? 'prepare' : s.screen;
    // (en la calibración del micro canta quien quiera: todos los móviles mandan voz)
    const st = { type: 'state', screen, singers: screen === 'calibrate' ? G.players.map(p => p.id) : (s.singers || []).map(x => x.id).filter(x => x != null) };
    if (s.mode === 'party' && s.party && s.singers && s.singers[0]) st.turn = s.singers[0].name;
    // Para la administración: qué se canta y en qué modo
    if (s.mode) st.mode = s.mode;
    const cs = ['prepare', 'countdown', 'sing', 'results', 'pause'].includes(screen) || s.screen === 'sing' ? SONGS[s.songSel] : null;
    if (cs && cs.title) st.song = { title: cs.title, artist: cs.artist || '' };
    const key = JSON.stringify(st);
    if (key !== lastState && G.net) { lastState = key; G.net.send(st); }
  };

  // Textos de los avisos con datos reales
  G.errText = (k, t) => {
    if (k === 'song' && G.failed) return t.replace('El último tren', G.failed);
    if (k === 'mic' && G.micLost) return t.replace(/Nerea/g, G.micLost);
    if (k === 'lost') {
      // Lo que ha pasado de verdad: la sala vieja ya no existe, hay una nueva y los móviles tienen que volver a entrar
      if (G.lostFrom && G.room) return t.replace('Buscando la sala {room}… Los móviles volverán a entrar solos.', `La sala ${G.lostFrom} se ha perdido. La nueva es ${G.room}: los móviles tienen que volver a escanear el QR.`).replace('Reintentar ahora', 'Entendido').replace('{room}', G.room);
      return t.replace('{room}', G.room || '');
    }
    return t;
  };

  // ------------------------------------------------------------------ medidor de rendimiento (?fps=1)
  const showMeter = /[?&]fps=1/.test(location.search), silentMeter = /[?&]tv=/.test(location.search);
  if (showMeter || silentMeter) {
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', left: '8px', top: '8px', zIndex: 99999, font: '600 16px/1.3 monospace', color: '#0f0', background: 'rgba(0,0,0,.65)', padding: '6px 10px', pointerEvents: 'none', whiteSpace: 'pre' });
    if (showMeter) addEventListener('DOMContentLoaded', () => document.body.appendChild(box));
    let frames = [], last = performance.now(), lastSend = performance.now();
    const loop = now => {
      frames.push(now - last); last = now;
      if (frames.length > 300) frames.shift();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => {
      const f = frames.slice(-120), sorted = [...f].sort((a, b) => a - b);
      const avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
      const fps = Math.round(1000 / Math.max(1, avg)), p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0), worst = Math.round(sorted[sorted.length - 1] || 0);
      const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      const c = g(), st = c ? c.state : {};
      const video = !!document.querySelector('video[data-gramola="videoclip"]');
      box.textContent = `${fps} fps · p95 ${p95} ms · peor ${worst} ms${heap ? ' · ' + heap + ' MB' : ''}\n${st.screen || ''}${st.singers ? ' · ' + st.singers.length + ' cantantes' : ''}${video ? ' · vídeo' : ''}`;
      if (performance.now() - lastSend > 5000) {
        lastSend = performance.now();
        const stp = G.stats.steps.slice().sort((a, b) => a - b);
        const T = G.timing, n = Math.max(1, T.n);
        const ce = G.cam.el;
        const vinfo = G.cameraState() + (ce && G.cam.active ? ` (${ce.videoWidth}x${ce.videoHeight}, ${ce.paused ? 'pausada' : 'en marcha'}); ` : '; ');
        const note = vinfo + `ms/fotograma: update ${(T.update / n).toFixed(1)}, canto ${(T.sing / n).toFixed(1)}, fondo ${(T.bg / n).toFixed(1)}; React ${T.renders} renders (${T.renders ? (T.renderMs / T.renders).toFixed(1) : 0} ms c/u); reloj ${stp.length ? Math.round(stp[stp.length >> 1] * 1000) : '?'} ms, ${G.stats.resets} corr.; vídeo ${G.stats.seeks} recol.`;
        Object.assign(G.timing, { update: 0, sing: 0, bg: 0, n: 0, renders: 0, renderMs: 0 });
        if (silentMeter && st.screen !== 'sing' && !G.sentCam) { G.sentCam = true; } else if (silentMeter && st.screen !== 'sing') return; // en la tele, solo durante el canto (y un aviso inicial)
        fetch(G.withK ? G.withK('/api/telemetry') : '/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fps, p95, worst, heap, screen: st.screen, singers: (st.singers || []).length, video, note, ua: navigator.userAgent }) }).catch(() => {});
      }
    }, 500);
  }

  ensureCtx();
  connect();   // las canciones se cargan al recibir la sala (necesitan el pase de tele)
  return G;
})();
