# Changelog

Versiones con el esquema `1.AA.MMDD.HHMM` (fecha y hora del despliegue).

## 1.26.1113.1750
- **Quitar voces al cantar.** Ajuste nuevo en *Ajustes → Voz de la canción*: **Quitada · En vivo · Entera**.
  **Quitada** (por defecto) pone la pista preparada y, si la canción no la tiene, quita la voz al momento;
  **En vivo** usa siempre el original con el filtro, y el nivel del filtro se ajusta en *Pausa → Ajustes de audio*
  (cuarta fila: **No · Suave · Fuerte**); **Entera** deja la voz original. Se puede cambiar durante la canción.
  Dos caminos, y el bueno manda:
  - Si la canción tiene **`sin-voz.mp3`** (la deja el pre-procesador, `tools/quitar-voz.py`, con Demucs), al empezar se pone esa pista y no se procesa nada: es separación de voz de verdad, se puede rebobinar como cualquier mp3 y no cuesta ni un cálculo. Se mide en **−0,3 dB** en los huecos instrumentales (la música se queda entera) y baja la voz donde canta.
  - Si no la tiene, un **filtro de centro en vivo** (AudioWorklet, ventana de 21 ms) baja lo que va centrado entre 140 Hz y 11 kHz, con suelo por bin y guardia para ficheros mono. Sirve, pero con la voz se lleva lo que comparta banda y centro: medido en −7,2 dB donde canta y −5,0 dB de mediana en los huecos, o sea que también toca la música. Por eso el pre-procesador.
  - El retardo del filtro entra en la cuenta del reloj de la letra y de la puntuación.
- El trabajador deja también la música sin voz (`sin-voz.mp3`) en la misma pasada en la que separa la voz para el editor, y usa la GPU si la hay.
- `tools/quitar-voz.py` procesa la biblioteca entera (se puede cortar y volver a lanzar; lo hecho se salta). Aquí: 20 s por canción en la 3090.
- Lo medido, lo que no está medido y cómo probarlo: `docs/QUITAR-VOCES.md`; banco de pruebas: `node tools/medir-quita-voces.mjs`.

## 1.26.1103.1347
- Editor: el trozo de voz de una frase (cuando no empieza en un silencio) se afina con la curva de tono: empieza en el primer instante en que la voz tiene tono y acaba en el último. El reconocimiento adelanta cada palabra al hueco anterior (en «Dance The Night» unos 0,4 s) y marcaba en ámbar frases que estaban bien.

## 1.26.1103.1339
- **Editor por frases sobre la voz** (modo sencillo): al elegir una frase solo se ve ella con su trozo de voz (banda «VOZ» con las palabras que dice, reconocidas por el trabajador) y se escribe en qué **segundo empieza y acaba** (Enter aplica; ↑ ↓ ±0,05 s). Al mover el inicio la frase se desplaza; al mover el fin sus sílabas se estiran o encogen; con «lo que viene detrás se mueve igual» (por defecto) todas las frases posteriores se desplazan lo mismo. «◉ Usar la voz» la pone donde la voz. Lista de frases con un punto verde (empieza donde la voz), ámbar (la voz empieza en otro sitio) o hueco (sin voz cerca). «▶ Escuchar» reproduce la frase con su trozo de voz.
- **Trabajador**: con la voz separada parte la canción en tramos por los silencios y reconoce qué dice cada uno palabra a palabra (faster-whisper «small», ~50 s por canción) → `voz-tramos.json`. Al crear o volver a encajar, cada línea de la letra se busca solo en la zona donde la voz la dice (palabras reconocidas emparejadas con la letra en orden, coincidencias largas primero: cada estribillo repetido va al suyo; la letra sincronizada queda de reserva), y la primera sílaba de cada frase se lleva a donde arranca la voz de su tramo. En «José José - Volcán» (prueba contra la versión corregida a mano): la primera frase, que salía 4 s tarde, ya sale en su sitio; mediana de 26 ms de desvío por línea.
- «Analizar la voz» guarda también los tramos y lo reconocido (idioma de la cabecera); las canciones analizadas antes solo tienen la voz y el tono: el editor calcula los tramos en el navegador y «Volver a analizar la voz» añade el reconocimiento.
- El idioma de la letra se detecta por sus palabras (en el admin, al crear, y en el trabajador, que avisa si no es el pedido); frases largas partidas donde el cantante respira; notas largas que no se comen las pausas en mezclas densas.
- Servidor mann: swap de 4 GB y lanzador con tope de memoria para el banco de pruebas del trabajador (el 03-nov dos procesos de torch a la vez dejaron la máquina sin memoria).

## 1.26.1103.1259
- Una sala cuya tele lleva 3 minutos desconectada se cierra sola (antes 15 minutos): los móviles reciben el aviso de sala cerrada y la tele, si vuelve después, abre una sala nueva.

## 1.26.1103.1257
- Canciones: dos botones ‹ › en el extremo derecho de la fila de filtros, a su misma altura, para pasar una pantalla de fichas adelante o atrás con el ratón (o el puntero de la tele), con un desplazamiento largo y suave (720 ms); el salto ficha a ficha con el mando sigue igual.

