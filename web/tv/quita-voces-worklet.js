// Quita la voz de la canción mientras suena (filtro de centro por STFT, dentro de Web Audio).
//
// Cómo: la voz de un disco casi siempre va al centro del estéreo (igual en los dos canales); los instrumentos
// van repartidos. Cada 21 ms (N = 1024 a 48 kHz) se abre una ventana, se separa el bin en su parte de centro
// C = (L+R)/2 y su parte de lado S = (L-R)/2, y se baja SOLO el centro, dejando el lado intacto. Así un
// instrumento duro a la izquierda no se toca y un bajo o un bombo centrado se protege por banda (por debajo de
// 140 Hz no se toca nada). El «cuánto» depende de lo iguales que sean los dos canales en ese bin (similitud
// con fase, entre -1 y 1): un bin centrado de verdad (sim≈1) se baja hasta el suelo; uno descorrelacionado, no.
//
// Lo que esto NO es: separación por modelo (Demucs). Es un filtro, no una separación: la voz baja mucho, pero
// lo que esté centrado en la misma banda (caja, guitarra solista, coros) baja con ella. El trabajador del admin
// sabe sacar la voz sola con Demucs; la vía fina es usar esa pista, no este filtro.
//
// Mensajes que entiende (port.postMessage desde el puente):
//   { nivel: 0|1|2 }  → 0 = apagado (identidad), 1 = suave, 2 = fuerte
//   { params: {...} } → ajuste fino: { lo, hi, exp, suelo, makeup }
// Contesta al arrancar con { type:'listo', n, rate, latencia } (latencia en segundos).

const TAU = Math.PI * 2;

