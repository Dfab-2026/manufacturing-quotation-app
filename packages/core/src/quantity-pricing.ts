import { calculateQuoteTotals } from "./pricing.js";
import type { CostLine } from "./types.js";

export type QuantityBreak = { quantity: number; unitPrice: number; totalPrice: number };

export function calculateQuantityBreaks(input: {
  variableLines: CostLine[];
  setupLines: CostLine[];
  quantities: number[];
  overheadPercent: number;
  marginPercent: number;
}): QuantityBreak[] {
  const unique = [...new Set(input.quantities.map(Number))].filter(q => Number.isFinite(q) && q > 0).sort((a,b)=>a-b);
  return unique.map(quantity => {
    const variable = input.variableLines.map(line => ({ ...line, quantity: line.quantity * quantity }));
    const totals = calculateQuoteTotals({
      lines: [...input.setupLines, ...variable],
      overheadPercent: input.overheadPercent,
      marginPercent: input.marginPercent,
      quantity
    });
    return { quantity, unitPrice: totals.unitPrice, totalPrice: totals.sellingPrice };
  });
}