## 1.26.1103.1253
- Rejilla de canciones: con el ratón, pinchar una ficha la elige sin mover la lista; solo el mando y el teclado la desplazan.

## 1.26.1103.1252
- Rejilla de canciones: se deja como estaba antes de los cambios del desplazamiento (transición de 260 ms, repetición de teclas y cruceta de siempre, y las fichas se eligen con clic, no al pasar el ratón). Las fichas del menú sí se siguen eligiendo al pasar por encima.

## 1.26.1103.1249
- Lista de canciones más tranquila: al mantener pulsada una flecha o la cruceta avanza una ficha cada 200 ms (antes el teclado repetía unas 30 veces por segundo y la cruceta cada 110 ms) y el desplazamiento dura 520 ms.

## 1.26.1103.1240
- La rejilla de canciones se desplaza más suave (420 ms con una curva más tendida, antes 260 ms).

## 1.26.1103.1239
- Créditos: «Volver» responde al clic y la rueda del ratón desplaza el texto.

## 1.26.1103.1233
- El clic en «Créditos» del pie de la bienvenida no abría el panel: el mismo clic subía a la pantalla y lo cerraba como si fuera «OK».
- Rejilla de canciones con ratón: al elegir una ficha pasando por encima, la rejilla ya no se desplaza mientras la ficha se vea entera (antes se movía, la ficha de debajo del puntero cambiaba y se elegía otra, y así sin parar). Con el mando sigue desplazándose como siempre.

## 1.26.1103.1201
- Con ratón, las fichas del menú y de la rejilla de canciones se eligen al pasar por encima (clic = entrar).
- Canciones: al cambiar un filtro (década, idioma, género) o buscar, el avance que suena pasa a ser el de la canción que enseña la ficha (antes seguía sonando la de antes).

## 1.26.1103.1155
- Sobre los elementos clicables ya no sale la mano: todo hereda el puntero propio (y nada cuando está escondido).

## 1.26.1103.1154
- El puntero no aparece durante el arranque (logo, aviso y carga); solo a partir de la bienvenida.

## 1.26.1103.1153
- Puntero propio en escritorio: la flecha plana en rojo con contorno de tinta, grande (72 px); se esconde a los 2,5 s quieto.

## 1.26.1103.1150
- En escritorio, el puntero del ratón aparece al moverlo y se esconde a los 2,5 s quieto (antes estaba siempre oculto, pensado solo para la tele).

## 1.26.1103.1147
- **Ayudas de botones según haya mando o no**: con un mando conectado (PlayStation o Xbox, detectado al pulsar un botón) se muestran sus símbolos (✕ ○ □ △ o A B X Y); sin mando, los del mando a distancia de la tele: OK, ← y los botones de colores (rojo, verde, amarillo, azul) como puntos de color. Al desconectar el mando vuelven las ayudas de la tele. Antes se mostraban siempre los de PlayStation.

## 1.26.1103.1142
- Bienvenida: el acceso a Créditos sale discreto a la derecha del pie, la versión va pequeña y centrada (sin la palabra «Versión») y el «Pulsa ✕ para continuar» queda solo.

## 1.26.1103.1135
- **Créditos** (Ajustes → Créditos, y △ en la bienvenida): qué es Gramola (software libre con licencia MIT, sin ánimo de lucro, sin pagos ni publicidad, hecho con respeto a los artistas; retirada de contenidos en soporte@gramola.link), y todo lo que usa con su autor y su licencia: tipografía, librerías de la tele y el móvil, servidor, herramientas de creación de canciones, servicios consultados e infraestructura. Música del menú creada con SUNO.AI; diseño original de NUVOLACAT.

## 1.26.1103.1109
- Pendientes menores del repaso: el selector del Megamix se esconde mientras hay un aviso (antes lo tapaba); `tools/version.py` pone la versión en todos los sitios de una vez, incluidos el `?v=` del móvil y el nombre de la caché de su service worker (así el móvil siempre baja el código nuevo tras un despliegue), y `deploy.sh` no despliega si no coinciden; el admin puede «Recargar móviles» de una sala (tras un despliegue del micro); la pantalla de resultados ya no calcula el carrusel de portadas que no se usa; las portadas de la bienvenida se guardan reducidas (90 imágenes grandes quedaban en memoria para siempre).

