// Gramola · web del móvil: unirse → elegir color → esperar → micro.
import { Net } from '/js/net.js';
import { PitchTracker, midiName } from '/js/pitch.js?v=1793577586';
import { keepAwake as awake, letSleep, wakeSupported } from '/js/wake.js';
import { nativo, plugin as nat, microHost, vibrar, alAbrirEnlace, compartirImagen } from '/js/nativo.js';
import * as H from '/m/historial.js';
import { dibujar, ESTILOS, valoracion } from '/m/compartir.js';

const $ = id => document.getElementById(id);
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const COLORS = ['#ff4fa3', '#3fd0ff', '#ffd23f', '#7cff6b', '#b38cff', '#ff8a3d', '#4fffd8', '#ff5a5a'];

let me = null;          // {id, slot, name, color, code, token}
let peek = null;        // datos de la sala antes de entrar
let chosen = 0;         // color elegido (1..8)
let tracker = null;
let screen = 's-join';
let joined = false;
let lastState = null;
let micImgSlot = 0;

const codeInputs = [0, 1, 2, 3].map(i => $('c' + i));
const params = new URLSearchParams(location.search);
const initial = (params.get('s') || LS.get('g-code') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
codeInputs.forEach((el, i) => (el.value = initial[i] || ''));
$('code-hint').textContent = params.get('s') ? 'Rellenado desde el QR de la tele' : 'Lo verás en la tele';
$('name').value = LS.get('g-name') || '';

// Sin menú de pulsación larga (copiar, guardar imagen…) ni arrastrar imágenes; en los campos de texto, sí
addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
addEventListener('dragstart', e => { if (e.target.closest('img, video, canvas')) e.preventDefault(); });
addEventListener('selectstart', e => { if (!e.target.closest || !e.target.closest('input, textarea')) e.preventDefault(); });

// El micro SOLO funciona con la app instalada (PWA): en el navegador, únicamente la pantalla de instalar
function isApp() {
  return nativo || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
}

// ---------------------------------------------------------------- ajustes (cada función se puede desactivar; por defecto, todo activado)
const puedeVibrar = nativo || 'vibrate' in navigator;
const AJ = [
  { k: 'vibBotones', t: 'Vibrar al tocar', d: 'Un toque suave al pulsar el mando, leer el QR o hacer la foto.', si: puedeVibrar },
  { k: 'vibCantar', t: 'Vibrar al acertar', d: 'Cuando cantas bien una nota dorada o te sale una frase perfecta.', si: puedeVibrar },
  { k: 'pantalla', t: 'Pantalla siempre encendida', d: 'Si la desactivas y el móvil se bloquea, el micro deja de oírte.', si: true },
  { k: 'brillo', t: 'Bajar el brillo al cantar', d: 'La pantalla se oscurece durante la canción para ahorrar batería y vuelve al acabar.', si: nativo },
  { k: 'bateria', t: 'Avisar con poca batería', d: 'Te avisa si queda poca batería o si el modo de ahorro está activado: puede frenar el micro.', si: nativo },
  { k: 'reacciones', t: 'Reacciones del público', d: 'Mientras otro canta, manda aplausos, fuego o corazones que salen en la tele.', si: true },
  { k: 'historial', t: 'Guardar tu historial', d: 'Tus resultados y logros, solo en este móvil. Desactivado, puedes compartir el último pero no se guarda.', si: true },
  { k: 'microMovil', t: 'Usar siempre el micro del móvil', d: 'Aunque haya auriculares o AirPods conectados. Desactívalo para cantar con un micro externo.', si: true },
];
let ajustes = {};
try { ajustes = JSON.parse(LS.get('g-ajustes') || '{}') || {}; } catch { ajustes = {}; }
const aj = k => ajustes[k] !== false;
function ponAjuste(k, v) {
  ajustes[k] = !!v;
  LS.set('g-ajustes', JSON.stringify(ajustes));
  aplicarAjuste(k);
}
function aplicarAjuste(k) {
  if (k === 'pantalla') {
    if (nat) nat.pantalla({ encendida: aj('pantalla') }).catch(() => {});
    if (aj('pantalla')) { if (joined) keepAwake(); } else { letSleep(); $('tip-awake').hidden = true; }
  }
  if (k === 'brillo' && nat && screen === 's-sing') nat.brillo({ bajo: aj('brillo') }).catch(() => {});
  if (k === 'bateria') revisarBateria();
  if (k === 'reacciones') verReacciones(lastState);
  if (k === 'microMovil' && tracker && tracker.setIntegrado) tracker.setIntegrado(aj('microMovil'));
}
function pintarAjustes() {
  const box = $('ajustes');
  box.innerHTML = '';
  for (const a of AJ) {
    if (!a.si) continue;
    const fila = document.createElement('label');
    fila.className = 'aj';
    const txt = document.createElement('div');
    const b = document.createElement('b'); b.textContent = a.t;
    const d = document.createElement('span'); d.textContent = a.d;
    txt.append(b, d);
    const sw = document.createElement('button');
    sw.className = 'sw'; sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', a.t);
    sw.setAttribute('aria-checked', String(aj(a.k)));
    sw.onclick = e => {
      e.preventDefault();
      ponAjuste(a.k, !aj(a.k));
      sw.setAttribute('aria-checked', String(aj(a.k)));
      if (aj('vibBotones')) vibrar(10);
    };
    fila.append(txt, sw);
    box.append(fila);
  }
}
let ajVuelta = 's-scan';
document.querySelectorAll('.aj-open').forEach(b => b.addEventListener('click', () => { ajVuelta = b.dataset.aj || screen; pintarAjustes(); show('s-ajustes'); }));
$('b-aj-reset').onclick = () => { for (const a of AJ) ponAjuste(a.k, true); pintarAjustes(); };
const toque = ms => { if (aj('vibBotones')) vibrar(ms); };

// Batería (solo app): aviso en «Esperando» si queda poca o está el modo ahorro
let batT = null;
async function revisarBateria() {
  const tip = $('tip-bat');
  if (!nat || !aj('bateria') || screen !== 's-wait') { tip.hidden = true; return; }
  try {
    const b = await nat.bateria();
    const pct = b.nivel >= 0 ? Math.round(b.nivel * 100) : null;
    let t = '';
    if (b.ahorro) t = 'El modo de ahorro de batería está activado: puede frenar el micro. Si puedes, desactívalo mientras cantas.';
    else if (pct != null && pct <= 20 && !b.cargando) t = `Te queda un ${pct} % de batería. Enchufa el móvil para no quedarte a mitad de canción.`;
    tip.textContent = t;
    tip.hidden = !t;
  } catch { tip.hidden = true; }
}

// Reacciones del público: mientras otro canta (o en los resultados), aplausos y demás que salen en la tele
function verReacciones(st) {
  const s = st && st.screen;
  $('reac').hidden = !(aj('reacciones') && joined && ['sing', 'countdown', 'results'].includes(s) && !isSinging(st));
}
let reacT = 0;
document.querySelectorAll('.reac-b button').forEach(b => b.addEventListener('click', () => {
  const t = Date.now(); if (t - reacT < 250) return; reacT = t;   // (el servidor deja 4 por segundo)
  net.send({ type: 'react', e: b.dataset.e });
  toque(10);
  b.classList.remove('hop'); void b.offsetWidth; b.classList.add('hop');
}));

// Aviso arriba (administración, logros…)
function aviso(t, ms = 6000) {
  let el = document.getElementById('g-aviso');
  if (!el) { el = document.createElement('div'); el.id = 'g-aviso'; el.className = 'aviso'; document.body.appendChild(el); }
  el.textContent = String(t).slice(0, 140);
  el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), ms);
}

