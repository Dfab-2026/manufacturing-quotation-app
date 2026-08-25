"use client";

export type CadGeometrySummary = {
  filename: string;
  file_hash: string;
  format: string;
  parser_status: "parsed" | "metadata_only";
  root_name: string;
  part_count: number;
  mesh_count: number;
  triangle_count: number;
  dimensions_mm: {
    x: number;
    y: number;
    z: number;
  };
  surface_area_mm2: number;
  volume_mm3: number;
  component_names: string[];
};

type OcctResult = {
  success?: boolean;
  root?: {
    name?: string;
    meshes?: number[];
    children?: unknown[];
  };
  meshes?: Array<{
    name?: string;
    attributes?: {
      position?: {
        array?: number[];
      };
      normal?: {
        array?: number[];
      };
    };
    index?: {
      array?: number[];
    };
    color?: number[];
    brep_faces?: unknown[];
  }>;
};

declare global {
  interface Window {
    occtimportjs?: (options?: Record<string, unknown>) => Promise<{
      ReadStepFile: (data: Uint8Array, params?: Record<string, unknown> | null) => OcctResult;
      ReadIgesFile: (data: Uint8Array, params?: Record<string, unknown> | null) => OcctResult;
    }>;
    THREE?: any;
  }
}

const OCCT_JS =
  "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js";
const OCCT_WASM =
  "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.wasm";
const OCCT_JS_FALLBACK =
  "https://unpkg.com/occt-import-js@0.0.23/dist/occt-import-js.js";
const OCCT_WASM_FALLBACK =
  "https://unpkg.com/occt-import-js@0.0.23/dist/occt-import-js.wasm";
const THREE_JS =
  "https://cdn.jsdelivr.net/npm/three@0.138.3/build/three.min.js";

const scriptPromises = new Map<string, Promise<void>>();
let occtWorkerPromise: Promise<Worker> | null = null;
let workerRequestId = 0;
const workerPending = new Map<
  number,
  {
    resolve: (value: OcctResult) => void;
    reject: (error: Error) => void;
  }
>();

