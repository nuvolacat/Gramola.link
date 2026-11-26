// Historial y logros del cantante: solo en este móvil (sin cuentas ni servidor).
const K = 'g-historial', KL = 'g-logros';
const leerJson = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || '') || def; } catch { return def; } };

export const leer = () => leerJson(K, []);
export const logrosConseguidos = () => leerJson(KL, {});

// Guarda un resultado (lo más reciente primero, hasta 200). Las carátulas pesan: solo se guardan las de las 30 últimas.
export function guardar(r) {
  const lista = [r, ...leer()].slice(0, 200).map((x, i) => (i < 30 ? x : { ...x, portada: null }));
  for (let n = 30; n >= 0; n -= 10) {
    try { localStorage.setItem(K, JSON.stringify(n === 30 ? lista : lista.map((x, i) => (i < n ? x : { ...x, portada: null })))); break; } catch {}
  }
  return lista;
}

export function borrar() {
  try { localStorage.removeItem(K); localStorage.removeItem(KL); } catch {}
}

const oroDe = r => parseInt(String(r.oro || '0').split('/')[0], 10) || 0;

export function estadisticas(lista = leer()) {
  return {
    canciones: lista.length,
    mejor: lista.reduce((m, r) => Math.max(m, r.puntos || 0), 0),
    media: lista.length ? Math.round(lista.reduce((s, r) => s + (r.puntos || 0), 0) / lista.length) : 0,
    oro: lista.reduce((s, r) => s + oroDe(r), 0),
    racha: lista.reduce((m, r) => Math.max(m, r.racha || 0), 0),
    salas: new Set(lista.map(r => r.sala).filter(Boolean)).size,
    victorias: lista.filter(r => r.puesto === 1 && r.total > 1).length,
  };
}

export const LOGROS = [
  { id: 'primera', t: 'Primera canción', d: 'Canta tu primera canción.', ok: (l) => l.length >= 1 },
  { id: 'diez', t: 'Diez canciones', d: 'Canta 10 canciones.', ok: (l) => l.length >= 10 },
  { id: 'cincuenta', t: 'Estrella', d: 'Canta 50 canciones.', ok: (l) => l.length >= 50 },
  { id: 'oro', t: 'Pepita de oro', d: 'Acierta 5 notas doradas en una canción.', ok: (l) => l.some(r => oroDe(r) >= 5) },
  { id: 'frase', t: 'Frase perfecta', d: 'Clava una frase entera (90 % o más).', ok: (l) => l.some(r => (r.mejorFrase || 0) >= 90) },
  { id: 'afinado', t: 'Oído fino', d: 'Canta una canción con un 90 % afinado.', ok: (l) => l.some(r => (r.precision || 0) >= 90) },
  { id: 'racha', t: 'Sin respirar', d: 'Encadena una racha de 50 notas.', ok: (l) => l.some(r => (r.racha || 0) >= 50) },
  { id: 'nueve', t: 'Nueve mil', d: 'Pasa de 9.000 puntos.', ok: (l) => l.some(r => (r.puntos || 0) >= 9000) },
  { id: 'gana', t: 'Primera victoria', d: 'Gana a los demás cantantes.', ok: (l) => l.some(r => r.puesto === 1 && r.total > 1) },
  { id: 'fiestas', t: 'Fiestero', d: 'Canta en 5 salas distintas.', ok: (l) => new Set(l.map(r => r.sala).filter(Boolean)).size >= 5 },
];

// Comprueba los logros con el historial actual; devuelve los nuevos (y los apunta con su fecha)
export function revisarLogros(lista = leer()) {
  const hechos = logrosConseguidos(), nuevos = [];
  for (const g of LOGROS) if (!hechos[g.id] && g.ok(lista)) { hechos[g.id] = Date.now(); nuevos.push(g); }
  if (nuevos.length) try { localStorage.setItem(KL, JSON.stringify(hechos)); } catch {}
  return nuevos;
}