## 1.26.1103.1102
- **Repaso total** (tres revisiones independientes más pruebas de reconexión con la tele real):
  - **Tele**: salir de la cuenta atrás (o del fundido hacia el canto) antes de que llegara dejaba la cuenta viva y la canción arrancaba sola en otra pantalla, o el audio seguía sonando en el menú; el resultado de «¡Récord!» y los puntos de la pantalla final ahora se corrigen con la respuesta del servidor (si recorta puntos avisa, si no se ha podido guardar lo dice y no hay confeti); la calibración «Retraso del micro» se había quedado sin voz tras limitar el envío de voz del móvil (ahora en la calibración cantan todos); al cerrar una sala desde el admin la tele se quedaba con un código muerto (ahora pide otra y avisa); el aviso de «sala perdida» dice la verdad (sala vieja, sala nueva, los móviles tienen que volver a escanear) y la sala se recuerda 14 min en el aparato por si la app de la tele se reinicia; «Nuevo código» recarga las direcciones de audio con el pase nuevo; en Pásalo y Preparar, si alguien se va, cada jugador conserva su equipo y sus ajustes (antes se corrían de fila) y las rondas se ajustan a los equipos; Récords «Por canción» muestra las 8 con récord (antes la biblioteca entera y se salía de pantalla); «Canción no disponible» en Pásalo o Jukebox ya no manda a Canciones con el modo equivocado; ajustes guardados fuera de rango no dejan la pantalla en blanco; con el selector de Megamix abierto, los avisos se pueden cerrar; en pausa se mandaba un reloj por fotograma.
  - **Servidor**: la latencia de la tele se descontaba dos veces en la puntuación del servidor (récords recortados en teles con mucha latencia); la partitura del servidor no respetaba `#START`/`#END`; quien canta y falla cuenta con 0 (antes desaparecía); los jugadores que cierran la app sin «Salir» ya no ocupan su color para siempre (10 min); adivinar códigos de sala tiene freno (10 fallos por minuto y dirección); el mismo token desde dos móviles ya no los cierra por turnos sin fin (el desplazado se entera); el aviso de «sala llena» a la tele, uno cada 10 s; un móvil que entra con la tele caída no ve el micro abierto; las salas se guardan al parar y se restauran al arrancar (un despliegue ya no echa a nadie); los ficheros de datos corruptos se apartan con fecha en vez de pisarse (antes un `admin.json` roto borraba las llaves de Touch ID en silencio); sin carpeta de datos escribible no arranca; el récord se marca guardado solo cuando se ha escrito (disco lleno = reintento posible); el `.txt` y los audios que lee la tele se escriben a un temporal y se renombran (nunca a medias); los trabajos de creación terminados se borran a los 30 días si la canción ya no está en preparación, y el original no MP3 se borra tras convertir; un trabajador que se reinicia devuelve su trabajo a la cola al momento; las versiones del editor siguen a la canción al renombrarla; el admin puede borrar ficheros que empiezan por punto; la copia del admin incluye las llaves y las novedades; la búsqueda de letra en segundo plano ya no pisa un borrador que el admin haya editado o continuado; la carpeta de la canción con caracteres invisibles vuelve a coincidir; la redirección de carpetas codifica bien los nombres raros.
  - **Despliegue y copias**: `deploy.sh` comprueba la sintaxis, espera a que nadie esté cantando, instala en una copia y solo entonces cambia (un fallo de npm ya no deja el servicio caído) y solo cambia permisos de lo que toca; copia diaria de `data/` y `web/songs` en el servidor.
  - **Móvil**: pantalla propia cuando la misma sesión se abre en otro móvil; mensaje de «demasiados intentos».
  - **Editor**: si el Megamix automático estaba ocupado al guardar, se vuelve a pedir en unos segundos (antes quedaba con los tiempos viejos sin aviso).
  - Los retoques de hoy a la página de la tele son enganches de `tools/build-tv.py`: regenerarla desde el diseño los conserva.

## 1.26.1103.1023
- **Seguridad** (auditoría forense): el WebSocket solo se acepta desde la propia web (una página ajena no puede usar los navegadores de sus visitantes para abrir salas) y hay tope de 300 sockets por IP; cabeceras `Referrer-Policy` y `Permissions-Policy` (micro y cámara solo para la propia web) en todo lo que sirve Node; la foto de jugador que ve el admin va con `nosniff` y CSP; los nombres de jugador se limpian de caracteres invisibles y bidi, y un cantante llamado `constructor` o `__proto__` ya no corrompe los récords; la descarga de portadas no sigue redirecciones.
- En Cloudflare: TLS mínimo 1.2, HTTPS forzado, HSTS (6 meses, con subdominios) y un tope de 120 peticiones a `/api/` cada 10 s por IP. En el servidor: fail2ban vigilando el SSH (había 14.000 intentos de contraseña de root al día sin nada que los frenara).
- Después, en el servidor: SSH solo con clave (la contraseña ya no entra), `admin.` registrado como alias de dominio en Plesk y certificado reemitido para que cubra `admin.`, `micro.` y `www.` → Cloudflare en SSL «strict» (antes «full»); el traductor de otra app que escuchaba en el puerto 2737 ya solo acepta conexiones locales; del entorno del trabajador se quitaron `transformers` y `tokenizers` (solo los usaba un experimento y tenían avisos de seguridad).

