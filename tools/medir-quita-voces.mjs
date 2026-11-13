// Mide el filtro «quitar voces» fuera del navegador, ejecutando EL MISMO fichero que sirve la tele
// (web/tv/quita-voces-worklet.js) con un apaño mínimo de AudioWorklet. Comprueba lo que se puede comprobar
// sin oídos: que sin filtro la señal sale idéntica (solo retrasada), cuánto baja un tono centrado, cuánto se
// queda un tono duro a un lado, que un fichero mono no se destroza, y qué pasa con una canción de verdad.
//
//   node tools/medir-quita-voces.mjs [--cancion "ruta/al.mp3"] [--seg 30] [--dur 12] [--wav]
//
// Sale una tabla con números y un veredicto por prueba (código de salida 1 si algo falla).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const WORKLET = path.join(RAIZ, 'web', 'tv', 'quita-voces-worklet.js');
const SR = 48000;

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const flag = n => process.argv.includes('--' + n);
// Canciones de verdad para medir: las que pase --cancion (varias veces) o estas tres de la biblioteca local
const BIB = path.resolve(RAIZ, process.env.GRAMOLA_CANCIONES || 'web/songs');
const CARPETAS = process.argv.reduce((a, v, i, t) => (v === '--cancion' && t[i + 1] ? (a.push(t[i + 1]), a) : a), []);
if (!CARPETAS.length) {
  for (const n of ['Lady GaGa - Bad Romance', 'The Eagles - Hotel California', 'Queen - We Will Rock You', 'Adele - Rolling In The Deep']) {
    const c = path.join(BIB, n);
    if (fs.existsSync(c)) CARPETAS.push(c);
  }
}
const SEG = arg('seg', null) == null ? null : Number(arg('seg'));   // null = empezar poco antes de la primera nota
const DUR = Number(arg('dur', 12));
const GUARDAR_WAV = flag('wav');

// ---------------------------------------------------------------- el apaño de AudioWorklet
let PROC = null, LISTO = null;
const fuente = fs.readFileSync(WORKLET, 'utf8');
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: m => { if (m && m.type === 'listo') LISTO = m; }, onmessage: null }; } };
globalThis.registerProcessor = (nombre, cls) => { PROC = { nombre, cls }; };
new Function(fuente)();
if (!PROC) { console.error('El worklet no registra ningún procesador'); process.exit(1); }

function nuevoNivel(nivel, params) {
  LISTO = null;
  const p = new PROC.cls({ processorOptions: {} });
  if (nivel != null) p.port.onmessage({ data: { nivel } });
  if (params) p.port.onmessage({ data: { params } });
  return { p, listo: LISTO };
}

// Pasa una señal estéreo por el worklet en cuantos de 128 muestras (como hace el navegador).
function procesar(L, R, nivel, params) {
  const { p, listo } = nuevoNivel(nivel, params);
  const n = L.length, outL = new Float32Array(n), outR = new Float32Array(n);
  const il = new Float32Array(128), ir = new Float32Array(128), ol = new Float32Array(128), or = new Float32Array(128);
  for (let i = 0; i < n; i += 128) {
    const m = Math.min(128, n - i);
    il.fill(0); ir.fill(0);
    il.set(L.subarray(i, i + m)); ir.set(R.subarray(i, i + m));
    p.process([[il, ir]], [[ol, or]]);
    outL.set(ol.subarray(0, m), i); outR.set(or.subarray(0, m), i);
  }
  return { outL, outR, listo };
}

// ---------------------------------------------------------------- utilidades de medida
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const db = v => 20 * Math.log10(Math.max(1e-12, v));

// Amplitud de una frecuencia concreta (Goertzel con ventana de Hann), en una señal
function amplitud(x, f, a, b) {
  let re = 0, im = 0, w = 0;
  const n = b - a;
  for (let i = 0; i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    const t = 2 * Math.PI * f * (a + i) / SR;
    re += x[a + i] * g * Math.cos(t); im -= x[a + i] * g * Math.sin(t); w += g;
  }
  return 2 * Math.hypot(re, im) / w;
}

