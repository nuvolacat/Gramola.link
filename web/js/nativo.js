// Puente con la app nativa del micro (Capacitor). En el navegador no hace nada y todo sigue como en la web.
// La app define window.GRAMOLA = { servidor: 'https://…', micro: 'micro.…' } antes de cargar el micro, y registra
// el complemento nativo «GramolaNativo»: micro del móvil, pantalla siempre encendida y vibración.
const C = window.Capacitor;
export const nativo = !!(C && C.isNativePlatform && C.isNativePlatform());
const cfg = window.GRAMOLA || {};
export const plugin = nativo && C.registerPlugin ? C.registerPlugin('GramolaNativo') : null;
const appPlugin = nativo && C.registerPlugin ? C.registerPlugin('App') : null;

// Servidor de las salas (en la web, el mismo de la página)
export const servidor = () => new URL(cfg.servidor || location.origin);
// Dirección del micro que se enseña en los textos («Abre … en el móvil»)
export const microHost = () => cfg.micro || location.host;

// tipo: 'suave' | 'medio' | 'exito' (en la app, vibración háptica de cada clase; en el navegador, solo la duración)
export function vibrar(ms, tipo) {
  if (plugin) return plugin.vibrar({ ms, tipo: tipo || '' }).catch(() => {});
  if (navigator.vibrate) navigator.vibrate(tipo === 'exito' ? [ms, 60, ms] : ms);
}

// Enlaces del QR de la tele abiertos con la app (…/?s=CODE): al arrancar y con la app ya abierta
export function alAbrirEnlace(cb) {
  if (!appPlugin) return;
  appPlugin.addListener('appUrlOpen', e => cb(e && e.url)).catch(() => {});
  appPlugin.getLaunchUrl().then(r => r && r.url && cb(r.url)).catch(() => {});
}