// ---------------------------------------------------------------- resultado, historial y compartir
const miles = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
let ultimo = null, resActual = null, resCanvas = null, resVuelta = 's-wait', histVuelta = 's-scan';
function nuevoResultado(r) {
  r = { ...r, nombre: me ? me.name : '', color: me ? me.color : COLORS[0], slot: me ? me.slot : 1 };
  ultimo = r;
  if (aj('historial')) {
    H.guardar(r);
    H.revisarLogros().forEach((g, i) => setTimeout(() => { aviso('★ Logro conseguido: ' + g.t); if (aj('vibCantar')) vibrar(60, 'exito'); }, 600 + i * 6500));
  }
  $('res-pts').textContent = miles(r.puntos);
  $('res-txt').textContent = valoracion(r.puntos) + (r.total > 1 ? ` · ${r.puesto}.º de ${r.total}` : '');
  $('res-card').hidden = false;
}
$('res-card').onclick = () => ultimo && abrirResultado(ultimo);
async function pintarResultado() {
  const r = resActual; if (!r) return;
  const estilo = LS.get('g-estilo') || 'A';
  document.querySelectorAll('#r-estilos button').forEach(b => b.classList.toggle('sel', b.dataset.e === estilo));
  $('err-res').textContent = '';
  try {
    resCanvas = await dibujar(estilo, r, { foto: LS.get('g-photo'), micro: `/assets/micro/j${r.slot || 1}.webp`, nuvola: '/assets/nuvola/tinta.png' });
    if (resActual === r) $('r-img').src = resCanvas.toDataURL('image/jpeg', 0.86);
  } catch { $('err-res').textContent = 'No se ha podido preparar la imagen.'; }
}
function abrirResultado(r) {
  if (screen !== 's-resultado') resVuelta = screen;
  resActual = r; resCanvas = null; $('r-img').removeAttribute('src');
  const d = new Date(r.fecha || Date.now());
  $('res-fecha').textContent = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  show('s-resultado');
  pintarResultado();
}
$('r-estilos').innerHTML = ESTILOS.map(e => `<button data-e="${e.id}">${e.t}</button>`).join('');
document.querySelectorAll('#r-estilos button').forEach(b => b.onclick = () => { LS.set('g-estilo', b.dataset.e); toque(10); pintarResultado(); });
$('b-compartir').onclick = async () => {
  if (!resCanvas || !resActual) return;
  $('b-compartir').disabled = true;
  try {
    const r = resActual;
    await compartirImagen(resCanvas, `¡${miles(r.puntos)} puntos cantando «${r.titulo}» en Gramola!`, 'gramola-' + (r.fecha || Date.now()) + '.png');
  } catch { $('err-res').textContent = 'No se ha podido compartir.'; }
  $('b-compartir').disabled = false;
};
function pintarHistorial() {
  const lista = H.leer(), st = H.estadisticas(lista), hechos = H.logrosConseguidos();
  $('h-stats').innerHTML = '';
  [[st.canciones, 'canciones'], [miles(st.mejor), 'mejor puntuación'], [st.oro, 'notas doradas'], [st.racha, 'mejor racha']].forEach(([v, t]) => {
    const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; const sp = document.createElement('span'); sp.textContent = t; d.append(b, sp); $('h-stats').append(d);
  });
  $('h-logros').innerHTML = '';
  H.LOGROS.forEach(g => {
    const d = document.createElement('div'); if (hechos[g.id]) d.className = 'ok';
    const b = document.createElement('b'); b.textContent = g.t; const sp = document.createElement('span'); sp.textContent = g.d; d.append(b, sp); $('h-logros').append(d);
  });
  $('h-lista').innerHTML = '';
  lista.forEach(r => {
    const b = document.createElement('button');
    const cv = document.createElement('span'); cv.className = 'cv'; if (r.portada) cv.style.backgroundImage = `url("${r.portada}")`;
    const tx = document.createElement('span'); tx.className = 'tx';
    const t1 = document.createElement('b'); t1.textContent = r.titulo || 'Canción';
    const t2 = document.createElement('span'); t2.textContent = [r.artista, new Date(r.fecha || 0).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ');
    tx.append(t1, t2);
    const pt = document.createElement('span'); pt.className = 'pt'; pt.textContent = miles(r.puntos);
    b.append(cv, tx, pt); b.onclick = () => abrirResultado(r); $('h-lista').append(b);
  });
  $('h-vacio').hidden = lista.length > 0;
  $('b-hist-borrar').hidden = lista.length === 0;
}
document.querySelectorAll('.hist-open').forEach(b => b.addEventListener('click', () => { histVuelta = b.dataset.hist || screen; pintarHistorial(); show('s-historial'); }));
$('b-hist-borrar').onclick = () => { if (confirm('¿Borrar todo tu historial y tus logros de este móvil?')) { H.borrar(); pintarHistorial(); } };

// Volver atrás: los botones «← Volver» y el gesto de volver del móvil (historial) hacen lo mismo
const BACK = {};
let fromPop = false;
function show(id) {
  if (!isApp() && id !== 's-install') id = 's-install';
  if (BACK[id] && !fromPop && id !== screen && !(history.state && history.state.g === id)) history.pushState({ g: id }, '');
  const antes = screen;
  screen = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  // App: brillo bajo mientras se canta (si está activado) y aviso de batería en «Esperando»
  if (nat && aj('brillo') && (id === 's-sing') !== (antes === 's-sing')) nat.brillo({ bajo: id === 's-sing' }).catch(() => {});
  if (id === 's-sing' && antes !== 's-sing') $('sing-pts').textContent = '0';   // canción nueva: los puntos empiezan de cero
  clearInterval(batT);
  if (id === 's-wait') { revisarBateria(); batT = setInterval(revisarBateria, 60000); } else $('tip-bat').hidden = true;
  document.querySelector('meta[name=theme-color]').content = id === 's-sing' ? '#f3f2f2' : '#f3f2f2';
}
const code = () => codeInputs.map(i => i.value).join('').toUpperCase();

// ---------------------------------------------------------------- casillas del código
codeInputs.forEach((el, i) => {
  el.addEventListener('input', () => {
    el.value = el.value.toUpperCase().replace(/[^A-Z]/g, '').slice(-1);
    codeInputs.forEach(c => c.classList.remove('bad'));
    if (el.value && i < 3) codeInputs[i + 1].focus();
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !el.value && i > 0) codeInputs[i - 1].focus();
    if (e.key === 'Enter') $('b-next').click();
  });
  el.addEventListener('paste', e => {
    const t = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (t.length > 1) { e.preventDefault(); codeInputs.forEach((c, j) => (c.value = t[j] || '')); }
  });
});
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') codeInputs[code().length < 4 ? code().length : 0].focus(); });

