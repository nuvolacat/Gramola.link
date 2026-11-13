# Quitar la voz

Pedido: quitar la voz de las canciones **mientras suenan, si se quiere**, «sin romper la música». Después: dejar el
trabajo hecho de antemano en el servidor, una vez por canción.

## Lo que hay, en dos caminos (y el bueno manda)

| | Cómo | Calidad | Coste |
|---|---|---|---|
| **1. Pista pre-procesada** (`sin-voz.mp3` en la carpeta de la canción) | Demucs `htdemucs` separa la voz del resto **una vez** y se guarda la música sin la voz. La tele pone ese fichero al empezar la canción. | Es separación de verdad: la música se queda entera. Es también la voz que usa el editor del admin, así que lo que se oye cantar y lo que se quita son la misma separación. | 10–20 s por canción en la 3090 (medido: 35 canciones en 5 min 33 s). Una vez. Después, cero en la partida, y el fichero se puede adelantar y rebobinar como cualquier mp3. |
| **2. Filtro en vivo** (`web/tv/quita-voces-worklet.js`) | STFT de 1024 (21 ms): cada bin se separa en centro `(L+R)/2` y lado `(L−R)/2` y se baja **solo el centro**, en la banda de la voz (140 Hz–11 kHz), con peso por lo iguales que sean los dos canales, suelo por bin y guardia de mono. | Es un filtro, no una separación: baja lo centrado, y con la voz se va lo que comparta banda y centro (caja, coros, guitarra al centro). Vale para salir del paso en una canción sin pre-procesar. | ~1 % de un núcleo (medido en node), 21 ms de retardo (el reloj de la letra lo descuenta). |

Regla que queda en el puente:

- Ajuste puesto **y** `sin-voz.mp3` existe al empezar la canción → se pone esa pista y **no** se procesa nada.
- Ajuste puesto y no hay pista → filtro en vivo, y se puede encender y apagar a mitad de canción.
- Si suena la pista sin voz, el ajuste no la puede cambiar a mitad: avisa («La voz vuelve en la próxima canción»).

El ajuste es `voz` en los ajustes guardados: 0 = No, 1 = Suave, 2 = Fuerte. Está en **Pausa → Ajustes de audio**
(cuarta fila), que es donde uno lo busca cuando está cantando.

## Lo medido (y lo que no)

`node tools/medir-quita-voces.mjs` ejecuta **el mismo fichero** que sirve la tele (no una copia) con un apaño de
AudioWorklet, y mide con el chart UltraStar de cada canción: la energía de la banda de voz del centro (150 Hz–9 kHz)
**donde el cantante canta** frente a **los huecos instrumentales**. Así se separa «quitar la voz» de «destrozar la
canción».

Pruebas sintéticas (lo que tiene que pasar por construcción):

| Prueba | Resultado |
|---|---|
| Sin filtro, la señal sale idéntica (solo retrasada) | error −147 dB, retardo 1023 muestras (21,3 ms) |
| Tono de 1 kHz centrado, nivel fuerte | −24,4 dB |
| Tono de 500 Hz duro a la izquierda (mismo caso) | −0,0 dB (no se toca) |
| Bajo de 60 Hz centrado | −0,0 dB (la banda lo protege) |
| Nivel suave / fuerte sobre un tono centrado | −10,5 / −24,4 dB, el lado quieto en los dos |
| Fichero **mono** (guardia) | −0,00 dB: no se queda hueco |

Canciones de verdad: **las 35 de la biblioteca**, con su chart, ventana alrededor de la primera frase.

| Mediana de las 35 canciones | donde canta | en los huecos (música sola) |
|---|---|---|
| Filtro en vivo, fuerte | −7,2 dB | **−5,0 dB** (rango −10,3 … +19,3) |
| `sin-voz.mp3` (Demucs) | −6,9 dB | **−0,8 dB** (rango −20,3 … +4,0) |

Cómo se lee. Las dos bajan la banda de voz donde canta casi lo mismo: la banda es del centro y ahí también hay caja y
coros, así que el número no separa voz de acompañamiento. La diferencia está en los huecos, donde no canta nadie: el
filtro en vivo se lleva **−5 dB de música** de mediana, y hasta −10 dB en algunas canciones. Eso es lo que se oye como
hueco. La pista pre-procesada deja la música en **−0,8 dB**: prácticamente intacta.

