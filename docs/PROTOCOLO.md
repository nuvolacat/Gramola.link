# Protocolo WebSocket

Una conexión WebSocket en `/ws` por dispositivo; mensajes JSON con `type`.

## Comunes

| Mensaje | Sentido | Descripción |
|---|---|---|
| `{type:"ping", t}` → `{type:"pong", t}` | cliente ↔ servidor | Latencia: cada cliente estima su media latencia como mediana de 9 RTT / 2. |

## Tele

| Mensaje | Sentido | Descripción |
|---|---|---|
| `{type:"host", code?, token?}` | tele → servidor | Abre sala, o recupera la suya con `code` + `token` (recarga, corte de red). |
| `{type:"room", code, token, recovered, players}` | servidor → tele | Sala lista. `recovered:false` tras una reconexión = sala perdida (se avisa en pantalla). |
| `{type:"players", players:[{id,slot,name,color,online,bot}]}` | servidor → tele | Lista de jugadores (cada cambio). `slot` 1–8 = color J1–J8. |
| `{type:"pitch", p, n, v, lat}` | servidor → tele | Voz del jugador `p`: nota MIDI decimal o `null`, volumen 0–1, media latencia del móvil (ms). |
| `{type:"input", p, key}` | servidor → tele | Botón del móvil: `up/down/left/right/ok/back/y`. |
| `{type:"full-attempt", name}` | servidor → tele | Alguien intentó entrar con la sala llena. |
| `{type:"state", screen, singers, turn?, mode?, song?}` | tele → servidor → móviles | Pantalla actual (`lobby`, `menu`, `songs`, `prepare`, `countdown`, `sing`, `pause`, `results`, `calibrate`…) y quién canta (los móviles muestran el micro solo a quien le toca y solo mandan voz en `sing`/`countdown`/`calibrate`). `mode` y `song:{title,artist}` son para la administración. |
| `{type:"admin", action, text?}` | servidor → tele | Desde la administración: `toast` (aviso en pantalla) o `reload` (recargar la app). |
| `{type:"bot"}` | tele → servidor | «Simular jugador»: ocupa un color libre y canta desde la tele. |
| `{type:"kick", p}` · `{type:"new-code"}` | tele → servidor | Expulsar jugador · cerrar la sala y abrir otra. |
| `{type:"buzz", p, k}` | tele → servidor | Aviso a un cantante: `k` = `"oro"` (nota dorada acertada) o `"frase"` (frase perfecta). El servidor solo lo reenvía al móvil del jugador `p`; cualquier otro `k` se descarta. |
| `{type:"sing", song, duo, delay, singers:[{id, part, tol}]}` | tele → servidor | Empieza una canción: carpeta de la canción, si es modo Dúo, ajuste del micro (ms) y, por cantante, su id, su parte (0/1) y su margen en semitonos. El servidor lee la misma partitura y lleva su propia puntuación con la voz que reenvía ([PUNTUACION.md](PUNTUACION.md)). |
| `{type:"clock", pos, playing, lat}` | tele → servidor | Cada segundo (y al pausar o seguir): segundo de la canción que suena, si está en marcha y media latencia de la tele (ms). |
| `{type:"photo", p, data}` | servidor → tele | Foto del jugador `p` (JPEG 200×200 en `data:`, o vacío para quitarla). Al reconectar la tele se reenvían todas. |

## Móvil