// --- FFT compleja iterativa (radix 2, con tablas y permutación de bits)
function crearFFT(n) {
  const niveles = Math.round(Math.log2(n));
  const cos = new Float64Array(n >> 1), sen = new Float64Array(n >> 1);
  for (let i = 0; i < (n >> 1); i++) { cos[i] = Math.cos(TAU * i / n); sen[i] = Math.sin(TAU * i / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let x = i, r = 0; for (let b = 0; b < niveles; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  return { n, cos, sen, rev };
}

function fft(F, re, im, inversa) {
  const n = F.n, cos = F.cos, sen = F.sen, rev = F.rev;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let tam = 2; tam <= n; tam <<= 1) {
    const mitad = tam >> 1, paso = n / tam;
    for (let i = 0; i < n; i += tam) {
      for (let j = 0, k = 0; j < mitad; j++, k += paso) {
        const c = cos[k], s = inversa ? sen[k] : -sen[k];
        const ar = re[i + j + mitad], ai = im[i + j + mitad];
        const tr = ar * c - ai * s, ti = ar * s + ai * c;
        re[i + j + mitad] = re[i + j] - tr; im[i + j + mitad] = im[i + j] - ti;
        re[i + j] += tr; im[i + j] += ti;
      }
    }
  }
  if (inversa) { const f = 1 / n; for (let i = 0; i < n; i++) { re[i] *= f; im[i] *= f; } }
}

const NIVELES = { 0: { kappa: 0, exp: 1.6 }, 1: { kappa: 0.70, exp: 2.0 }, 2: { kappa: 0.94, exp: 1.5 } };

class QuitaVoces extends AudioWorkletProcessor {
  constructor(opciones) {
    super();
    const o = (opciones && opciones.processorOptions) || {};
    const N = this.N = o.n || 1024;          // ventana (muestras). Par, potencia de 2.
    const H = this.H = N >> 1;               // salto: 50 % de solape (Hann suma 1 exacto)
    this.F = crearFFT(N);
    const vent = this.vent = new Float32Array(N);
    for (let i = 0; i < N; i++) vent[i] = Math.sqrt(0.5 - 0.5 * Math.cos(TAU * i / N));   // raíz de Hann: ventana² = Hann
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.entL = new Float32Array(N); this.entR = new Float32Array(N);     // ventana de análisis
    this.salL = new Float32Array(N); this.salR = new Float32Array(N);     // acumulador de solape
    this.nueL = new Float32Array(H); this.nueR = new Float32Array(H);     // lo que entra en este salto
    this.colaL = new Float32Array(H); this.colaR = new Float32Array(H);   // lo que sale, ya sumado
    this.lleno = 0; this.cola = 0;
    this.simAnt = new Float32Array(N >> 1);
    this.peso = new Float32Array(N >> 1);      // 1 dentro de la banda de voz, 0 fuera (con rampas)
    this.p = { nivel: 0, lo: 140, hi: 11000, exp: 1.6, suelo: 0.06, makeup: 0 };
    this.kappa = 0;                            // valor suavizado que se aplica de verdad
    this.kappaObj = 0;
    this.guardia = 0;                          // 0 = fichero mono (no tocar), 1 = estéreo de verdad
    this.calcPeso();
    this.port.postMessage({ type: 'listo', n: N, rate: sampleRate, latencia: N / sampleRate });
    this.port.onmessage = e => this.mando(e.data || {});
  }

  mando(d) {
    if (d.nivel != null) {
      const n = NIVELES[+d.nivel | 0] || NIVELES[0];
      this.p.nivel = +d.nivel | 0;
      this.kappaObj = n.kappa; this.p.exp = n.exp;
    }
    if (d.params) {
      const p = this.p, q = d.params;
      if (q.lo) p.lo = Math.max(20, Math.min(2000, q.lo));
      if (q.hi) p.hi = Math.max(400, Math.min(sampleRate / 2 - 200, q.hi));
      if (q.exp != null) p.exp = Math.max(0.5, Math.min(6, q.exp));
      if (q.suelo != null) p.suelo = Math.max(0, Math.min(0.9, q.suelo));
      if (q.makeup != null) p.makeup = Math.max(0, Math.min(0.5, q.makeup));
      if (q.lo || q.hi) this.calcPeso();
      if (q.nivel != null) this.mando({ nivel: q.nivel });
    }
  }

  // Peso por bin: 0 por debajo de lo (bajo y bombo se quedan), 1 en la banda de la voz, 0 otra vez por encima de hi
  // (los platos van al centro y quitarlos deja la música sin aire).
  calcPeso() {
    const { lo, hi } = this.p, N = this.N, w = this.peso;
    const a0 = lo, a1 = lo * 1.45, b0 = hi / 1.5, b1 = hi;
    for (let k = 0; k < w.length; k++) {
      const f = k * sampleRate / N;
      const sube = f <= a0 ? 0 : f >= a1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (f - a0) / (a1 - a0));
      const baja = f <= b0 ? 1 : f >= b1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (f - b0) / (b1 - b0));
      w[k] = sube * baja;
    }
  }

  procesarMarco() {
    const N = this.N, H = this.H, F = this.F, re = this.re, im = this.im, vent = this.vent;
    const eL = this.entL, eR = this.entR;
    const p = this.p;
    // kappa objetivo suavizado (170 ms): encender o apagar no chasquea
    this.kappa += (this.kappaObj - this.kappa) * 0.12;
    const kap = this.kappa < 1e-4 ? 0 : this.kappa;
    // Sin filtro y sin mono-guardia que calcular: solo retardo (identidad y barato)
    // (aun así hay que pasar por la FFT para mantener el retardo constante y el reloj estable)

    // Dos señales reales en una FFT compleja: z = L + i·R  (mitad de trabajo, y L y R tratados igual)
    for (let i = 0; i < N; i++) { re[i] = eL[i] * vent[i]; im[i] = eR[i] * vent[i]; }
    fft(F, re, im, false);

    const mit = N >> 1, peso = this.peso, simAnt = this.simAnt;
    let eneC = 0, eneS = 0;
    for (let k = 1; k < mit; k++) {
      const j = N - k;
      // L̂ = (Z[k] + conj(Z[j]))/2 ; R̂ = (Z[k] - conj(Z[j]))·(-i/2)
      const ar = re[k], ai = im[k], br = re[j], bi = -im[j];
      const Lr = 0.5 * (ar + br), Li = 0.5 * (ai + bi);
      const dr = ar - br, di = ai - bi;
      const Rr = 0.5 * di, Ri = -0.5 * dr;
      const Cr = 0.5 * (Lr + Rr), Ci = 0.5 * (Li + Ri);
      const Sr = 0.5 * (Lr - Rr), Si = 0.5 * (Li - Ri);
      const magL = Math.hypot(Lr, Li), magR = Math.hypot(Rr, Ri);
      // Similitud con fase y con BALANCE: 2·Re(L·R*)/(|L|²+|R|²) va de −1 a 1, y pesa el balance, así que un
      // instrumento duro a un lado da ~0 aunque el otro canal tenga algo (antes daba cos(fase) y tocaba cosas a un lado).
      let sim = 2 * (Lr * Rr + Li * Ri) / (magL * magL + magR * magR + 1e-12);
      if (sim < 0) sim = 0;
      sim = 0.4 * simAnt[k] + 0.6 * sim;
      simAnt[k] = sim;
      const w = peso[k];
      if (w > 0) { eneC += Cr * Cr + Ci * Ci; eneS += Sr * Sr + Si * Si; }
      let g = 1;
      if (kap) {
        let s = sim; if (p.exp !== 1) s = Math.pow(s, p.exp);
        g = 1 - kap * w * s * this.guardia;
        if (g < p.suelo) g = p.suelo;   // suelo duro: nunca se deja el bin a cero (dejaría la música hueca)
      }
      const gr = 1 + p.makeup * (1 - g);                        // un poco de lado de vuelta, si se pide
      const LR = Cr * g, LI = Ci * g;                          // L̂' = C' + S'
      const RR = Cr * g, RI = Ci * g;                          // R̂' = C' - S'
      const SR = Sr * gr, SI = Si * gr;
      // Se vuelve a empaquetar: Z'[k] = L̂' + i·R̂' = (Lr - Ri) + i·(Li + Rr) ; Z'[N-k] = conj(L̂') + i·conj(R̂')
      const lr = LR + SR, li = LI + SI, rr = RR - SR, ri = RI - SI;
      re[k] = lr - ri; im[k] = li + rr;
      re[j] = lr + ri; im[j] = rr - li;
    }
    // Guardia de mono: si el fichero es mono (lado ≈ 0) el filtro se comería la música entera. Se mide y se apaga.
    // Un fichero mono de verdad da ~0 (los dos canales son iguales bit a bit); una mezcla estrecba y normal, 0,02–0,2.
    const ratio = eneS / (eneC + 1e-12);
    let guard = (ratio - 0.001) / (0.012 - 0.001);
    guard = guard < 0 ? 0 : guard > 1 ? 1 : guard;
    this.guardia += (guard - this.guardia) * 0.25;

    fft(F, re, im, true);

    // Solape y suma: ventana² = Hann, y Hann con salto N/2 suma exactamente 1
    const sL = this.salL, sR = this.salR;
    for (let i = 0; i < N; i++) { sL[i] += re[i] * vent[i]; sR[i] += im[i] * vent[i]; }
    this.colaL.set(sL.subarray(0, H)); this.colaR.set(sR.subarray(0, H));
    sL.copyWithin(0, H); sL.fill(0, N - H);
    sR.copyWithin(0, H); sR.fill(0, N - H);
    this.cola = 0;
  }

  process(entradas, salidas) {
    const eL = entradas[0] && entradas[0][0], eR = entradas[0] && (entradas[0][1] || entradas[0][0]);
    const sL = salidas[0][0], sR = salidas[0][1] || salidas[0][0];
    const n = sL.length, N = this.N, H = this.H;
    for (let i = 0; i < n; i++) {
      const l = eL ? eL[i] : 0, r = eR ? eR[i] : 0;
      this.nueL[this.lleno] = l; this.nueR[this.lleno] = r;
      this.lleno++;
      if (this.lleno === H) {
        // ventana de análisis: se desplaza H y entra lo nuevo
        this.entL.copyWithin(0, H); this.entL.set(this.nueL, N - H);
        this.entR.copyWithin(0, H); this.entR.set(this.nueR, N - H);
        this.procesarMarco();
        this.lleno = 0;
      }
      sL[i] = this.colaL[this.cola];
      if (sR !== sL) sR[i] = this.colaR[this.cola];
      this.cola = (this.cola + 1) % H;
    }
    return true;
  }
}

registerProcessor('quita-voces', QuitaVoces);