Los casos raros, dichos: con `sin-voz.mp3` hay cuatro o cinco canciones con más de 3 dB en los huecos (Hakuna Matata
−20,3 dB, En la jungla −7,8, Voy a ser El Rey León −7,5, Wannabe −5,6). O el chart va desplazado y esos «huecos» no son
huecos, o en esos trozos hay coros que sí se han quitado. Sin escucharlos no se puede saber cuál de las dos cosas es,
y por eso no se afirma.

Para escuchar la diferencia, misma canción y mismo trozo (`Lady GaGa – Bad Romance`, desde 9,7 s, 10 s):

| Fichero | Qué es |
|---|---|
| `C:\Users\lai\Documents\workspace\_oyes\bad-romance-0.mp3` | original |
| `C:\Users\lai\Documents\workspace\_oyes\bad-romance-1.mp3` | filtro en vivo, suave |
| `C:\Users\lai\Documents\workspace\_oyes\bad-romance-2.mp3` | filtro en vivo, fuerte |
| `C:\Users\lai\Documents\workspace\_oyes\bad-romance-sinvoz.mp3` | pista pre-procesada |

Lo que **no** está medido:

- No hay oído en estas pruebas: el número dice cuánta energía sale de la banda; si suena bien hay que escucharlo.
- El coste medido es de este PC en node (~1 % de un núcleo), no de la tele.
- El filtro en vivo solo cubre la canción normal y la vista previa del editor. El **Megamix** no lo lleva.

## El pre-procesador

```bash
# ¿qué falta?
python tools/quitar-voz.py --carpeta web/songs --listar
# todas las que falten (se puede cortar y volver a lanzar: las hechas se saltan)
python tools/quitar-voz.py --carpeta web/songs
# una sola, o rehacer una que ya estaba
python tools/quitar-voz.py --carpeta web/songs --cancion "Queen - We Will Rock You" --forzar
```

Deja en cada carpeta `sin-voz.mp3` (192 kbps estéreo) y `sin-voz.json` con el modelo, el dispositivo y el fichero de
origen (tamaño y fecha): si el mp3 cambia, la próxima pasada lo rehace.

Necesita `torch`, `torchaudio`, `demucs` y `ffmpeg`. En esta máquina están en el entorno
`C:\Users\lai\Documents\workspace\.venvs\gramola-voz` (torch 2.14 con CUDA, demucs 4.1, Python 3.13). En el servidor
Ubuntu, el mismo entorno que el trabajador (ver `tools/trabajador/LEEME.md`); `device()` ahora también usa CUDA si la
hay.

El trabajador (`tools/trabajador/crear.py`) deja el `sin-voz.mp3` **en la misma pasada** en la que separa la voz para
el editor: no cuesta una segunda separación, y `server/admin.js` y `tools/trabajador/trabajador.py` lo suben con el
resto de los resultados.

## Ficheros

- `web/tv/quita-voces-worklet.js` — el filtro (AudioWorklet, sin dependencias).
- `web/tv/gramola-bridge.js` — carga el filtro, lo mete en el grafo de la canción, elige la pista sin voz y suma su
  retardo al reloj de la letra.
- `tools/build-tv.py` — la fila «Quitar voces» del menú de audio de la pausa (el diseño no se toca).
- `server/server.js` — `sinVoz` en la lista de canciones cuando el fichero está.
- `server/admin.js` — `sin-voz.mp3` admitido entre los ficheros que sube el trabajador.
- `tools/quitar-voz.py` — el pre-procesador.
- `tools/medir-quita-voces.mjs` — el banco de pruebas (mide el fichero real del filtro y las pistas sin voz).
- `tools/verificar-sin-voz.cjs` — comprueba el servidor que está corriendo: abre una sala de verdad, pide la lista de
  canciones como la tele y mira que `sinVoz` llega, que el mp3 se sirve con rangos (para rebobinar) y que el filtro se
  descarga con su tipo. `NODE_PATH=server/node_modules node tools/verificar-sin-voz.cjs`.
