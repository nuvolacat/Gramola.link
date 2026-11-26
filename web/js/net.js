// Conexión WebSocket con reconexión automática y medida de latencia.
// La usan la tele y el móvil.
import { servidor } from '/js/nativo.js';
export class Net {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.hello = null;      // mensaje a reenviar al (re)conectar
    this.rtts = [];
    this.halfLatency = 40;  // ms, estimación inicial
    this.retry = 0;
    this.queue = [];        // mensajes importantes enviados sin conexión: salen al reconectar
    this.lastPong = 0;
    setInterval(() => {
      // Socket zombi (al volver del segundo plano en Android el TCP está muerto pero readyState sigue abierto):
      // sin pong en 7 s se da por caído y se reconecta sin esperar a que lo cierre el servidor
      if (this.ws && this.ws.readyState === 1 && this.lastPong && Date.now() - this.lastPong > 7000) {
        const old = this.ws; this.ws = null; try { old.close(); } catch {}
        this.onStatus('closed'); this.connect(); return;
      }
      this.send({ type: 'ping', t: performance.now() });
    }, 2000);
  }

  url() {
    const base = servidor();   // en la app nativa, el servidor de su configuración; en la web, esta misma página
    const proto = base.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${base.host}/ws`;
  }

  connect(hello) {
    if (hello) this.hello = hello;
    if (this.ws && this.ws.readyState <= 1) return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    this.onStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.lastPong = Date.now();
      this.onStatus('open');
      const h = typeof this.hello === 'function' ? this.hello() : this.hello;
      if (h) this.send(h);
      const q = this.queue.splice(0);
      q.forEach(m => { if (m !== h) this.send(m); });   // (el saludo ya ha salido: no se manda dos veces)
    };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'pong') {
        this.lastPong = Date.now();
        const rtt = performance.now() - m.t;
        this.rtts.push(rtt);
        if (this.rtts.length > 9) this.rtts.shift();
        const sorted = [...this.rtts].sort((a, b) => a - b);
        this.halfLatency = sorted[sorted.length >> 1] / 2;
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.onStatus('closed');
      const wait = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => ws.close();
  }

  send(m) {
    if (this.ws && this.ws.readyState === 1) return this.ws.send(JSON.stringify(m));
    // Lo que caduca enseguida (ping, voz, estado) no se guarda
    if (!['ping', 'pitch', 'state', 'clock'].includes(m.type) && this.queue.length < 20) this.queue.push(m);
  }
}
