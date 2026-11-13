#!/usr/bin/env python3
"""Trabajador de creación de canciones: corre en el servidor (servicio gramola-trabajador) y atiende la cola del admin.

    python trabajador.py            # bucle: pide trabajo cada 10 s
    python trabajador.py --una      # atiende como mucho un trabajo y sale (para probar)

Configuración (GRAMOLA_TRABAJADOR_CFG o ~/.gramola-trabajador.json):
    {"url": "http://127.0.0.1:8877", "host": "admin.TU-DOMINIO", "token": "…"}
«host» hace falta cuando se habla con el servidor por dentro (127.0.0.1): el admin solo responde en su subdominio.
La clave se genera en el admin, apartado Creación → «Clave del trabajador».
"""
import base64
import glob
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crear  # noqa: E402

VERSION = '1.0'
CFG = json.load(open(os.environ.get('GRAMOLA_TRABAJADOR_CFG') or os.path.expanduser('~/.gramola-trabajador.json')))
BASE = CFG['url'].rstrip('/') + '/api/worker'


def pedir(method, ruta, data=None, raw=None, timeout=60):
    h = {'Authorization': 'Bearer ' + CFG['token'], 'User-Agent': 'gramola-trabajador/' + VERSION}
    if CFG.get('host'):
        h['Host'] = CFG['host']
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        h['Content-Type'] = 'application/json'
    elif raw is not None:
        body = raw
        h['Content-Type'] = 'application/octet-stream'
    req = urllib.request.Request(BASE + ruta, data=body, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
        return json.loads(b) if r.headers.get('content-type', '').startswith('application/json') else b


# ---------------------------------------------------------------------------- Spotify (una canción suelta)
# Mismo motor que el antiguo Gramola: zotify + librespot (parcheados) con la cuenta de credentials.json, en su propio
# entorno de Python. Ruta en la configuración: "spotify": "/opt/gramola-trabajador/spotify"
def spotify(j, out, progreso):
    sp = CFG.get('spotify') or '/opt/gramola-trabajador/spotify'
    os.makedirs(out + '.tmp', exist_ok=True)
    env = dict(os.environ, HOME=os.path.join(sp, 'home'), TQDM_DISABLE='1', PYTHONUNBUFFERED='1')
    try:
        app = json.load(open(os.path.join(sp, 'spotify_app.json')))
        env.update(SPOTIFY_CLIENT_ID=app['client_id'], SPOTIFY_CLIENT_SECRET=app['client_secret'])
    except Exception:
        app = None
    progreso(10, 'Descargando de Spotify')
    cmd = [os.path.join(sp, 'venv/bin/python'), '-m', 'zotify', '--credentials-location', os.path.join(sp, 'credentials.json'),
           '--root-path', out, '--temp-download-dir', out + '.tmp', '--download-format', 'mp3', '--download-quality', 'auto',
           '--download-real-time', 'False', '--skip-existing', 'False', '--skip-previously-downloaded', 'False',
           '--retry-attempts', '2', '--download-lyrics', 'False', '--bulk-wait-time', '1', '--print-splash', 'False',
           '--print-progress-info', 'False', '--print-download-progress', 'False', '--print-downloads', 'True',
           '--print-errors', 'True', '--output', '{artist} - {song_name}.{ext}', j['url']]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=sp, env=env, timeout=600)
    mp3s = glob.glob(os.path.join(out, '**', '*.mp3'), recursive=True)
    if not mp3s:
        raise RuntimeError('Spotify no ha dado la canción: ' + (r.stdout + r.stderr).strip()[-600:])
    mp3 = mp3s[0]
    progreso(80, 'Leyendo los datos')
    info = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', mp3], capture_output=True, text=True).stdout or '{}')
    tags = {k.lower(): v for k, v in (info.get('format', {}).get('tags') or {}).items()}
    meta = {'titulo': tags.get('title', ''), 'artista': tags.get('artist', ''), 'album': tags.get('album', ''),
            'anio': (tags.get('date') or tags.get('year') or '')[:4], 'duracion': round(float(info.get('format', {}).get('duration') or 0))}
    if not meta['anio'] and app:   # año del disco por la Web API (si responde)
        try:
            tok = json.loads(urllib.request.urlopen(urllib.request.Request('https://accounts.spotify.com/api/token', data=b'grant_type=client_credentials',
                headers={'Authorization': 'Basic ' + base64.b64encode(f"{app['client_id']}:{app['client_secret']}".encode()).decode()}), timeout=15).read())['access_token']
            tr = json.loads(urllib.request.urlopen(urllib.request.Request('https://api.spotify.com/v1/tracks/' + j['trackId'], headers={'Authorization': 'Bearer ' + tok}), timeout=15).read())
            meta['anio'] = (tr.get('album', {}).get('release_date') or '')[:4]
        except Exception:
            pass
    portada = os.path.join(out, 'portada.jpg')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mp3, '-an', '-c:v', 'copy', '-frames:v', '1', portada], capture_output=True)
    shutil.move(mp3, os.path.join(out, 'entrada.mp3'))
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), ensure_ascii=False)
    nombres = ['entrada.mp3', 'meta.json'] + (['portada.jpg'] if os.path.exists(portada) and os.path.getsize(portada) > 1000 else [])
    return nombres, f"{meta['artista']} - {meta['titulo']}"