// ---------------------------------------------------------------- red
const net = new Net(onMessage, st => {
  if (st === 'open') {
    if (screen === 's-reconnect') show(joined ? (lastState && isSinging(lastState) ? 's-sing' : 's-wait') : 's-join');
  } else if (st === 'closed' && joined && screen !== 's-closed') {
    setTimeout(() => { if (net.ws && net.ws.readyState !== 1 && joined) show('s-reconnect'); }, 1500);
  }
});
let hello = null;
net.connect(() => hello);

let autoVuelta = false;   // volver sola a la sala al reabrir la app (si ya no existe, a escanear, sin error)
function onMessage(m) {
  if (m.type === 'error' && autoVuelta) {
    autoVuelta = false; peek = null; hello = null; LS.del('g-code');
    codeInputs.forEach(c => (c.value = ''));
    return show('s-scan');
  }
  if (m.type === 'peek' || m.type === 'joined') autoVuelta = false;
  if (m.type === 'error') {
    if (m.code === 'color-taken') {
      $('err-color').textContent = m.msg;
      peek && (peek.taken = m.taken || peek.taken);
      chosen = 0;
      renderColors();
      return show('s-color');
    }
    joined = false;
    hello = null;
    stopMic();   // fuera de la sala no se queda el micro abierto (indicador del sistema y batería)
    codeInputs.forEach(c => c.classList.add('bad'));
    $('err-join').textContent = m.code === 'no-room' ? `No hay ninguna sala ${code()}. Revisa el código de la tele.` : (m.msg || 'No se ha podido entrar en la sala');
    return show('s-join');
  }
  if (m.type === 'peek') {
    peek = m;
    if (m.full) {
      $('err-join').textContent = 'La sala está llena: ya hay 8 jugadores.';
      return show('s-join');
    }
    chosen = m.mySlot || 0;
    $('who-color').textContent = `${$('name').value.trim()} · Sala ${m.code}`;
    renderColors();
    return show('s-color');
  }
  if (m.type === 'joined') {
    me = m;
    joined = true;
    LS.set('g-token-' + m.code, m.token);
    LS.set('g-code', m.code);
    LS.set('g-when', String(Date.now()));
    document.documentElement.style.setProperty('--me', m.color);
    ['badge-wait', 'badge-sing'].forEach(id => ($(id).textContent = 'J' + m.slot));
    $('who-wait').textContent = `${m.name} · Sala ${m.code}`;
    $('sing-name').textContent = m.name;
    setMicImage(m.slot);
    // A partir de ahora, si se corta la red, volvemos a entrar con el mismo color
    hello = { type: 'join', code: m.code, name: m.name, slot: m.slot, token: m.token };
    if (photo) net.send({ type: 'photo', data: photo });   // la tele la recibe (también al reconectar)
    if (!lastState || !isSinging(lastState)) show('s-wait');
    setWaitTexts(lastState);
    return;
  }
  if (m.type === 'state') {
    lastState = m;
    if (!joined) return;
    setWaitTexts(m);
    show(isSinging(m) ? 's-sing' : 's-wait');
    return;
  }
  if (m.type === 'host') {
    if (!m.online && joined) {
      // Tele caída a mitad de canción: a la espera (y sin micro); al volver la tele se recupera el canto
      if (screen === 's-sing') show('s-wait');
      setWaitTexts(lastState); $('wait-state').textContent = 'La tele se ha desconectado…';
    } else {
      setWaitTexts(lastState);
      if (joined && screen === 's-wait' && isSinging(lastState)) show('s-sing');
    }
    return;
  }
  // Orden desde la administración: recargar la app (tras un despliegue)
  if (m.type === 'pts') { $('sing-pts').textContent = miles(m.s); return; }
  if (m.type === 'buzz') { if (aj('vibCantar')) vibrar(m.k === 'frase' ? 60 : 30, m.k === 'frase' ? 'exito' : 'medio'); return; }
  if (m.type === 'admin' && m.action === 'reload') { setTimeout(() => location.reload(), 300 + Math.random() * 1500); return; }
  // Aviso desde la administración: una franja arriba unos segundos
  if (m.type === 'admin' && m.action === 'toast' && m.text) { aviso(m.text); return; }
  if (m.type === 'resultado' && m.r) { nuevoResultado(m.r); return; }
  if (m.type === 'kicked' || m.type === 'closed' || m.type === 'replaced') {
    joined = false;
    hello = null;
    if (me) LS.del('g-token-' + me.code);
    $('closed-room').textContent = 'Sala ' + (me ? me.code : '');
    $('closed-text').textContent = m.type === 'kicked'
      ? 'La tele te ha sacado de la sala. Pide el código y vuelve a entrar.'
      : m.type === 'replaced' ? 'Tu sesión se ha abierto en otro móvil. Si no has sido tú, vuelve a entrar con el código.'
      : 'La tele ha terminado la fiesta o ha generado un código nuevo. Pide el código y vuelve a entrar.';
    stopMic();
    show('s-closed');
  }
}

