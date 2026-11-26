// Mantener la pantalla del móvil encendida mientras se canta.
// Si la pantalla se apaga, iOS y Android cortan el micro: hay que evitarlo a toda costa.
//  1. Screen Wake Lock (iOS 16.4+, Android Chrome…). El sistema lo suelta cada vez que la página se oculta,
//     así que se vuelve a pedir al volver y también si se suelta solo.
//  2. Plan B: un vídeo diminuto, mudo y en bucle (en móviles sin Wake Lock, un vídeo reproduciéndose impide el bloqueo).
import { nativo } from '/js/nativo.js';

let lock = null;
let wanted = false;
let video = null;
let onChange = () => {};

export const wakeSupported = () => 'wakeLock' in navigator;

async function requestLock() {
  if (!wanted || document.visibilityState !== 'visible') return;
  if (wakeSupported()) {
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
        onChange(false);
        // Si se suelta con la página visible (ahorro de batería, etc.), se vuelve a pedir
        if (wanted && document.visibilityState === 'visible') setTimeout(requestLock, 500);
      });
      onChange(true);
      return;
    } catch {}
  }
  startVideo();
}

function startVideo() {
  if (!video) {
    video = document.createElement('video');
    video.src = '/m/despierto.mp4';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', bottom: '0', left: '0' });
    document.body.appendChild(video);
  }
  video.play().then(() => onChange(true)).catch(() => onChange(false));
}

// Llamar desde un toque del usuario (los navegadores lo exigen la primera vez)
export function keepAwake(cb) {
  if (cb) onChange = cb;
  // App nativa: la pantalla se queda encendida desde el código nativo todo el rato que la app está abierta
  if (nativo) { wanted = true; onChange(true); return; }
  wanted = true;
  requestLock();
  if (!wakeSupported()) startVideo();
}
export function letSleep() {
  wanted = false;
  if (lock) lock.release().catch(() => {});
  lock = null;
  if (video) video.pause();
}
export const isAwake = () => (nativo && wanted) || !!lock || (video && !video.paused);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) requestLock();
});
// Cualquier toque reactiva el plan B si el navegador lo había pausado
document.addEventListener('touchend', () => { if (wanted && !isAwake()) requestLock(); }, { passive: true });
