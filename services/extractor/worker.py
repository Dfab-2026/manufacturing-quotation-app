import os
import socket
import time
from datetime import datetime, timezone
from supabase import create_client
from app.config import settings
from app.pipeline import analyze_bytes


def run_once(client, worker_id: str) -> bool:
    result = client.rpc("claim_analysis_job", {"p_worker_id": worker_id}).execute()
    jobs = result.data or []
    if not jobs:
        return False

    job = jobs[0]
    job_id = job["id"]
    try:
        drawing = client.table("drawings").select("*").eq("id", job["drawing_id"]).single().execute().data
        data = client.storage.from_("drawings").download(drawing["storage_path"])
        extraction = analyze_bytes(data, drawing["mime_type"], drawing["file_name"])

        client.table("drawing_extractions").upsert({
            "tenant_id": job["tenant_id"],
            "rfq_id": job["rfq_id"],
            "drawing_id": drawing["id"],
            "schema_version": 1,
            "extractor_version": "hybrid-0.7-direct",
            "raw_text": extraction.raw_text,
            "structured_data": extraction.model_dump(exclude={"raw_text", "warnings"}),
            "warnings": extraction.warnings,
        }, on_conflict="drawing_id,schema_version").execute()

        client.table("drawings").update({"extraction_status": "completed"}).eq("id", drawing["id"]).execute()
        client.table("analysis_jobs").update({
            "status": "completed", "completed_at": datetime.now(timezone.utc).isoformat(), "error_message": None
        }).eq("id", job_id).execute()
    except Exception as exc:
        client.table("drawings").update({"extraction_status": "failed"}).eq("id", job["drawing_id"]).execute()
        client.table("analysis_jobs").update({
            "status": "failed", "completed_at": datetime.now(timezone.utc).isoformat(), "error_message": str(exc)[:1000]
        }).eq("id", job_id).execute()
    return True


def main() -> None:
    cfg = settings()
    if not cfg.supabase_url or not cfg.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    client = create_client(cfg.supabase_url, cfg.supabase_service_role_key)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    while True:
        worked = run_once(client, worker_id)
        if not worked:
            time.sleep(cfg.worker_poll_seconds)


if __name__ == "__main__":
    main()