// ¿Me toca cantar? (en «Pasa el micro» canta uno; en el resto, los que la tele ha elegido)
function isSinging(st) {
  if (!st || !me) return false;
  if (!['countdown', 'sing', 'calibrate'].includes(st.screen)) return false;
  return !Array.isArray(st.singers) || st.singers.includes(me.id);
}

function setWaitTexts(st) {
  const s = st && st.screen;
  const title = {
    lobby: 'Esperando a que todos entren', menu: 'Configura el modo de juego en la pantalla principal',
    songs: 'Elegid canción en la tele', prepare: 'Preparando la partida', results: '¡Mira los resultados en la tele!',
    sing: st && st.turn ? `Le toca a ${st.turn}` : 'Esta canción no te toca', countdown: st && st.turn ? `Le toca a ${st.turn}` : 'Esta canción no te toca',
    pause: 'Canción en pausa',
  }[s] || 'Configura el modo de juego en la pantalla principal';
  $('wait-title').textContent = title;
  verReacciones(st);
  $('wait-state').textContent = s === 'sing' ? 'Escuchando…' : 'Esperando…';
}

// ---------------------------------------------------------------- pasos
$('b-next').onclick = () => {
  const name = $('name').value.trim();
  const c = code();
  $('err-join').textContent = '';
  if (!name) { $('err-join').textContent = 'Pon tu nombre'; return $('name').focus(); }
  if (c.length !== 4) { $('err-join').textContent = 'El código tiene 4 letras'; return codeInputs[c.length].focus(); }
  LS.set('g-name', name);
  peek = null;
  net.send({ type: 'peek', code: c, token: LS.get('g-token-' + c) });
};

