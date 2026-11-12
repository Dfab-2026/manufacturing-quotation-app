"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";

const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.dxf,.dwg,.step,.stp,.iges,.igs,.zip";
type UploadedDrawing = { id: string; name: string; size: number };

type UploadStage = "idle" | "uploading" | "ready" | "analyzing" | "error";

function titleFromFiles(files: File[]) {
  const first = files[0]?.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return files.length > 1 ? `${first || "Drawing"} package` : first || "New drawing quotation";
}

export function QuickDrawingAnalyze() {
  const [uploaded, setUploaded] = useState<UploadedDrawing[]>([]);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const rfqId = useRef<string | null>(null);
  const lock = useRef(false);
  const router = useRouter();

  async function uploadFiles(files: File[]) {
    if (!files.length || lock.current) return;
    lock.current = true;
    setStage("uploading");
    setError("");
    setFailedFiles([]);
    const completed: UploadedDrawing[] = [];

    try {
      if (!rfqId.current) {
        setMessage("Preparing secure upload…");
        const response = await fetch("/api/rfqs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: titleFromFiles(files), currency: "INR" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.data?.id) {
          throw new Error(result?.error || "Unable to prepare upload");
        }
        rfqId.current = String(result.data.id);
      }

      for (const [index, file] of files.entries()) {
        setMessage(`Uploading ${index + 1} of ${files.length}…`);
        if (file.size < 1 || file.size > 25 * 1024 * 1024) {
          setFailedFiles(files.slice(index));
          throw new Error(`${file.name}: file must be between 1 byte and 25 MB`);
        }
        const data = new FormData();
        data.set("file", file);
        const response = await fetch(`/api/rfqs/${rfqId.current}/drawings?uploadOnly=1`, {
          method: "POST",
          body: data,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.status !== "uploaded" || !result?.drawingId) {
          setFailedFiles(files.slice(index));
          throw new Error(result?.error || `Upload failed: ${file.name}`);
        }
        const saved = { id: String(result.drawingId), name: file.name, size: file.size };
        completed.push(saved);
        setUploaded((current) => [...current, saved]);
      }
      setMessage("");
      setStage("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
      setStage("error");
      setMessage("");
    } finally {
      lock.current = false;
    }
  }

  async function analyze() {
    if (!uploaded.length || !rfqId.current || lock.current || stage === "uploading") return;
    lock.current = true;
    setStage("analyzing");
    setError("");
    try {
      for (const [index, drawing] of uploaded.entries()) {
        setMessage(`Analyzing ${index + 1} of ${uploaded.length}: ${drawing.name}`);
        const response = await fetch(
          `/api/rfqs/${rfqId.current}/drawings/${drawing.id}/analyze`,
          { method: "POST" }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || `Analysis failed for ${drawing.name}`);
        if (result.status !== "completed" && result.status !== "queued") {
          throw new Error(`Unexpected analysis status for ${drawing.name}`);
        }
      }
      router.push(`/rfqs/${rfqId.current}/review`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to analyze drawings");
      setStage("error");
    } finally {
      lock.current = false;
      setMessage("");
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (busy) return;
    const selected = Array.from(event.dataTransfer.files);
    void uploadFiles(selected);
  }

  const busy = stage === "uploading" || stage === "analyzing";
  return (
    <div className="quick-analyze-card">
      <label className={`drawing-dropzone quick-dropzone${uploaded.length ? " has-files" : ""}`} htmlFor="quick-drawing-files" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <span className="drawing-dropzone-icon">⇧</span>
        <strong>Upload drawing</strong>
        <span>Choose drawing files or drag them here</span>
        <small>PDF, images, DXF, DWG, STEP/STP, IGES/IGS, ZIP · max 25 MB each</small>
        <input
          id="quick-drawing-files"
          type="file"
          accept={ACCEPTED}
          multiple
          disabled={busy}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            void uploadFiles(selected);
          }}
        />
      </label>
      {uploaded.length > 0 && (
        <div className="quick-file-list" aria-label="Uploaded drawings">
          {uploaded.map((file) => (
            <div className="quick-file-row" key={file.id}>
              <div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB</span></div>
              <span className="badge badge-ready" role="status">✓ Uploaded</span>
            </div>
          ))}
        </div>
      )}
      {message && <div className="upload-progress" role="status" aria-live="polite">{message}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {failedFiles.length > 0 && !busy && (
        <button className="btn btn-sm" type="button" onClick={() => void uploadFiles(failedFiles)}>
          Retry upload
        </button>
      )}
      <div className="quick-analyze-actions">
        <span className="help">{uploaded.length ? `${uploaded.length} file(s) uploaded securely` : "Select files to upload automatically"}</span>
        <button
          className="btn btn-primary btn-analyze"
          type="button"
          disabled={!uploaded.length || busy || failedFiles.length > 0}
          onClick={() => void analyze()}
        >
          {stage === "analyzing" ? "Analyzing…" : stage === "uploading" ? "Uploading…" : "Analyze Drawing →"}
        </button>
      </div>
    </div>
  );
}
