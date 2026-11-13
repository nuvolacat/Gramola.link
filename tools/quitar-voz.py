#!/usr/bin/env python3
"""Deja cada canción con una pista sin voz (`sin-voz.mp3`), para que la tele cante sobre ella sin procesar nada en vivo.

Es el pre-procesador: se ejecuta UNA vez por canción (y otra vez solo si se cambia el modelo o se pide --forzar) y
escribe el fichero en la carpeta de la canción, al lado del mp3. La tele, cuando el ajuste «Quitar voces» está
puesto, pone esa pista en vez de la original. Calidad: Demucs separa la voz del resto; no es un filtro de centro,
así que la música se queda como estaba (no se lleva por delante guitarras ni cajas centradas).

Mismo modelo que el trabajador (`htdemucs`), así la voz que se oye en el editor y la que se quita en la tele son la
misma separación.

    python tools/quitar-voz.py --carpeta web/songs                 # todas las que falten
    python tools/quitar-voz.py --carpeta web/songs --listar        # solo dice qué falta, sin procesar
    python tools/quitar-voz.py --carpeta web/songs --cancion "Queen - We Will Rock You" --forzar

Tarda ~1-2 min por canción en GPU y ~4-6 min en CPU (4 núcleos). Se puede cortar con Ctrl-C y volver a lanzar:
las que ya están hechas se saltan.
"""
import argparse
import json
import os
import subprocess
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'trabajador'))

import numpy as np                                        # noqa: E402
from crear import SR, leer_audio, log                     # noqa: E402  (mismas funciones que el trabajador)

VERSION = 1
AUDIO_EXT = ('.mp3', '.ogg', '.opus', '.wav', '.m4a', '.flac')
SALIDA = 'sin-voz.mp3'
FICHA = 'sin-voz.json'


def dispositivo(pedido=None):
    import torch
    if pedido:
        return pedido
    if torch.cuda.is_available():
        return 'cuda'
    if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def audio_de(carpeta):
    """El audio de la canción: el que diga la cabecera #MP3, o el primer fichero de audio que haya."""
    txt = next((f for f in os.listdir(carpeta) if f.lower().endswith('.txt')), None)
    if txt:
        try:
            for l in open(os.path.join(carpeta, txt), encoding='utf-8', errors='replace').read().splitlines():
                if l.upper().startswith('#MP3:') or l.upper().startswith('#AUDIO:'):
                    f = l.split(':', 1)[1].strip()
                    if f and os.path.exists(os.path.join(carpeta, f)):
                        return os.path.join(carpeta, f)
        except OSError:
            pass
    for f in sorted(os.listdir(carpeta)):
        if f.lower().endswith(AUDIO_EXT) and f != SALIDA:
            return os.path.join(carpeta, f)
    return None


def guardar_estereo_mp3(x, sr, destino, kbps=192):
    """(2, n) float32 → mp3 estéreo. Si la cima pasa de 1, se baja todo lo justo (no se recorta)."""
    cima = float(np.max(np.abs(x))) if x.size else 0.0
    if cima > 0.999:
        x = x * (0.999 / cima)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-',
                          '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', destino], stdin=subprocess.PIPE)
    p.communicate(np.ascontiguousarray(x.T, dtype=np.float32).tobytes())
    if p.returncode:
        raise RuntimeError('ffmpeg no ha podido escribir ' + destino)


def separar(path, disp, modelo='htdemucs'):
    """Devuelve la música sin la voz, (2, n) float32: la suma de todo menos el canal de voces."""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    wav = leer_audio(path)
    model = get_model(modelo)
    model.eval()
    ref = wav.mean(0)
    x = torch.from_numpy((wav - ref.mean()) / (ref.std() + 1e-8))
    with torch.no_grad():
        try:
            out = apply_model(model, x[None], device=disp, split=True, overlap=0.25, progress=False)[0]
        except Exception as e:                                  # GPU sin memoria o sin soporte: se hace en CPU
            if disp == 'cpu':
                raise
            log(f'  · no se pudo en {disp} ({str(e)[:90]}): se hace en CPU')
            out = apply_model(model, x[None], device='cpu', split=True, overlap=0.25, progress=False)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    voces = model.sources.index('vocals')
    resto = np.zeros_like(out[0].numpy())
    for i, nombre in enumerate(model.sources):
        if i != voces:
            resto += out[i].numpy()
    del model, out, x
    import gc
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return resto.astype(np.float32)


