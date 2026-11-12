import type { CostLine, QuoteTotals } from "./types.js";
export declare function lineCost(line: CostLine): number;
export declare function calculateQuoteTotals(input: {
    lines: CostLine[];
    overheadPercent: number;
    marginPercent: number;
    quantity: number;
}): QuoteTotals;
