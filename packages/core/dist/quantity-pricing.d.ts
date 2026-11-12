import type { CostLine } from "./types.js";
export type QuantityBreak = {
    quantity: number;
    unitPrice: number;
    totalPrice: number;
};
export declare function calculateQuantityBreaks(input: {
    variableLines: CostLine[];
    setupLines: CostLine[];
    quantities: number[];
    overheadPercent: number;
    marginPercent: number;
}): QuantityBreak[];
