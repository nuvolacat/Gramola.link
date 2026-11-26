// Detección de tono con YIN sobre el micro del móvil.
// Devuelve nota MIDI decimal (69 = La 440 Hz) o null, y el volumen.

import { plugin as nativoPlugin } from '/js/nativo.js';

export function yin(buf, sampleRate, minHz = 70, maxHz = 1100, threshold = 0.2) {
  const tauMin = Math.floor(sampleRate / maxHz);
  const tauMax = Math.min(Math.floor(sampleRate / minHz), (buf.length >> 1) - 1);
  const W = buf.length >> 1;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const x = buf[i] - buf[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // Diferencia normalizada acumulada
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    d[tau] = run ? d[tau] * tau / run : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  // Con ruido (la música de la tele entrando por el micro) no siempre hay un mínimo por debajo del umbral:
  // entonces se toma el mínimo global si es razonablemente claro.
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
    if (d[best] < 0.4) {
      tau = best;
      // Entre candidatos casi igual de buenos, el periodo más corto (evita confundir la nota con un múltiplo)
      const lim = d[best] * 1.2 + 0.03;
      for (let t = tauMin + 1; t < best; t++) if (d[t] < lim && d[t] <= d[t - 1] && d[t] <= d[t + 1]) { tau = t; break; }
    }
  }
  if (tau < 0) return null;
  // Interpolación parabólica para afinar
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
  const den = a - 2 * b + c;
  const shift = den ? (a - c) / (2 * den) : 0;
  return { hz: sampleRate / (tau + shift), clarity: 1 - b };
}

export const hzToMidi = hz => 69 + 12 * Math.log2(hz / 440);

const NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const midiName = m => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

// Siempre el micro del propio móvil: si el sistema da unos auriculares (AirPods, Bluetooth, cable…), se cambia
// por el micrófono integrado. Ganancia automática SÍ (sin ella el iPhone entrega la voz muy floja); eco y
// supresión de ruido NO (estropean el tono).
const AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
const EXTERNO = /airpod|bluetooth|\bbt\b|headset|headphone|auricular|cascos|earbud|buds|beats|hands-?free|manos libres|jabra|bose|wh-|wf-|usb|externo|external|wired/i;
const INTEGRADO = /iphone|ipad|built-?in|integrad|interno|del (teléfono|móvil)|phone mic|bottom|front|back|speakerphone|default/i;
async function phoneMic(integrado = true) {
  let s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
  if (!integrado) return s;   // ajuste «Usar siempre el micro del móvil» desactivado: el que dé el sistema (micro externo)
  try {
    const tr = s.getAudioTracks()[0];
    if (!tr || !EXTERNO.test(tr.label)) return s;
    const ins = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && !EXTERNO.test(d.label));
    const pick = ins.find(d => INTEGRADO.test(d.label) && d.deviceId !== 'default') || ins.find(d => d.deviceId !== 'default') || ins[0];
    if (!pick) return s;
    const s2 = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: pick.deviceId } } });
    s.getTracks().forEach(t => t.stop());
    return s2;
  } catch { return s; }
}

export class PitchTracker {
  constructor(onFrame, opts = {}) {
    this.onFrame = onFrame;
    this.integrado = opts.integrado !== false;
    this.history = [];
    this.noiseFloor = 0.004;
  }

  async start() {
    if (nativoPlugin) return this.startNativo();
    // El AudioContext se crea ANTES de pedir el micro: así nace con el gesto del usuario (en iPhone, si el aviso de
    // permiso tarda, el gesto caduca y un contexto creado después se queda «suspended» sin remedio)
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.ctx.resume().catch(() => {});
    const stream = await phoneMic(this.integrado);
    await this.ctx.resume().catch(() => {});
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.use(stream);
    this.timer = setInterval(() => this.tick(), 40); // 25 lecturas por segundo
    // Si se conectan unos auriculares a mitad de partida, volver al micro del móvil
    this.onDev = () => this.recheck();
    navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener('devicechange', this.onDev);
  }

