"""Bounded, position-aware optical reading of engineering drawing details.

Native PDF text remains authoritative. OCR reads overlapping zoomed tiles rather
than downsampling a whole CAD sheet to an OCR model's input size.
"""
from __future__ import annotations
import csv
import io
import math
import os
import shutil
import subprocess
import threading
import time
from collections import OrderedDict
from hashlib import sha256

import pymupdf as fitz
from PIL import Image, ImageOps

_lock = threading.Lock()
_cache = OrderedDict()
_gate = threading.BoundedSemaphore(1)


def _env_int(name, default, low, high):
    try: return max(low, min(high, int(os.getenv(name, str(default)))))
    except ValueError: return default


def cached_regions(content):
    with _lock:
        return _cache.get(sha256(content).hexdigest(), ([], []))[0]


def _recognize(image, engine, timeout):
    # Tesseract is optional; RapidOCR is the portable bundled runtime.
    if shutil.which('tesseract'):
        buf = io.BytesIO(); image.save(buf, format='PNG')
        result = subprocess.run(['tesseract', 'stdin', 'stdout', '--psm', '11', '-l', 'eng', 'tsv'], input=buf.getvalue(), capture_output=True, timeout=timeout, check=True, env={**os.environ, 'OMP_THREAD_LIMIT':'1'})
        groups = {}
        for row in csv.DictReader(io.StringIO(result.stdout.decode('utf-8', 'replace')), delimiter='\t'):
            try:
                score = float(row['conf']) / 100; text = row['text'].strip()
                if score < .60 or not text: continue
                x,y,w,h = (int(row[k]) for k in ('left','top','width','height'))
                key = tuple(row[k] for k in ('block_num','par_num','line_num'))
                groups.setdefault(key, []).append((text, (x,y,x+w,y+h), score))
            except (KeyError, ValueError, AttributeError): continue
        for words in groups.values():
            words.sort(key=lambda w:w[1][0]); boxes=[w[1] for w in words]
            yield ' '.join(w[0] for w in words), (min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)), min(w[2] for w in words)
    elif engine is not None:
        import numpy as np
        result = engine(np.asarray(image.convert('RGB')))
        texts, boxes, scores = (getattr(result,k,None) for k in ('txts','boxes','scores'))
        if texts is None or boxes is None or scores is None: return
        for text, corners, score in zip(texts,boxes,scores):
            if not text or float(score)<.70: continue
            xs=[float(x) for x,y in corners]; ys=[float(y) for x,y in corners]
            yield str(text), (min(xs),min(ys),max(xs),max(ys)),float(score)
    else:
        raise RuntimeError('Install the configured OCR runtime')


def _origins(size, tile, stride):
    if size<=tile: return [0]
    return sorted(set([*range(0,size-tile+1,stride),size-tile]))


def read_detail(content, filename, engine=None):
    digest=sha256(content).hexdigest()
    with _lock:
        saved=_cache.get(digest)
        if saved is not None and not saved[1]: return saved
    regions=[]; warnings=[]; deadline=time.monotonic()+_env_int('DETAIL_OCR_SECONDS',100,10,220)
    page_limit=_env_int('DETAIL_OCR_MAX_PAGES',30,1,100)
    tile_limit=_env_int('DETAIL_OCR_MAX_TILES',160,1,600)
    count=0; completed=0
    if not _gate.acquire(timeout=5): return [], ['Detailed drawing reader is busy; retry analysis.']
    try:
        def scan(index, width, height, render, upscale=1):
            nonlocal count
            tile=1600; stride=1280
            for y in _origins(height,tile,stride):
                for x in _origins(width,tile,stride):
                    if count>=tile_limit or time.monotonic()>=deadline or len(regions)>=6000: return False
                    count+=1
                    image=render(x,y,min(x+tile,width),min(y+tile,height))
                    if upscale>1: image=image.resize((image.width*upscale,image.height*upscale),Image.Resampling.LANCZOS)
                    try:
                        for text,box,score in _recognize(image,engine,max(1,min(15,deadline-time.monotonic()))):
                            if time.monotonic()>=deadline: return False
                            clean=' '.join(text.split())
                            if not clean or len(clean)>500: continue
                            a,b,c,d=(v/upscale for v in box)
                            rect=[max(0,min(1,(x+a)/width)),max(0,min(1,(y+b)/height)),max(0,min(1,(x+c)/width)),max(0,min(1,(y+d)/height))]
                            if rect[2]<=rect[0] or rect[3]<=rect[1]:continue
                            # Overlapping tiles must not multiply a feature count.
                            duplicate=next((r for r in regions if r['page']==index and r['text'].casefold()==clean.casefold() and abs((r['box'][0]+r['box'][2]-rect[0]-rect[2])/2)<.008 and abs((r['box'][1]+r['box'][3]-rect[1]-rect[3])/2)<.008),None)
                            if duplicate:
                                if score>duplicate['score']: duplicate.update(box=rect,score=score)
                                continue
                            regions.append({'page':index,'text':clean,'box':rect,'score':round(score,3)})
                    except Exception as exc:
                        warnings.append(f'Page {index+1}: detail tile unreadable ({type(exc).__name__}).')
                        return False
            return True
        if filename.lower().endswith('.pdf'):
            with fitz.open(stream=content,filetype='pdf') as doc:
                total=len(doc)
                for i,page in enumerate(doc):
                    if i>=page_limit: break
                    # Render at 400 DPI (up to 600 via environment); each tile
                    # is independently rasterized, avoiding giant page allocations.
                    scale=_env_int('DETAIL_OCR_DPI',400,220,600)/72
                    width=math.ceil(page.rect.width*scale);height=math.ceil(page.rect.height*scale)
                    def render(x,y,x1,y1):
                        clip=fitz.Rect(x/scale,y/scale,x1/scale,y1/scale)
                        pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),clip=clip,alpha=False)
                        return Image.frombytes('RGB',(pix.width,pix.height),pix.samples)
                    if not scan(i,width,height,render):break
                    completed+=1
        else:
            with Image.open(io.BytesIO(content)) as source:
                if source.width*source.height>65_000_000: raise ValueError('Image exceeds 65 MP')
                total=min(getattr(source,'n_frames',1),100)
                for i in range(min(total,page_limit)):
                    source.seek(i); image=ImageOps.exif_transpose(source).convert('RGB')
                    if not scan(i,image.width,image.height,lambda x,y,x1,y1:image.crop((x,y,x1,y1)),upscale=2 if max(image.size)<=1600 else 1):break
                    completed+=1
        if completed<total: warnings.append(f'Detail OCR covered {completed}/{total} complete pages ({count} tiles); remaining regions require review or a larger configured budget.')
        if not regions: warnings.append('No reliable optical text was recovered; review the original drawing.')
    finally:
        _gate.release()
    regions.sort(key=lambda r:(r['page'],round(r['box'][1],2),r['box'][0]))
    result=(regions,list(dict.fromkeys(warnings)))
    # Cache text/coordinates only, not proprietary file binaries; bounded to 4 drawings.
    with _lock:
        _cache[digest]=result
        while len(_cache)>4:_cache.popitem(last=False)
    return result


def detail_text(regions):
    return '\n'.join(dict.fromkeys(r['text'] for r in regions if r['score']>=.70))
