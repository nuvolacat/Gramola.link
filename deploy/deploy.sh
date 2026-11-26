#!/usr/bin/env bash
# Despliega server/, web/ y tools/ al servidor indicado en deploy/deploy.env y reinicia el servicio.
# - Comprueba la sintaxis antes de tocar nada y espera (hasta 90 s) a que nadie esté cantando (DEPLOY_FORCE=1 lo salta).
# - El servidor se sube a una copia (server.new) y las dependencias se instalan ALLÍ; solo entonces se cambia de carpeta.
#   Si npm falla, el servicio sigue con el código anterior (antes, node_modules se vaciaba antes de instalar y un fallo
#   dejaba el servicio sin arrancar).
# - Las salas sobreviven al reinicio: el servidor las guarda al parar (SIGTERM) y las restaura al arrancar.
# No borra canciones del servidor (web/songs no se toca; se suben con tools/subir-canciones.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/deploy.env
# Grupo del usuario de la app y nombres de los servicios en el servidor (Doku: gramola / doku-gramola)
DEPLOY_GROUP="${DEPLOY_GROUP:-$DEPLOY_USER}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-gramola}"
DEPLOY_WORKER="${DEPLOY_WORKER:-gramola-trabajador}"
# Opciones extra de SSH (por ejemplo una conexión maestra ya abierta: -o ControlPath=…)
SSH="ssh ${DEPLOY_SSH_OPTS:-}"

for f in server/server.js server/admin.js server/puntuacion.js; do node --check "$f"; done
# La misma versión en todos los sitios (VERSION, README, tele, móvil y su service worker): tools/version.py X.Y.MMDD.HHMM
python3 tools/version.py --check

if [ "${DEPLOY_FORCE:-0}" != 1 ]; then
  for i in $(seq 1 18); do
    C=$($SSH "$DEPLOY_HOST" "curl -fsS http://127.0.0.1:8877/api/health" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("singing",0))' 2>/dev/null || echo 0)
    [ "$C" = 0 ] && break
    echo "Hay $C cantando ahora mismo: espero 5 s ($i/18)…"; sleep 5
  done
fi

rsync -az -e "$SSH" --delete --exclude node_modules --exclude data server/ "$DEPLOY_HOST:$DEPLOY_DIR/server.new/"
rsync -az -e "$SSH" --delete --exclude songs --filter='P /privado/' web/ "$DEPLOY_HOST:$DEPLOY_DIR/web/"
# Recursos privados (fuera del repo porque nombran el dominio, p. ej. la imagen para redes de la tele): web/privado/
if [ -d deploy/privado/web ]; then rsync -az -e "$SSH" deploy/privado/web/ "$DEPLOY_HOST:$DEPLOY_DIR/web/"; fi
# Herramientas de canciones (el admin las usa para el Megamix y el volumen; necesitan python3 y ffmpeg en el servidor)
rsync -az -e "$SSH" --delete --exclude __pycache__ tools/ "$DEPLOY_HOST:$DEPLOY_DIR/tools/"
# Las canciones NO se despliegan desde aquí (tienen derechos y se suben aparte con tools/subir-canciones.sh)
# El trabajador de creación importa tools/trabajador/crear.py al arrancar: si existe su servicio, se reinicia también
# (un trabajo a medias vuelve a la cola en cuanto el trabajador reaparece)
$SSH "$DEPLOY_HOST" "set -e; cd $DEPLOY_DIR; mkdir -p data
  (cd server.new && npm ci --omit=dev --silent && node --check server.js)
  rm -rf server.old; mv server server.old; mv server.new server; rm -rf server.old
  chown -R $DEPLOY_USER:$DEPLOY_GROUP server tools data
  find web -maxdepth 1 -mindepth 1 ! -name songs -exec chown -R $DEPLOY_USER:$DEPLOY_GROUP {} +
  find web/songs ! -user $DEPLOY_USER -exec chown $DEPLOY_USER:$DEPLOY_GROUP {} + 2>/dev/null || true
  systemctl restart $DEPLOY_SERVICE; systemctl try-restart $DEPLOY_WORKER 2>/dev/null || true
  sleep 1; curl -fsS http://127.0.0.1:8877/api/health"
echo
echo "Desplegado."
