"""Production OCR configuration and an actual recognition smoke test."""
from __future__ import annotations

import importlib.util
import os
import re
import shutil


def _cgroup_memory_limit_bytes() -> int | None:
    """Read container memory limits without loading model libraries or psutil."""
    from pathlib import Path

    for path in (Path('/sys/fs/cgroup/memory.max'), Path('/sys/fs/cgroup/memory/memory.limit_in_bytes')):
        try:
            raw = path.read_text().strip()
            value = int(raw)
            if 0 < value < 1 << 60:
                return value
        except (OSError, ValueError):
            continue
    return None


def _ocr_memory_safe() -> bool:
    """Avoid native ONNX OOM kills that turn /api/analyze into 'Failed to fetch'.

    Render's 512 MiB service is not large enough to reliably load the OCR
    detection, classification, and recognition models alongside the API/CAD
    runtime. Native PDF text extraction remains available on smaller plans.
    OCR_MIN_MEMORY_MB=0 explicitly opts out of the conservative limit.
    """
    try:
        minimum_mb = max(0, int(os.getenv('OCR_MIN_MEMORY_MB', '768')))
    except ValueError:
        minimum_mb = 768
    limit = _cgroup_memory_limit_bytes()
    return not minimum_mb or limit is None or limit >= minimum_mb * 1024 * 1024


def ocr_configuration() -> dict:
    enabled = os.getenv('LOCAL_OCR_ENABLED', 'true').strip().lower() in {'1', 'true', 'yes', 'on'}
    tesseract = bool(shutil.which('tesseract'))
    rapidocr = importlib.util.find_spec('rapidocr') is not None
    onnxruntime = importlib.util.find_spec('onnxruntime') is not None
    backend = 'tesseract' if tesseract else 'rapidocr_onnx' if rapidocr and onnxruntime else None
    memory_safe = backend != 'rapidocr_onnx' or _ocr_memory_safe()
    available = enabled and bool(backend) and memory_safe
    reason = ('disabled_by_environment' if not enabled else
              'missing_ocr_dependencies' if not backend else
              'insufficient_memory_for_ocr' if not memory_safe else 'configured')
    return {'enabled': enabled, 'backend': backend, 'available': available, 'reason': reason}


def smoke_test(engine=None) -> dict:
    """Recognize generated engineering callouts, not just import a package.

    The fixture contains no customer data. Exercising recognition also fetches
    and initializes required models at build time on the production backend.
    """
    config = ocr_configuration()
    if not config['available']:
        return {**config, 'verified': False}
    try:
        import pymupdf as fitz
        from PIL import Image
        from app.extraction.detail_ocr import _recognize
        if config['backend'] == 'rapidocr_onnx' and engine is None:
            from rapidocr import RapidOCR
            engine = RapidOCR()
        with fitz.open() as doc:
            page = doc.new_page(width=360, height=150)
            page.insert_text((25, 45), 'THK 2.5 mm', fontsize=16)
            page.insert_text((25, 90), 'WIDTH 80 mm', fontsize=16)
            pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
            image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        text = ' '.join(item[0] for item in _recognize(image, engine, 45)).upper()
        compact = re.sub(r'\s+', '', text)
        verified = '2.5' in compact and '80' in compact and 'THK' in compact and 'WIDTH' in compact
        return {**config, 'verified': verified, 'reason': 'recognition_passed' if verified else 'recognition_failed'}
    except Exception as exc:
        # Do not expose machine paths, model URLs or environment secrets.
        return {**config, 'verified': False, 'reason': 'runtime_error', 'error_type': type(exc).__name__}