// Energía del «centro» y del «lado» por STFT (lo mismo que separa el filtro): sirve de apaño para medir
// cuánto centro queda, sin tener la pista de voz real.
function centroLado(L, R, desde) {
  const N = 1024, H = 512, F = fftPrep(N);
  let eneC = 0, eneS = 0, eneB = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  const vent = new Float64Array(N);
  for (let i = 0; i < N; i++) vent[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  for (let o = desde; o + N <= L.length; o += H) {
    for (let i = 0; i < N; i++) { re[i] = L[o + i] * vent[i]; im[i] = R[o + i] * vent[i]; }
    fft(F, re, im, false);
    for (let k = 1; k < N / 2; k++) {
      const j = N - k;
      const Lr = 0.5 * (re[k] + re[j]), Li = 0.5 * (im[k] - im[j]);
      const Rr = 0.5 * (im[k] + im[j]), Ri = -0.5 * (re[k] - re[j]);
      const Cr = 0.5 * (Lr + Rr), Ci = 0.5 * (Li + Ri);
      const Sr = 0.5 * (Lr - Rr), Si = 0.5 * (Li - Ri);
      const f = k * SR / N;
      eneC += Cr * Cr + Ci * Ci; eneS += Sr * Sr + Si * Si;
      if (f > 150 && f < 9000) eneB += (Cr * Cr + Ci * Ci);
    }
  }
  return { C: eneC, S: eneS, voz: eneB };
}

// --- FFT mínima (la misma que el worklet, para medir)
function fftPrep(n) {
  const niveles = Math.round(Math.log2(n)), cos = new Float64Array(n >> 1), sen = new Float64Array(n >> 1);
  for (let i = 0; i < (n >> 1); i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sen[i] = Math.sin(2 * Math.PI * i / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let x = i, r = 0; for (let b = 0; b < niveles; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  return { n, cos, sen, rev };
}
function fft(F, re, im, inversa) {
  const n = F.n, cos = F.cos, sen = F.sen, rev = F.rev;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let tam = 2; tam <= n; tam <<= 1) {
    const mitad = tam >> 1, paso = n / tam;
    for (let i = 0; i < n; i += tam) for (let j = 0, k = 0; j < mitad; j++, k += paso) {
      const c = cos[k], s = inversa ? sen[k] : -sen[k];
      const ar = re[i + j + mitad], ai = im[i + j + mitad];
      const tr = ar * c - ai * s, ti = ar * s + ai * c;
      re[i + j + mitad] = re[i + j] - tr; im[i + j + mitad] = im[i + j] - ti;
      re[i + j] += tr; im[i + j] += ti;
    }
  }
  if (inversa) { const f = 1 / n; for (let i = 0; i < n; i++) { re[i] *= f; im[i] *= f; } }
}

// ---------------------------------------------------------------- señales de prueba
const N = 8 * SR;
function seno(f, amp, desfase = 0) { const x = new Float32Array(N); for (let i = 0; i < N; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / SR + desfase); return x; }
function ruido(semilla) { let s = semilla; const x = new Float32Array(N); for (let i = 0; i < N; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; x[i] = (s / 0x3fffffff - 1) * 0.3; } return x; }

const res = [];
function prueba(nombre, ok, lineas) { res.push({ nombre, ok }); console.log(`\n${ok ? '✔' : '✘'} ${nombre}`); for (const l of lineas) console.log('   ' + l); }

// 1. Carga y latencia declarada
{
  const { p, listo } = nuevoNivel(0);
  const n = listo ? listo.n : 0;
  prueba('El procesador se registra y declara su retardo',
    !!listo && n === 1024 && Math.abs(listo.latencia - 1024 / SR) < 1e-9,
    [`nombre: ${PROC.nombre}`, `ventana: ${n} muestras · retardo declarado: ${(listo ? (listo.latencia * 1000).toFixed(2) : '—')} ms`]);
}

// 2. Identidad sin filtro (y medida del retardo real)
{
  const L = ruido(7), R = ruido(99);
  const { outL } = procesar(L, R, 0);
  // busca el retardo que mejor encaja, midiendo el error en la zona ya estable
  let mejor = 0, menor = Infinity;
  for (let d = 0; d <= 2048; d++) {
    let s = 0;
    for (let i = 4 * SR; i < 7 * SR; i += 7) { const e = outL[i] - L[i - d]; s += e * e; }
    if (s < menor) { menor = s; mejor = d; }
  }
  const err = Math.sqrt(menor / ((7 - 4) * SR / 7));
  const dB = err / rms(L.subarray(4 * SR, 7 * SR));
  prueba('Sin filtro la señal sale idéntica (solo retrasada)',
    mejor >= 1023 && mejor <= 1024 && db(dB) < -80,
    [`retardo medido: ${mejor} muestras (${(mejor / SR * 1000).toFixed(1)} ms)`, `error: ${db(dB).toFixed(1)} dB`]);
}

// 3. Un tono centrado baja; uno duro a un lado y el bajo, no
{
  const centro = seno(1000, 0.3), lado = seno(500, 0.3), bajo = seno(60, 0.3);
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = centro[i] + lado[i] + bajo[i]; R[i] = centro[i] + bajo[i]; }   // 500 Hz solo a la izquierda
  const a = 4 * SR, b = 7 * SR;
  const { outL, outR } = procesar(L, R, 2);
  const antC = amplitud(L, 1000, a, b), posC = amplitud(outL, 1000, a, b);
  const antL = amplitud(L, 500, a, b), posL = amplitud(outL, 500, a, b);
  const antB = amplitud(L, 60, a, b), posB = amplitud(outL, 60, a, b);
  const dC = db(posC / antC), dL = db(posL / antL), dB = db(posB / antB);
  prueba('Nivel fuerte: baja el centro, respeta el lado y el bajo',
    dC < -9 && Math.abs(dL) < 0.5 && Math.abs(dB) < 0.5,
    [`centrado 1 kHz: ${dC.toFixed(1)} dB`, `a la izquierda 500 Hz: ${dL.toFixed(1)} dB (debe ser ~0)`, `bajo 60 Hz centrado: ${dB.toFixed(1)} dB (debe ser ~0)`,
      `(en el canal derecho el 500 Hz no existe: ${db(amplitud(outR, 500, a, b) / amplitud(R, 500, a, b)).toFixed(1)} dB de fuga)`]);
}

// 4. Niveles: suave frente a fuerte
{
  const centro = seno(1000, 0.3), lado = seno(500, 0.3);
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = centro[i] + lado[i]; R[i] = centro[i]; }
  const a = 4 * SR, b = 7 * SR;
  const filas = [];
  let ok = true, previo = 0;
  for (const nv of [1, 2]) {
    const { outL } = procesar(L, R, nv);
    const d = db(amplitud(outL, 1000, a, b) / amplitud(L, 1000, a, b));
    const dl = db(amplitud(outL, 500, a, b) / amplitud(L, 500, a, b));
    filas.push(`nivel ${nv} (${['apagado', 'suave', 'fuerte'][nv]}): centro ${d.toFixed(1)} dB · lado ${dl.toFixed(1)} dB`);
    if (d >= previo) ok = false;   // cada nivel debe bajar más que el anterior
    previo = d;
    if (Math.abs(dl) > 0.5) ok = false;
  }
  prueba('Los dos niveles bajan cada vez más y no tocan el lado', ok && previo < -9, filas);
}

// 5. Fichero mono: no se destroza
{
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    x[i] = 0.2 * Math.sin(2 * Math.PI * 220 * t) + 0.15 * Math.sin(2 * Math.PI * 660 * t) + 0.1 * Math.sin(2 * Math.PI * 3200 * t);
  }
  const L = x, R = x.slice();
  const { outL } = procesar(L, R, 2);
  const a = 4 * SR, b = 7 * SR;
  const d = db(rms(outL, a, b) / rms(L, a, b));
  prueba('Un fichero mono no se queda hueco (guardia de mono)',
    d > -1.5, [`energía conservada: ${d.toFixed(2)} dB (un filtro de centro sin guardia daría −40 dB o menos)`]);
}

