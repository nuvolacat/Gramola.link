// Puente con la app nativa del micro (Capacitor). En el navegador no hace nada y todo sigue como en la web.
// La app define window.GRAMOLA = { servidor: 'https://…', micro: 'micro.…' } antes de cargar el micro, y registra
// el complemento nativo «GramolaNativo»: micro del móvil, pantalla siempre encendida y vibración.
const C = window.Capacitor;
export const nativo = !!(C && C.isNativePlatform && C.isNativePlatform());
const cfg = window.GRAMOLA || {};
// Los complementos nativos están en Capacitor.Plugins (registerPlugin solo existe al empaquetar con npm)
const complemento = n => (nativo && ((C.Plugins && C.Plugins[n]) || (C.registerPlugin && C.registerPlugin(n)))) || null;
export const plugin = complemento('GramolaNativo');
const appPlugin = complemento('App');

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
// (se pregunta con la página ya cargada y con reintentos: nada más arrancar, Android aún no tiene el enlace y da vacío)
let arranque = null;
export function urlDeArranque() {
  if (!appPlugin) return Promise.resolve('');
  if (!arranque) arranque = (async () => {
    if (document.readyState !== 'complete') await new Promise(ok => addEventListener('load', ok, { once: true }));
    for (let i = 0; i < 4; i++) {
      const r = await appPlugin.getLaunchUrl().catch(() => null);
      if (r && r.url) return r.url;
      await new Promise(ok => setTimeout(ok, 150));
    }
    return '';
  })();
  return arranque;
}
export function alAbrirEnlace(cb) {
  if (!appPlugin) return;
  // (según la versión, addListener devuelve el oyente o una promesa: se aceptan las dos)
  try { const h = appPlugin.addListener('appUrlOpen', e => cb(e && e.url)); if (h && h.catch) h.catch(() => {}); } catch {}
  urlDeArranque().then(u => u && cb(u));
}

// Compartir una imagen (el resultado): en la app, la hoja de compartir del sistema; en el navegador, la del navegador
// si sabe compartir ficheros y, si no, se descarga
const fsPlugin = complemento('Filesystem');
const sharePlugin = complemento('Share');
export async function compartirImagen(canvas, texto, nombre = 'gramola.png') {
  if (sharePlugin && fsPlugin) {
    const datos = canvas.toDataURL('image/png').split(',')[1];
    const { uri } = await fsPlugin.writeFile({ path: nombre, data: datos, directory: 'CACHE' });
    try { await sharePlugin.share({ title: 'Gramola', text: texto, files: [uri] }); } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
    return 'compartido';
  }
  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/png'));
  const fichero = new File([blob], nombre, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [fichero] })) {
    try { await navigator.share({ files: [fichero], text: texto }); return 'compartido'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'descargado';
}