function renderColors() {
  const box = $('colors');
  box.innerHTML = '';
  const taken = new Map((peek && peek.taken || []).map(t => [t.slot, t.name]));
  COLORS.forEach((col, i) => {
    const slot = i + 1;
    const b = document.createElement('button');
    b.style.background = col;
    const owner = taken.get(slot);
    if (owner) { b.classList.add('taken'); b.textContent = owner; b.disabled = true; }
    if (slot === chosen) { b.classList.add('sel'); b.textContent = 'Tú'; }
    b.setAttribute('aria-label', owner ? `J${slot}, de ${owner}` : `Color J${slot}`);
    b.onclick = () => { chosen = slot; $('err-color').textContent = ''; renderColors(); };
    box.appendChild(b);
  });
  $('b-enter').disabled = !chosen;
}

$('b-enter').onclick = async () => {
  if (!chosen) return;
  // El micro se pide aquí porque iOS exige que sea tras pulsar un botón
  if (!(await startMic())) return;
  const c = peek.code;
  hello = { type: 'join', code: c, name: $('name').value.trim(), slot: chosen, token: LS.get('g-token-' + c) };
  net.send(hello);
  keepAwake();
};

// ---------------------------------------------------------------- micro
async function startMic() {
  if (tracker && tracker.ctx) return true;
  try {
    tracker = new PitchTracker(onPitch, { integrado: aj('microMovil') });
    await tracker.start();
    return true;
  } catch (e) {
    tracker = null;
    showBlocked(e);
    return false;
  }
}
function stopMic() { tracker && tracker.stop(); tracker = null; }

// Micro sin permiso: si el navegador aún pregunta, el botón rojo vuelve a pedirlo (sale el aviso del sistema);
// si lo tiene bloqueado, ninguna web puede forzar el aviso y se explican los pasos para activarlo a mano.
async function micPermission() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state; } catch { return 'unknown'; }
}
async function showBlocked(err) {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
  const insecure = !window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia;
  const state = insecure ? 'insecure' : await micPermission();
  const denied = state === 'denied' || (err && err.name === 'NotAllowedError' && state !== 'prompt');
  $('browser-name').textContent = insecure ? 'una página segura' : ios ? 'Safari' : /Chrome|CriOS/.test(ua) ? 'Chrome' : 'el navegador';
  let steps;
  if (insecure) {
    $('blocked-text').textContent = 'El navegador solo deja usar el micro en páginas seguras (https). Entra así:';
    steps = ['Abre ' + microHost() + ' en el móvil', 'O escanea otra vez el QR de la tele', 'Pon tu nombre y elige tu color'];
  } else if (err && err.name === 'NotFoundError') {
    $('blocked-text').textContent = 'No encontramos ningún micrófono en este aparato.';
    steps = ['Prueba con otro móvil', 'O con unos auriculares con micro'];
  } else if (denied) {
    $('blocked-text').textContent = 'El navegador tiene el micro bloqueado para Gramola. Así se arregla:';
    steps = ios
      ? ['Toca «aA» en la barra de direcciones', 'Elige «Ajustes del sitio web»', 'En Micrófono, cambia a «Permitir»', 'Vuelve aquí y recarga la página']
      : ['Toca el candado junto a la dirección', 'Entra en «Permisos»', 'Activa el Micrófono', 'Vuelve aquí y recarga la página'];
  } else {
    $('blocked-text').textContent = 'Sin micro no podemos oírte. Pulsa el botón y, cuando el móvil pregunte, elige «Permitir».';
    steps = ['Pulsa «Activar el micro»', 'En el aviso del móvil, elige «Permitir»'];
  }
  $('blocked-steps').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  $('b-ask').hidden = insecure || denied || (err && err.name === 'NotFoundError');
  show('s-blocked');
}
$('b-ask').onclick = async () => {
  // Debe ir dentro del toque: así el navegador muestra su aviso de permiso
  if (await startMic()) $('b-enter').click();
};
$('b-reload').onclick = () => location.reload();

const micStats = { frames: 0, gate: 0, voiced: 0, rms: 0, clar: 0, sr: 0, since: Date.now() };
function onPitch(n, v, info) {
  if (info) {
    micStats.frames++; micStats.rms += info.rms; micStats.sr = info.sr;
    if (info.gate) micStats.gate++;
    if (n !== null) { micStats.voiced++; micStats.clar += info.clarity; }
    if (screen === 's-tuner') drawTuner(n, v, info);
  }
  if (joined && screen === 's-sing') net.send({ type: 'pitch', n, v, lat: net.halfLatency });   // solo cuando toca cantar (la tele no lo usa en otras pantallas)
  if (screen === 's-sing') drawVu(v, n !== null);
}

