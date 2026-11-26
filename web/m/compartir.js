// Imagen para compartir el resultado (formato historia 1080×1920), en cuatro estilos a elegir:
// A póster · B entrada · C micro · D marcador. Se dibuja en un canvas con la letra y los colores de Gramola.
const W = 1080, H = 1920;
const ROJO = '#ec3013', TINTA = '#201e1d', PAPEL = '#f3f2f2', GRIS = '#605d5d';
export const ESTILOS = [
  { id: 'A', t: 'Póster' }, { id: 'B', t: 'Entrada' }, { id: 'C', t: 'Micro' }, { id: 'D', t: 'Marcador' },
];
const MODOS = { sing: 'Canción', duel: 'Duelo', duo: 'Dúo', team: 'Equipos' };

const cargar = src => new Promise(ok => { if (!src) return ok(null); const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
const fecha = t => { const d = new Date(t || Date.now()); return [d.getDate(), d.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('·') + '·' + d.getFullYear(); };
const miles = n => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const valoracion = p => p >= 9000 ? '¡Perfecto!' : p >= 7500 ? '¡Genial!' : p >= 5500 ? '¡Bien!' : p >= 3000 ? 'Regular' : '¡A por la siguiente!';
const oroDe = r => parseInt(String(r.oro || '0').split('/')[0], 10) || 0;

function letra(x, peso, px) { x.font = `${peso} ${px}px Archivo, system-ui, sans-serif`; }
function texto(x, t, px0, maxW, peso = 800) {   // reduce la letra hasta que quepa; si ni así, corta con «…»
  let px = px0;
  letra(x, peso, px);
  while (x.measureText(t).width > maxW && px > px0 * 0.6) letra(x, peso, (px -= 2));
  if (x.measureText(t).width <= maxW) return t;
  while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function escribir(x, t, px, peso, color, X, Y, maxW, alinear = 'left') {
  x.fillStyle = color; x.textAlign = alinear; x.textBaseline = 'alphabetic';
  x.fillText(maxW ? texto(x, t, px, maxW, peso) : (letra(x, peso, px), t), X, Y);
}
function espaciado(x, t, px, color, X, Y, alinear = 'left') {   // rótulos en mayúsculas con espacio entre letras
  letra(x, 800, px); x.fillStyle = color; x.textBaseline = 'alphabetic';
  const sep = px * 0.16, chars = [...t.toUpperCase()], ancho = chars.reduce((s, c) => s + x.measureText(c).width + sep, -sep);
  let cx = alinear === 'right' ? X - ancho : alinear === 'center' ? X - ancho / 2 : X;
  x.textAlign = 'left';
  for (const c of chars) { x.fillText(c, cx, Y); cx += x.measureText(c).width + sep; }
}
// «gram◎la»: el símbolo (aro + tres rayas) va en el sitio de la «o», como en la tele
function marca(x, X, Y, px, color, colSimbolo, alinear = 'left') {
  letra(x, 800, px);
  const a = x.measureText('gram').width, b = x.measureText('la').width, s = px * 0.66, sep = px * 0.01;
  const total = a + sep + s + b - px * 0.03;
  let cx = alinear === 'right' ? X - total : alinear === 'center' ? X - total / 2 : X;
  x.fillStyle = color; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillText('gram', cx, Y);
  const ox = cx + a + sep, oy = Y + px * 0.06 - s, k = s / 100;
  x.strokeStyle = colSimbolo || color;
  x.lineWidth = 14 * k; x.beginPath(); x.arc(ox + 50 * k, oy + 50 * k, 38 * k, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 8 * k; x.beginPath();
  x.moveTo(ox + 30 * k, oy + 38 * k); x.lineTo(ox + 70 * k, oy + 38 * k);
  x.moveTo(ox + 27 * k, oy + 50 * k); x.lineTo(ox + 73 * k, oy + 50 * k);
  x.moveTo(ox + 30 * k, oy + 62 * k); x.lineTo(ox + 70 * k, oy + 62 * k);
  x.stroke();
  x.fillText('la', ox + s - px * 0.03, Y);
}
function cubrir(x, im, X, Y, w, h) {
  const r = Math.max(w / im.naturalWidth, h / im.naturalHeight), sw = w / r, sh = h / r;
  x.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, X, Y, w, h);
}
// Carátula (o, si no hay, una portada de Gramola con el símbolo)
function portada(x, im, X, Y, w, h) {
  if (im) return cubrir(x, im, X, Y, w, h);
  const g = x.createLinearGradient(X, Y, X + w, Y + h); g.addColorStop(0, TINTA); g.addColorStop(1, ROJO);
  x.fillStyle = g; x.fillRect(X, Y, w, h);
  const s = Math.min(w, h) * 0.4, k = s / 100, ox = X + (w - s) / 2, oy = Y + (h - s) / 2;
  x.strokeStyle = '#fff'; x.lineWidth = 14 * k; x.beginPath(); x.arc(ox + 50 * k, oy + 50 * k, 38 * k, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 8 * k; x.beginPath(); [[30, 38, 70], [27, 50, 73], [30, 62, 70]].forEach(([a, y, b]) => { x.moveTo(ox + a * k, oy + y * k); x.lineTo(ox + b * k, oy + y * k); }); x.stroke();
}
// Foto del jugador o, sin foto, un cuadrado de su color con la inicial
function avatar(x, foto, d, X, Y, s) {
  if (foto) return cubrir(x, foto, X, Y, s, s);
  x.fillStyle = d.color || ROJO; x.fillRect(X, Y, s, s);
  escribir(x, (d.nombre || '?').slice(0, 1).toUpperCase(), s * 0.5, 800, TINTA, X + s / 2, Y + s * 0.68, 0, 'center');
}
function sombra(x, on) { x.shadowColor = on ? 'rgba(0,0,0,.35)' : 'transparent'; x.shadowBlur = on ? 70 : 0; x.shadowOffsetY = on ? 28 : 0; }

// d = { nombre, color, slot, puntos, precision, oro, racha, titulo, artista, portada, fecha, sala, modo, puesto, total, otros }
export async function dibujar(estilo, d, recursos = {}) {
  try { await document.fonts.load('800 40px Archivo'); await document.fonts.load('300 40px Archivo'); } catch {}
  const [cov, foto, micro, nuvola] = await Promise.all([cargar(d.portada), cargar(recursos.foto), cargar(recursos.micro), cargar(recursos.nuvola)]);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const val = valoracion(d.puntos), oro = oroDe(d), f = fecha(d.fecha);

  if (estilo === 'A') {   // Póster
    x.fillStyle = ROJO; x.fillRect(0, 0, W, H);
    espaciado(x, 'Karaoke en casa', 34, '#fff', 90, 150); espaciado(x, f, 34, '#fff', W - 90, 150, 'right');
    sombra(x, true); portada(x, cov, 90, 230, 900, 900); sombra(x, false);
    escribir(x, d.titulo || '', 58, 800, '#fff', 90, 1230, 900);
    escribir(x, d.artista || '', 44, 300, '#fff', 90, 1295, 900);
    escribir(x, miles(d.puntos), 300, 800, '#fff', 82, 1610, 920);
    avatar(x, foto, d, 90, 1660, 86);
    escribir(x, `${d.nombre} · ${val}`, 42, 800, '#fff', 200, 1717, 790);
    marca(x, W - 90, 1830, 86, '#fff', '#fff', 'right');
  } else if (estilo === 'B') {   // Entrada
    x.fillStyle = TINTA; x.fillRect(0, 0, W, H);
    x.fillStyle = PAPEL; x.fillRect(80, 130, 920, 1660);
    portada(x, cov, 80, 130, 920, 860);
    x.fillStyle = TINTA; [[80, 990], [1000, 990]].forEach(([cx, cy]) => { x.beginPath(); x.arc(cx, cy, 40, 0, Math.PI * 2); x.fill(); });
    x.strokeStyle = TINTA; x.lineWidth = 6; x.setLineDash([18, 14]); x.beginPath(); x.moveTo(130, 990); x.lineTo(950, 990); x.stroke(); x.setLineDash([]);
    espaciado(x, `Actuación · Sala ${d.sala || ''}`, 30, ROJO, 150, 1075);
    escribir(x, d.titulo || '', 64, 800, TINTA, 150, 1160, 780);
    escribir(x, d.artista || '', 44, 300, TINTA, 150, 1225, 780);
    x.fillStyle = TINTA; x.fillRect(150, 1290, 780, 4);
    espaciado(x, 'Cantante', 28, TINTA, 150, 1350); espaciado(x, 'Puntos', 28, TINTA, 930, 1350, 'right');
    avatar(x, foto, d, 150, 1385, 76);
    escribir(x, d.nombre || '', 50, 800, TINTA, 246, 1440, 330);
    escribir(x, miles(d.puntos), 120, 800, ROJO, 930, 1470, 400, 'right');
    letra(x, 600, 32);
    escribir(x, `${oro} notas doradas`, 32, 600, GRIS, 150, 1570); escribir(x, `Racha ${d.racha || 0}`, 32, 600, GRIS, 540, 1570, 0, 'center'); escribir(x, f, 32, 600, GRIS, 930, 1570, 0, 'right');
    escribir(x, val, 44, 800, TINTA, 540, 1690, 760, 'center');
    marca(x, W / 2, 1880, 56, '#fff', ROJO, 'center');
  } else if (estilo === 'C') {   // Micro
    x.fillStyle = TINTA; x.fillRect(0, 0, W, H);
    if (cov) {   // carátula de fondo desenfocada (reducida y ampliada: funciona en todos los navegadores)
      const t = document.createElement('canvas'); t.width = 24; t.height = 24; t.getContext('2d').drawImage(cov, 0, 0, 24, 24);
      x.globalAlpha = 0.55; x.imageSmoothingQuality = 'high'; x.drawImage(t, -100, -100, W + 200, 1300); x.globalAlpha = 1;
    }
    const g = x.createLinearGradient(0, 300, 0, 1150); g.addColorStop(0, 'rgba(32,30,29,0)'); g.addColorStop(1, TINTA);
    x.fillStyle = g; x.fillRect(0, 0, W, 1200);
    sombra(x, true); portada(x, cov, 90, 140, 300, 300); sombra(x, false);
    escribir(x, d.titulo || '', 54, 800, '#fff', 430, 260, 560);
    escribir(x, d.artista || '', 40, 300, 'rgba(255,255,255,.85)', 430, 320, 560);
    espaciado(x, `${d.nombre || ''} ha cantado`, 40, d.color || ROJO, W / 2, 620, 'center');
    escribir(x, miles(d.puntos), 250, 800, '#fff', W / 2, 850, 980, 'center');
    escribir(x, `${val} · ${oro} notas doradas`, 44, 600, 'rgba(255,255,255,.9)', W / 2, 930, 980, 'center');
    if (micro) {
      x.save(); x.translate(W / 2 + 60, H + 430); x.rotate(-8 * Math.PI / 180);   // (la cabeza asoma por debajo de la puntuación)
      const w = 820, h = w * micro.naturalHeight / micro.naturalWidth; x.drawImage(micro, -w / 2, -h, w, h); x.restore();
    }
    marca(x, 90, 1830, 64, '#fff', ROJO);
  } else {   // D · Marcador
    x.fillStyle = PAPEL; x.fillRect(0, 0, W, H);
    marca(x, 80, 180, 72, TINTA, ROJO); espaciado(x, 'Resultados', 30, TINTA, W - 80, 170, 'right');
    x.fillStyle = TINTA; x.fillRect(80, 285, 920, 5); x.fillRect(80, 640, 920, 5);
    portada(x, cov, 80, 330, 260, 260);
    escribir(x, d.titulo || '', 58, 800, TINTA, 380, 420, 620);
    escribir(x, d.artista || '', 42, 300, TINTA, 380, 480, 620);
    escribir(x, [MODOS[d.modo], f].filter(Boolean).join(' · '), 30, 600, GRIS, 380, 555, 620);
    const filas = (d.otros && d.otros.length ? d.otros : [{ nombre: d.nombre, color: d.color, puntos: d.puntos }]).slice(0, 6);
    let y = 700;
    filas.forEach((o, i) => {
      const yo = o.nombre === d.nombre && o.puntos === d.puntos;
      const alto = yo ? 170 : 140;
      if (yo) { x.fillStyle = d.color || ROJO; x.fillRect(80, y, 920, alto); }
      else { x.fillStyle = '#d7d3d3'; x.fillRect(80, y + alto - 3, 920, 3); }
      escribir(x, String(i + 1), yo ? 70 : 56, 800, yo ? TINTA : '#9b9797', 120, y + alto / 2 + (yo ? 25 : 20));
      if (yo) avatar(x, foto, d, 210, y + 30, 110); else { x.fillStyle = o.color || '#9b9797'; x.fillRect(220, y + 25, 90, 90); }
      escribir(x, o.nombre || '', yo ? 60 : 50, yo ? 800 : 600, TINTA, 360, y + alto / 2 + 20, 380);
      escribir(x, miles(o.puntos), yo ? 80 : 60, 800, TINTA, 960, y + alto / 2 + (yo ? 28 : 22), 0, 'right');
      y += alto;
    });
    [[String(oro), 'notas doradas', ROJO], [String(d.racha || 0), 'mejor racha', TINTA], [(d.precision || 0) + ' %', 'afinado', TINTA]].forEach(([v, t, col], i) => {
      const X = 80 + i * 313; x.fillStyle = '#fff'; x.fillRect(X, 1500, 293, 200);
      escribir(x, v, 72, 800, col, X + 146, 1600, 270, 'center'); escribir(x, t, 28, 600, TINTA, X + 146, 1660, 270, 'center');
    });
    if (nuvola) { const h = 44, w = h * nuvola.naturalWidth / nuvola.naturalHeight; x.drawImage(nuvola, (W - w) / 2, 1800, w, h); }
  }
  return c;
}

export const aBlob = c => new Promise(ok => c.toBlob(ok, 'image/png'));