## 1.26.1103.1010
- **Los récords los comprueba el servidor** (`server/puntuacion.js`): la tele sigue puntuando y dibujando en directo, pero el servidor lleva su propia cuenta con la misma regla y la misma partitura (lector compartido `web/js/ultrastar.js`) usando la voz que reenvía a la tele. La tele le dice qué canción empieza (`sing`: cantantes, parte, margen, ajuste del micro) y cada segundo por dónde va (`clock`). Al guardar: solo jugadores de la sala (con el nombre con el que entraron, nunca el que diga la tele), sin bots ni quien no ha cantado, puntos recortados a **lo visto × 1,25 + 200** y racha a **la vista + 3**, canción cantada entera y una sola vez. Antes cualquiera con una sala podía inventarse un récord con una petición.
- **Tele**: el Megamix acababa al instante si la canción anterior había llegado al final; el QR se regeneraba 60 veces por segundo fuera de la sala (también cantando); «Pásalo» se quedaba en blanco si un equipo se quedaba sin jugadores; un fallo del audio en la cuenta atrás dejaba la partida clavada en 0:00; «Nuevo código de sala» avisaba de «sala perdida» y recargaba la biblioteca; dos pantallas con la misma sala se la robaban sin parar (`replaced`); si falla el pase de tele al arrancar se reintenta (antes, «Cargando… 95 %» para siempre) y en el arranque también se avisa de «Sin conexión»; con notas pegadas la primera ranura de cada una era imposible de acertar (el 100 % no existía); en pausa los móviles seguían con el micro abierto; `#START` ya no dispara una ráfaga de «Fallo» y `#END` se respeta; un jugador que sale en «Preparar partida» ya no deja un cantante fantasma; la propina de vibrato no pasa de 10.000; un móvil ya no puede llenar la sala de simulados ni echar jugadores; «Sala llena» durante el canto es un aviso, no una pantalla; la lista de canciones del diseño se calcula solo cuando cambia algo (antes en cada fotograma de resultados).
- **Móvil**: una nota larga a volumen constante dejaba de detectarse a los 7 s (el suelo de ruido se la comía); el AudioContext se crea antes de pedir el micro (iPhone con el aviso de permiso lento se quedaba sin vúmetro); si el sistema corta el micro (llamada, otra app) se vuelve a pedir; sin pong en 7 s se reconecta (socket zombi al volver del fondo en Android); la voz solo se manda cuando toca cantar (antes 25 mensajes/s desde que entrabas); la tele caída a mitad de canción manda a la espera y al volver recupera el canto; sin sala no se queda el micro abierto; el lector de QR que no carga avisa en vez de quedarse con la cámara encendida; el saludo no se manda dos veces al reconectar (daba «color ocupado» del propio color); la caché de la PWA guardaba rutas que la página no pide y, sin red que responda, la app tardaba hasta un minuto en abrir (ahora 4 s y a lo guardado).
- **Panel admin**: abrir el editor y cambiar de apartado antes de que cargara pisaba la vista nueva; la subida de audio se quedaba colgada si el proxy devolvía un error en HTML; deshacer un cambio de BPM no devolvía la rejilla; «Publicar» desde la ficha no la refrescaba; «Publicar» y «Volver a encajar» seguían aunque el guardado fallara; al volver a entrar tras caducar la sesión se duplicaban los sondeos y los avisos; dobles clics en Igualar volumen, Megamix, Restaurar, Enviar aviso y Publicar; un clic en una nota o un corte sin moverlos ya no cuenta como cambio ni borra «rehacer»; Escape al editar una sílaba no la aplica; GAP con texto no la pone a 0; «Desplazar» por debajo de un tiempo avisa; las notas guardadas nunca se solapan ni tienen tiempos negativos (también tras cambiar el BPM o «Dejar sin cantar»); sílabas separadas por tabulador no se pierden; un hash raro o una canción inexistente no dejan la vista en blanco (botón «Volver»).
- **Creación**: un trabajo que tumbe al trabajador dos veces pasa a error (antes se repetía cada 20 min para siempre); borrar un trabajo en curso lo cancela de verdad; la letra se lee antes de marcarlo «procesando»; igualar volumen y Megamix ya no corren dos veces a la vez sobre la misma canción; `megamix.mp3`, `megamix.json` y el `.txt` de carátulas se escriben a un temporal y se renombran (nunca un fichero a medias); el temporal de normalizar no se queda en la carpeta si ffmpeg falla; los `#MP3`/`#AUDIO` con rutas se rechazan; `deploy.sh` reinicia también el trabajador (importa `crear.py` al arrancar); mensajes de error con causa (ffmpeg, letra sin encajar).
- **Servidor**: el manejador de WebSocket va en try/catch y hay tope de 300 mensajes/s por conexión; un fichero que desaparece mientras se sirve o una petición cortada a medias ya no dejan nada colgado; errores sin capturar se registran sin tumbar el proceso (y si el puerto está ocupado sí sale, para que systemd reintente).
- Pruebas: `npm test` añade la partida verificada en el servidor (voz real de dos móviles falsos, uno recortado); en el navegador se probaron la tele real cantando de principio a fin, el panel entero (admin + tele + móvil) y el editor.

