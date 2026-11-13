# El selector de canción, en todos los modos

## Lo que pasaba

Cinco modos de juego y solo tres dejaban elegir canción:

| Modo | Antes | Ahora |
|---|---|---|
| Cantar | selector | selector |
| Duelo | selector | selector |
| Dúo | selector | selector |
| **Jukebox** | entraba a cantar la primera de la cola (`GR.randSong()`) | **selector**, y de ahí a cantar |
| **Pasa el micro** | sacaba la canción al azar (`Math.random()`) | **selector** en tu turno, y de ahí a cantar |

En Jukebox y en Pasa el micro no se pasaba por «Preparar» porque no hay jugadores que preparar: la canción entraba
directa. Al añadir el selector hacía falta que esos dos siguieran sin pasar por esa pantalla, así que el paso del
selector a la canción va directo a la cuenta atrás.

## Cómo

Todo va en los enganches de `tools/build-tv.py`; el diseño (`diseno/Gramola TV.dc.html`) no se toca, que es la regla
de la casa.

- `menuAct(4)` (Jukebox) ya no canta: `go('songs', {mode:'jukebox'})`.
- `partyGo()` (Pasa el micro, al empezar el turno) ya no sortea: `go('songs', {mode:'party'})`.
- `startSetup()` gana dos ramas al principio: si el modo es `jukebox`, guarda la canción elegida, arma la cola con
  ella delante y canta; si es `party`, monta el cantante del turno (con su `id` y su `bot`, para que el móvil puntúe
  de verdad) y lanza la cuenta atrás con la canción elegida.

## Medido

Con el navegador real y `GR` en la mano:

- Menú → Jukebox → `songs/jukebox` → elegir la 3ª → `sing/jukebox`.
- Pasa el micro → turno → `songs/party` → elegir la 5ª → `count/party` con la canción 5 y el cantante del turno.

## Lo que cuesta

El Jukebox ya no se pone solo: alguien tiene que elegir cada canción. Si se prefiere que siga sonando sin que nadie
toque nada, se revierte solo el enganche del Jukebox y se queda el de Pasa el micro.

## Nota para quien lo mezcle

Este cambio y el de «quitar la voz» tocan los dos `tools/build-tv.py` (y la página montada). Son enganches distintos y
no se pisan, pero el segundo que entre tiene que volver a montar la página (`python tools/build-tv.py`).