def procesar(carpeta, disp, kbps, forzar, modelo):
    audio = audio_de(carpeta)
    if not audio:
        return 'sin audio'
    destino = os.path.join(carpeta, SALIDA)
    st = os.stat(audio)
    if os.path.exists(destino) and not forzar:
        try:
            ficha = json.load(open(os.path.join(carpeta, FICHA)))
            if ficha.get('modelo') == modelo and ficha.get('origen', {}).get('mtime') == int(st.st_mtime):
                return 'ya estaba'
        except (OSError, ValueError):
            pass
        return 'ya estaba'
    t0 = time.time()
    x = separar(audio, disp, modelo)
    dur = x.shape[1] / SR
    guardar_estereo_mp3(x, SR, destino, kbps)
    json.dump({'v': VERSION, 'modelo': modelo, 'dispositivo': disp, 'kbps': kbps,
               'origen': {'fichero': os.path.basename(audio), 'bytes': st.st_size, 'mtime': int(st.st_mtime)},
               'segundos': round(dur, 1), 'hecho': time.strftime('%Y-%m-%dT%H:%M:%S')},
              open(os.path.join(carpeta, FICHA), 'w'), ensure_ascii=False, indent=1)
    log(f'  · {os.path.basename(destino)}: {dur:.0f} s de música en {time.time() - t0:.0f} s '
        f'({time.time() - t0:.0f} s de cálculo, {disp})')
    return 'hecha'


def main():
    ap = argparse.ArgumentParser(description='Deja sin-voz.mp3 en cada canción (Demucs, una vez por canción).')
    ap.add_argument('--carpeta', default=os.path.join(AQUI, '..', 'web', 'songs'), help='biblioteca de canciones')
    ap.add_argument('--cancion', action='append', default=[], help='solo estas (por nombre de carpeta); se puede repetir')
    ap.add_argument('--forzar', action='store_true', help='rehacer también las que ya tienen sin-voz.mp3')
    ap.add_argument('--listar', action='store_true', help='solo decir qué falta, sin procesar nada')
    ap.add_argument('--dispositivo', choices=['cuda', 'cpu', 'mps'], help='por defecto, la GPU si la hay')
    ap.add_argument('--modelo', default='htdemucs')
    ap.add_argument('--kbps', type=int, default=192)
    a = ap.parse_args()

    base = os.path.abspath(a.carpeta)
    if not os.path.isdir(base):
        sys.exit('No existe la carpeta de canciones: ' + base)
    carpetas = sorted(d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d)))
    if a.cancion:
        quiero = set(a.cancion)
        carpetas = [d for d in carpetas if d in quiero]
        faltan = quiero - set(carpetas)
        if faltan:
            sys.exit('No están en la biblioteca: ' + ', '.join(sorted(faltan)))
    if not carpetas:
        sys.exit('No hay canciones en ' + base)

    if a.listar:
        faltan = [d for d in carpetas if not os.path.exists(os.path.join(base, d, SALIDA))]
        log(f'{len(carpetas)} canciones · con sin-voz.mp3: {len(carpetas) - len(faltan)} · faltan: {len(faltan)}')
        for d in faltan:
            log('  · ' + d)
        return

    disp = dispositivo(a.dispositivo)
    log(f'{len(carpetas)} canciones en {base} · dispositivo: {disp} · modelo: {a.modelo}')
    cuenta = {'hecha': 0, 'ya estaba': 0, 'sin audio': 0, 'error': 0}
    t0 = time.time()
    for i, d in enumerate(carpetas, 1):
        log(f'[{i}/{len(carpetas)}] {d}')
        try:
            r = procesar(os.path.join(base, d), disp, a.kbps, a.forzar, a.modelo)
        except KeyboardInterrupt:
            log('\nCortado. Lo hecho queda hecho: al volver a lanzarlo se salta lo que ya está.')
            return
        except Exception as e:                                   # una canción rota no para el lote
            log(f'  · error: {type(e).__name__}: {e}')
            r = 'error'
        cuenta[r] += 1
    log(f'\n{cuenta["hecha"]} hechas · {cuenta["ya estaba"]} ya estaban · {cuenta["sin audio"]} sin audio · '
        f'{cuenta["error"]} con error · {time.time() - t0:.0f} s en total')
    if cuenta['error']:
        sys.exit(1)


if __name__ == '__main__':
    main()
