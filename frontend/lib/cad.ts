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
  shape_hint?: "plate_like" | "rotational_like" | "prismatic_like" | "unknown";
  step_metadata?: {
    schema?: string;
    product_names?: string[];
    material_text?: string;
    entity_counts?: Record<string, number>;
    cylindrical_diameters_mm?: number[];
    cylindrical_diameter_counts?: Record<string, number>;
    circle_diameters_mm?: number[];
    circle_diameter_counts?: Record<string, number>;
    torus_radii_mm?: Array<{ major_radius_mm: number; minor_radius_mm: number }>;
    conical_surfaces?: Array<{ radius_mm: number; semi_angle_deg: number }>;
    geometry_dimensions?: Array<{
      label: string;
      value_mm: number;
      quantity?: number;
      kind?: string;
      confidence?: number;
      review_required?: boolean;
      basis?: string;
    }>;
    thread_labels?: string[];
    datum_labels?: string[];
    tolerance_labels?: string[];
    surface_finish_labels?: string[];
    geometric_tolerance_types?: string[];
    pmi_entity_counts?: Record<string, number>;
  };
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

const OCCT_JS = "/vendor/occt/occt-import-js.js";
const OCCT_WASM = "/vendor/occt/occt-import-js.wasm";
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

let occtDirectPromise: Promise<{
  ReadStepFile: (data: Uint8Array, params?: Record<string, unknown> | null) => OcctResult;
  ReadIgesFile: (data: Uint8Array, params?: Record<string, unknown> | null) => OcctResult;
}> | null = null;

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
    // Blob workers do not reliably resolve root-relative importScripts() URLs.
    // Convert the locally bundled CAD runtime to same-origin absolute URLs first.
    const localJsUrl = new URL(OCCT_JS, window.location.origin).href;
    const localWasmUrl = new URL(OCCT_WASM, window.location.origin).href;

    const workerSource = `
      let occtInstance = null;

      async function ensureOcct() {
        if (occtInstance) return occtInstance;

        try {
          importScripts("${localJsUrl}");
          occtInstance = await self.occtimportjs({
            locateFile(filename) {
              if (filename.endsWith(".wasm")) return "${localWasmUrl}";
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

async function getDirectOcct() {
  if (occtDirectPromise) return occtDirectPromise;

  occtDirectPromise = (async () => {
    const localJsUrl = new URL(OCCT_JS, window.location.origin).href;
    const localWasmUrl = new URL(OCCT_WASM, window.location.origin).href;

    try {
      await loadScript("dfab-occt-js", localJsUrl);
    } catch {
      await loadScript("dfab-occt-js-fallback", OCCT_JS_FALLBACK);
    }

    if (!window.occtimportjs) {
      throw new Error("OpenCascade STEP runtime did not initialize.");
    }

    try {
      return await window.occtimportjs({
        locateFile(filename) {
          return String(filename).endsWith(".wasm") ? localWasmUrl : filename;
        }
      });
    } catch {
      return window.occtimportjs({
        locateFile(filename) {
          return String(filename).endsWith(".wasm") ? OCCT_WASM_FALLBACK : filename;
        }
      });
    }
  })();

  return occtDirectPromise;
}

async function readCadMeshDirect(file: File): Promise<OcctResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const occt = await getDirectOcct();
  const data = new Uint8Array(await file.arrayBuffer());
  const params = {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.01,
    angularDeflection: 0.5
  };

  const result = extension === "iges" || extension === "igs"
    ? occt.ReadIgesFile(data, params)
    : occt.ReadStepFile(data, params);

  if (!result?.success || !Array.isArray(result.meshes) || result.meshes.length === 0) {
    throw new Error("OpenCascade could not triangulate this STEP/IGES model.");
  }

  return result;
}

export async function preloadCadRuntime() {
  try {
    await Promise.allSettled([getOcctWorker(), getDirectOcct()]);
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

    try {
      const worker = await getOcctWorker();
      const buffer = await file.arrayBuffer();
      const id = ++workerRequestId;

      return await withTimeout(
        new Promise<OcctResult>((resolve, reject) => {
          workerPending.set(id, { resolve, reject });
          worker.postMessage({ id, extension, buffer }, [buffer]);
        }),
        20000
      );
    } catch (workerError) {
      try {
        return await withTimeout(readCadMeshDirect(file), 30000);
      } catch (directError) {
        const workerMessage = workerError instanceof Error ? workerError.message : String(workerError);
        const directMessage = directError instanceof Error ? directError.message : String(directError);
        throw new Error(`STEP viewer failed: ${directMessage}. Worker fallback: ${workerMessage}`);
      }
    }
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


function shapeHintFromDimensions(dimensions: { x: number; y: number; z: number }) {
  const values = [dimensions.x, dimensions.y, dimensions.z]
    .map((value) => Math.max(0, Number(value || 0)))
    .sort((a, b) => a - b);

  const [small, middle, large] = values;
  if (!large || !middle) return "unknown" as const;

  if (small / large <= 0.12 && middle / large >= 0.30) {
    return "plate_like" as const;
  }

  const roundSection = Math.abs(small - middle) / Math.max(middle, 1) <= 0.18;
  if (roundSection && large / Math.max(middle, 1) >= 1.35) {
    return "rotational_like" as const;
  }

  return "prismatic_like" as const;
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
  const dimensions = finite
    ? { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
    : { x: 0, y: 0, z: 0 };

  return {
    filename: file.name,
    file_hash: hash,
    format,
    parser_status: "parsed",
    root_name: file.name.replace(/\.[^.]+$/, ""),
    part_count: 1,
    mesh_count: triangles.length ? 1 : 0,
    triangle_count: triangles.length,
    dimensions_mm: dimensions,
    surface_area_mm2: surfaceArea,
    volume_mm3: Math.abs(signedVolume),
    component_names: [],
    shape_hint: shapeHintFromDimensions(dimensions)
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


function decodeStepText(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buffer));
  } catch {
    return "";
  }
}

function uniqueStrings(values: string[], limit = 100) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).slice(0, limit);
}

function extractStepMetadata(text: string): CadGeometrySummary["step_metadata"] {
  if (!text) return undefined;

  const schema = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] || "";
  const productNames = uniqueStrings(
    Array.from(text.matchAll(/\bPRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'/gi))
      .flatMap((m) => [m[1] || "", m[2] || ""])
      .filter((value) => value && value.toUpperCase() !== "NONE")
  );

  const explicitMaterials = uniqueStrings([
    ...Array.from(text.matchAll(/\bMATERIAL_DESIGNATION\s*\(\s*'([^']+)'/gi)).map((m) => m[1]),
    ...Array.from(text.matchAll(/\bMATERIAL_PROPERTY\s*\(\s*'([^']+)'/gi)).map((m) => m[1]),
  ]);

  const upper = text.toUpperCase();
  const materialPatterns: Array<[RegExp, string]> = [
    [/\b(?:AISI|SUS|SS)[\s_-]*(304L|316L|304|316|321|430|201|202)\b/i, "Stainless Steel $1"],
    [/\b(304L|316L|304|316|321|430|201|202)\s*SS\b/i, "Stainless Steel $1"],
    [/\b(?:EN\s*)?1\.(4301|4307|4401|4404)\b/i, "Stainless Steel EN 1.$1"],
    [/\b(?:IS\s*2062\s*)?(E250|E350)\b/i, "Mild Steel $1"],
    [/\b(?:AL|ALUMINIUM|ALUMINUM)[\s_-]*(5052(?:-H32)?|6061(?:-T6)?|6082(?:-T6)?)\b/i, "Aluminium $1"],
  ];
  let inferredMaterial = "";
  for (const [pattern, label] of materialPatterns) {
    const match = upper.match(pattern);
    if (match) {
      inferredMaterial = label.replace("$1", match[1]);
      break;
    }
  }

  const countEntity = (name: string) =>
    (text.match(new RegExp(`\\b${name}\\s*\\(`, "gi")) || []).length;

  const entityCounts: Record<string, number> = {
    advanced_faces: countEntity("ADVANCED_FACE"),
    cylindrical_surfaces: countEntity("CYLINDRICAL_SURFACE"),
    conical_surfaces: countEntity("CONICAL_SURFACE"),
    toroidal_surfaces: countEntity("TOROIDAL_SURFACE"),
    planes: countEntity("PLANE"),
    circles: countEntity("CIRCLE"),
    b_spline_surfaces: countEntity("B_SPLINE_SURFACE_WITH_KNOTS"),
  };

  const cylindricalDiameters = Array.from(
    text.matchAll(/\bCYLINDRICAL_SURFACE\s*\([^,]*,[^,]*,\s*([-+0-9.Ee]+)\s*\)/gi)
  )
    .map((m) => Number(m[1]) * 2)
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Number(v.toFixed(4)));

  const cylindricalDiameterCounts: Record<string, number> = {};
  for (const diameter of cylindricalDiameters) {
    const key = diameter.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    cylindricalDiameterCounts[key] = (cylindricalDiameterCounts[key] || 0) + 1;
  }

  // Analytic STEP entities carry exact radii independent of the triangulated
  // preview mesh. Preserve those source-backed dimensions so the engineering
  // review can show more than only the X/Y/Z envelope.
  const circleDiameters = Array.from(
    text.matchAll(/\bCIRCLE\s*\([^,]*,[^,]*,\s*([-+0-9.Ee]+)\s*\)/gi)
  )
    .map((m) => Number(m[1]) * 2)
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Number(v.toFixed(4)));

  const circleDiameterCounts: Record<string, number> = {};
  for (const diameter of circleDiameters) {
    const key = diameter.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    circleDiameterCounts[key] = (circleDiameterCounts[key] || 0) + 1;
  }

  const torusRadii = Array.from(
    text.matchAll(/\bTOROIDAL_SURFACE\s*\([^,]*,[^,]*,\s*([-+0-9.Ee]+)\s*,\s*([-+0-9.Ee]+)\s*\)/gi)
  )
    .map((m) => ({ major_radius_mm: Number(m[1]), minor_radius_mm: Number(m[2]) }))
    .filter((row) => Number.isFinite(row.major_radius_mm) && row.major_radius_mm > 0 && Number.isFinite(row.minor_radius_mm) && row.minor_radius_mm > 0)
    .map((row) => ({
      major_radius_mm: Number(row.major_radius_mm.toFixed(4)),
      minor_radius_mm: Number(row.minor_radius_mm.toFixed(4))
    }));

  const conicalSurfaces = Array.from(
    text.matchAll(/\bCONICAL_SURFACE\s*\([^,]*,[^,]*,\s*([-+0-9.Ee]+)\s*,\s*([-+0-9.Ee]+)\s*\)/gi)
  )
    .map((m) => ({
      radius_mm: Number(m[1]),
      semi_angle_deg: Number(m[2]) * 180 / Math.PI
    }))
    .filter((row) => Number.isFinite(row.radius_mm) && row.radius_mm >= 0 && Number.isFinite(row.semi_angle_deg))
    .map((row) => ({
      radius_mm: Number(row.radius_mm.toFixed(4)),
      semi_angle_deg: Number(row.semi_angle_deg.toFixed(4))
    }));

  type StepGeometryDimension = NonNullable<NonNullable<CadGeometrySummary["step_metadata"]>["geometry_dimensions"]>[number];
  const geometryDimensions: StepGeometryDimension[] = [];
  const pushUniqueGeometryDimension = (row: StepGeometryDimension) => {
    const existing = geometryDimensions.some((item) =>
      item.kind === row.kind && Math.abs(Number(item.value_mm) - Number(row.value_mm)) < 0.0001
    );
    if (!existing) geometryDimensions.push(row);
  };

  for (const diameter of Array.from(new Set(cylindricalDiameters)).slice(0, 40)) {
    const key = diameter.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    pushUniqueGeometryDimension({
      label: `Cylindrical Surface Ø${Number(diameter.toFixed(4))}`,
      value_mm: diameter,
      // STEP entity count is not physical hole quantity: one feature may be
      // split into several cylindrical faces by the CAD exporter.
      quantity: 1,
      kind: "cylindrical_diameter",
      confidence: 96,
      review_required: true,
      basis: "Exact radius stored in STEP CYLINDRICAL_SURFACE entity; classify as OD/bore/hole during review"
    });
  }

  for (const diameter of Array.from(new Set(circleDiameters)).slice(0, 40)) {
    const key = diameter.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    pushUniqueGeometryDimension({
      label: `Circular Edge Ø${Number(diameter.toFixed(4))}`,
      value_mm: diameter,
      // Circular edge count is topology, not feature quantity.
      quantity: 1,
      kind: "circle_diameter",
      confidence: 95,
      review_required: true,
      basis: "Exact radius stored in STEP CIRCLE entity; may be an edge, bore, boss or construction circle"
    });
  }

  for (const torus of torusRadii.slice(0, 20)) {
    pushUniqueGeometryDimension({
      label: "Torus / Bend Major Radius",
      value_mm: torus.major_radius_mm,
      quantity: 1,
      kind: "torus_major_radius",
      confidence: 96,
      review_required: true,
      basis: "Exact major radius stored in STEP TOROIDAL_SURFACE entity"
    });
    pushUniqueGeometryDimension({
      label: "Torus / Bend Minor Radius",
      value_mm: torus.minor_radius_mm,
      quantity: 1,
      kind: "torus_minor_radius",
      confidence: 96,
      review_required: true,
      basis: "Exact minor radius stored in STEP TOROIDAL_SURFACE entity"
    });
  }

  const threadLabels = uniqueStrings(
    Array.from(text.matchAll(/\b(M\d+(?:\.\d+)?(?:\s*[xX]\s*\d+(?:\.\d+)?)?)\b/g)).map((m) => m[1]),
    50
  );

  // AP242/PMI data varies by CAD exporter. Keep only information explicitly
  // present in the STEP text and mark it as review data rather than inventing it.
  const quotedStrings = Array.from(text.matchAll(/'([^']{1,160})'/g)).map((m) => m[1]);
  const datumLabels = uniqueStrings(
    quotedStrings.filter((value) => /^(?:DATUM\s*)?[A-Z]{1,3}$/i.test(value.trim())),
    30
  );
  const toleranceLabels = uniqueStrings(
    quotedStrings.filter((value) => /(?:±|\+\/\-|\bTOL(?:ERANCE)?\b|\bH[0-9]{1,2}\b|\bg[0-9]{1,2}\b)/i.test(value)),
    50
  );
  const surfaceFinishLabels = uniqueStrings(
    quotedStrings.filter((value) => /\b(?:RA|RZ|SURFACE\s*(?:FINISH|ROUGHNESS))\s*[:=]?\s*[0-9]+(?:\.[0-9]+)?/i.test(value)),
    30
  );

  const toleranceEntityNames = [
    "GEOMETRIC_TOLERANCE",
    "FLATNESS_TOLERANCE",
    "STRAIGHTNESS_TOLERANCE",
    "ROUNDNESS_TOLERANCE",
    "CYLINDRICITY_TOLERANCE",
    "PARALLELISM_TOLERANCE",
    "PERPENDICULARITY_TOLERANCE",
    "ANGULARITY_TOLERANCE",
    "POSITION_TOLERANCE",
    "CONCENTRICITY_TOLERANCE",
    "SYMMETRY_TOLERANCE",
    "CIRCULAR_RUNOUT_TOLERANCE",
    "TOTAL_RUNOUT_TOLERANCE",
    "PLUS_MINUS_TOLERANCE",
    "DATUM_FEATURE",
    "DATUM_REFERENCE"
  ];
  const pmiEntityCounts: Record<string, number> = {};
  const geometricToleranceTypes: string[] = [];
  for (const entityName of toleranceEntityNames) {
    const count = countEntity(entityName);
    if (count > 0) {
      pmiEntityCounts[entityName.toLowerCase()] = count;
      if (entityName.endsWith("_TOLERANCE")) {
        geometricToleranceTypes.push(entityName.replace(/_/g, " "));
      }
    }
  }

  return {
    schema,
    product_names: productNames,
    material_text: explicitMaterials[0] || inferredMaterial || "",
    entity_counts: entityCounts,
    cylindrical_diameters_mm: Array.from(new Set(cylindricalDiameters)).slice(0, 100),
    cylindrical_diameter_counts: cylindricalDiameterCounts,
    circle_diameters_mm: Array.from(new Set(circleDiameters)).slice(0, 100),
    circle_diameter_counts: circleDiameterCounts,
    torus_radii_mm: torusRadii.slice(0, 50),
    conical_surfaces: conicalSurfaces.slice(0, 50),
    geometry_dimensions: geometryDimensions.slice(0, 100),
    thread_labels: threadLabels,
    datum_labels: datumLabels,
    tolerance_labels: toleranceLabels,
    surface_finish_labels: surfaceFinishLabels,
    geometric_tolerance_types: uniqueStrings(geometricToleranceTypes, 30),
    pmi_entity_counts: pmiEntityCounts,
  };
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
    const stepMetadata = ["step", "stp"].includes(extension)
      ? extractStepMetadata(decodeStepText(await file.arrayBuffer()))
      : undefined;

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
      component_names: [],
      shape_hint: "unknown",
      step_metadata: stepMetadata
    };
  }

  let result: OcctResult;
  try {
    result = await withTimeout(readCadMesh(file), 32000);
  } catch {
    return {
      filename: file.name, file_hash: hash, format: extension.toUpperCase(), parser_status: "metadata_only" as const,
      root_name: file.name.replace(/\.[^.]+$/, ""), part_count: 1, mesh_count: 0, triangle_count: 0,
      dimensions_mm: { x: 0, y: 0, z: 0 }, surface_area_mm2: 0, volume_mm3: 0, component_names: [], shape_hint: "unknown",
      step_metadata: stepMetadata
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
  const dimensions = finite
    ? {
        x: Math.max(0, maxX - minX),
        y: Math.max(0, maxY - minY),
        z: Math.max(0, maxZ - minZ)
      }
    : { x: 0, y: 0, z: 0 };

  return {
    filename: file.name,
    file_hash: hash,
    format: extension.toUpperCase(),
    parser_status: "parsed" as const,
    root_name: String(result.root?.name || "").trim(),
    part_count: Math.max(1, hierarchy.partCount || meshes.length || 1),
    mesh_count: meshes.length,
    triangle_count: triangleCount,
    dimensions_mm: dimensions,
    surface_area_mm2: surfaceArea,
    volume_mm3: volume,
    component_names: hierarchy.names,
    shape_hint: shapeHintFromDimensions(dimensions),
    step_metadata: stepMetadata
    };
  })();

  cadSummaryCache.set(file, promise);
  return promise;
}