function loadScript(id: string, src: string) {
  const existingPromise = scriptPromises.get(id);
  if (existingPromise) return existingPromise;

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;

    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Could not load ${src}`)),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;

    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });

    script.addEventListener("error", () => {
      reject(new Error(`Could not load ${src}`));
    });

    document.head.appendChild(script);
  });

  scriptPromises.set(id, promise);
  return promise;
}

async function getOcctWorker(): Promise<Worker> {
  if (occtWorkerPromise) return occtWorkerPromise;

  occtWorkerPromise = Promise.resolve().then(() => {
    const workerSource = `
      let occtInstance = null;

      async function ensureOcct() {
        if (occtInstance) return occtInstance;

        try {
          importScripts("${OCCT_JS}");
          occtInstance = await self.occtimportjs({
            locateFile(filename) {
              if (filename.endsWith(".wasm")) return "${OCCT_WASM}";
              return filename;
            }
          });
          return occtInstance;
        } catch (firstError) {
          importScripts("${OCCT_JS_FALLBACK}");
          occtInstance = await self.occtimportjs({
            locateFile(filename) {
              if (filename.endsWith(".wasm")) return "${OCCT_WASM_FALLBACK}";
              return filename;
            }
          });
          return occtInstance;
        }
      }

      self.onmessage = async (event) => {
        const { id, extension, buffer } = event.data;

        try {
          const occt = await ensureOcct();
          const data = new Uint8Array(buffer);
          const params = {
            linearUnit: "millimeter",
            linearDeflectionType: "bounding_box_ratio",
            linearDeflection: 0.015,
            angularDeflection: 0.65
          };

          const result =
            extension === "iges" || extension === "igs"
              ? occt.ReadIgesFile(data, params)
              : occt.ReadStepFile(data, params);

          if (!result?.success || !Array.isArray(result.meshes)) {
            throw new Error("CAD parser could not triangulate this model.");
          }

          self.postMessage({ id, ok: true, result });
        } catch (error) {
          self.postMessage({
            id,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      };
    `;

    const blob = new Blob([workerSource], { type: "text/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {};
      const pending = workerPending.get(id);

      if (!pending) return;

      workerPending.delete(id);

      if (ok) pending.resolve(result as OcctResult);
      else pending.reject(new Error(error || "CAD worker failed."));
    };

    worker.onerror = (event) => {
      const error = new Error(event.message || "CAD worker failed.");

      for (const pending of workerPending.values()) {
        pending.reject(error);
      }

      workerPending.clear();
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      occtWorkerPromise = null;
    };

    return worker;
  });

  return occtWorkerPromise;
}

export async function preloadCadRuntime() {
  try {
    await getOcctWorker();
  } catch {
    // Best effort only.
  }
}

export async function ensureThreeForCadViewer() {
  await loadScript("dfab-three-js", THREE_JS);

  if (!window.THREE) {
    throw new Error("Three.js did not initialize.");
  }

  return window.THREE;
}

const cadResultCache = new WeakMap<File, Promise<OcctResult>>();
const cadSummaryCache = new WeakMap<File, Promise<CadGeometrySummary>>();

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("CAD parser timed out.")), milliseconds);
    promise.then(v => { window.clearTimeout(timer); resolve(v); }, e => { window.clearTimeout(timer); reject(e); });
  });
}


export function isKernelCadFormat(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return ["step", "stp", "iges", "igs", "stl", "obj"].includes(extension);
}

export function isVisualCadFormat(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return [
    "step",
    "stp",
    "iges",
    "igs",
    "glb",
    "gltf",
    "stl",
    "obj",
    "x_t",
    "x_b"
  ].includes(extension);
}

export async function readCadMesh(file: File): Promise<OcctResult> {
  const cached = cadResultCache.get(file);
  if (cached) return cached;

  const promise = (async () => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";

    if (!["step", "stp", "iges", "igs"].includes(extension)) {
      throw new Error(
        `${extension.toUpperCase() || "CAD"} geometry extraction is not available in the STEP/IGES worker.`
      );
    }

    const worker = await getOcctWorker();
    const buffer = await file.arrayBuffer();
    const id = ++workerRequestId;

    return withTimeout(
      new Promise<OcctResult>((resolve, reject) => {
        workerPending.set(id, { resolve, reject });
        worker.postMessage({ id, extension, buffer }, [buffer]);
      }),
      9000
    );
  })();

  cadResultCache.set(file, promise);
  return promise;
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer()
  );

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function nodeNames(root: OcctResult["root"]) {
  const names: string[] = [];
  let partCount = 0;

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node.meshes) && node.meshes.length > 0) {
      partCount += 1;

      const name = String(node.name || "").trim();
      if (name) names.push(name);
    }

    for (const child of node.children || []) {
      walk(child);
    }
  };

  walk(root);

  return {
    partCount,
    names: Array.from(new Set(names)).slice(0, 100)
  };
}


function geometrySummaryFromTriangles(
  file: File,
  hash: string,
  format: string,
  triangles: Array<number[]>
): CadGeometrySummary {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let surfaceArea = 0;
  let signedVolume = 0;

  for (const tri of triangles) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tri;

    minX = Math.min(minX, ax, bx, cx);
    minY = Math.min(minY, ay, by, cy);
    minZ = Math.min(minZ, az, bz, cz);
    maxX = Math.max(maxX, ax, bx, cx);
    maxY = Math.max(maxY, ay, by, cy);
    maxZ = Math.max(maxZ, az, bz, cz);

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    surfaceArea += 0.5 * Math.hypot(crossX, crossY, crossZ);

    signedVolume += (
      ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx)
    ) / 6;
  }

  const finite = [minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite);

  return {
    filename: file.name,
    file_hash: hash,
    format,
    parser_status: "parsed",
    root_name: file.name.replace(/\.[^.]+$/, ""),
    part_count: 1,
    mesh_count: triangles.length ? 1 : 0,
    triangle_count: triangles.length,
    dimensions_mm: finite
      ? { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
      : { x: 0, y: 0, z: 0 },
    surface_area_mm2: surfaceArea,
    volume_mm3: Math.abs(signedVolume),
    component_names: []
  };
}

async function inspectStlFile(
  file: File,
  hash: string
): Promise<CadGeometrySummary> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const triangles: Array<number[]> = [];

  const binaryTriangleCount =
    buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const binaryExpectedSize = 84 + binaryTriangleCount * 50;
  const isBinary =
    binaryTriangleCount > 0 && binaryExpectedSize === buffer.byteLength;

  if (isBinary) {
    let offset = 84;

    for (let i = 0; i < binaryTriangleCount; i += 1) {
      offset += 12; // normal
      const values: number[] = [];

      for (let vertex = 0; vertex < 3; vertex += 1) {
        values.push(
          view.getFloat32(offset, true),
          view.getFloat32(offset + 4, true),
          view.getFloat32(offset + 8, true)
        );
        offset += 12;
      }

      triangles.push(values);
      offset += 2;
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    const vertices = Array.from(
      text.matchAll(
        /^\s*vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/gm
      )
    ).map((match) => [
      Number(match[1]),
      Number(match[2]),
      Number(match[3])
    ]);

    for (let i = 0; i + 2 < vertices.length; i += 3) {
      triangles.push([
        ...vertices[i],
        ...vertices[i + 1],
        ...vertices[i + 2]
      ]);
    }
  }

  return geometrySummaryFromTriangles(file, hash, "STL", triangles);
}

async function inspectObjFile(
  file: File,
  hash: string
): Promise<CadGeometrySummary> {
  const text = await file.text();
  const vertices: number[][] = [];
  const triangles: Array<number[]> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/).slice(1, 4).map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        vertices.push(parts);
      }
    } else if (line.startsWith("f ")) {
      const indices = line
        .split(/\s+/)
        .slice(1)
        .map((token) => Number(token.split("/")[0]))
        .map((value) => value < 0 ? vertices.length + value : value - 1)
        .filter((value) => value >= 0 && value < vertices.length);

      for (let i = 1; i + 1 < indices.length; i += 1) {
        const a = vertices[indices[0]];
        const b = vertices[indices[i]];
        const c = vertices[indices[i + 1]];
        triangles.push([...a, ...b, ...c]);
      }
    }
  }

  return geometrySummaryFromTriangles(file, hash, "OBJ", triangles);
}

export async function inspectCadFile(
  file: File
): Promise<CadGeometrySummary> {
  const cached = cadSummaryCache.get(file);
  if (cached) return cached;

  const promise: Promise<CadGeometrySummary> = (
    async (): Promise<CadGeometrySummary> => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const hash = await sha256Hex(file);

    if (extension === "stl") {
      return inspectStlFile(file, hash);
    }

    if (extension === "obj") {
      return inspectObjFile(file, hash);
    }

    if (!isKernelCadFormat(file)) {
    return {
      filename: file.name,
      file_hash: hash,
      format: extension.toUpperCase() || "CAD",
      parser_status: "metadata_only" as const,
      root_name: file.name.replace(/\.[^.]+$/, ""),
      part_count: 1,
      mesh_count: 0,
      triangle_count: 0,
      dimensions_mm: { x: 0, y: 0, z: 0 },
      surface_area_mm2: 0,
      volume_mm3: 0,
      component_names: []
    };
  }

  let result: OcctResult;
  try {
    result = await withTimeout(readCadMesh(file), 6500);
  } catch {
    return {
      filename: file.name, file_hash: hash, format: extension.toUpperCase(), parser_status: "metadata_only" as const,
      root_name: file.name.replace(/\.[^.]+$/, ""), part_count: 1, mesh_count: 0, triangle_count: 0,
      dimensions_mm: { x: 0, y: 0, z: 0 }, surface_area_mm2: 0, volume_mm3: 0, component_names: []
    };
  }
  const meshes = result.meshes || [];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let surfaceArea = 0;
  let volume = 0;
  let triangleCount = 0;

  for (const mesh of meshes) {
    const positions = mesh.attributes?.position?.array || [];
    const indices = mesh.index?.array || [];

    for (let i = 0; i < positions.length; i += 3) {
      const x = Number(positions[i] || 0);
      const y = Number(positions[i + 1] || 0);
      const z = Number(positions[i + 2] || 0);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }

    let meshSignedVolume = 0;

    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = Number(indices[i]) * 3;
      const ib = Number(indices[i + 1]) * 3;
      const ic = Number(indices[i + 2]) * 3;

      const ax = Number(positions[ia] || 0);
      const ay = Number(positions[ia + 1] || 0);
      const az = Number(positions[ia + 2] || 0);

      const bx = Number(positions[ib] || 0);
      const by = Number(positions[ib + 1] || 0);
      const bz = Number(positions[ib + 2] || 0);

      const cx = Number(positions[ic] || 0);
      const cy = Number(positions[ic + 1] || 0);
      const cz = Number(positions[ic + 2] || 0);

      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = cy - ay;
      const acz = cz - az;

      const crossX = aby * acz - abz * acy;
      const crossY = abz * acx - abx * acz;
      const crossZ = abx * acy - aby * acx;

      surfaceArea += 0.5 * Math.hypot(crossX, crossY, crossZ);

      meshSignedVolume += (
        ax * (by * cz - bz * cy)
        - ay * (bx * cz - bz * cx)
        + az * (bx * cy - by * cx)
      ) / 6;

      triangleCount += 1;
    }

    volume += Math.abs(meshSignedVolume);
  }

  const finite = [minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite);
  const hierarchy = nodeNames(result.root);

  return {
    filename: file.name,
    file_hash: hash,
    format: extension.toUpperCase(),
    parser_status: "parsed" as const,
    root_name: String(result.root?.name || "").trim(),
    part_count: Math.max(1, hierarchy.partCount || meshes.length || 1),
    mesh_count: meshes.length,
    triangle_count: triangleCount,
    dimensions_mm: finite
      ? {
          x: Math.max(0, maxX - minX),
          y: Math.max(0, maxY - minY),
          z: Math.max(0, maxZ - minZ)
        }
      : { x: 0, y: 0, z: 0 },
    surface_area_mm2: surfaceArea,
    volume_mm3: volume,
      component_names: hierarchy.names
    };
  })();

  cadSummaryCache.set(file, promise);
  return promise;
}
