# El sonido de la tele y las voces de al lado, en el micro del móvil

Pregunta: ¿se puede filtrar lo que el móvil oye de la tele, y las voces de los demás?

## Respuesta corta

**La tele, sí, en buena parte — pero no con cancelación de eco.** Desde el 13-nov-2026 la voz de la canción sale del
fichero sin voz (`sin-voz.mp3`, separado con Demucs), así que por el altavoz de la tele ya no va la melodía que
cantaba el cantante original. Eso era lo que más confundía al detector de tono: la tele y el cantante sonando la
misma nota. Queda la música, que va por otras notas y molesta menos.

**Las voces de al lado, no de verdad.** Separármelas requeriría separación de fuentes por cada móvil (Demucs en el
bolsillo, en tiempo real): no cabe ni de lejos. Lo que hay es una puerta de calidad: si la voz que llega no es clara y
fuerte, no se manda.

## Por qué la cancelación de eco no sirve aquí

`echoCancellation` de WebRTC resta lo que el **propio aparato** está reproduciendo de lo que capta su micrófono. En
este juego la música la reproduce la **tele**, no el móvil: el móvil no tiene ninguna referencia que restar, así que la
cancelación no tiene nada que cancelar. Además está ajustada para voz hablada y estropea el contenido armónico que
necesita el detector de tono.

Por eso `web/js/pitch.js:60` la tiene apagada a propósito:

```js
const AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
```

Encenderla no quitaría la tele y empeoraría la afinación. La supresión de ruido tampoco: está pensada para ruido
estacionario (ventilador), no para música.

## Lo que sí hay hoy

- **Pista sin voz en la tele** (por defecto). Es la medida que más se nota, y ya está.
- **Puerta por claridad**: la muestra se descarta si la claridad del detector baja de 0,55 (`pitch.js:148`).
- **Puerta por nivel**: se descarta si el nivel no supera el ruido de fondo medido × 1,7 (`pitch.js:145`), que se
  recalcula solo.
- **Margen por nota**: cada nota admite ±2, ±1 o ±½ semitonos según dificultad, así que una muestra desviada no
  arrastra la puntuación.

## Lo que se puede añadir, si hace falta

1. **Puerta estricta opcional** en el micro (un ajuste «ignorar sonidos de fondo»): subir la claridad exigida a ~0,75 y
   el nivel a ruido × 2,5. Menos muestras falsas, y también menos muestras buenas si se canta flojo. Es media hora de
   trabajo y se puede medir con una grabación: la misma frase con la tele sonando, contando muestras aceptadas y
   rechazadas.
2. **Bajar la música de la tele** por debajo de la voz (Ajustes → Volumen de la música). Aburrido y eficaz.
3. **Cantar más cerca del móvil**: sube la relación voz/tele sin tocar código.

## Lo que no se va a hacer

- Cancelar la tele en el móvil sin referencia: no es un problema de ajuste, es que falta la señal de referencia.
- Separar dos voces simultáneas en el móvil: hace falta un modelo de separación por dispositivo, en tiempo real, y no
  hay presupuesto para eso en un navegador de móvil.
