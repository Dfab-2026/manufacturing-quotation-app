export type SourceKind = "drawing" | "cad" | "calculated" | "inferred" | "manual";
export interface SourcedValue<T> {
    value: T;
    source: SourceKind;
    confidence: number;
    evidence?: string;
}
export type MaterialShape = "plate" | "solid_round" | "pipe" | "rect_tube" | "custom";
export interface MaterialDensity {
    code: string;
    kgPerM3: number;
}
export interface PlateGeometry {
    shape: "plate";
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
    removedVolumeMm3?: number;
}
export interface SolidRoundGeometry {
    shape: "solid_round";
    diameterMm: number;
    lengthMm: number;
}
export interface PipeGeometry {
    shape: "pipe";
    outerDiameterMm: number;
    wallThicknessMm: number;
    lengthMm: number;
}
export interface RectTubeGeometry {
    shape: "rect_tube";
    widthMm: number;
    heightMm: number;
    wallThicknessMm: number;
    lengthMm: number;
}
export type Geometry = PlateGeometry | SolidRoundGeometry | PipeGeometry | RectTubeGeometry;
export interface WeightResult {
    netKg: number;
    rawKg: number;
    scrapKg: number;
    source: SourceKind;
    formula: string;
}
export type RateBasis = "kg" | "minute" | "hour" | "mm" | "meter" | "bend" | "piece" | "sqm" | "lot";
export interface CostLine {
    id: string;
    category: "material" | "process" | "labor" | "consumable" | "subcontract" | "inspection" | "packing" | "other";
    description: string;
    quantity: number;
    basis: RateBasis;
    rate: number;
    wastePercent?: number;
}
export interface QuoteTotals {
    directCost: number;
    overhead: number;
    manufacturingCost: number;
    margin: number;
    sellingPrice: number;
    unitPrice: number;
}
