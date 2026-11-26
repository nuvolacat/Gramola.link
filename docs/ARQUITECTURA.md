# Arquitectura

```
                         ┌───────────────────────────────┐
  Móvil 1..8 (/m)        │  Servidor de salas (Node.js)   │        Tele (/)
 ┌───────────────┐  WS   │  /ws          salas y mensajes │  WS   ┌──────────────────────────────┐
 │ micro + YIN   │──────►│  /api/songs   canciones        │◄──────│ diseño original (React)       │
 │ wake lock     │◄──────│  /api/records salón de la fama │       │   + gramola-bridge.js         │
 │ PWA           │       │  estáticos (web, canciones)    │       │ navegador de la tele          │
 └───────────────┘       └───────────────────────────────┘       └──────────────────────────────┘
```

## La tele: diseño 1:1 + puente

La pantalla de la tele **es el prototipo del diseño** (`diseno/Gramola TV.dc.html`), que ya trae todas las pantallas,
transiciones, mando y la pantalla de canto. No se redibuja nada: así queda idéntica al diseño por construcción.

`tools/build-tv.py` lo copia a `web/app/index.html` e inserta unos 120 enganches cortos que llaman a `web/tv/gramola-bridge.js`:

| Enganche | Qué cambia |
|---|---|
| `PLAYERS`, `SONGS`, `REC2/REC3`, `LANGS/DECS/GENS` | Las constantes simuladas pasan a ser arrays del puente con datos reales. |
| `buildChart()` | La partitura sale del `.txt` UltraStar de la canción elegida (tiempos reales, tono en semitonos, notas doradas/libres/rap, dúos P1/P2). |
| `update(dt)` | Misma lógica de puntuación del diseño, pero con el **reloj del audio** y la **voz real** de cada móvil (los bots siguen simulados como en el diseño). |
| `py()` | Altura de las notas según el registro real de la canción. |
| `addPlayer`, `isOff`, expulsar, nuevo código | Acciones reales de la sala (bot en el servidor, micro desconectado, kick, nueva sala). |
| `qrRef`, `room` | Código y QR reales de la sala. |
| `errAct`, `ERRS` | Los avisos saltan con fallos reales (sin red, sala perdida, sala llena, micro perdido, canción que no carga). |
| `beats()` | Calibración del retraso con pitidos reales y los «pa» del móvil. |
| `finishSing` | Guarda los récords en el servidor. |
| bucle | `GR.tick()`: música de menús en bucle, avance de la canción enfocada, pitidos de la cuenta atrás y estado para los móviles. |
| `<head>` | `<base href="/tv/">`, iconos, QR y el puente antes del runtime del diseño. |

Si llega un diseño nuevo y algún trozo cambió, el script se detiene y dice qué enganche ya no encaja.

## Lo que añade el puente

