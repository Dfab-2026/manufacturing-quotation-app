import type { Geometry, WeightResult } from "./types.js";
export declare function calculateWeight(geometry: Geometry, densityKgPerM3: number, scrapPercent?: number): WeightResult;
export declare function chooseWeight(input: {
    drawingWeightKg?: number | null;
    cadVolumeMm3?: number | null;
    geometry?: Geometry | null;
    densityKgPerM3: number;
    scrapPercent?: number;
}): WeightResult;
