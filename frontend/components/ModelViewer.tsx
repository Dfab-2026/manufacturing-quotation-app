"use client";

import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureThreeForCadViewer,
  isKernelCadFormat,
  readCadMesh
} from "@/lib/cad";

export default function ModelViewer({
  file,
  issueCount = 0
}: {
  file: File | null;
  issueCount?: number;
}) {
  const cadHostRef = useRef<HTMLDivElement | null>(null);
  const [modelViewerReady, setModelViewerReady] = useState(false);
  const [cadMessage, setCadMessage] = useState("");

  const extension = file?.name.split(".").pop()?.toLowerCase() || "";
  const isGlb = extension === "glb" || extension === "gltf";
  const kernelCad = Boolean(
    file && ["step", "stp", "iges", "igs"].includes(extension)
  );

  useEffect(() => {
    if (!isGlb) return;

    if (customElements.get("model-viewer")) {
      setModelViewerReady(true);
      return;
    }

    const existing = document.querySelector(
      'script[data-dfab-model-viewer="true"]'
    );

    if (existing) {
      existing.addEventListener(
        "load",
        () => setModelViewerReady(true),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src =
      "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js";
    script.dataset.dfabModelViewer = "true";
    script.onload = () => setModelViewerReady(true);
    document.head.appendChild(script);
  }, [isGlb]);

  const url = useMemo(
    () => (file && isGlb ? URL.createObjectURL(file) : ""),
    [file, isGlb]
  );

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    const host = cadHostRef.current;

    if (!file || !kernelCad || !host) return;

    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      try {
        setCadMessage("Loading 3D model…");

        const [result, THREE] = await Promise.all([
          readCadMesh(file),
          ensureThreeForCadViewer()
        ]);

        if (disposed) return;

        host.innerHTML = "";

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf5f8fb);

        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100000);
        camera.up.set(0, 0, 1);

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "low-power"
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        host.appendChild(renderer.domElement);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x596a7b, 1.7));

        const directional = new THREE.DirectionalLight(0xffffff, 1.9);
        directional.position.set(2, 3, 4);
        scene.add(directional);

        const group = new THREE.Group();

        for (const sourceMesh of result.meshes || []) {
          const positions = sourceMesh.attributes?.position?.array || [];
          const indices = sourceMesh.index?.array || [];

          if (!positions.length || !indices.length) continue;

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(positions, 3)
          );
          geometry.setIndex(indices);

          if (sourceMesh.attributes?.normal?.array?.length) {
            geometry.setAttribute(
              "normal",
              new THREE.Float32BufferAttribute(
                sourceMesh.attributes.normal.array,
                3
              )
            );
          } else {
            geometry.computeVertexNormals();
          }

          const sourceColor = sourceMesh.color;
          const color = sourceColor?.length >= 3
            ? new THREE.Color(
                sourceColor[0],
                sourceColor[1],
                sourceColor[2]
              )
            : new THREE.Color(0xb9c6d3);

          const material = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.12,
            roughness: 0.7,
            side: THREE.DoubleSide
          });

          const mesh = new THREE.Mesh(geometry, material);
          group.add(mesh);

          const edgeGeometry = new THREE.EdgesGeometry(geometry, 32);
          const edgeMaterial = new THREE.LineBasicMaterial({
            color: 0x52687e,
            transparent: true,
            opacity: 0.62
          });
          group.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
        }

        if (!group.children.length) {
          throw new Error("STEP geometry was read but no drawable mesh was produced.");
        }

        scene.add(group);

        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 1);

        group.position.sub(center);
        group.rotation.x = 0.55;
        group.rotation.z = -0.45;

        let zoom = 1;
        const fitCamera = () => {
          const distance = maxDimension * 2.15 / zoom;
          camera.near = Math.max(0.01, maxDimension / 1000);
          camera.far = maxDimension * 100;
          camera.position.set(distance, -distance, distance * 0.78);
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
        };

        const render = () => {
          if (!disposed) renderer.render(scene, camera);
        };

        const resize = () => {
          const width = Math.max(1, host.clientWidth);
          const height = Math.max(1, host.clientHeight);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          render();
        };

        fitCamera();

        const observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();

        let dragging = false;
        let previousX = 0;
        let previousY = 0;

        const pointerDown = (event: PointerEvent) => {
          dragging = true;
          previousX = event.clientX;
          previousY = event.clientY;
          renderer.domElement.setPointerCapture?.(event.pointerId);
        };

        const pointerMove = (event: PointerEvent) => {
          if (!dragging) return;

          const dx = event.clientX - previousX;
          const dy = event.clientY - previousY;
          previousX = event.clientX;
          previousY = event.clientY;

          group.rotation.z += dx * 0.008;
          group.rotation.x += dy * 0.008;
          render();
        };

        const pointerUp = () => {
          dragging = false;
        };

        const wheel = (event: WheelEvent) => {
          event.preventDefault();
          zoom = Math.max(
            0.45,
            Math.min(3.5, zoom * (event.deltaY > 0 ? 0.9 : 1.1))
          );
          fitCamera();
          render();
        };

        renderer.domElement.addEventListener("pointerdown", pointerDown);
        renderer.domElement.addEventListener("pointermove", pointerMove);
        renderer.domElement.addEventListener("pointerup", pointerUp);
        renderer.domElement.addEventListener("pointercancel", pointerUp);
        renderer.domElement.addEventListener("wheel", wheel, { passive: false });

        setCadMessage("");
        render();

        cleanup = () => {
          observer.disconnect();

          renderer.domElement.removeEventListener("pointerdown", pointerDown);
          renderer.domElement.removeEventListener("pointermove", pointerMove);
          renderer.domElement.removeEventListener("pointerup", pointerUp);
          renderer.domElement.removeEventListener("pointercancel", pointerUp);
          renderer.domElement.removeEventListener("wheel", wheel);

          group.traverse((child: any) => {
            child.geometry?.dispose?.();

            if (Array.isArray(child.material)) {
              child.material.forEach((material: any) => material?.dispose?.());
            } else {
              child.material?.dispose?.();
            }
          });

          renderer.dispose();

          if (renderer.domElement.parentElement === host) {
            host.removeChild(renderer.domElement);
          }
        };
      } catch (error) {
        setCadMessage(
          error instanceof Error
            ? error.message
            : "Could not render this STEP model."
        );
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [file, kernelCad]);

  return (
    <div className="dfm-model-shell dfm-model-shell-compact">
      {!file && (
        <div className="dfm-model-message">
          No 3D CAD source for this DFM report.
        </div>
      )}

      {file && kernelCad && (
        <div ref={cadHostRef} className="dfm-cad-canvas">
          {cadMessage && (
            <div className="dfm-model-message">{cadMessage}</div>
          )}
        </div>
      )}

      {file && isGlb && modelViewerReady && createElement(
        "model-viewer",
        {
          src: url,
          "camera-controls": "",
          "shadow-intensity": "1",
          "environment-image": "neutral",
          style: {
            width: "100%",
            height: "100%",
            background: "#f5f8fb"
          }
        }
      )}

      {file && isGlb && !modelViewerReady && (
        <div className="dfm-model-message">Loading 3D viewer…</div>
      )}

      {file && !kernelCad && !isGlb && (
        <div className="dfm-model-message">
          <b>{file.name}</b>
          <span>
            Interactive DFM preview is enabled for STEP/STP/IGES and GLB/GLTF.
            This source remains an independent quotation item.
          </span>
        </div>
      )}

      {issueCount > 0 && (
        <div className="dfm-model-issue-count">
          {issueCount} review
        </div>
      )}
    </div>
  );
}