// Vúmetro: 12 líneas de la rejilla, de abajo arriba
const vu = $('vu');
const BARS = 12;
for (let i = 0; i < BARS; i++) {
  const b = document.createElement('i');
  b.style.top = ((60.2 + i * 2.15) * 999 / 1420).toFixed(2) + '%';   // (medido sobre jN.webp de 999 px de alto; la alargada mide 1420)
  vu.appendChild(b);
}
let vuLevel = 0;
function drawVu(v, voiced) {
  const target = Math.min(1, v * 1.6) * (voiced ? 1 : 0.6);
  vuLevel = target > vuLevel ? target : vuLevel * 0.82 + target * 0.18;
  const lit = Math.round(vuLevel * BARS);
  [...vu.children].forEach((b, i) => { b.style.opacity = BARS - i <= lit ? '1' : '0'; });
  $('mic').firstElementChild.style.transform = `scale(${1 + vuLevel * 0.025})`;
}

function setMicImage(slot) {
  if (micImgSlot === slot) return;
  micImgSlot = slot;
  $('mic-img').src = `/assets/micro/j${slot}-largo.webp`;
  $('mic-img').alt = `Micro J${slot}`;
}

// ---------------------------------------------------------------- mando
$('b-pad').onclick = () => {
  const pad = $('pad');
  pad.hidden = !pad.hidden;
  $('b-pad').textContent = pad.hidden ? 'Usar el móvil como mando' : 'Ocultar el mando';
};
document.querySelectorAll('.pad button').forEach(b => {
  b.addEventListener('click', () => { net.send({ type: 'input', key: b.dataset.k }); toque(10); });
});

// ---------------------------------------------------------------- reconexión, sala cerrada
$('b-retry').onclick = () => { net.retry = 0; net.connect(); };
$('b-other').onclick = () => { codeInputs.forEach(c => (c.value = '')); LS.del('g-code'); show('s-join'); codeInputs[0].focus(); };

// Pantalla siempre encendida (si se apaga, el micro deja de funcionar)
function keepAwake() {
  if (!aj('pantalla')) return;
  awake(ok => { $('tip-awake').hidden = ok; });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tracker && tracker.ctx && tracker.ctx.resume();
    if (!net.ws || net.ws.readyState > 1) net.connect();
  }
});

// Vuelta tras recargar: si ya estaba en una sala, entra directamente con su color
(async () => {
  const c = initial;
  const tok = c && LS.get('g-token-' + c);
  const recent = Date.now() - (+LS.get('g-when') || 0) < 3 * 3600 * 1000;
  if (tok && recent && isApp() && $('name').value && !params.get('s')) {
    autoVuelta = true;
    peek = { code: c, taken: [] };
    net.send({ type: 'peek', code: c, token: tok });
  }
})();

// ---------------------------------------------------------------- PWA: instalar, escanear el QR
const standalone = isApp();
const fromQR = !!params.get('s');
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
if (!nativo && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});

let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('b-install').hidden = false; $('install-steps').hidden = true; });
addEventListener('appinstalled', () => { $('b-install').hidden = true; $('install-steps').hidden = false; $('install-steps').innerHTML = '<li>¡Instalado! Ábrelo desde tu pantalla de inicio: se llama «Gramola».</li>'; });