## 1.26.1103.0941
- **Servidor más robusto** (revisión de seguridad; parte de los fallos los señaló un fork de la comunidad):
  - Una cookie mal codificada (`gtv=%`) o un cuerpo JSON que no fuera un objeto (`null`) tumbaban el proceso entero y se caían todas las salas hasta que systemd lo levantaba. Ahora dan 400 o se ignoran, y cualquier error no previsto en una petición responde 500 sin parar el servidor.
  - La ruta se descodifica y normaliza una sola vez antes de mirar permisos: `/%73ongs/…`, `//songs/…` o `/app/../songs/…` ya no se saltan el pase de tele (en producción Cloudflare y Apache ya lo paraban; ahora también lo para Node).
  - Tope de 500 salas abiertas a la vez: al agotarse los 6.390 códigos el servidor se quedaba colgado para siempre buscando uno libre. Si se llega al tope, la tele recibe `error busy`, avisa y vuelve a pedir sala a los 30 s.
  - Récords: solo canciones que existen en la biblioteca y solo jugadores bien formados (un `players:[null]` también tumbaba el servidor).
  - Telemetría de la tele: solo la manda una tele con sala y solo la ve el admin (antes era pública).
  - Al cerrar una sala con «Nuevo código», los cierres de los móviles ya no mandan listas de jugadores de la sala vieja a la tele.
  - Admin: el .txt del editor con JSON mal formado responde 400 (no 500); rangos de audio fuera de fichero en Creación responden 416.
  - Creación desde Spotify: la letra se busca en segundo plano al instalar el borrador, así el trabajador no da por fallida una descarga buena porque LRCLIB, Genius o songlyrics tarden.
- **Pruebas del servidor** (`cd server && npm test`): peticiones raras, pase de tele con rutas codificadas, telemetría, partida completa (sala, jugador, canciones, récord), tope de salas y «Nuevo código».

## 1.26.1102.1646
- **Editor · frases**: con palabras elegidas, «✂ Separar en otra frase», «⤒ Pasar a la frase anterior» y «⤓ Pasar a la frase siguiente»; «Unir con la siguiente» junta dos frases.
- **Editor · trozo sin cantar**: se marca arrastrando (botón «⌇ Marcar trozo sin cantar» o sobre la forma de onda), se puede escuchar y «Dejar sin cantar» aparta las sílabas que caían dentro (antes o después del trozo) y deja un corte de frase en el hueco.
- Versiones del editor con etiqueta («UltraSinger», «antes de volver a encajar»).

## 1.26.1102.1303
- **Editor en modo sencillo** (por defecto): lista de frases; al elegir una, se ve solo ese fragmento con cada sílaba como un bloque con su texto; palabras de la frase como botones; escuchar la frase (en bucle si se quiere), moverla, alargarla o acortarla; alargar, acortar, subir o bajar cada sílaba; **palabras doradas** con un clic. El modo avanzado (línea de tiempo completa) sigue disponible.
- **Notas largas**: el encaje alarga cada sílaba mientras suena la voz (energía de la voz separada + tono, sin cortar en respiraciones), recoloca sílabas que el alineador estiraba sobre los solos y solo parte una nota larga si la melodía cambia de verdad: el **vibrato** ya no la trocea y los saltos de octava del detector se corrigen. En «Volcán»: notas sobre la voz real del 77 % al 90 %, notas donde no se canta del 19 % al 2 %, sin notas de 25 s, y 106 notas largas enteras (antes 80).
- **Volver a encajar** las canciones en preparación con el método actual (lo editado queda en Versiones).
- Arreglado: al cerrar «Ver en el juego» seguía sonando de fondo; y el botón «Ver en el juego» compartía identificador con el selector de versiones.

## 1.26.1102.1242
- Móvil: el micro **solo funciona con la app instalada** (PWA). En el navegador solo se ve cómo instalarla (sin «Seguir sin instalar») y, si se llega por el QR, el código de la sala para entrar desde la app. Fuera el atajo de pruebas `?pwa=1`.
- Al reabrir la app durante una partida, vuelve a su sala con su color; si la sala ya no existe, va a escanear el QR sin avisos de error.

## 1.26.1102.1238
- Móvil: sin copiar contenido. Ni selección de texto, ni menú de pulsación larga (copiar, guardar imagen) ni arrastrar imágenes; los campos de nombre y código se siguen pudiendo escribir y seleccionar.

## 1.26.1102.1237
- Móvil: botón «← Volver» al poner el nombre (vuelve a escanear el QR, para cambiar de sala), al elegir color (vuelve al nombre) y en la foto (vuelve a los colores). El gesto de volver del móvil hace lo mismo en vez de cerrar la app.

