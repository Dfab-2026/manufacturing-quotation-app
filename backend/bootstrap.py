from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
REQ = ROOT / "requirements.txt"
STAMP = VENV / ".requirements.sha256"


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    print("[bootstrap]", " ".join(str(x) for x in cmd), flush=True)
    return subprocess.run(cmd, cwd=ROOT, check=check)


def venv_python() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def requirements_hash() -> str:
    return hashlib.sha256(REQ.read_bytes()).hexdigest()


def ensure_venv() -> Path:
    py = venv_python()
    if not py.exists():
        print("[bootstrap] Creating backend virtual environment...", flush=True)
        venv.EnvBuilder(with_pip=True, clear=False).create(VENV)
    return py


def install_dependencies(py: Path) -> None:
    run([str(py), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    run([str(py), "-m", "pip", "install", "-r", str(REQ)])
    run([str(py), "-m", "pip", "check"])
    STAMP.write_text(requirements_hash(), encoding="utf-8")


def verify_dependencies(py: Path) -> bool:
    check = (
        "import fastapi, uvicorn, pymupdf, pypdf, ezdxf, numpy, onnxruntime; "
        "from rapidocr import RapidOCR; "
        "import PIL, sqlalchemy, psycopg, openpyxl, reportlab; "
        "print('FASTAPI + PDF + DXF + OCR + DB EXTRACTION READY')"
    )
    result = run([str(py), "-c", check], check=False)
    if result.returncode != 0:
        return False
    result = run([str(py), "-m", "pip", "check"], check=False)
    return result.returncode == 0


def ensure_dependencies(py: Path) -> None:
    wanted = requirements_hash()
    current = STAMP.read_text(encoding="utf-8").strip() if STAMP.exists() else ""
    if current != wanted or not verify_dependencies(py):
        print("[bootstrap] Installing/repairing backend dependencies...", flush=True)
        install_dependencies(py)
    if not verify_dependencies(py):
        raise RuntimeError("Backend dependencies failed verification after installation.")


def main() -> int:
    if sys.version_info < (3, 12):
        print("Python 3.12+ is required. Install Python 3.12 and run START_BACKEND again.")
        return 2

    py = ensure_venv()
    ensure_dependencies(py)

    print("[bootstrap] Dependency verification passed.", flush=True)
    print("[bootstrap] Starting FastAPI on http://127.0.0.1:8000", flush=True)
    os.execv(
        str(py),
        [
            str(py),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
            "--reload",
        ],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
