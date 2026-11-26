// Calentamiento vocal: respiración guiada y escalas que el móvil toca y tú repites (el micro las comprueba).
// Todo en el móvil; usa la misma detección de tono que al cantar.
import { midiName } from '/js/pitch.js?v=1793577586';

const ESCALA = [0, 2, 4, 5, 7, 5, 4, 2, 0];   // Do Re Mi Fa Sol Fa Mi Re Do (relativo a la nota de partida)
const RONDAS = 3, ACIERTO_MS = 400, TIEMPO_NOTA = 5000;
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

export function crearCalentamiento({ $, rango, toque }) {
  let ctx = null, fase = 'inicio', base = 57, idx = 0, ronda = 0, aciertos = 0, enNota = 0, notaT = 0, timers = [], vez = 0;
  const limpiar = () => { timers.forEach(clearTimeout); timers = []; };
  const luego = (fn, ms) => timers.push(setTimeout(fn, ms));
  function tono(m, ms = 700) {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume();
    const g = ctx.createGain(), o = ctx.createOscillator(), t = ctx.currentTime;
    o.type = 'triangle'; o.frequency.value = hz(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.03); g.gain.setValueAtTime(0.28, t + ms / 1000 - 0.08); g.gain.linearRampToValueAtTime(0, t + ms / 1000);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
  }
  const objetivo = () => base + ronda + ESCALA[idx];
  function pintarTono() { $('cal-base').textContent = 'Empieza en ' + midiName(base); }

  function inicio() {
    limpiar(); fase = 'inicio';
    const r = rango();
    if (r) base = Math.max(40, Math.min(72, Math.round(r.min + (r.max - r.min) * 0.3)));   // cómodo: algo por encima de lo más grave
    $('cal-tit').textContent = 'Calienta la voz';
    $('cal-txt').textContent = 'Primero respiramos y luego repites unas escalas: el móvil toca cada nota y tú la cantas. Ponte en un sitio tranquilo.';
    $('cal-zona').innerHTML = '';
    $('cal-tono').hidden = false; pintarTono();
    $('b-cal').firstChild.textContent = 'Empezar ';
  }
  function respirar() {
    limpiar(); fase = 'respirar';
    $('cal-tono').hidden = true;
    $('cal-tit').textContent = 'Respira';
    $('cal-zona').innerHTML = '<div class="cal-circ" id="cal-circ"></div><p class="cal-paso" id="cal-paso"></p>';
    $('b-cal').firstChild.textContent = 'Saltar ';
    const pasos = [['Coge aire por la nariz', 4000, 'grande'], ['Aguanta', 4000, 'grande'], ['Suéltalo despacio por la boca', 6000, '']];
    let t = 0;
    for (let c = 0; c < 3; c++) for (const [txt, ms, clase] of pasos) {
      luego(() => { $('cal-paso').textContent = `${txt} · ${c + 1} de 3`; $('cal-circ').className = 'cal-circ ' + clase; $('cal-circ').style.transitionDuration = ms + 'ms'; }, t);
      t += ms;
    }
    luego(escalas, t);
  }
  function escalas() {
    limpiar(); fase = 'escalas'; idx = 0; ronda = 0; aciertos = 0;
    $('cal-tono').hidden = true;
    $('cal-tit').textContent = 'Escalas';
    $('cal-txt').textContent = 'Escucha la nota y cántala hasta que se ponga en verde.';
    $('cal-zona').innerHTML = '<div class="cal-nota"><small id="cal-ronda"></small><b id="cal-obj"></b><span id="cal-voz">–</span></div><div class="cal-pasos" id="cal-pasos"></div>';
    $('b-cal').firstChild.textContent = 'Terminar ';
    siguienteNota();
  }
  function siguienteNota() {
    if (idx >= ESCALA.length) { idx = 0; ronda++; }
    if (ronda >= RONDAS) return final();
    const m = objetivo();
    $('cal-ronda').textContent = `Ronda ${ronda + 1} de ${RONDAS} · nota ${idx + 1} de ${ESCALA.length}`;
    $('cal-obj').textContent = midiName(m); $('cal-obj').className = '';
    $('cal-pasos').innerHTML = ESCALA.map((_, i) => `<i class="${i < idx ? 'h' : i === idx ? 'a' : ''}"></i>`).join('');
    enNota = 0; notaT = performance.now() + 700;   // (mientras suena el tono no cuenta)
    tono(m);
    const esta = ++vez;
    luego(() => { if (fase === 'escalas' && vez === esta) { idx++; siguienteNota(); } }, TIEMPO_NOTA + 700);   // no salió: a la siguiente
  }
  function final() {
    limpiar(); fase = 'final';
    const total = RONDAS * ESCALA.length, pct = Math.round(100 * aciertos / total);
    $('cal-tit').textContent = pct >= 80 ? '¡Voz a punto!' : pct >= 50 ? '¡Bien calentado!' : 'Calentamiento hecho';
    $('cal-txt').textContent = `Has clavado ${aciertos} de ${total} notas (${pct} %). ${pct < 50 ? 'Si te cuesta, prueba a bajar el tono de partida.' : ''}`;
    $('cal-zona').innerHTML = '';
    $('cal-tono').hidden = false; pintarTono();
    $('b-cal').firstChild.textContent = 'Otra vez ';
    toque && toque(30);
  }
  return {
    abrir: inicio,
    cerrar() { limpiar(); fase = 'inicio'; },
    boton() { if (fase === 'inicio' || fase === 'final') respirar(); else if (fase === 'respirar') escalas(); else final(); },
    mover(d) { base = Math.max(40, Math.min(76, base + d)); pintarTono(); tono(base, 500); },
    // Cada lectura del micro (25 por segundo)
    frame(n) {
      if (fase !== 'escalas' || idx >= ESCALA.length) return;
      const m = objetivo(), t = performance.now();
      $('cal-voz').textContent = n == null ? '–' : midiName(n) + (Math.abs(n - m) <= 0.5 ? ' ✓' : n < m ? ' ↑ sube' : ' ↓ baja');
      if (t < notaT) return;
      if (n != null && Math.abs(n - m) <= 0.5) { enNota += 40; } else enNota = Math.max(0, enNota - 40);
      if (enNota >= ACIERTO_MS) {
        aciertos++; $('cal-obj').className = 'ok'; toque && toque(15);
        const sig = idx + 1, esta = ++vez; notaT = Infinity;
        luego(() => { if (fase === 'escalas' && vez === esta) { idx = sig; siguienteNota(); } }, 450);
      }
    },
  };
}
