#!/bin/bash
# Micros alargados de la pantalla de cantar: web/assets/micro/jN.webp (640×999, cortado a media empuñadura) →
# jN-largo.webp (640×1420). Se copia un tramo de la empuñadura de debajo de la rejilla, se estira siguiendo su
# estrechamiento (perspectiva) y se une con un fundido de 60 px; el tramo añadido va sin la sombra de alrededor.
# La pantalla lo desvanece al final con una máscara (m.css). Necesita ImageMagick.
set -euo pipefail
cd "$(dirname "$0")/../web/assets/micro"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
for n in 1 2 3 4 5 6 7 8; do
  magick j$n.webp -crop 640x30+0+900 +repage -resize 640x520\! -virtual-pixel transparent -background none \
    -distort Perspective "0,0 0,0  640,0 640,0  0,520 34,520  640,520 606,520" \
    -channel A -threshold 85% +channel -channel A -blur 0x1 +channel "$T/cola.png"
  magick j$n.webp -crop 640x960+0+0 +repage \( +clone -alpha extract \( -size 640x900 xc:white -size 640x60 gradient:white-black -append \) \
    -compose multiply -composite \) -alpha off -compose CopyOpacity -composite "$T/arriba.png"
  magick -size 640x1420 xc:none "$T/cola.png" -geometry +0+900 -composite "$T/arriba.png" -geometry +0+0 -composite -quality 88 j$n-largo.webp
done
ls -la j?-largo.webp