## 1.26.1102.1233
- **Creación = taller completo**: sección «En preparación» (creadas sin publicar) con Editar, Ver en el juego, Publicar y Descartar; el editor de una canción en preparación vive dentro de Creación.
- **Ver en el juego** desde el editor: la app de la tele en una ventana con lo que hay en el editor (aunque no esté guardado), desde el principio o desde el cursor, con pausa.
- **Tiempos** en el editor: desplazar todo desde el cursor, estirar o encoger una selección y cambiar el BPM sin mover nada.
- **Publicar** pregunta si ya hay otra canción igual: sustituirla (la nueva ocupa su sitio y su historial; la antigua va a Retiradas) o publicar las dos. También desde el editor.
- El botón de los formularios pasa a «Editar»: va al editor, que muestra el avance mientras se encaja la letra y se abre solo con la canción al terminar (no publica nada).
- La letra sincronizada (LRCLIB) guía el encaje: se mide el desfase con el audio y, si casa, cada línea se busca en su zona.
- Arreglado: el tono con CREPE fallaba con algunas duraciones (se pasaba a pYIN).

## 1.26.1102.1202
- **Letras automáticas**: al importar de Spotify la letra se busca sola, y en «Crear canción» hay un botón «Buscar la letra». Fuentes: LRCLIB (a menudo sincronizada por líneas) y, de reserva, Genius y songlyrics (como SimonIT/spotifylyrics). Se deja una frase por línea, sin marcas ni cabeceras.

## 1.26.1102.1157
- **Importar desde Spotify** en «Crear canción»: se pega el enlace de una canción (solo canciones sueltas) y se descarga en el servidor con el motor del antiguo Gramola (MP3 320 kbps con carátula y datos). Queda en **Borradores** (apartado Creación) para seguir cuando se quiera: escucharla, completar datos y letra, guardar a medias o mandarla a crear.
- Las canciones creadas pendientes de revisar se llaman ahora «Sin publicar».

## 1.26.1102.1150
- **Editor de canciones** en el admin (tipo DAW): notas a la altura de su tono, frases, forma de onda (también de la voz sola) y curva de la voz real; mover, alargar, partir, unir, cambiar sílabas, notas doradas/libres/rap, cortes de frase, GAP; deshacer y rehacer; reproducción lenta, tono guía, repetir frase, vista de karaoke y prueba con el micro con % por frase; versiones de cada guardado.
- **Creación de canciones** a partir del audio y la letra: cola en el admin que atiende un trabajador en el propio servidor (servicio con prioridad mínima y límites; separación de voz con Demucs, alineación forzada MMS, tono con CREPE, sílabas con pyphen; ~5 min por canción). Quedan como **borrador** (no salen en la tele) con portada, volumen y Megamix; se revisan en el editor y se publican (entrando en Novedades).
- **Analizar la voz** de cualquier canción para verla en el editor.
- Arreglado: «Detectar solo» (Megamix) e «Igualar el volumen» del admin fallaban al llamar a las herramientas.
- El servidor vuelve a leer las Novedades si el fichero cambia por fuera.

## 1.26.1102.1107
- **Novedades**: en el admin se seleccionan canciones con casillas y se marcan como Novedades (o desde la ficha); botón «★ Novedades» junto a «Retiradas». En la tele salen las primeras de la lista, en su grupo «★» y con la etiqueta NUEVA.
- Admin: columna de idioma en corto (ES, EN, CA…) y «Añadida» con fecha y hora.

## 1.26.1102.1101
- Admin: paginación en la lista de canciones (25, 50, 100 o todas; recuerda la página al volver de una ficha).
- Admin: sin avisos de error falsos al cambiar de apartado mientras el anterior aún carga.

## 1.26.1102.1059
- **Administración** en el subdominio `admin.`, con entrada solo por Touch ID (passkeys): salas y jugadores en directo (mensaje, echar, cerrar, recargar la tele, aviso a todas), canciones (búsqueda, filtros, ficha con audio, carátulas de iTunes y Deezer, imagen propia, Megamix automático o a mano, medir e igualar el volumen, cabecera del .txt, ficheros, canción nueva, renombrar, retirar y restaurar), récords (renombrar, fusionar, borrar, vaciar con copia), actividad, estadísticas por día, telemetría, estado del servidor, copia de los datos y reinicio.
- La tele muestra los avisos de la administración y obedece la orden de recargar; los móviles muestran los avisos en una franja.
- La tele informa al servidor del modo y la canción que suena.

## 1.26.1102.1031
- Mando en la tele: en LG la cruceta del mando llegaba dos veces (como tecla y por el mando) y se avanzaba el doble; ahora se cuenta una sola vez.

## 1.26.1102.0417
- Móvil: si se gira en horizontal mientras se canta, el micro se sigue dibujando como en vertical (la pantalla se contrarrota según hacia dónde se gire). En iPhone la web no puede bloquear el giro; así no se nota.

## 1.26.1102.0414
- Móvil: el logo de nuvola del pie, centrado.
- Capturas del móvil actualizadas.

## 1.26.1102.0412
- Capturas con los jugadores Marta, Oriol, Ana y Jordi.
- Imagen para compartir enlaces nueva: «La nueva estrella del karaoke».

## 1.26.1102.0408
- Sala: la tarjeta de un jugador sin foto ya no muestra un puntito de color.
- Capturas nuevas del README y de la web con el diseño actual (micro del móvil al derecho).