// 6. Canciones de verdad, con su chart UltraStar. Tres formas de mirarlo, de menos a más específico:
//    · qué baja la banda de voz donde canta, y qué baja en los huecos instrumentales;
//    · la voz medida en el tono de cada nota (una nota cantada es estrecha en frecuencia; un bombo no);
//    · y lo que más importa: cuánto se toca la música donde no canta nadie.
function leerChart(dir) {
  const txt = fs.readdirSync(dir).find(f => f.toLowerCase().endsWith('.txt'));
  if (!txt) return null;
  const lineas = fs.readFileSync(path.join(dir, txt), 'utf8').split(/\r?\n/);
  let bpm = 0, gap = 0;
  for (const l of lineas) {
    const b = /^#BPM:([\d.,]+)/i.exec(l), g = /^#GAP:([\d.,]+)/i.exec(l);
    if (b && !bpm) bpm = parseFloat(b[1].replace(',', '.'));
    if (g && !gap) gap = parseFloat(g[1].replace(',', '.'));
  }
  if (!bpm) return null;
  const pulso = 60000 / (bpm * 4) / 1000;          // un pulso, en segundos (como web/js/ultrastar.js)
  const notas = [];
  for (const l of lineas) {
    const m = /^([:*FRG])\s*(-?\d+)\s+(\d+)\s+(-?\d+) ?(.*)$/.exec(l);
    if (!m || m[1] === 'F') continue;              // verso libre: no hay nota que cantar
    const t0 = gap / 1000 + (+m[2]) * pulso;
    notas.push([t0, t0 + (+m[3]) * pulso, +m[4]]);
  }
  return { bpm, gap, notas };
}