function startScreen() {
  if (!standalone) {
    // Desde el QR en el navegador: el código, para entrar luego desde la app (en iPhone no comparte datos con Safari)
    const c = (params.get('s') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (c.length === 4) { $('inst-room').hidden = false; $('inst-code').textContent = c; }
    // iPhone: Safari no tiene botón de instalar; se explican los pasos
    if (isIOS || !('BeforeInstallPromptEvent' in window)) {
      $('install-steps').hidden = false;
      $('install-steps').innerHTML = isIOS
        ? ['Toca <span class="share"></span> <b>Compartir</b>, abajo en Safari', 'Elige <b>«Añadir a pantalla de inicio»</b>', 'Abre <b>Gramola</b> desde tu pantalla de inicio'].map(x => `<li>${x}</li>`).join('')
        : ['Abre el menú del navegador (⋮)', 'Elige <b>«Instalar app»</b> o <b>«Añadir a pantalla de inicio»</b>', 'Abre <b>Gramola</b> desde tu pantalla de inicio'].map(x => `<li>${x}</li>`).join('');
    }
    return show('s-install');
  }
  if (standalone && !fromQR) return show('s-scan');
  show('s-join');
}
function SS_get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function SS_set(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
$('b-install').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  const r = await installEvt.userChoice.catch(() => null);
  installEvt = null;
  if (r && r.outcome === 'accepted') { $('b-install').hidden = true; }
};
$('b-manual').onclick = () => { show('s-join'); codeInputs[0].focus(); };

// Lector de QR: el del propio móvil (BarcodeDetector) o jsQR si no lo tiene (iPhone)
let camStream = null, scanTimer = null;
async function startScanner() {
  $('err-scan').textContent = '';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    $('err-scan').textContent = 'No podemos usar la cámara. Dale permiso o escribe el código a mano.';
    return;
  }
  show('s-camera');
  const v = $('cam-video');
  v.srcObject = camStream;
  await v.play().catch(() => {});
  let detect;
  if ('BarcodeDetector' in window) {
    try {
      const bd = new BarcodeDetector({ formats: ['qr_code'] });
      detect = async () => { const r = await bd.detect(v); return r[0] && r[0].rawValue; };
    } catch {}
  }
  if (!detect) {
    if (!window.jsQR) {
      try { await new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = '/vendor/jsQR.js'; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); }); }
      catch { stopScanner(); $('err-scan').textContent = 'No se ha podido cargar el lector de códigos. Escribe el código que sale en la tele.'; return show('s-scan'); }
    }
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      if (!v.videoWidth) return null;
      const w = 480, h = Math.round(v.videoHeight * w / v.videoWidth);
      cv.width = w; cv.height = h; cx.drawImage(v, 0, 0, w, h);
      const r = window.jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      return r && r.data;
    };
  }
  const tick = async () => {
    if (!camStream) return;
    let txt = null;
    try { txt = await detect(); } catch {}
    const code = parseRoom(txt);
    if (code) { toque(30); stopScanner(); return roomFound(code); }
    scanTimer = setTimeout(tick, 180);
  };
  tick();
}
function stopScanner() {
  clearTimeout(scanTimer);
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null;
}
function parseRoom(txt) {
  if (!txt) return null;
  const m = String(txt).match(/[?&]s=([A-Za-z]{4})\b/) || String(txt).trim().match(/^([A-Za-z]{4})$/);
  return m ? m[1].toUpperCase() : null;
}
function roomFound(code) {
  codeInputs.forEach((el, i) => (el.value = code[i] || ''));
  $('code-hint').textContent = 'Leído del QR de la tele';
  show('s-join');
  if ($('name').value.trim()) $('b-next').click(); else $('name').focus();
}
$('b-scan').onclick = startScanner;

// ---------------------------------------------------------------- volver atrás
function backFromJoin() {
  // A escanear otro QR (o escribir otro código): se olvida la sala elegida
  codeInputs.forEach(c => { c.value = ''; c.classList.remove('bad'); });
  $('err-join').textContent = ''; $('err-scan').textContent = '';
  $('code-hint').textContent = 'Lo verás en la tele';
  LS.del('g-code');
  if (/[?&]s=/.test(location.search)) history.replaceState(history.state, '', location.pathname);
  show('s-scan');
}
function backFromColor() { peek = null; chosen = 0; $('err-color').textContent = ''; show('s-join'); }
BACK['s-join'] = backFromJoin;
BACK['s-color'] = backFromColor;
BACK['s-selfie'] = () => closeSelfie();
BACK['s-camera'] = () => { stopScanner(); show('s-scan'); };
function goBack() {
  if (history.state && history.state.g === screen) history.back();   // el popstate hace el resto
  else if (BACK[screen]) BACK[screen]();
}
addEventListener('popstate', () => {
  if (!BACK[screen]) return;
  fromPop = true;
  try { BACK[screen](); } finally { fromPop = false; }
});
$('b-join-back').onclick = goBack;
$('b-color-back').onclick = goBack;
$('b-sf-back').onclick = goBack;
$('b-cam-cancel').onclick = () => goBack();

startScreen();

// Salir de la sala: se despide del servidor, olvida la sala y vuelve a empezar
$('b-leave').onclick = () => {
  if (me) { net.send({ type: 'leave' }); LS.del('g-token-' + me.code); }
  LS.del('g-code'); LS.del('g-when');
  joined = false; hello = null; me = null; lastState = null;
  stopMic();
  codeInputs.forEach(c => (c.value = ''));
  $('err-join').textContent = ''; $('err-scan').textContent = '';
  history.replaceState(null, '', location.pathname);
  show(standalone ? 's-scan' : 's-join');
};

// ---------------------------------------------------------------- probar el micro (afinador)
let tunerFrom = 's-wait', refOsc = null, refCtx = null;
$('b-tuner').onclick = async () => { if (!(await startMic())) return; tunerFrom = screen; show('s-tuner'); };
$('b-tuner-back').onclick = () => { stopRef(); show(tunerFrom === 's-tuner' ? 's-wait' : tunerFrom); };
function drawTuner(n, v, info) {
  $('t-vol').style.width = Math.round(Math.min(1, v) * 100) + '%';
  $('t-clar').style.width = Math.round((info.clarity || 0) * 100) + '%';
  if (n === null) { $('t-note').textContent = '–'; $('t-hz').textContent = info.gate ? 'Te oigo, pero no distingo la nota' : 'Silencio'; return; }
  const cents = Math.round((n - Math.round(n)) * 100);
  $('t-note').textContent = midiName(n);
  $('t-hz').textContent = (info.hz ? info.hz.toFixed(1) : '—') + ' Hz · ' + (cents > 0 ? '+' : '') + cents + ' cents';
  $('t-needle').style.left = (50 + cents) + '%';
}
function stopRef() { if (refOsc) { try { refOsc.stop(); } catch {} refOsc = null; } $('b-ref').firstChild.textContent = 'Tono de referencia · La 440 Hz '; }
$('b-ref').onclick = () => {
  if (refOsc) return stopRef();
  refCtx = refCtx || new (window.AudioContext || window.webkitAudioContext)();
  refCtx.resume();
  const g = refCtx.createGain(); g.gain.value = 0.25; g.connect(refCtx.destination);
  refOsc = refCtx.createOscillator(); refOsc.frequency.value = 440; refOsc.connect(g); refOsc.start();
  $('b-ref').firstChild.textContent = 'Parar el tono ';
};
$('t-info').textContent = 'Si el micro va bien, con el tono de referencia tiene que marcar La4 con la aguja en el centro.';

