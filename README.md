<div align="center">

<img src="docs/readme/icono.png" width="120" alt="Icono de Gramola"><br>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/logo-oscuro.png">
  <img src="docs/readme/logo-claro.png" width="420" alt="gramola">
</picture>

**Karaoke en casa. Tu móvil es el micro.**

La tele es el escenario (**funciona en el navegador**) y cada móvil es un micrófono:
escaneas el QR, eliges tu color y cantas. Gramola escucha el tono de cada voz y puntúa lo afinado que vas.

![Versión](https://img.shields.io/badge/versi%C3%B3n-1.26.1113.1750-ec3013)
![Navegador](https://img.shields.io/badge/navegador-Edge%20%C2%B7%20Chrome%20%C2%B7%20Safari-1f6feb)
![PWA](https://img.shields.io/badge/micro-web%20%2B%20PWA-ec3013)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-5fa04e?logo=nodedotjs&logoColor=white)
![UltraStar](https://img.shields.io/badge/canciones-formato%20UltraStar-201e1d)
![Hasta 8 jugadores](https://img.shields.io/badge/jugadores-hasta%208-F2C230)

<br>

<p>
<img src="docs/readme/canto.png" width="80%" alt="Cantando">
</p>

<p>
<img src="docs/readme/bienvenida.png" width="26%" alt="Bienvenida">
<img src="docs/readme/sala.png" width="26%" alt="Sala con QR">
<img src="docs/readme/canciones.png" width="26%" alt="Canciones">
</p>

<p>
<img src="docs/readme/menu.png" width="26%" alt="Menú">
<img src="docs/readme/resultados.png" width="26%" alt="Resultados">
<img src="docs/readme/pasa-el-micro.png" width="26%" alt="Pásalo">
</p>

<p>
<img src="docs/readme/movil-01-unirse.png" width="19%" alt="Unirse">
<img src="docs/readme/movil-02-color.png" width="19%" alt="Elegir color">
<img src="docs/readme/movil-03-esperando.png" width="19%" alt="Esperando">
<img src="docs/readme/movil-04-micro.png" width="19%" alt="Micro">
</p>

</div>

---

## 🎤 Cómo se juega

1. Enciende Gramola en la tele. Tras la intro sale la **sala**: un código de 4 letras (tipo «MOKA») y su QR.
2. Cada uno escanea el QR, pone su nombre y **elige su color** (8 colores, uno por persona). El móvil se convierte en un micro de su color.
3. Con el mando (o con los botones del móvil) se elige modo, canción y dificultad de cada cantante.
4. Las notas pasan por la línea roja: tu voz se dibuja con tu color y las notas se rellenan cuando aciertas. Las doradas valen doble.
5. Al final: puntuación sobre 10.000, precisión, notas doradas, racha, mejor frase y tu **rango**
   (*Cantante de ducha, Aficionado, Promesa, Estrella, Leyenda, Mito*). Los récords se guardan.

## ✨ Modos

| | |
|---|---|
| 🎙️ **Cantar** | Solo o todos a la vez (hasta 8 micros), cada uno con su estela y su marcador. |
| ⚔️ **Duelo** | Dos jugadores o dos equipos cara a cara, con barra de tira y afloja. |
| 🎶 **Megamix** | El estribillo de 4, 6 u 8 canciones al azar (sin repetir artista), seguidas y con fundido cruzado; entre una y otra se anuncia la siguiente. |
| 🎲 **Pásalo** | Equipos, ruleta de 8 retos (*sin ver la letra, canta más agudo, susurrando…*), turnos, marcador y campeones. |
| 📺 **Jukebox** | La letra en grande y sin puntos, para cantar todos; cola automática de canciones. |
| 🏆 **Récords** | Salón de la fama por canción, cantantes con más canciones, rachas y rangos. |
| ⚙️ **Ajustes** | Dificultad, **calibración del retraso del micro cantando**, volúmenes, estela, tamaño de letra, gestión de la sala y **Créditos** (qué es Gramola, licencias de todo lo que usa y contacto para retirar contenidos; también con △ en la bienvenida). |

## 🌟 Detalles

- **Bienvenida viva**: filas de portadas difuminadas pasan de derecha a izquierda y, cada pocos segundos, una se enfoca unos 4 s.
- **Lista de canciones en rejilla** de dos filas agrupada por letra (o década), con tira de letras, desvanecimiento en los laterales
  y avance de cada canción desde el minuto 1 con fundido cruzado. El título se encoge lo justo para leerse entero.
- **Títulos limpios**: sin lo que va entre paréntesis y con mayúscula en cada palabra (salvo «a, e, i, o, u, y» sueltas).
- **Pantalla de canto**: la portada del disco de fondo, difuminada; carril por frases; letra centrada que se encoge si una frase no cabe;
  **barra de aproximación** que se acerca a la letra y la toca justo cuando hay que cantar; sílabas que se pintan al cantarlas.
- **Vibrato**: en las notas largas se detecta, se dibuja con ondas y purpurina y da puntos extra (ver [docs/PUNTUACION.md](docs/PUNTUACION.md)).
- **Sonido**: «¡zzzup!» al moverse por cualquier opción, aplausos del público en los resultados y pausa que se desvanece con un «whooom».
- **Mando**: las ayudas muestran los botones del mando de PlayStation (✕ ○ □ △ L1 R1); también funciona el mando de la tele.
- **Aviso al arrancar**: tras el logo de nuvola, ~6 s indicando que es un proyecto gratuito, sin ánimo de lucro y sin relación con los artistas.

## 📱 El micro (PWA)

- El micro **solo funciona con la app instalada** (PWA: «Añadir a pantalla de inicio»), que abre a pantalla completa. En el
  navegador, el QR del subdominio `micro.` solo muestra cómo instalarla (con los pasos de Safari en iPhone) y el código
  de la sala, para entrar desde la app escaneando otra vez o escribiéndolo. Dentro de la app se escanea el QR de la tele.
- Al reabrir la app durante una partida (los móviles a veces la cierran en segundo plano) vuelve a su sala con su color.
- Sin copiar contenido: ni selección de texto ni menú de pulsación larga (salvo en los campos para escribir).
- **El tono se calcula en el propio móvil** (YIN) y solo viajan unos bytes 25 veces por segundo.
- **La pantalla no se apaga** mientras se canta (Screen Wake Lock, con un plan B para móviles sin él): si se apagara, el micro dejaría de oír.
- Se reconecta solo con el mismo color si se corta la wifi o se recarga.
- **Foto del jugador** (opcional): la cámara frontal con un cuadro que muestra exactamente lo que saldrá; aparece en su tarjeta de la sala.
  No se guarda en el servidor: solo vive mientras dura la sala.
- Usa siempre **el micrófono del propio móvil**, aunque haya auriculares conectados (AirPods, Bluetooth, cable).

## 🧱 Cómo está hecho

```
 Móviles /m (web, PWA)  ──WebSocket──►  Servidor de salas (Node.js)  ◄──WebSocket──  Tele / (diseño + puente)
   micro + YIN                           /ws · /api/songs · /api/records                 navegador de la tele
```

- **`diseno/`**: el diseño original de Gramola (prototipo interactivo de la tele, móvil, sistema y recursos). Es la referencia **1:1**.
- **`tools/build-tv.py`** monta la tele a partir del diseño **sin tocar su aspecto**: inserta unos pocos enganches al puente.
  Si llega una versión nueva del diseño, se vuelve a ejecutar y queda conectada.
- **`web/tv/gramola-bridge.js`** (el puente) pone todo lo real: sala y móviles, canciones UltraStar, audio, voz, puntuación,
  récords, ajustes, calibración, música y efectos, Megamix, rejilla de canciones, vibrato, fondos y avisos.
- **`web/m/`**: la web del micro. **`server/`**: Node.js con una sola dependencia (`ws`).

| Dirección | Qué es |
|---|---|
| `/` | Web informativa (qué es, cómo se juega, modos y capturas). |
| subdominio `micro.` | El micro (adonde lleva el QR de la tele); se puede instalar como app. |
| `/app` | La interfaz de la tele, a pantalla completa en el navegador. |

Más detalle en **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**, **[docs/PROTOCOLO.md](docs/PROTOCOLO.md)** y **[docs/PUNTUACION.md](docs/PUNTUACION.md)**.

## 🚀 Ponerlo en marcha

```bash
cd server && npm install && npm start      # http://localhost:8877  (tele en /app)
cd server && npm test                      # pruebas del servidor (salas, permisos, peticiones raras)
python3 tools/build-tv.py                  # solo si cambia el diseño
```

Para jugar con móviles hace falta **HTTPS** (los navegadores solo dejan usar el micro en páginas seguras).
Guía de servidor (Plesk/Apache, systemd, Cloudflare) en **[docs/INSTALACION.md](docs/INSTALACION.md)**.

## 🎵 Canciones

Formato abierto **UltraStar** (`.txt` + audio y portada, sin vídeo), una carpeta por canción en `web/songs/` del servidor.
Las canciones **no están en el repositorio**. Para añadir un lote:

| Paso | Herramienta | Qué hace |
|---|---|---|
| 1 | `tools/preparar-canciones.py` | Normaliza nombres y cabeceras, pasa el `.txt` a UTF-8, saca el audio del vídeo si no hay mp3, convierte a MP3 los audios que no lo son (MP2, WAV con etiqueta…), quita el vídeo y recorta el tramo del **Megamix**. |
| 2 | `tools/normalizar.py` | Iguala el volumen a −12 LUFS (EBU R128) y rehace el tramo del Megamix. |
| 3 | `tools/caratulas.py` | Busca portadas de más calidad en iTunes, para revisarlas antes de aplicarlas (la anterior se conserva). |
| 4 | `tools/subir-canciones.sh` | Sube las carpetas al servidor. |

El tramo del **Megamix** (`tools/megamix.py`) sale del estribillo marcado (`#MEDLEYSTARTBEAT` / `#MEDLEYENDBEAT`) o, si no lo hay,
del bloque de frases repetido más largo. Detalles en **[docs/CANCIONES.md](docs/CANCIONES.md)**.

La música de los menús (`web/audio/menu.mp3`) es original, creada para Gramola. Los aplausos de los resultados (`web/audio/aplausos.mp3`) son
un fragmento de *Sound Effects – Applause after a concert*, grabación de dominio público (CC0) de Wikimedia Commons.

## 🛠️ Administración

Portal propio en el subdominio `admin.`, con entrada **solo por Touch ID** (passkeys): salas y jugadores en directo
(mensajes, echar, cerrar, recargar la tele), canciones (**Novedades**, que en la tele salen primero, carátulas de iTunes y Deezer, Megamix, volumen, cabecera,
ficheros, subir canciones nuevas, retirar), un **editor de canciones** por frases sobre la voz (cada frase sola con su trozo de voz y lo que dice, segundo de inicio y fin a mano, tono guía, prueba con micro, versiones; modo avanzado tipo DAW),
**creación de canciones** a partir del audio (o importando una canción de Spotify) y la letra (con búsqueda automática en LRCLIB y Genius) (separación de voz, alineación y tono en un servicio del propio servidor), récords, actividad, estadísticas por día y estado del servidor.
Detalles en **[docs/ADMIN.md](docs/ADMIN.md)**.

Novedades de cada versión en **[CHANGELOG.md](CHANGELOG.md)**.

---

<div align="center">
<br>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/nuvola-oscuro.png">
  <img src="docs/readme/nuvola-claro.png" width="160" alt="nuvola">
</picture>

© NUVOLACAT
</div>