| Mensaje | Sentido | Descripción |
|---|---|---|
| `{type:"peek", code, token?}` → `{type:"peek", code, taken:[{slot,name}], mySlot, full, hostOnline, colors}` | móvil ↔ servidor | Antes de elegir color: qué colores están ocupados. |
| `{type:"join", code, name, slot, token?}` | móvil → servidor | Entrar con el color `slot`. Con `token` se recupera el mismo jugador. |
| `{type:"joined", id, slot, token, name, color, code, hostOnline}` | servidor → móvil | Dentro. |
| `{type:"error", code, msg}` | servidor → móvil | `no-room`, `full`, `color-taken` (con `taken`), `slow` (más de 10 códigos fallidos en un minuto desde la misma dirección). |
| `{type:"replaced"}` | servidor → móvil | El mismo token ha entrado desde otro aparato: este deja de reclamar la plaza (pantalla «sesión abierta en otro móvil»). |
| `{type:"closed"}` | servidor → tele | La sala se ha cerrado desde la administración: la tele olvida el código y pide una sala nueva. |
| `{type:"error", code:"busy", msg}` | servidor → tele | No caben más salas (tope de 500 a la vez); la tele avisa y vuelve a pedir sala al cabo de 30 s. |
| `{type:"pitch", n, v, lat}` · `{type:"input", key}` · `{type:"leave"}` | móvil → servidor | Voz (25/s), mando, salir. |
| `{type:"photo", data}` | móvil → servidor | Foto del jugador (cámara frontal, ≤48 KB). Solo se guarda en memoria mientras dura la sala. |
| `{type:"roster", players}` · `{type:"host", online}` · `{type:"kicked"}` · `{type:"closed"}` | servidor → móvil | Lista de la sala, tele conectada o no, expulsado, sala cerrada. |
| `{type:"buzz", k}` | servidor → móvil | El móvil vibra si el cantante tiene activado «Vibrar al acertar» en sus ajustes. |
| `{type:"admin", action:"toast", text}` | servidor → móvil | Aviso desde la administración (franja arriba unos segundos). |

## Límites

Máximo 8 jugadores; mensajes de 16 KB; códigos consonante-vocal-consonante-vocal (tipo «MOKA», sin palabras feas);
la sala se cierra sola a los 3 min sin tele; ping de WebSocket cada 25 s; como mucho 500 salas abiertas a la vez (hay 6.390 códigos;
con el tope nunca se agotan y el servidor no se puede quedar colgado buscando uno libre). Un jugador sin conexión 10 min
(cerró la app sin «Salir») deja su color libre. Al parar el servidor (despliegue) las salas se guardan en
`data/salas.json` y se restauran al arrancar (si no han pasado 3 min): la tele recupera la suya con `recovered` y los
móviles con su token; solo se pierde la cuenta de la canción en curso, que no da récord.

El WebSocket solo se acepta desde la propia web (`Origin` del mismo dominio, con `micro.`/`admin.`/`www.`, o
`localhost` en pruebas; sin `Origin` también, para clientes que no son navegador): una página ajena no puede usar los
navegadores de sus visitantes para abrir salas. Como mucho 300 sockets a la vez por dirección IP y 300 mensajes por
segundo por socket. Los nombres de jugador se limpian de caracteres de control e invisibles (anchura cero, marcas
bidi) y un nombre como `__proto__` o `constructor` no toca el prototipo de los objetos de récords.

Las rutas se descodifican y normalizan una sola vez antes de mirar permisos: `/%73ongs/…`, `//songs/…` o
`/app/../songs/…` son `/songs/…` y piden el pase de tele igual. Cualquier error no previsto en una petición responde
500 sin tumbar el servidor (una cookie mal codificada o un cuerpo JSON que no sea un objeto dan 400 o se ignoran).

## HTTP

| Ruta | Descripción |
|---|---|
| `GET /api/songs` | Canciones: id, título, artista, año, idioma, género, duración, dificultad 1–3, dúo, rutas. |
| `GET /api/records` | `{songs:{id:{score,name,date,title,artist}}, singers:{nombre:{songs,best,streak}}, plays:{id:n}}`. |
| `POST /api/records` | `{code, token, song, players:[{id,score,streak}]}`. Solo con el token de una sala abierta, `song` una canción de la biblioteca que se haya cantado entera en esa sala (mensajes `sing` y `clock`) y `id` de jugadores de la sala (los bots no cuentan). El nombre, el título y el artista los pone el servidor, y los puntos no pueden pasar de lo que él ha visto acertar (ver [PUNTUACION.md](PUNTUACION.md)). Responde `{isNew, previous, record, players:[{name,score,streak}]}` con lo guardado; una segunda llamada para la misma canción da 409. |
| `GET /api/health` | Estado. |
| `POST /api/telemetry` | Rendimiento de la tele (fps, memoria…), en memoria (últimas 300). Solo con pase de tele; `GET` solo con sesión de admin. |
| `/api/admin/*` | Solo en el subdominio `admin.` y con sesión de Touch ID. Ver [ADMIN.md](ADMIN.md). |
| `/api/worker/*` | Solo en `admin.`, con la clave del trabajador (`Authorization: Bearer`): `next`, `jobs/<id>/input`, `progress`, `result/<fichero>`, `done`. Ver [ADMIN.md](ADMIN.md). |