  use(stream) {
    if (this.src) try { this.src.disconnect(); } catch {}
    if (this.stream && this.stream !== stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = stream;
    this.src = this.ctx.createMediaStreamSource(stream);
    this.src.connect(this.analyser);
    // Si el sistema corta la pista (llamada, otra app coge el micro, permiso retirado), se vuelve a pedir el micro
    const tr = stream.getAudioTracks()[0];
    if (tr) tr.addEventListener('ended', () => { if (this.stream === stream) this.reacquire(); });
  }

  async reacquire() {
    if (this.busy || !this.timer) return;
    this.busy = true;
    try { this.use(await phoneMic(this.integrado)); } catch {}
    this.busy = false;
  }

  async recheck() {
    if (!this.stream || this.busy) return;
    const tr = this.stream.getAudioTracks()[0];
    if (!this.integrado || (tr && !EXTERNO.test(tr.label))) return;
    this.busy = true;
    try { this.use(await phoneMic(this.integrado)); } catch {}
    this.busy = false;
  }

  // App nativa: el micro integrado lo abre el código nativo (sin auriculares, sin eco ni supresión de ruido) y manda
  // los últimos 2048 valores 25 veces por segundo; el análisis es el mismo de siempre (analizar)
  async startNativo() {
    this.ctx = { state: 'running', sampleRate: 48000, resume: () => Promise.resolve(), close: () => {} };   // (m.js mira tracker.ctx)
    this.buf = new Float32Array(2048);
    this.oyente = await nativoPlugin.addListener('audio', e => {
      const bin = atob(e.d), n = Math.min(bin.length >> 2, this.buf.length), u8 = new Uint8Array(n * 4);
      for (let i = 0; i < u8.length; i++) u8[i] = bin.charCodeAt(i);
      this.buf.set(new Float32Array(u8.buffer));
      if (e.sr) this.ctx.sampleRate = e.sr;
      this.analizar();
    });
    try {
      const r = await nativoPlugin.micro({ activo: true, muestras: this.buf.length, ms: 40, integrado: this.integrado });
      if (r && r.sr) this.ctx.sampleRate = r.sr;
    } catch (e) {
      this.oyente.remove();
      const err = new Error(e && e.message || 'micro');
      err.name = /permi|denied|autoriz/i.test(err.message) ? 'NotAllowedError' : 'NotReadableError';
      throw err;
    }
    this.timer = true;
  }

  // Cambio del ajuste con el micro abierto
  setIntegrado(v) {
    this.integrado = !!v;
    if (this.oyente) return nativoPlugin.micro({ activo: true, muestras: this.buf.length, ms: 40, integrado: this.integrado }).catch(() => {});
    if (this.stream) { this.busy = false; this.reacquire(); }
  }

  stop() {
    if (this.oyente) { this.oyente.remove(); this.oyente = null; nativoPlugin.micro({ activo: false }).catch(() => {}); this.timer = null; return; }
    clearInterval(this.timer);
    this.onDev && navigator.mediaDevices.removeEventListener && navigator.mediaDevices.removeEventListener('devicechange', this.onDev);
    this.stream && this.stream.getTracks().forEach(t => t.stop());
    this.ctx && this.ctx.close();
  }

  tick() {
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.analyser.getFloatTimeDomainData(this.buf);
    this.analizar();
  }

  analizar() {
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    this.peak = Math.max(rms, (this.peak || 0.01) * 0.995);
    const vol = Math.min(1, rms / Math.max(0.004, this.peak * 0.8));
    let midi = null, r = null;
    const gate = rms > Math.max(0.0007, this.noiseFloor * 1.7);
    if (gate) {
      r = yin(this.buf, this.ctx.sampleRate);
      if (r && r.clarity > 0.55) midi = hzToMidi(r.hz);
    }
    // Suelo de ruido adaptativo: baja rápido y sube despacio, pero NO mientras hay una nota clara (si no, una nota
    // larga a volumen constante acababa «siendo ruido» a los 7 s y se cortaba)
    const voz = r && r.clarity > 0.55;
    this.noiseFloor = rms < this.noiseFloor ? rms * 0.5 + this.noiseFloor * 0.5 : voz ? this.noiseFloor : this.noiseFloor * 0.995 + rms * 0.005;
    // Mediana de 3 para quitar saltos de octava sueltos
    this.history.push(midi);
    if (this.history.length > 3) this.history.shift();
    const vals = this.history.filter(x => x !== null).sort((a, b) => a - b);
    const out = midi === null ? null : vals[vals.length >> 1];
    this.onFrame(out, vol, { rms, gate, hz: r ? r.hz : null, clarity: r ? r.clarity : 0, raw: midi, sr: this.ctx.sampleRate });
  }
}
