#!/usr/bin/env python3
"""Crea una canción UltraStar a partir del audio y la letra (y analiza la voz de canciones que ya existen).

    python crear.py crear AUDIO.mp3 LETRA.txt SALIDA/ --titulo T --artista A --idioma es [--anio 1999]
    python crear.py analizar AUDIO.mp3 SALIDA/

Pasos (todo en local, en el Mac):
  1. Separa la voz de la música con Demucs (htdemucs) → voz.mp3
  2. Mide el tono de la voz cada 10 ms con CREPE (pYIN de reserva) → voz-tono.json ([[ms, midi|null], …])
  2b. Parte la voz en TRAMOS por los silencios (un silencio de 0,35 s separa; lo que dura menos de 0,3 s no cuenta) y
     reconoce qué dice cada tramo con faster-whisper (palabra a palabra, con tiempos) → voz-tramos.json. Con eso el
     editor enseña cada frase sobre su trozo de voz y propone dónde empieza y acaba.
  3. (crear) Alinea la letra sobre la voz con el alineador forzado multilingüe MMS (wav2vec2): cada letra de la
     letra recibe su instante exacto. No transcribe: coloca el texto que se le da. Antes, cada línea de la letra se
     empareja con las palabras reconocidas (en orden, coincidencias largas primero: los estribillos repetidos van cada
     uno a su sitio) y el alineador solo busca cada línea en la zona donde la voz la dice; si no hay reconocimiento,
     con la letra sincronizada (LRC) si la hay. Al final, la primera sílaba de cada frase se lleva a donde arranca la
     voz en su tramo (si arranca a menos de 0,6 s).
  4. (crear) Parte las palabras en sílabas (pyphen, según el idioma) y da a cada sílaba su inicio, su fin y su nota:
     - el fin se alarga mientras suene la voz (energía de la voz separada + tono detectado, sin cortar en respiraciones
       de menos de 0,12 s), así las NOTAS LARGAS quedan enteras hasta la siguiente sílaba o hasta que la voz calla;
     - una sílaba que el alineador estiró sobre un silencio largo (un solo, una intro) se recoloca donde suena;
     - la nota es el tono sostenido (sin el arranque, con los saltos de octava del detector corregidos);
     - las sílabas largas solo se parten («~») si la melodía cambia de verdad: más de 1 semitono durante 0,25 s,
       medido con una media de ~0,25 s para que el VIBRATO no cuente como cambio de nota.
  5. (crear) Escribe cancion.txt en formato UltraStar: una frase por línea de la letra.
Requisitos: ver tools/trabajador/LEEME.md (torch y torchaudio 2.8, demucs, torchcrepe, librosa, pyphen, soundfile; ffmpeg).
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import unicodedata

import numpy as np

SR = 44100
LANGS = {  # código → (pyphen, nombre en la cabecera)
    'es': ('es', 'Spanish'), 'en': ('en_US', 'English'), 'ca': ('ca', 'Catalan'), 'fr': ('fr', 'French'),
    'it': ('it_IT', 'Italian'), 'pt': ('pt_PT', 'Portuguese'), 'de': ('de_DE', 'German'), 'gl': ('gl', 'Galician'), 'eu': ('eu', 'Basque'),
}
BPM = 400                      # resolución: un tiempo = 60000 / (BPM·4) = 37,5 ms
BEAT = 60000 / (BPM * 4)


def log(*a):
    print(*a, flush=True)


def device():
    import torch
    if torch.cuda.is_available():
        return 'cuda'
    return 'mps' if torch.backends.mps.is_available() else 'cpu'


def liberar():
    """Suelta la memoria de los modelos entre paso y paso (en el servidor la memoria es justa)."""
    import gc
    gc.collect()


# ---------------------------------------------------------------------------- audio
def leer_audio(path, sr=SR, canales=2):
    """Audio en float32 (canales, n) con ffmpeg."""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(canales), '-ar', str(sr), '-'],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError('ffmpeg no ha podido leer el audio: ' + r.stderr.decode('utf-8', 'replace').strip()[-500:])
    out = r.stdout
    a = np.frombuffer(out, dtype=np.float32)
    return a.reshape(-1, canales).T.copy()


def guardar_mp3_estereo(x, sr, path, kbps=192):
    """(2, n) float32 → mp3 estéreo (para la pista sin voz)."""
    cima = float(abs(x).max()) if x.size else 0.0
    if cima > 0.999:
        x = x * (0.999 / cima)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-',
                          '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', path], stdin=subprocess.PIPE)
    p.communicate(np.ascontiguousarray(x.T, dtype=np.float32).tobytes())
    if p.returncode:
        raise RuntimeError('ffmpeg no pudo guardar ' + path)


def guardar_mp3(x, sr, path, kbps=128):
    """x mono float32 → mp3."""
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', '-',
                          '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', path], stdin=subprocess.PIPE)
    p.communicate(x.astype(np.float32).tobytes())
    if p.returncode:
        raise RuntimeError('ffmpeg no pudo guardar ' + path)


# ---------------------------------------------------------------------------- 1. voz
def separar_voz(path):
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    log('· Separando la voz (Demucs)…')
    wav = leer_audio(path)
    model = get_model('htdemucs')
    model.eval()
    ref = wav.mean(0)
    x = torch.from_numpy((wav - ref.mean()) / (ref.std() + 1e-8))
    dev = device()
    with torch.no_grad():
        try:
            out = apply_model(model, x[None], device=dev, split=True, overlap=0.25, progress=False)[0]
        except Exception:   # por si MPS no soporta alguna operación
            out = apply_model(model, x[None], device='cpu', split=True, overlap=0.25, progress=False)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    voces = model.sources.index('vocals')
    voz = out[voces].mean(0).cpu().numpy().astype(np.float32)
    # La misma pasada deja la música sin la voz: la tele la usa para cantar sin oír al cantante original
    resto = np.zeros_like(out[0].cpu().numpy())
    for i in range(len(model.sources)):
        if i != voces:
            resto += out[i].cpu().numpy()
    del model, out, x
    liberar()
    return voz, resto.astype(np.float32)


# ---------------------------------------------------------------------------- 2. tono
def medir_tono(voz, sr=SR):
    """Tono cada 10 ms con CREPE (modelo pequeño: en Shine acierta como el grande, 77 % frente al 54 % de pYIN,
    y tarda ~7 s). Si CREPE no está o falla, pYIN."""
    log('· Midiendo el tono de la voz…')
    try:
        import torch
        import torchcrepe
        import librosa
        y = librosa.resample(voz, orig_sr=sr, target_sr=16000).astype(np.float32)
        f0, per = torchcrepe.predict(torch.from_numpy(y)[None], 16000, hop_length=160, fmin=65, fmax=1050, model='tiny',
                                     decoder=torchcrepe.decode.viterbi, return_periodicity=True, batch_size=1024, device=device())
        per = torchcrepe.filter.median(per, 3)
        f0 = torchcrepe.filter.mean(f0, 3)
        f0, per = f0[0].cpu().numpy(), per[0].cpu().numpy()
        liberar()
        rms = np.sqrt(np.convolve(y ** 2, np.ones(400) / 400, 'same'))[::160]
        n = min(len(f0), len(per), len(rms))   # a veces difieren en una trama según la duración
        f0, per, rms = f0[:n], per[:n], rms[:n]
        umbral = max(1e-4, np.percentile(rms, 30) * 1.5)
        midi = np.where((per > 0.45) & (rms > umbral), 69 + 12 * np.log2(np.maximum(f0, 1) / 440), np.nan)
        return np.arange(len(f0)) * 0.01, midi
    except Exception as e:
        log('  (CREPE no disponible, uso pYIN:', e, ')')
    import librosa
    y = librosa.resample(voz, orig_sr=sr, target_sr=22050)
    f0, voiced, prob = librosa.pyin(y, fmin=65, fmax=1050, sr=22050, frame_length=2048, hop_length=220)
    t = librosa.times_like(f0, sr=22050, hop_length=220)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=220)[0]
    umbral = max(1e-4, np.percentile(rms, 30) * 1.5)
    midi = np.where(voiced & (prob > 0.3) & (rms[:len(f0)] > umbral), 69 + 12 * np.log2(np.where(f0 > 0, f0, 1) / 440), np.nan)
    return t, midi


def curva_json(t, midi):
    return [[int(round(a * 1000)), (None if math.isnan(m) else round(float(m), 2))] for a, m in zip(t, midi)]


# ---------------------------------------------------------------------------- 2b. tramos de voz y reconocimiento
ASR_MODELO = os.environ.get('GRAMOLA_ASR', 'small')   # faster-whisper: «small» tarda ~50 s por canción en el servidor (845 MB)
ASR_IDIOMAS = {'es', 'en', 'ca', 'fr', 'it', 'pt', 'de', 'gl', 'eu'}


def tramos_voz(voz, sr=SR, hueco=0.35, minimo=0.3):
    """Trozos seguidos de voz, por los silencios de la voz separada: [(ini, fin)] en segundos. Un silencio de menos de
    «hueco» no parte (respiraciones, pausas dentro de la frase) y lo que dura menos de «minimo» no cuenta."""
    paso = 0.01
    n = len(voz) // int(sr * paso)
    act = actividad(voz, n, sr, paso)
    out, i = [], 0
    while i < n:
        if not act[i]:
            i += 1
            continue
        j = i
        while j < n and act[j]:
            j += 1
        a, b = i * paso, j * paso
        if out and a - out[-1][1] < hueco:
            out[-1][1] = b
        else:
            out.append([a, b])
        i = j
    return [(round(a, 2), round(b, 2)) for a, b in out if b - a >= minimo]


def transcribir(voz, tramos, idioma=None, sr=SR):
    """Qué dice la voz en cada tramo (faster-whisper, modelo ASR_MODELO): devuelve (idioma, [(ini, fin, texto)],
    [(ini, fin, palabra)]) con los tiempos en segundos. Sin faster-whisper instalado, listas vacías."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        log('· (sin faster-whisper: no se reconoce lo que dice la voz)')
        return idioma, [], []
    import torch
    import torchaudio
    y = torchaudio.functional.resample(torch.from_numpy(voz)[None], sr, 16000)[0].numpy()
    model = WhisperModel(ASR_MODELO, device='cpu', compute_type='int8', cpu_threads=min(4, os.cpu_count() or 1))
    lang = idioma if idioma in ASR_IDIOMAS else None
    opc = dict(beam_size=1, temperature=0.0, condition_on_previous_text=False, word_timestamps=True, vad_filter=False)
    if lang is None and tramos:
        a, b = max(tramos, key=lambda x: x[1] - x[0])   # el idioma, por el tramo más largo
        _, info = model.transcribe(y[int(a * 16000):int(b * 16000)], **opc)
        lang = info.language if info.language_probability > 0.5 else 'es'
        log(f'· La voz parece «{lang}» ({info.language_probability:.0%})')
    textos, palabras = [], []
    for a, b in tramos:
        segs, _ = model.transcribe(y[int(a * 16000):int(b * 16000)], language=lang, **opc)
        ws = []
        for sg in segs:
            for w in sg.words or []:
                t = w.word.strip()
                if t:
                    ws.append((round(a + w.start, 2), round(a + w.end, 2), t))
        palabras += ws
        textos.append((a, b, ' '.join(w[2] for w in ws)))
    del model
    liberar()
    return lang, textos, palabras