const re = new Float64Array(1024), im = new Float64Array(1024), F = fftPrep(1024);

// energía del centro (canal medio) en una banda, entre dos instantes
function bandaEnergia(L, R, t0, t1, fmin = 150, fmax = 9000) {
  const N = 1024, H = 512;
  let ene = 0;
  const a = Math.max(0, Math.floor(t0 * SR / H) * H), b = Math.min(L.length, Math.floor(t1 * SR));
  const vent = new Float64Array(N);
  for (let i = 0; i < N; i++) vent[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  for (let o = a; o + N <= b; o += H) {
    for (let i = 0; i < N; i++) { re[i] = L[o + i] * vent[i]; im[i] = R[o + i] * vent[i]; }
    fft(F, re, im, false);
    for (let k = 1; k < N / 2; k++) {
      const j = N - k, f = k * SR / N;
      if (f < fmin || f > fmax) continue;
      const Lr = 0.5 * (re[k] + re[j]), Li = 0.5 * (im[k] - im[j]);
      const Rr = 0.5 * (im[k] + im[j]), Ri = -0.5 * (re[k] - re[j]);
      const Cr = 0.5 * (Lr + Rr), Ci = 0.5 * (Li + Ri);
      ene += Cr * Cr + Ci * Ci;
    }
  }
  return ene;
}

// amplitud en la frecuencia de una nota (la mayor de ±1 semitono, por si el cantante se va), en el centro mono
function ampNota(L, R, t0, t1, f) {
  const a = Math.max(0, (t0 * SR) | 0), b = Math.max(a + 64, Math.min(L.length, (t1 * SR) | 0));
  let mejor = 0;
  for (const k of [0.944, 1, 1.06]) {
    const fk = f * k;
    let rr = 0, ii = 0, w = 0;
    for (let i = a; i < b; i++) {
      const g = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / (b - a));
      const x = 0.5 * (L[i] + R[i]), t = 2 * Math.PI * fk * i / SR;
      rr += x * g * Math.cos(t); ii -= x * g * Math.sin(t); w += g;
    }
    mejor = Math.max(mejor, 2 * Math.hypot(rr, ii) / Math.max(1e-9, w));
  }
  return mejor;
}

