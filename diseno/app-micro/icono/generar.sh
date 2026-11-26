#!/bin/bash
# Icono de la app del micro (propuesta E1: micro de la web con anilla azul sobre rojo Gramola, símbolo centrado al 25 %).
# Necesita ImageMagick (magick) y Microsoft Edge (para pintar el SVG del símbolo). Salida en final/.
set -euo pipefail
cd "$(dirname "$0")"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
ROJO="#ec3013"
# 1) micro sin el fondo blanco
magick ../../assets/micro/micro-original.png -alpha set -fuzz 25% -fill none \
  -draw "color 0,0 floodfill" -draw "color %[fx:w-1],0 floodfill" -draw "color 0,%[fx:h-1] floodfill" -draw "color %[fx:w-1],%[fx:h-1] floodfill" \
  -channel A -morphology Erode Disk:4 -blur 0x1 +channel "$T/micro.png"
magick "$T/micro.png" -resize 780x -background none \( +clone -background "#000" -shadow 45x22+0+18 \) +swap -background none -layers merge +repage "$T/micro-sombra.png"
# 2) símbolo de Gramola (aro + tres rayas) centrado, blanco al 25 %, en un lienzo de 1536 (= 108 dp de Android; el icono visible son los 1024 del centro)
cat > "$T/logo.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1536" viewBox="0 0 1536 1536"><g opacity=".25" transform="translate(768,768) scale(12) translate(-50,-50)"><circle cx="50" cy="50" r="38" fill="none" stroke="#fff" stroke-width="14"/><path d="M30 38h40M27 50h46M30 62h40" stroke="#fff" stroke-width="8"/></g></svg>
SVG
"$EDGE" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=1536,1536 --screenshot="$T/logo.png" "file://$T/logo.svg" 2>/dev/null
# 3) capas a 1536: fondo (rojo + símbolo) y primer plano (micro; arriba a 110+256 como en el diseño de 1024, sigue hasta abajo)
magick -size 1536x1536 xc:"$ROJO" "$T/logo.png" -composite "$T/fondo.png"
magick -size 1536x1536 xc:none "$T/micro-sombra.png" -gravity north -geometry +0+366 -composite -crop 1536x1536+0+0 +repage "$T/frente.png"
magick "$T/fondo.png" "$T/frente.png" -composite "$T/completo.png"
# iOS (y fuente general): 1024 sin transparencia = el centro visible
magick "$T/completo.png" -gravity center -crop 1024x1024+0+0 +repage -alpha off final/icono-1024.png
# Android adaptable (formato de @capacitor/assets: 1024 = lienzo entero de 108 dp)
magick "$T/fondo.png" -resize 1024x1024 -alpha off final/android-fondo.png
magick "$T/frente.png" -resize 1024x1024 final/android-frente.png
# Google Play (512, sin transparencia) y web/PWA del micro
magick final/icono-1024.png -resize 512x512 final/google-play-512.png
for s in 512 192 180 32; do magick final/icono-1024.png -resize ${s}x${s} final/micro-$s.png; done
echo "listo: $(ls final | tr '\n' ' ')"