def norm_palabra(w):
    return ''.join(x for ch in w for x in normalizar(ch) if x in "abcdefghijklmnopqrstuvwxyz'")


def ventanas_asr(lineas, palabras_asr, dur, tramos=()):
    """Con lo que la voz dice (palabras reconocidas con su tiempo), la zona donde cae cada línea de la letra, en el
    mismo formato que ventanas_lrc: {línea: (ini, fin, ini_marca)}. Las palabras de la letra y las reconocidas se
    emparejan en orden, coincidencias largas primero (difflib), así cada estribillo repetido va al suyo."""
    import difflib
    pal = palabras_de(lineas)
    if len(palabras_asr) < 5:
        return {}
    a, b = [p[3] for p in pal], [norm_palabra(w) for _, _, w in palabras_asr]
    casa = {}
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            casa[blk.a + k] = blk.b + k
    por_linea = {}
    for i, p in enumerate(pal):
        if i in casa:
            por_linea.setdefault(p[0], []).append(casa[i])
    out, usadas = {}, set(casa.values())
    tramo_de = lambda t: next((x for x in tramos if x[0] - 0.06 <= t <= x[1] + 0.06), None)
    for li, ks in por_linea.items():
        n_pal = sum(1 for p in pal if p[0] == li)
        if len(ks) < max(1, n_pal / 3):   # pocas palabras reconocidas de la línea: no fiarse
            continue
        # las palabras reconocidas pegadas a la línea que no son de ninguna otra (mal oídas) también son suyas,
        # mientras estén en el mismo tramo de voz
        lo, hi = ks[0], ks[-1]
        t0, t1 = tramo_de(palabras_asr[lo][0]), tramo_de(palabras_asr[hi][1])
        while lo > 0 and lo - 1 not in usadas and t0 and palabras_asr[lo - 1][0] >= t0[0] - 0.06:
            lo -= 1
        while hi + 1 < len(palabras_asr) and hi + 1 not in usadas and t1 and palabras_asr[hi + 1][1] <= t1[1] + 0.06:
            hi += 1
        ini, fin = palabras_asr[lo][0], palabras_asr[hi][1]
        out[li] = (max(0, ini - 0.5), min(dur, fin + 0.5), ini)
    log(f'· Reconocimiento: {len(casa)} de {len(pal)} palabras de la letra encontradas, {len(out)} de {len(lineas)} líneas situadas')
    if len(out) < len(lineas) * 0.5:
        return {}
    for li in range(len(lineas)):   # las líneas sin sitio: entre la anterior y la siguiente que sí lo tienen
        if li in out:
            continue
        prev = max((x for x in out if x < li), default=None)
        nxt = min((x for x in out if x > li), default=None)
        out[li] = (out[prev][0] if prev is not None else 0.0, out[nxt][1] if nxt is not None else dur, None)
    return out