| Parte | Cómo funciona |
|---|---|
| **Lista de canciones** | Rejilla de dos filas que se desplaza en horizontal, agrupada por inicial (o década), con tira de letras. Solo se dibujan las fichas visibles y se reutilizan (sin transiciones de color, para que no parpadeen). |
| **Avances** | Se descarga por rangos solo el trozo del mp3 desde el minuto 1 (se calcula la posición con la cabecera MP3/Xing), se decodifica y suena por Web Audio con fundido cruzado: la tele LG solo reproduce un `<audio>` a la vez. |
| **Megamix** | Elección de 4/6/8 canciones al azar sin repetir artista; una sola partitura con los tramos encadenados y audio por Web Audio con fundido cruzado de 3 s; el reloj de la partida es el del `AudioContext`. |
| **Pantalla de canto** | Carril por frases (`pageLane`), portada de fondo (miniatura de 160×90 ampliada: difumina sin coste), letra centrada que se encoge si no cabe y sin «~». |
| **Barra de aproximación** | Antes de cada frase se desliza hasta la primera letra y la toca al empezar; luego sigue y se desvanece. En la intro recorre toda la intro; tras una pausa larga, sus últimos 3 s. |
| **Vibrato** | Detector en notas largas (ver PUNTUACION.md); se dibuja con dos ondas entrelazadas y purpurina. |
| **Sonido** | «Zzzup» al cambiar la selección en cualquier pantalla, aplausos (grabación CC0) al salir los resultados, pausa que se desvanece (~0,6 s) con «whooom» y vuelve al punto exacto. |
| **Reloj** | Sigue al audio (suavizado: algunas teles actualizan `currentTime` a saltos) y descuenta el retraso de salida del audio (`outputLatency` + `baseLatency`) para que letra y cajas vayan con lo que se oye. |
| **Bienvenida** | Cinco filas de portadas difuminadas que se desplazan; cada pocos segundos una se enfoca ~4 s. Se descartan portadas iguales comparando su huella de 8×8. |
| **Mando** | Ayudas con los símbolos del mando de PlayStation; teclas del mando de la tele (Atrás 461, botones de colores) traducidas a las del diseño. |
| **Títulos** | Sin paréntesis ni corchetes y con mayúscula inicial en cada palabra, salvo «a e i o u y» sueltas. |
| **Direcciones** | El QR y los textos salen del dominio en uso (`micro.` + dominio); el servidor rellena `%%ORIGEN%%` en las páginas. |

El runtime del diseño (`support.js`) usa React 18.3.1 y Babel standalone 7.29.0, servidos en local desde `web/vendor/`
(sin depender de unpkg en la tele).

## Voz y latencia

1. El móvil detecta el tono (YIN, 2.048 muestras cada 40 ms) y envía `{n, v, lat}`.
2. La tele recibe la muestra y la coloca en el instante en que se cantó:
   `t = reloj_audio − (retraso_micro + latencia_móvil + latencia_tele)`.
3. La nota activa en `t` se compara con el tono (octava indiferente) y con el margen de la dificultad.
4. La estela se dibuja en ese instante, así que va pegada a las notas aunque la red tarde.

## Ficheros

| Ruta | Qué es |
|---|---|
| `diseno/` | Diseño original: `Gramola TV.dc.html`, `Gramola Movil.dc.html`, `Gramola Sistema.dc.html`, `support.js`, `_ds/`, `assets/`, `exports/`. |
| `tools/build-tv.py` | Monta la tele desde el diseño. |
| `web/app/index.html` | Tele montada (generada: no editar a mano). |
| `web/index.html` | Web informativa. |
| `web/tv/gramola-bridge.js` | El puente con lo real. |
| `web/m/` | Web del micro: `index.html`, `m.css`, `m.js`, `manifest.webmanifest`, `sw.js`, `despierto.mp4`. |
| `web/m/historial.js` · `web/m/compartir.js` | Historial y logros del cantante (solo en su móvil, `localStorage`) · imagen para compartir el resultado (canvas 1080×1920, estilos póster, entrada, micro y marcador). |
| `web/js/` | `net.js` (WebSocket con reconexión y cola), `pitch.js` (YIN), `ultrastar.js` (lector), `wake.js` (pantalla encendida), `nativo.js` (puente opcional con una app nativa del micro: servidor configurable con `window.GRAMOLA`, micro, pantalla, brillo, batería y vibración nativos; en el navegador no hace nada). |
| `web/assets/` | Recursos del diseño optimizados para web (micros en WebP, iconos, logos…). |
| `web/audio/menu.mp3` | Música de los menús (original, en bucle). |
| `web/audio/aplausos.mp3` | Aplausos de los resultados (grabación CC0). |
| `server/server.js` | Salas, colores, bots, récords, canciones y estáticos. |
| `tools/preparar-canciones.py`, `normalizar.py`, `megamix.py`, `caratulas.py`, `subir-canciones.sh` | Preparar, igualar, recortar el Megamix, buscar portadas y subir canciones (ver CANCIONES.md). |
| `tools/demo-song.py` | Genera la canción de demostración original. |
| `deploy/` | systemd, Apache/Plesk y script de despliegue. |