// (la telemetría del micro se quitó: el servidor solo la admite de una tele con sala y nunca se usaba)

// ---------------------------------------------------------------- foto del jugador (cámara frontal)
// Lo que se ve dentro del cuadro es exactamente la foto: recorte cuadrado del centro, en espejo como en la pantalla.
let sfStream = null, shot = '', photo = LS.get('g-photo') || '';
function photoPreview() {
  const el = $('ph-prev');
  el.style.backgroundImage = photo ? `url(${photo})` : '';
  el.classList.toggle('has', !!photo);
  $('b-photo').textContent = photo ? 'Repetir foto' : 'Hacer foto';
}
function sfMode(taken) {
  $('sf-video').hidden = taken; $('sf-img').hidden = !taken;
  $('b-sf-shot').hidden = taken; $('b-sf-cancel').hidden = taken;
  $('b-sf-again').hidden = !taken; $('b-sf-ok').hidden = !taken;
  $('sf-txt').textContent = taken ? '¿Te gusta?' : 'Pon tu cara dentro del cuadro';
}
async function openSelfie() {
  $('err-color').textContent = '';
  try {
    sfStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
  } catch {
    $('err-color').textContent = 'No podemos usar la cámara. Dale permiso para hacerte la foto.';
    return;
  }
  const v = $('sf-video');
  v.srcObject = sfStream;
  await v.play().catch(() => {});
  sfMode(false);
  show('s-selfie');
}
function closeSelfie() {
  if (sfStream) sfStream.getTracks().forEach(t => t.stop());
  sfStream = null;
  show(joined ? 's-wait' : 's-color');
}
$('b-photo').onclick = openSelfie;
$('b-sf-cancel').onclick = goBack;
$('b-sf-again').onclick = () => sfMode(false);
$('b-sf-shot').onclick = () => {
  const v = $('sf-video'), vw = v.videoWidth, vh = v.videoHeight;
  if (!vw) return;
  const s = Math.min(vw, vh), c = document.createElement('canvas'), x = c.getContext('2d');
  c.width = c.height = 200;
  x.translate(200, 0); x.scale(-1, 1);
  x.drawImage(v, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, 200, 200);
  shot = c.toDataURL('image/jpeg', 0.72);
  $('sf-img').src = shot;
  sfMode(true);
  toque(20);
};
$('b-sf-ok').onclick = () => {
  photo = shot;
  LS.set('g-photo', photo);
  photoPreview();
  if (joined) net.send({ type: 'photo', data: photo });
  closeSelfie();
};
photoPreview();

// Dirección de esta web en los pies de página (no va escrita en el código)
document.querySelectorAll('.g-host').forEach(e => (e.textContent = microHost()));

// Ajuste de pantalla al arrancar (la app nativa la mantiene encendida desde que se abre, salvo que se desactive)
if (nat && !aj('pantalla')) nat.pantalla({ encendida: false }).catch(() => {});
BACK['s-ajustes'] = () => show(ajVuelta);
BACK['s-historial'] = () => show(histVuelta);
BACK['s-resultado'] = () => show(resVuelta);
$('b-hist-back').onclick = () => goBack();
$('b-res-back').onclick = () => goBack();
$('b-aj-back').onclick = () => goBack();

// App nativa: el QR de la tele (o un enlace de sala) abre la app directamente en esa sala
alAbrirEnlace(url => { const c = parseRoom(url); if (c) roomFound(c); });

// ---------------------------------------------------------------- giro: en horizontal, el micro se dibuja como en vertical
(function () {
  const S = window.screen, root = document.documentElement;
  function giro() {
    let a = S.orientation && typeof S.orientation.angle === 'number' ? S.orientation.angle : Number(window.orientation) || 0;
    a = ((a % 360) + 360) % 360;
    const land = (a === 90 || a === 270) && innerWidth > innerHeight;
    root.classList.toggle('rot', land);
    root.style.setProperty('--rot', land ? (-a) + 'deg' : '0deg');
  }
  if (S.orientation && S.orientation.addEventListener) S.orientation.addEventListener('change', giro);
  addEventListener('orientationchange', () => setTimeout(giro, 50));
  addEventListener('resize', giro);
  giro();
})();