def ajustar_a_voz(notas, tramos, tope=0.6):
    """La primera sílaba de cada frase arranca donde arranca la voz en su tramo (si el tramo empieza a menos de «tope»
    segundos y la frase anterior ya había callado). Devuelve cuántas se han movido."""
    movidas = 0
    for i, n in enumerate(notas):
        if i and n.get('frase', n['linea']) == notas[i - 1].get('frase', notas[i - 1]['linea']):
            continue
        prev_fin = notas[i - 1]['fin'] if i else -1
        cand = [a for a, b in tramos if abs(a - n['ini']) <= tope and n['ini'] < b and prev_fin <= a + 0.05]
        if not cand:
            continue
        a = min(cand, key=lambda x: abs(x - n['ini']))
        if abs(a - n['ini']) < 0.02:
            continue
        sig = notas[i + 1]['ini'] if i + 1 < len(notas) else n['fin'] + 1
        n['ini'] = min(a, sig - 0.1)
        n['fin'] = max(n['fin'], n['ini'] + 0.08)
        movidas += 1
    return movidas


# ---------------------------------------------------------------------------- 3. alinear la letra
def normalizar(c):
    c = unicodedata.normalize('NFD', c.lower())
    c = ''.join(x for x in c if not unicodedata.combining(x))
    return {'ñ': 'n', 'ç': 'c', 'ß': 's', 'æ': 'ae', 'œ': 'oe', '’': "'", '`': "'"}.get(c, c)


