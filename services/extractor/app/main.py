from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from .config import settings
from .models import Extraction
from .pipeline import analyze_bytes
from .security import verify_service_signature

app = FastAPI(
    title="ForgeQuote Drawing Extractor",
    version="0.7.0",
    docs_url=None,
    redoc_url=None,
)

SUPPORTED = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/tiff",
    "image/webp",
    "application/dxf",
    "application/acad",
    "application/x-dwg",
    "image/vnd.dwg",
    "application/step",
    "model/step",
    "model/iges",
    "application/iges",
    "application/zip",
}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.7.0"}


@app.post("/v1/extract", response_model=Extraction)
async def extract(
    file: UploadFile = File(...),
    x_signature: str = Header(default=""),
    x_timestamp: str = Header(default=""),
) -> Extraction:
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in SUPPORTED:
        raise HTTPException(415, "Unsupported drawing format")

    data = await file.read(settings().max_drawing_bytes + 1)
    if not data or len(data) > settings().max_drawing_bytes:
        raise HTTPException(413, "Drawing exceeds configured size limit")

    file_name = file.filename or "drawing"
    verify_service_signature(
        data=data,
        file_name=file_name,
        mime_type=mime_type,
        signature=x_signature,
        timestamp=x_timestamp,
    )
    return analyze_bytes(data, mime_type, file_name)
