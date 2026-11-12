import type { MaterialDensity } from "./types.js";
export declare const MATERIAL_DENSITIES: Record<string, MaterialDensity>;
export declare function getDensity(code: string): MaterialDensity | null;
