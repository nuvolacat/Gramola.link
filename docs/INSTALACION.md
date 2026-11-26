# Instalación

## Requisitos

- **Node.js 22+** (librerías `ws` y `@simplewebauthn/server` para el Touch ID del admin).
- Para el admin: **python3** y **ffmpeg** (Megamix y volumen de las canciones).
- Un **dominio con HTTPS** para jugar con móviles (los navegadores solo dejan usar el micro en páginas seguras).

## En local (para desarrollar)

```bash
cd server
npm install
npm start                 # http://localhost:8877
npm test                  # pruebas del servidor (arranca uno aparte con datos temporales)
```

## Despliegue, copias y datos

- La versión sigue el esquema `1.AA.MMDD.HHMM` con la hora real del despliegue y se pone en todos los sitios de una
  vez con `python3 tools/version.py 1.26.1103.1102` (VERSION, insignia del README, página de la tele, `?v=` del
  móvil y nombre de la caché de su service worker). `deploy.sh` no despliega si no coinciden.

- `deploy/deploy.sh` comprueba la sintaxis, espera hasta 90 s a que nadie esté cantando (`DEPLOY_FORCE=1` lo salta),
  instala las dependencias en una copia (`server.new`) y solo entonces cambia de carpeta y reinicia: un fallo de `npm`
  nunca deja el servicio sin arrancar. Al parar, el servidor guarda las salas en `data/salas.json` y las restaura al
  arrancar, así que un despliegue no echa a nadie de su sala.
- Lo que hay que guardar: `data/` (récords, estadísticas, actividad, **llaves de Touch ID** en `admin.json`, novedades,
  versiones del editor, retiradas; `data/trabajos` es prescindible) y `web/songs` (las canciones con sus portadas,
  Megamix y volumen igualado). En el servidor de producción hay una copia diaria a las 04:10 en
  `/root/backups/gramola/` (`datos-AAAA-MM-DD.tgz`, 14 días, y una réplica de `web/songs`), hecha por
  `/root/backups/gramola/backup.sh`. El admin (Servidor → Descargar copia) baja récords, estadísticas, actividad,
  novedades y llaves.
- Un fichero de datos que no sea JSON válido no se pisa en silencio: el servidor lo aparta como
  `*.corrupto-<fecha>` y lo dice en el registro (`journalctl -u gramola`).
```
```

Variables de entorno:

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | `8877` | Puerto de escucha. |
| `HOST` | `127.0.0.1` | Interfaz. Usa `0.0.0.0` para entrar desde otros equipos de la red. |
| `WEB_DIR` | `../web` | Carpeta de la web. |
| `SONGS_DIR` | `$WEB_DIR/songs` | Carpeta de canciones. |
| `SERVE_STATIC` | `1` | Con `0`, el servidor solo atiende `/api` y `/ws` (si los estáticos los sirve nginx). |
| `DATA_DIR` | `server/data` | Récords (`records.json`), estadísticas, actividad, llaves del admin y canciones retiradas. |
| `TV_HOST` | — | Dominio propio de la tele (p. ej. `tele.ejemplo.com`): la tele se abre en su raíz, `micro.` de ese dominio es el micro, y `/app` de cualquier otro dominio redirige allí conservando `?tv=…` (el editor del admin sigue usando `/app/?preview=1`). Sin ella, la tele vive en `/app`. |
| `APP_IOS` · `APP_ANDROID` · `APP_ANDROID_SHA256` | — | App nativa del micro: «EQUIPO.identificador» de iOS, paquete de Android y huellas SHA-256 de sus firmas (separadas por comas). Con ellas, `micro.…/.well-known/apple-app-site-association` y `assetlinks.json` hacen que el QR de la tele abra la app si está instalada. |
| `TIENDA_IOS` · `TIENDA_ANDROID` · `APPLE_ID` | — | Enlaces a las fichas de App Store y Google Play y número de la app en App Store: la página del micro, en el navegador, ofrece la tienda que toca (y en iPhone, el banner de Safari); instalar la web queda como opción secundaria. |
| `ADMIN_HOST` | — | Host del portal de administración. Sin ella, cualquier host que empiece por `admin.` (en local, `admin.localhost:8877`). |

En `localhost` el micro funciona porque los navegadores lo tratan como seguro. Como el micro solo funciona **instalado
como app** (en el navegador solo enseña cómo instalarlo), para probarlo en el ordenador ábrelo en Chrome
(`http://localhost:8877/m/`) e instálalo con el icono de instalar de la barra de direcciones.

## En un servidor

### 1. Ficheros

```bash
sudo mkdir -p /var/www/vhosts/DOMINIO/app
sudo rsync -a server web /var/www/vhosts/DOMINIO/app/
cd /var/www/vhosts/DOMINIO/app/server && sudo -u USUARIO npm ci --omit=dev
```

### 2. Servicio systemd

Copia `deploy/gramola.service` a `/etc/systemd/system/`, cambia `USUARIO` y `DOMINIO`, crea la carpeta de datos
(`app/data`, donde se guardan los récords) y:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gramola
curl -s http://127.0.0.1:8877/api/health
```

### 3. Proxy con WebSocket

**Plesk con Apache**: pega `deploy/apache-gramola.conf` en *Configuración de Apache y nginx → Directivas adicionales
para HTTPS* (necesita `mod_proxy_wstunnel`). **nginx**: `proxy_pass` a `127.0.0.1:8877` con las cabeceras `Upgrade` y
`Connection "upgrade"` en `/ws`.

### 4. HTTPS y Cloudflare

- Certificado Let's Encrypt para el dominio (y `www`).
- Con Cloudflare en modo proxy los WebSocket funcionan sin cambios (el servidor envía pings cada 25 s).
  Si el modo SSL es «Full (strict)», emite el certificado con el registro en «solo DNS» y activa el proxy después.

### 5. Canciones

Sube las carpetas UltraStar a `SONGS_DIR` (por SFTP). Aparecen en menos de 5 s, sin reiniciar nada.

### 6. Diseño

Si cambia el diseño de la tele: copia la exportación nueva en `diseno/` y ejecuta `python3 tools/build-tv.py`.