def palabras_de(lineas):
    """[(linea, palabra_original, [índice normalizado o None por letra], texto_normalizado)]"""
    out = []
    for li, linea in enumerate(lineas):
        for w in linea.split():
            idx, norm = [], ''
            for ch in w:
                n = ''.join(x for x in normalizar(ch) if x in "abcdefghijklmnopqrstuvwxyz'")
                if n:
                    idx.append(len(norm))
                    norm += n
                else:
                    idx.append(None)
            out.append((li, w, idx, norm))
    return out


def ventanas_lrc(lineas, lrc, dur):
    """Con una letra sincronizada (LRC), la zona de la canción donde cae cada línea: {línea: (ini, fin)} en segundos.
    Las líneas se emparejan por su texto (la letra puede estar retocada); las que no casan quedan entre sus vecinas."""
    import difflib
    import re
    marcas = []
    for L in (lrc or '').splitlines():
        ts = re.findall(r'\[(\d+):(\d+(?:[.:]\d+)?)\]', L)
        txt = re.sub(r'\[[^\]]*\]', '', L).strip()
        for mm, ss in ts:
            if txt:
                marcas.append((int(mm) * 60 + float(ss.replace(':', '.')), txt))
    marcas.sort()
    if len(marcas) < 3:
        return {}
    n = lambda s: re.sub(r'[^a-z0-9]', '', ''.join(normalizar(c) for c in s))
    a, b = [n(x) for x in lineas], [n(x[1]) for x in marcas]
    ini = {}
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            ini[blk.a + k] = marcas[blk.b + k][0]
    if len(ini) < len(lineas) * 0.5:   # la letra no se parece a la sincronizada: mejor sin ventanas
        return {}
    ord_ = sorted(ini)
    out = {}
    for k, li in enumerate(ord_):
        sig = next((ini[x] for x in ord_[k + 1:] if ini[x] > ini[li]), dur)
        out[li] = (max(0, ini[li] - 0.6), min(dur, sig + 0.4), ini[li])   # margen pequeño: sin invadir la frase siguiente
    # Las líneas sin marca: entre la anterior y la siguiente que sí tienen
    for li in range(len(lineas)):
        if li in out:
            continue
        prev = max((x for x in out if x < li), default=None)
        nxt = min((x for x in out if x > li), default=None)
        out[li] = (out[prev][0] if prev is not None else 0.0, out[nxt][1] if nxt is not None else dur, None)
    return out


def alinear(voz, sr, palabras, ventanas=None, fiables=False):
    """«fiables»: las ventanas salen de esta misma grabación (reconocimiento) y no se comprueba su desfase."""
    import torch
    import torchaudio
    from torchaudio.pipelines import MMS_FA as bundle
    log('· Alineando la letra con la voz (MMS)…')
    y = torch.from_numpy(voz)[None]
    y = torchaudio.functional.resample(y, sr, bundle.sample_rate)
    model = bundle.get_model(with_star=False).eval()
    # Emisiones por trozos de 20 s con 1 s de margen a cada lado (el modelo no cabe entero con canciones largas)
    paso, margen, sr16 = 20 * bundle.sample_rate, bundle.sample_rate, bundle.sample_rate
    trozos = []
    with torch.inference_mode():
        for a in range(0, y.shape[1], paso):
            i0, i1 = max(0, a - margen), min(y.shape[1], a + paso + margen)
            e, _ = model(y[:, i0:i1])
            fps = e.shape[1] / ((i1 - i0) / sr16)
            s0 = int(round((a - i0) / sr16 * fps))
            s1 = s0 + int(round(min(paso, y.shape[1] - a) / sr16 * fps))
            trozos.append(e[:, s0:s1])
    em = torch.cat(trozos, 1)
    del model, trozos
    liberar()
    seg_por_trama = y.shape[1] / sr16 / em.shape[1]
    validas = [p for p in palabras if p[3]]
    tokenizar, alineador = bundle.get_tokenizer(), bundle.get_aligner()
    tiempos = {}
    # Primero, alineación de toda la canción de una vez
    tok = tokenizar([p[3] for p in validas])
    for p, sp in zip(validas, alineador(em[0], tok)):
        tiempos[id(p)] = [(s.start * seg_por_trama, s.end * seg_por_trama, float(s.score)) for s in sp]
    if ventanas:
        # La letra sincronizada puede ser de otra versión (disco, videoclip con intro…): se mide el desfase con lo
        # alineado. Si es constante, se corrige y cada línea se vuelve a buscar solo en su zona (así no se confunden
        # estribillos repetidos ni se meten frases en los solos); si no casa, se queda la alineación global.
        dif = []
        for li in sorted({p[0] for p in validas}):
            w = ventanas.get(li)
            p0 = next((p for p in validas if p[0] == li), None)
            if w and w[2] is not None and p0 and tiempos.get(id(p0)):
                dif.append(tiempos[id(p0)][0][0] - w[2])
        if fiables:
            d = 0.0
        else:
            if len(dif) < 4:
                return tiempos
            d = float(np.median(dif))
            casan = sum(abs(x - d) < 1.5 for x in dif) / len(dif)
            log(f'  (letra sincronizada: desfase {d:+.1f} s, casan {casan:.0%} de las líneas)')
            if casan < 0.6:
                return tiempos
            ventanas = {k: (max(0, a + d), b + d, s) for k, (a, b, s) in ventanas.items()}
        globales = dict(tiempos)
        tiempos = {}
        try:
            fin_prev = 0   # cada frase empieza después de donde acabó la anterior: no se mezclan palabras de dos frases
            for li in sorted({p[0] for p in validas}):
                ps = [p for p in validas if p[0] == li]
                a, b, _ = ventanas[li]
                f0, f1 = max(0, int(a / seg_por_trama), fin_prev), min(em.shape[1], int(b / seg_por_trama))
                tok = tokenizar([p[3] for p in ps])
                if f1 - f0 < sum(len(x) for x in tok) * 2:
                    raise ValueError('ventana corta')
                for p, sp in zip(ps, alineador(em[0, f0:f1], tok)):
                    tiempos[id(p)] = [((s.start + f0) * seg_por_trama, (s.end + f0) * seg_por_trama, float(s.score)) for s in sp]
                    fin_prev = max(fin_prev, f0 + max(s.end for s in sp))
            return tiempos
        except Exception as e:
            log('  (sin ventanas:', e, ')')
            return globales
    return tiempos


