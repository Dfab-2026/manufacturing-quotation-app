"use client";

import { createElement, useEffect, useMemo, useState } from "react";

export default function ModelViewer({
  file,
  issueCount = 0
}: {
  file: File | null;
  issueCount?: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (customElements.get("model-viewer")) {
      setReady(true);
      return;
    }

    const existing = document.querySelector('script[data-dfab-model-viewer="true"]');
    if (existing) {
      existing.addEventListener("load", () => setReady(true), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js";
    script.dataset.dfabModelViewer = "true";
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, []);

  const url = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const extension = file?.name.split(".").pop()?.toLowerCase() || "";
  const canRender = extension === "glb" || extension === "gltf";

  return (
    <div className="dfm-model-shell">
      {!file && (
        <div className="dfm-model-message">
          No 3D model is linked. Add STEP / STP or another supported CAD file through Choose drawing(s), or add one here.
        </div>
      )}

      {file && !canRender && (
        <div className="dfm-model-message">
          <b>{file.name}</b>
          <span>
            {(file.name.split(".").pop() || "CAD").toUpperCase()} model is linked to this DFM report.
            Interactive browser preview currently uses GLB/GLTF; STEP/STP remains attached as the manufacturing CAD input.
          </span>
        </div>
      )}

      {file && canRender && ready && createElement(
        "model-viewer",
        {
          src: url,
          "camera-controls": "",
          "auto-rotate": "",
          "shadow-intensity": "1",
          "environment-image": "neutral",
          style: {
            width: "100%",
            height: "430px",
            background: "#f5f8fb"
          }
        }
      )}

      {file && canRender && !ready && (
        <div className="dfm-model-message">Loading 3D viewer…</div>
      )}

      {issueCount > 0 && (
        <div className="dfm-model-issue-overlay">
          <i/>
          <b>{issueCount} DFM issue{issueCount === 1 ? "" : "s"} flagged</b>
          <span>Report-linked review warning. Exact CAD-face red highlighting needs feature-coordinate/B-Rep mapping.</span>
        </div>
      )}
    </div>
  );
}