def atender(j):
    tmp = tempfile.mkdtemp(prefix='gramola-')
    try:
        def progreso(p, msg):
            crear.log(f'  {p}% {msg}')
            try:
                r = pedir('POST', f'/jobs/{j["id"]}/progress', {'p': p, 'msg': msg})
                if r.get('cancel'):
                    raise KeyboardInterrupt('cancelado desde el admin')
            except urllib.error.HTTPError as e:
                if e.code in (404, 410):   # el trabajo se ha borrado desde el admin: no seguir calculando para nadie
                    raise KeyboardInterrupt('borrado desde el admin')
            except (urllib.error.URLError, OSError):   # (también los tiempos de espera agotados)
                pass
        out = os.path.join(tmp, 'salida')
        if j['kind'] == 'spotify':
            os.makedirs(out, exist_ok=True)
            nombres, msg = spotify(j, out, progreso)
            for n in nombres:
                pedir('PUT', f'/jobs/{j["id"]}/result/{n}', raw=open(os.path.join(out, n), 'rb').read(), timeout=300)
            pedir('POST', f'/jobs/{j["id"]}/done', {'ok': True, 'msg': msg})
            crear.log('✓ Descargada:', msg)
            return
        progreso(1, 'Descargando el audio')
        audio = os.path.join(tmp, 'audio.mp3')
        open(audio, 'wb').write(pedir('GET', f'/jobs/{j["id"]}/input', timeout=300))
        if j['kind'] == 'analizar':
            crear.analizar(audio, out, progreso, j.get('idioma'))
            nombres = ['voz.mp3', 'voz-tono.json', 'voz-tramos.json', 'sin-voz.mp3']
            msg = 'Voz analizada'
        else:
            txt = crear.crear(audio, j['letra'], out, j['titulo'], j['artista'], j.get('idioma') or 'es', j.get('anio') or None, j['audioName'], progreso, j.get('lrc'))
            nombres = ['cancion.txt', 'voz.mp3', 'voz-tono.json', 'voz-tramos.json', 'sin-voz.mp3']
            msg = f'{sum(1 for l in txt.splitlines() if l[:1] in ":*FRG")} notas'
        for n in nombres:
            if os.path.exists(os.path.join(out, n)):
                pedir('PUT', f'/jobs/{j["id"]}/result/{n}', raw=open(os.path.join(out, n), 'rb').read(), timeout=300)
        pedir('POST', f'/jobs/{j["id"]}/done', {'ok': True, 'msg': msg})
        crear.log('✓ Hecho:', j.get('artista'), '-', j.get('titulo'))
    except BaseException as e:
        err = ''.join(traceback.format_exception_only(type(e), e)).strip()
        crear.log('✗ Error:', err)
        try:
            pedir('POST', f'/jobs/{j["id"]}/done', {'ok': False, 'error': err[-1500:]})
        except Exception:
            pass
        if isinstance(e, SystemExit):
            raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    una = '--una' in sys.argv
    crear.log(f'Trabajador de Gramola {VERSION} · {BASE}')
    espera = 10
    while True:
        try:
            j = pedir('POST', '/next', {'host': platform.node(), 'version': VERSION})
            espera = 10
            if j and j.get('id'):
                crear.log(f'→ {j["kind"]}: {j.get("artista")} - {j.get("titulo")}')
                atender(j)
                continue
            if una:
                return
        except urllib.error.HTTPError as e:
            crear.log('Servidor:', e.code, e.read()[:200])
            espera = 60 if e.code == 401 else 30
        except Exception as e:
            crear.log('Sin conexión:', e)
            espera = 30
        time.sleep(espera)


if __name__ == '__main__':
    main()
