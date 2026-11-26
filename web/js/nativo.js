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

// Compartir una imagen (el resultado): en la app, la hoja de compartir del sistema; en el navegador, la del navegador
// si sabe compartir ficheros y, si no, se descarga
const fsPlugin = nativo && C.registerPlugin ? C.registerPlugin('Filesystem') : null;
const sharePlugin = nativo && C.registerPlugin ? C.registerPlugin('Share') : null;
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