const mediana = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const medio = a => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : 0);
const dbPot = (a, b) => 10 * Math.log10(Math.max(1e-12, a) / Math.max(1e-12, b));   // energías
const dbAmp = (a, b) => 20 * Math.log10(Math.max(1e-9, a) / Math.max(1e-9, b));    // amplitudes

for (const CARPETA of CARPETAS) {
  const chart = leerChart(CARPETA);
  const mp3 = fs.readdirSync(CARPETA).find(f => /\.(mp3|ogg|wav|opus|m4a)$/i.test(f) && f !== 'sin-voz.mp3' && f !== 'megamix.mp3');
  if (!chart || !mp3) { console.log(`\n· Sin chart o sin audio en ${CARPETA}: se salta`); continue; }
  const ruta = path.join(CARPETA, mp3);
  const durTotal = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', ruta]).toString().trim()) || 0;
  const notas = chart.notas.filter(n => n[1] > n[0]).sort((x, y) => x[0] - y[0]);
  const primera = notas[0] ? notas[0][0] : 0;
  let desde = Math.max(0, SEG == null ? primera - 3 : SEG);
  if (durTotal && desde + DUR > durTotal) desde = Math.max(0, durTotal - DUR - 0.5);
  const crudo = execFileSync('ffmpeg', ['-v', 'error', '-ss', desde.toFixed(2), '-t', String(DUR), '-i', ruta, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  const n = crudo.length / 8;
  if (n < SR * 2) { console.log(`\n· ${path.basename(CARPETA)}: no se pudo sacar audio (${n} muestras)`); continue; }
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = crudo.readFloatLE(i * 8); R[i] = crudo.readFloatLE(i * 8 + 4); }
  const fin = desde + n / SR;

  const canta = notas.map(([a, b]) => [Math.max(desde, a - 0.2), Math.min(fin, b + 0.2)]).filter(([a, b]) => b > desde && a < fin).sort((x, y) => x[0] - y[0]);
  const unido = [];
  for (const t of canta) { const u = unido[unido.length - 1]; if (u && t[0] <= u[1] + 0.6) u[1] = Math.max(u[1], t[1]); else unido.push(t.slice()); }
  const huecos = [];
  let cursor = desde;
  for (const [a, b] of unido) { if (a - cursor >= 1.2) huecos.push([cursor, a]); cursor = Math.max(cursor, b); }
  if (fin - cursor >= 1.2) huecos.push([cursor, fin]);
  const rel = t => [t[0] - desde, t[1] - desde];

  const notasDentro = notas.filter(([a, b]) => a >= desde && b <= fin && b - a > 0.08);
  const f0 = m => 440 * Math.pow(2, (m - 69) / 12);

  const filas = [`chart: BPM ${chart.bpm} · ${notas.length} notas · ventana ${desde.toFixed(1)}–${fin.toFixed(1)} s: ` +
    `${unido.reduce((s, t) => s + t[1] - t[0], 0).toFixed(1)} s cantados, ${huecos.reduce((s, t) => s + t[1] - t[0], 0).toFixed(1)} s de música sola` +
    ` · ${notasDentro.length} notas en la ventana`];
  let ok = true, daño = null;

  const eCanta = unido.map(t => bandaEnergia(L, R, ...rel(t))), eHueco = huecos.map(t => bandaEnergia(L, R, ...rel(t)));
  const aNota = notasDentro.map(([a, b, m]) => ampNota(L, R, a - desde, b - desde, f0(m)));
  const corte = mediana(aNota);
  const buenas = aNota.map((v, i) => (v > Math.max(corte, 1.5e-3) ? i : -1)).filter(i => i >= 0);   // notas con señal clara

  for (const nv of [1, 2]) {
    const t0c = process.hrtime.bigint();
    const { outL, outR } = procesar(L, R, nv);
    const ms = Number(process.hrtime.bigint() - t0c) / 1e6;
    const c2 = unido.map(t => bandaEnergia(outL, outR, ...rel(t))), h2 = huecos.map(t => bandaEnergia(outL, outR, ...rel(t)));
    const dCanta = dbPot(medio(c2), medio(eCanta)), dHueco = huecos.length ? dbPot(medio(h2), medio(eHueco)) : 0;
    const dTotal = db(rms(outL, 2048) / rms(L, 2048));
    filas.push(`nivel ${nv}: banda donde canta ${dCanta.toFixed(1)} dB · en los huecos ${dHueco.toFixed(1)} dB · total ${dTotal.toFixed(1)} dB · coste ${(ms / 1000 / (n / SR) * 100).toFixed(2)} % de un núcleo`);
    if (nv === 2 && dCanta > -3) ok = false;          // el filtro tiene que bajar el centro donde canta
    if (nv === 2 && huecos.length && dHueco < -3) daño = dHueco;   // (lo que se lleva de la música: se informa, no se suspende)
    if (GUARDAR_WAV) {
      const dir = path.join(RAIZ, '_scratch'); fs.mkdirSync(dir, { recursive: true });
      escribirWav(path.join(dir, `quita-voces-${nv}.wav`), outL, outR);
    }
  }

  const sinVoz = path.join(CARPETA, 'sin-voz.mp3');
  if (fs.existsSync(sinVoz)) {
    const crudo2 = execFileSync('ffmpeg', ['-v', 'error', '-ss', desde.toFixed(2), '-t', String(DUR), '-i', sinVoz, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
    const m2 = crudo2.length / 8;
    const pL = new Float32Array(m2), pR = new Float32Array(m2);
    for (let i = 0; i < m2; i++) { pL[i] = crudo2.readFloatLE(i * 8); pR[i] = crudo2.readFloatLE(i * 8 + 4); }
    const c3 = unido.map(t => bandaEnergia(pL, pR, ...rel(t))), h3 = huecos.map(t => bandaEnergia(pL, pR, ...rel(t)));
    const dC = dbPot(medio(c3), medio(eCanta)), dH = huecos.length ? dbPot(medio(h3), medio(eHueco)) : 0;
    const dT = db(rms(pL, 2048) / rms(L, 2048));
    filas.push(`sin-voz.mp3: banda donde canta ${dC.toFixed(1)} dB · en los huecos ${dH.toFixed(1)} dB · total ${dT.toFixed(1)} dB`);
    if (huecos.length && dH < -1.5) ok = false;                    // la pista sin voz no puede tocar la música sola
    if (dC < -4 && huecos.length && dH >= -1.5) filas.push('  (lo que se busca: baja donde canta y deja la música quieta)');
  } else filas.push('sin-voz.mp3: no está (solo se mide el filtro en vivo)');

  if (daño != null) filas.push(`  (el filtro en vivo se lleva también ${daño.toFixed(1)} dB de la música donde no canta nadie: es un filtro, no una separación)`);
  if (GUARDAR_WAV) {
    const dir = path.join(RAIZ, '_scratch'); fs.mkdirSync(dir, { recursive: true });
    escribirWav(path.join(dir, 'quita-voces-0.wav'), L, R);
    filas.push(`wavs en ${dir} (el 0 es el original, para comparar)`);
  }
  prueba(`Canción con chart: ${path.basename(CARPETA)}`, ok, filas);
}

function escribirWav(destino, L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 8);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(L[i], 44 + i * 8); buf.writeFloatLE(R[i], 48 + i * 8); }
  fs.writeFileSync(destino, buf);
}

const fallos = res.filter(r => !r.ok);
console.log(`\n${res.length - fallos.length}/${res.length} pruebas bien` + (fallos.length ? ` · FALLAN: ${fallos.map(f => f.nombre).join(' | ')}` : ''));
process.exit(fallos.length ? 1 : 0);
