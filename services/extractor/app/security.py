import hashlib
import hmac
import time
from fastapi import HTTPException
from .config import settings


def verify_service_signature(
    *,
    data: bytes,
    file_name: str,
    mime_type: str,
    signature: str,
    timestamp: str,
) -> None:
    try:
        parsed_timestamp = int(timestamp)
    except (TypeError, ValueError) as exc:
        raise HTTPException(401, "Invalid service timestamp") from exc

    if abs(int(time.time()) - parsed_timestamp) > 300:
        raise HTTPException(401, "Expired service request")

    digest = hashlib.sha256(data).hexdigest()
    canonical = f"{timestamp}.{digest}.{file_name}.{mime_type}".encode()
    expected = hmac.new(
        settings().extractor_hmac_secret.encode(),
        canonical,
        hashlib.sha256,
    ).hexdigest()

    if not signature or not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "Invalid service signature")