# ---------------------------------------------------------------------------- 4. sílabas y notas
def silabas(palabra, idioma):
    import pyphen
    h = pyphen.Pyphen(lang=LANGS.get(idioma, ('es',))[0])
    partes = h.inserted(palabra, hyphen='\u0001').split('\u0001')
    return [x for x in partes if x]


USA_VOZ = True


def energia_db(voz, n, sr=SR, paso=0.01):
    """Energía de la voz separada en dB cada 10 ms (n valores)."""
    h = int(sr * paso)
    m = len(voz) // h
    e = np.sqrt(np.mean(voz[:m * h].reshape(m, h) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(e)
    out = np.full(n, -120.0)
    out[:min(n, m)] = db[:min(n, m)]
    return out


def actividad(voz, n, sr=SR, paso=0.01):
    """Cuándo suena la voz (energía de la voz separada cada 10 ms), con histéresis y sin huecos cortos."""
    h = int(sr * paso)
    m = len(voz) // h
    e = np.sqrt(np.mean(voz[:m * h].reshape(m, h) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(e)
    ref = np.percentile(db, 95)
    on, off = max(-48, ref - 26), max(-52, ref - 32)
    act = np.zeros(m, bool)
    s = False
    for i, v in enumerate(db):
        s = v > on if not s else v > off
        act[i] = s
    # huecos de menos de 120 ms (respiraciones, consonantes) no cortan
    i = 0
    while i < m:
        if not act[i]:
            j = i
            while j < m and not act[j]:
                j += 1
            if 0 < i and j < m and (j - i) * paso < 0.12:
                act[i:j] = True
            i = j
        else:
            i += 1
    out = np.zeros(n, bool)
    out[:min(n, m)] = act[:min(n, m)]
    return out


def suavizar(midi, k=7):
    """Mediana móvil que ignora los huecos (para que el vibrato y los saltos sueltos no cuenten)."""
    out = np.full_like(midi, np.nan)
    r = k // 2
    for i in range(len(midi)):
        w = midi[max(0, i - r):i + r + 1]
        w = w[~np.isnan(w)]
        if len(w) >= 2:
            out[i] = np.median(w)
    return out


def construir(lineas, palabras, tiempos, t, midi, idioma, voz=None):
    """Notas: [{linea, ini, fin (s), texto, midi}]"""
    notas = []
    primera_de_linea = set()
    for li in range(len(lineas)):
        ws = [p for p in palabras if p[0] == li]
        if ws:
            primera_de_linea.add(id(ws[0]))
    for p in palabras:
        li, w, idx, norm = p
        sp = tiempos.get(id(p))
        sil = silabas(w, idioma)
        pos = 0
        for k, s in enumerate(sil):
            ini = fin = None
            for j in range(pos, pos + len(s)):
                n = idx[j] if j < len(idx) else None
                if n is not None and sp and n < len(sp):
                    a, b, _ = sp[n]
                    ini = a if ini is None else min(ini, a)
                    fin = b if fin is None else max(fin, b)
            pos += len(s)
            texto = ((' ' if k == 0 and id(p) not in primera_de_linea else '') + s)
            if ini is None:
                if notas and notas[-1]['linea'] == li:
                    notas[-1]['texto'] += texto
                continue
            notas.append({'linea': li, 'ini': ini, 'fin': fin, 'texto': texto})
    # Cuándo suena la voz: energía de la voz separada (si la hay) o, si no, el tono detectado
    paso = 0.01
    con_tono = ~np.isnan(midi)
    if voz is not None:
        # Voz = energía de la voz separada Y tono detectado a menos de 0,15 s (los restos de orquesta no cuentan)
        cerca = np.convolve(con_tono.astype(float), np.ones(31), 'same') > 0
        suena = actividad(voz, len(t)) & cerca
    else:
        suena = con_tono
    ms = suavizar(midi)
    lento = suavizar(midi, 25)   # ~0,25 s: más que un ciclo de vibrato (4-7 por segundo), así el vibrato se compensa
    # Sílabas que el alineador estiró sobre un silencio largo (un solo de guitarra, una intro): si arranca en silencio,
    # se recoloca donde suena de verdad, justo antes de la siguiente; si arranca bien, se recorta al callarse la voz.
    for i, n in enumerate(notas):
        sig = notas[i + 1]['ini'] if i + 1 < len(notas) else n['fin']
        a0, a1 = int(n['ini'] / paso), int(min(n['fin'], sig) / paso)
        if a1 - a0 < 150 or suena[a0:a1].mean() >= 0.5:
            continue
        if not suena[a0:a0 + 30].any():
            j = a1 - 1
            while j > a0 and not suena[j]:
                j -= 1
            k = j
            while k > a0 and suena[k - 1]:
                k -= 1
            if j > a0:
                n['ini'], n['fin'] = max(k * paso, j * paso - 1.2), j * paso
        else:
            j = a0
            while j < a1 and suena[j]:
                j += 1
            n['fin'] = max(n['ini'] + 0.12, j * paso)
    # Fin de cada sílaba: se alarga mientras siga sonando la voz, hasta la siguiente sílaba (las notas largas, enteras).
    # «Sonando» aquí es exigente: energía a menos de 14 dB del pico de la propia sílaba y tono detectado a menos de
    # 80 ms; si no, en mezclas densas (coros, eco, segundas voces) la voz separada nunca calla, las notas se comían
    # las pausas entre frases y no quedaba hueco alguno en la letra.
    db = energia_db(voz, len(t)) if voz is not None else None
    cerca8 = np.convolve(con_tono.astype(float), np.ones(17), 'same') > 0
    for i, n in enumerate(notas):
        sig = notas[i + 1]['ini'] if i + 1 < len(notas) else n['fin'] + 4
        a0 = int(n['ini'] / paso)
        j = int(max(n['fin'], n['ini'] + 0.06) / paso)
        pico = db[a0:max(a0 + 1, j)].max() if db is not None else 0
        tope = n['fin'] + 2.5   # una nota no se alarga más de 2,5 s sobre lo que dijo el alineador
        while j < len(t) and j * paso < sig - 0.03 and j * paso < tope and suena[j] and cerca8[j] and (db is None or db[j] >= pico - 14):
            j += 1
        fin = max(n['fin'], j * paso)
        n['fin'] = max(n['ini'] + 0.08, min(fin, sig - 0.02))
    # Frases: una por línea de la letra y, además, donde el cantante hace una pausa dentro de una línea (medio segundo
    # entre sílaba y sílaba, o algo menos si la voz calla de verdad): así las líneas largas de la letra se parten donde
    # se respira, y la tele enseña el hueco
    frase = 0
    for i, n in enumerate(notas):
        if i:
            p = notas[i - 1]
            hueco = n['ini'] - p['fin']
            callada = (1 - suena[int(p['fin'] / paso):max(int(p['fin'] / paso) + 1, int(n['ini'] / paso))].mean()) if hueco > 0 else 0
            mismo = n['linea'] == p['linea']
            antes = sum(1 for x in notas[:i] if x.get('frase') == frase)
            despues = sum(1 for x in notas[i:] if x['linea'] == n['linea'])
            if not mismo or ((hueco >= 0.5 or (hueco >= 0.35 and callada >= 0.7)) and antes >= 2 and despues >= 2):
                frase += 1
        n['frase'] = frase
    # Tono: el que se sostiene (sin el arranque), y las notas largas solo se parten si el tono cambia de verdad
    out, ultimo = [], None
    for n in notas:
        a = n['ini'] + min(0.06, (n['fin'] - n['ini']) * 0.2)
        sel = (t >= a) & (t < n['fin'])
        v = ms[sel]
        v = v[~np.isnan(v)]
        if not len(v):
            n['midi'] = ultimo if ultimo is not None else 60
            out.append(n)
            continue
        c0 = float(np.median(v))
        v = c0 + ((v - c0 + 6) % 12) - 6
        n['midi'] = int(round(float(np.median(v))))
        ultimo = n['midi']
        # Saltos de octava del detector: se llevan a la octava de la nota antes de decidir si cambia
        vl = lento[sel].copy()
        okv = ~np.isnan(vl)
        vl[okv] = n['midi'] + ((vl[okv] - n['midi'] + 6) % 12) - 6
        seg = tramos(t[sel], vl, umbral=1.0, minimo=0.25) if n['fin'] - n['ini'] > 0.6 else []
        if len(seg) > 1:
            for k, (a2, b2, p) in enumerate(seg):
                out.append({'linea': n['linea'], 'frase': n.get('frase', n['linea']), 'ini': n['ini'] if k == 0 else a2, 'fin': n['fin'] if k == len(seg) - 1 else b2,
                            'texto': n['texto'] if k == 0 else '~', 'midi': p})
            ultimo = seg[-1][2]
        else:
            out.append(n)
    return out


def tramos(ts, ms, umbral=0.8, minimo=0.18):
    """Tramos de nota estable dentro de una sílaba larga: [(ini, fin, midi)]. Un tramo nuevo solo empieza si el tono
    se aparta más de «umbral» semitonos de la nota del tramo y se mantiene al menos «minimo» segundos (el vibrato no parte)."""
    ok = ~np.isnan(ms)
    if ok.sum() < 3:
        return []
    segs = []
    cur_i, cur_p = None, None
    i = 0
    idx = np.where(ok)[0]
    vals = ms[ok]
    k = 0
    while k < len(idx):
        if cur_p is None:
            cur_i, cur_p = k, vals[k]
            k += 1
            continue
        if abs(vals[k] - cur_p) > umbral:
            # ¿se mantiene lejos lo bastante?
            m = k
            while m < len(idx) and abs(vals[m] - cur_p) > umbral and ts[idx[m]] - ts[idx[k]] < minimo:
                m += 1
            if m < len(idx) and ts[idx[m]] - ts[idx[k]] >= minimo or (m == len(idx) and ts[idx[-1]] - ts[idx[k]] >= minimo):
                segs.append((cur_i, k))
                cur_i, cur_p = k, float(np.median(vals[k:min(len(vals), k + int(minimo * 100))]))
            k = m if m > k else k + 1
            continue
        cur_p = float(np.median(vals[cur_i:k + 1]))
        k += 1
    segs.append((cur_i, len(idx)))
    out = []
    for a, b in segs:
        p = int(round(float(np.median(vals[a:b]))))
        ta, tb = ts[idx[a]], ts[idx[b - 1]] + 0.01
        if out and out[-1][2] == p:
            out[-1] = (out[-1][0], tb, p)
        elif tb - ta >= minimo * 0.8 or not out:
            out.append((ta, tb, p))
        else:
            out[-1] = (out[-1][0], tb, out[-1][2])
    for x in range(len(out) - 1):   # sin huecos entre tramos
        out[x] = (out[x][0], out[x + 1][0], out[x][2])
    return out


# ---------------------------------------------------------------------------- 5. UltraStar
def ultrastar(notas, titulo, artista, idioma, anio, mp3, portada=None):
    if not notas:
        raise ValueError('No se ha podido encajar ninguna palabra de la letra con la voz (¿letra o idioma equivocados?)')
    gap = int(round(notas[0]['ini'] * 1000))
    beat = lambda s: int(round((s * 1000 - gap) / BEAT))
    head = [f'#TITLE:{titulo}', f'#ARTIST:{artista}', f'#LANGUAGE:{LANGS.get(idioma, ("", idioma))[1]}']
    if anio:
        head.append(f'#YEAR:{anio}')
    head += [f'#MP3:{mp3}', f'#AUDIO:{mp3}']
    if portada:
        head.append(f'#COVER:{portada}')
    head += [f'#BPM:{BPM}', f'#GAP:{gap}', '#CREATOR:Gramola']
    body = []
    prev_fin = None
    for i, n in enumerate(notas):
        b, l = beat(n['ini']), max(1, int(round((n['fin'] - n['ini']) * 1000 / BEAT)))
        if prev_fin is not None and b < prev_fin:
            b = prev_fin
        if i and n.get('frase', n['linea']) != notas[i - 1].get('frase', notas[i - 1]['linea']):
            # Dónde cambia la línea en pantalla dentro de la pausa (convención de los editores UltraStar, como YASS):
            # pausa corta → justo antes de la frase nueva; pausa de 1-2 s → medio segundo después de callarse;
            # 2-4 s → al segundo; más → a los dos segundos (la frase vieja se queda un rato, luego se ve la que viene)
            pausa = (b - prev_fin) * BEAT / 1000
            tras = 0.5 if pausa < 2 else 1.0 if pausa < 4 else 2.0
            corte = max(prev_fin, b - int(round(150 / BEAT))) if pausa < 1 else prev_fin + int(round(tras * 1000 / BEAT))
            body.append(f'- {max(prev_fin, min(corte, b))}')
        texto = n['texto'].replace('\n', ' ')
        body.append(f": {b} {l} {n['midi']} {texto}")
        prev_fin = b + l
    return '\n'.join(head + body + ['E']) + '\n'


# ---------------------------------------------------------------------------- órdenes
def analizar(audio, salida, progreso=lambda p, m: None, idioma=None):
    """voz.mp3 + voz-tono.json + voz-tramos.json (tramos de voz y lo que dice, si hay faster-whisper)."""
    os.makedirs(salida, exist_ok=True)
    progreso(5, 'Separando la voz')
    voz, resto = separar_voz(audio)
    progreso(48, 'Guardando la voz y la música sin voz')
    guardar_mp3(voz, SR, os.path.join(salida, 'voz.mp3'))
    guardar_mp3_estereo(resto, SR, os.path.join(salida, 'sin-voz.mp3'))
    progreso(55, 'Midiendo el tono')
    t, midi = medir_tono(voz)
    json.dump(curva_json(t, midi), open(os.path.join(salida, 'voz-tono.json'), 'w'), separators=(',', ':'))
    progreso(66, 'Reconociendo lo que dice la voz')
    tr = tramos_voz(voz)
    lang, textos, palabras = transcribir(voz, tr, idioma)
    json.dump({'v': 1, 'modelo': ASR_MODELO if palabras else None, 'idioma': lang,
               'tramos': [[a, b, (next((x[2] for x in textos if x[0] == a), ''))] for a, b in tr], 'palabras': [list(p) for p in palabras]},
              open(os.path.join(salida, 'voz-tramos.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    log(f'· {len(tr)} tramos de voz, {len(palabras)} palabras reconocidas')
    return voz, t, midi


STOP = {   # palabras muy frecuentes, para adivinar el idioma de la letra (el admin propone «es» por defecto)
    'es': 'que de no la el y a en un es me te se mi tu por lo con para como yo si más ya mi sin del al las los una pero'.split(),
    'en': 'the you and i to a of in it my me is that on we your this for be all with so like just what but oh got'.split(),
    'ca': 'que de no la el i a en un és em et es el meu teu per amb com jo si més ja sense del al les els una però hi'.split(),
    'fr': 'que de ne la le et à un est je tu me te mon ma pour avec comme si plus sans des les une mais pas dans'.split(),
    'it': 'che di non la il e a un è mi ti io tu per con come se più già senza del al le una ma nel sei'.split(),
    'pt': 'que de não a o e um é me te eu você por com como se mais já sem do na os as uma mas'.split(),
    'de': 'der die und ich du nicht das ist ein es zu mit dich mich wir sie auf für von so wie was'.split(),
}


def detectar_idioma(lineas, pedido='es'):
    """El idioma que más parece la letra; si el pedido no se le acerca, se cambia (y se avisa)."""
    w = [x for l in lineas for x in re.findall(r"[a-záéíóúàèìòùäëïöüñçœ']+", l.lower())]
    if len(w) < 20:
        return pedido
    punt = {k: sum(1 for x in w if x in set(v)) / len(w) for k, v in STOP.items()}
    mejor = max(punt, key=punt.get)
    if mejor != pedido and punt[mejor] >= 0.12 and punt[mejor] >= 2 * punt.get(pedido, 0):
        log(f'· La letra parece {LANGS.get(mejor, (mejor, mejor))[1]} y no {LANGS.get(pedido, (pedido, pedido))[1]}: se usa {mejor}')
        return mejor
    return pedido


def crear(audio, letra, salida, titulo, artista, idioma='es', anio=None, mp3='audio.mp3', progreso=lambda p, m: None, lrc=None):
    lineas = [l.strip() for l in letra.replace('\r', '').split('\n') if l.strip()]
    if not lineas:
        raise ValueError('La letra está vacía')
    idioma = detectar_idioma(lineas, idioma)
    voz, t, midi = analizar(audio, salida, progreso, idioma)
    progreso(75, 'Alineando la letra')
    pal = palabras_de(lineas)
    dur = len(voz) / SR
    rec = json.load(open(os.path.join(salida, 'voz-tramos.json')))
    tr = [tuple(x[:2]) for x in rec['tramos']]
    ven = ventanas_asr(lineas, [tuple(x) for x in rec['palabras']], dur, tr)
    fiables = bool(ven)
    if not ven and lrc:
        ven = ventanas_lrc(lineas, lrc, dur)
    tiempos = alinear(voz, SR, pal, ven or None, fiables)
    progreso(90, 'Sílabas y notas')
    notas = construir(lineas, pal, tiempos, t, midi, idioma, voz)
    log(f'· {ajustar_a_voz(notas, tr)} frases llevadas a donde arranca la voz')
    txt = ultrastar(notas, titulo, artista, idioma, anio, mp3)
    open(os.path.join(salida, 'cancion.txt'), 'w', encoding='utf-8').write(txt)
    progreso(100, f'{len(notas)} notas en {len(lineas)} frases')
    return txt


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('orden', choices=['crear', 'analizar'])
    ap.add_argument('audio')
    ap.add_argument('resto', nargs='+')
    ap.add_argument('--titulo', default='Sin título')
    ap.add_argument('--artista', default='Desconocido')
    ap.add_argument('--idioma', default='es')
    ap.add_argument('--anio')
    ap.add_argument('--lrc', help='letra sincronizada (LRC) para guiar el encaje')
    a = ap.parse_args()
    if a.orden == 'analizar':
        analizar(a.audio, a.resto[0], lambda p, m: log(f'{p}% {m}'), a.idioma)
    else:
        letra = open(a.resto[0], encoding='utf-8').read()
        crear(a.audio, letra, a.resto[1], a.titulo, a.artista, a.idioma, a.anio, os.path.basename(a.audio), lambda p, m: log(f'{p}% {m}'),
              open(a.lrc, encoding='utf-8').read() if a.lrc else None)
