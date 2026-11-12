"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ACCEPTED = ".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp,.dxf,.dwg,.step,.stp,.iges,.igs,.zip";

export function DrawingUpload({ rfqId, redirectAfterUpload }: { rfqId: string; redirectAfterUpload?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const router = useRouter();

  async function submit(form: FormData) {
    const files = form.getAll("file").filter((item): item is File => item instanceof File && item.size > 0);
    if (!files.length) { setError("Choose at least one drawing file."); return; }
    setBusy(true); setError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        setProgress(`Uploading ${index + 1} of ${files.length}: ${files[index].name}`);
        const body = new FormData();
        body.set("file", files[index]);
        const response = await fetch(`/api/rfqs/${rfqId}/drawings`, { method: "POST", body });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? `Upload failed for ${files[index].name}`);
      }
      const formElement = document.getElementById("drawing-upload-form") as HTMLFormElement | null;
      formElement?.reset();
      if (redirectAfterUpload) router.push(redirectAfterUpload);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false); setProgress("");
    }
  }

  return (
    <form id="drawing-upload-form" action={submit} className="stack">
      <label className="drawing-dropzone" htmlFor="drawing">
        <span className="drawing-dropzone-icon">⇧</span>
        <strong>Drop drawings here or click to browse</strong>
        <span>PDF · JPG/PNG/TIFF/WebP · DXF · DWG · STEP/STP · IGES/IGS · ZIP</span>
        <small>Maximum 25 MB per file. Multiple files are supported. Files remain private to this company workspace.</small>
        <input id="drawing" name="file" type="file" accept={ACCEPTED} multiple required />
      </label>
      {progress && <div className="upload-progress" role="status">{progress}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="upload-actions"><span className="help">CAD formats are ingested directly; preview availability depends on the format.</span><button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Uploading…" : "Upload & analyze →"}</button></div>
    </form>
  );
}