## 1.26.1102.0348
- Sincronía: la letra y las cajas descuentan el retraso de salida del audio de la tele (iban unas milésimas por delante de la música).

## 1.26.1102.0345
- Pausa: suena el «whooom» de las transiciones mientras la canción se desvanece.
- Pausa: fuera el eco; la canción se desvanece suavemente (~0,6 s) y al seguir vuelve con un fundido, desde el punto exacto donde se pausó.

## 1.26.1102.0343
- Pausa: la canción ya no se corta en seco; se apaga en un eco (~1,5 s) y al seguir vuelve con un fundido. En el Megamix, fundido rápido con el «whooom».

## 1.26.1102.0337
- Bienvenida: sin eslogan, y resplandor blanco bajo el logo de gramola.

## 1.26.1102.0333
- Bienvenida: cinco filas de portadas (dos más pequeñas en los huecos), desenfoque suave sin pixelado, también se enfocan portadas de la fila del medio, y resplandor blanco bajo el logo de nuvola y la versión.

## 1.26.1102.0328
- Bienvenida: tres filas de portadas difuminadas desplazándose de derecha a izquierda; cada pocos segundos una se enfoca y se queda nítida ~4 s (sin repetir portadas).

## 1.26.1102.0316
- Títulos: la «y» suelta también en minúscula.

## 1.26.1102.0316
- Títulos limpios en la tele: sin lo que va entre paréntesis o corchetes y con mayúscula inicial en cada palabra (salvo las vocales sueltas a, e, i, o, u).

## 1.26.1102.0314
- Letra: fuera el símbolo «~» (marca interna de UltraStar para alargar una sílaba).

## 1.26.1102.0310
- Canto: fuera «Interludio musical»; en las pausas largas se ve ya la frase que viene y la barra de aproximación entra en sus últimos 3 s (el Megamix sigue anunciando la canción siguiente).

## 1.26.1102.0304
- Canto: la portada del disco de fondo, difuminada y tenue, con el carril blanco algo transparente.
- 3 canciones nuevas de José José (219 en total).

## 1.26.1102.0259
- Vibrato: dos ondas suaves y entrelazadas con brillo del color del cantante y purpurina dorada y blanca que titila.
- «¡Zzzup!» con más volumen.

## 1.26.1102.0255
- Vibrato: en las notas largas se detecta y se dibuja una onda del color del cantante; si la nota se canta bien, suma la mitad de su valor y sale «Vibrato +N».
- Efecto «¡zzzup!» al moverse entre opciones en todas las pantallas (también en el menú de pausa durante el canto).
- Fuera el 3-2-1 sobre el carril antes de cantar (ya lo marca la barra de aproximación).

## 1.26.1102.0244
- Resultados: aplausos del público (6 s, grabación real de dominio público) además de la música de fondo.

## 1.26.1102.0240
- Web: en «Modos de juego» quedan los seis modos (fuera Ajustes), sin huecos en el móvil.

## 1.26.1102.0233
- Lista de canciones: fuera el parpadeo rojo de otras portadas al moverse (la ficha seleccionada cambia al instante).

## 1.26.1102.0230
- Las portadas llevan la fecha del fichero en su dirección: al cambiar una, la tele la descarga de nuevo en vez de enseñar la vieja de su caché.
- Fuera las 3 canciones de «Enredados»; 13 canciones nuevas (216 en total, 208 en el Megamix).

## 1.26.1102.0215
- Lista de canciones: desvanecimiento suave en los laterales, para que las portadas no se corten en seco.
- Última tanda: 63 canciones nuevas (206 en total, 200 en el Megamix).

## 1.26.1102.0142
- Menú y elección del Megamix: sombra algo más marcada en la tarjeta seleccionada.
- Menú y elección del Megamix: la tarjeta seleccionada lleva borde negro por los cuatro lados.

## 1.26.1102.0140
- Menú: el subtítulo de Récords pasa a «Los mejores» (antes «Salón de la fama» ocupaba dos líneas).

## 1.26.1102.0138
- Las ayudas de botones muestran siempre los del mando de PlayStation (✕ ○ □ △ L1 R1) en toda la tele.

## 1.26.1102.0137
- La tele recuerda el último mando usado: desde el arranque sale «Pulsa ✕ para continuar» con el de PlayStation (antes salía OK hasta pulsar un botón).

## 1.26.1102.0134
- Mandos de consola: con un mando de PlayStation conectado, las ayudas de botones muestran ✕ ○ □ △ L1 R1 (con uno de Xbox, A B X Y LB RB); al desconectarlo vuelven las de siempre.

## 1.26.1102.0127
- La «o» del centro del QR pasa a negro.

## 1.26.1102.0127
- El QR de la sala lleva la «o» de Gramola en el centro (corrección de errores máxima para que se siga leyendo).

## 1.26.1102.0125
- Nuevo texto del aviso de inicio, más formal: proyecto gratuito y sin ánimo de lucro, nunca se pedirá un pago y sin relación con artistas, autores ni discográficas.

