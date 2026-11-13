# Voz de la canción, selector en todos los modos y controles del canto

Cuatro cambios pedidos el 13-nov-2026, con lo que se decidió y lo que se midió.

## 1. Voz de la canción: tres estados, uno solo por defecto

Antes había dos ajustes sueltos y escondidos: el nivel del filtro en vivo (`voz`, dentro del panel de audio de la
pausa) y la pista `sin-voz.mp3`, que solo se usaba si ese nivel era mayor que cero. Con los ajustes de fábrica
(`voz: 0`) la pista preparada **nunca** sonaba, aunque estuviera ahí.

Ahora es un ajuste de Ajustes, `vozModo`, con tres estados:

| Estado | Qué suena | Filtro en vivo |
|---|---|---|
| **Quitada** (por defecto) | `sin-voz.mp3` si la canción lo tiene; si no, el original | 0 si hay pista; **fuerte (2)** si no la hay |
| **En vivo** | siempre el original | el nivel de «Quitar voces» del panel de audio, mínimo suave (1) |
| **Entera** | siempre el original | 0 |

El respaldo es lo que pediste: con «Quitada» y una canción sin pista preparada, se quita la voz al momento sin
preguntar. Se puede cambiar **durante** la canción: se cambia `src` del mismo elemento `<audio>`, así el grafo de Web
Audio sigue enganchado y el reloj del audio no se reinicia; se recoloca en el mismo segundo y sigue sonando.

Medido (35 canciones, todas con `sin-voz.mp3`, 6–8 MB cada una):

| Petición | `_sinVoz` | Fichero | Filtro |
|---|---|---|---|
| defecto, con pista | sí | `sin-voz.mp3` | 0 |
| cambiar a «en vivo» en mitad | no | original `.mp3` | 1 |
| cambiar a «entera» | no | original `.mp3` | 0 |
| volver a «quitada» | sí | `sin-voz.mp3` | 0 |

`readyState 4`, sin errores de carga. Queda sin probar el camino de verdad (un móvil cantando mientras se cambia),
pero el cambio es de fichero, no de reloj.

## 2. El selector de canción, en todos los modos

- **Jukebox** entraba a cantar la primera de la cola (`songSel: GR.randSong()`). Ahora pasa por el selector.
- **Pasa el micro** sacaba la canción al azar. Ahora también la eliges tú, en tu turno.
- Cantar, Duelo y Dúo ya lo tenían.

Jukebox y Pasa el micro no pasan por «Preparar»: no hay jugadores que preparar, así que del selector se va directo a
la cuenta atrás. En Pasa el micro el cantante es el jugador al que le toca, con su `id` y su `bot`, como antes.

Medido: menú → Jukebox → `songs/jukebox` → elegir la 3ª → `sing/jukebox`. Pasa el micro → turno → `songs/party` →
elegir la 5ª → `count/party` con la canción 5.

**Coste:** en los dos modos se ha perdido el «una cosa menos que decidir». Si prefieres que el Jukebox siga eligiendo
solo para que no se pare la fiesta, es una línea.

## 3. Los botones del canto, con el lenguaje del diseño

Estaban en negro translúcido, pegados a la esquina (28 px). Ahora son las mismas fichas que el diseño usa para sus
atajos: cuadro de 48 px con el glifo dentro, borde de 2 px, etiqueta al lado en 28 px/600, separación de 32 px, a 96 px
del borde como el resto de la pantalla, y color `var(--color-bg)` (el mismo que el conmutador de variante).

- Canto normal: abajo a la izquierda (96 px, 84 px), a la altura del conmutador de variante que va a la derecha.
- Jukebox: arriba a la izquierda (96 px, 54 px), porque el pie lo ocupa la cola de canciones.

Medido en el navegador: `left: 96px`, `bottom: 84px` / `top: 54px`, `color: rgb(243,242,242)`, caja de 48 px con
borde de 2 px, fichas «10 s», «30 s», «Pausa» (el glifo `≡` de pausa es el que usa el propio diseño).

## 4. El sonido de la tele y las voces de los demás en el micro del móvil

Pregunta directa, respuesta directa: **no, no se puede cancelar de verdad, y lo que se vende como cancelación no
funciona aquí.** El porqué y lo que sí ayuda está en `docs/MICRO-FUGA.md`.