## 1.26.1102.0119
- El aviso de después del logo de nuvola dura ahora unos 6 s.

## 1.26.1102.0118
- Tras el logo de nuvola, un aviso de unos 4 s: Gramola es totalmente gratis, nunca se pedirá dinero, sin ánimo de lucro y sin relación con los artistas.
- Volumen igualado (−12 LUFS) en 97 canciones; arreglados dos audios MP2 y uno WAV disfrazados de MP3.
- Las direcciones públicas (QR, textos, vistas previas) salen del dominio en uso; no van escritas en el código.

## 1.26.1102.0100
- Micro del móvil: usa siempre el micrófono del propio móvil aunque haya auriculares conectados (AirPods, Bluetooth, cable); si se conectan a mitad de partida, vuelve al del móvil.
- Portadas alternativas elegidas para 14 canciones; fuera «Vive la vida» (Gusanito).

## 1.26.1102.0050
- Canto: si una frase no cabe en la pantalla, la letra se reduce lo justo para que se lea entera (también la línea siguiente).
- Portadas nuevas de iTunes (600×600) para 96 canciones; la anterior se conserva en su carpeta.

## 1.26.1102.0037
- Foto del jugador: en el móvil, al elegir color, «Hacer foto» abre la cámara frontal con un cuadro que muestra exactamente lo que saldrá; la foto aparece en su tarjeta de la sala. Solo vive en memoria mientras dura la sala.
- Megamix: 120 canciones (a las 58 con estribillo marcado se suman 62 con el estribillo detectado automáticamente).

## 1.26.1102.0027
- Lista de canciones: fuera «Duración · Año»; el título tiene el doble de sitio y, si aun así no cabe, se encoge lo justo para leerse entero.

## 1.26.1102.0024
- Lista de canciones en rejilla de dos filas agrupada por letra (o década), con tira de letras: se ven unas 18 canciones a la vez y ←→ avanza de dos en dos.

## 1.26.1102.0022
- Nuevo modo Megamix: el estribillo de 4, 6 u 8 canciones al azar (sin repetir artista), seguidas y con fundido cruzado entre una y otra. Usa las 58 canciones con el estribillo marcado; entre canción y canción se anuncia la siguiente.
- «Pasa el micro» pasa a llamarse «Pásalo».
- El QR de la sala se vuelve a dibujar siempre al entrar en ella.

## 1.26.1102.0004
- Fuera el modo Dúo (no hay canciones a dos voces): menú de seis modos y sin el filtro «Solo dúos». Web y capturas actualizadas.

## 1.26.1102.0000
- Canto: las sílabas en cursiva (notas libres) se pintan enteras del color.

## 1.26.1101.2356
- Canto: al tocar la letra, la barra de aproximación sigue adelante por debajo de la letra y se desvanece en medio segundo.

## 1.26.1101.2353
- Canto: la barra de aproximación toca la primera letra de la frase (sin hueco).

## 1.26.1101.2351
- Canto: la barra de aproximación encaja con la letra justo al empezar la frase y tiene la altura de las letras.

## 1.26.1101.2347
- Canto: la barra de aproximación sale siempre y en movimiento antes de cada frase, desde la izquierda, y toca la letra justo cuando hay que cantar (en la intro recorre toda la intro). Si la frase siguiente empieza pronto, entra en cuanto acaba la anterior.
- Sala: Atrás en el mando vuelve a la bienvenida.

## 1.26.1101.2343
- Canto: la barra de aproximación es un dibujo fijo que se desliza hasta la letra y desaparece al llegar; vuelve a salir antes de cada frase.

## 1.26.1101.2342
- Canto: la barra de aproximación sale antes de cada frase (no solo en la intro), para saber cuándo empezar a cantar.

## 1.26.1101.2340
- Canto: siempre con el fondo claro; fuera el selector de fondos (V) y la cámara de fondo.

## 1.26.1101.2338
- Canto: la letra va centrada en pantalla.
- Canto: barra de aproximación antes de la primera frase (y tras un interludio) que se acorta hasta que toca cantar.
- La tele carga siempre el código nuevo tras un despliegue (el navegador ya no se queda con una versión antigua).

## 1.26.1101.2331
- Selección de canciones: la música de menús ya no se cuela entre un avance y otro.

## 1.26.1101.2314
- Textos de Ajustes y del aviso sin conexión referidos a «la tele».

## 1.26.1101.2309
- Ajustes: fuera la opción de idioma (la app va en castellano).

## 1.26.1101.2301
- Mando de la tele: el botón Atrás vuelve a la pantalla anterior y los botones de colores vuelven a funcionar.
- Selección de canciones: los avances empiezan en el minuto 1 de la canción y pasan de una a otra con fundido cruzado (también en la tele).
- Arranque: «Pulsa OK para continuar» en vez de «Pulsa A».
- App de la tele: arranca en negro, sin «Cargando», y después sale el logo de nuvola.
- 122 canciones, todas sin vídeo.
