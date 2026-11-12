import type { CostLine, QuoteTotals } from "./types.js";

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function lineCost(line: CostLine): number {
  if (line.quantity < 0 || line.rate < 0) throw new Error("Quantity and rate cannot be negative");
  const waste = line.wastePercent ?? 0;
  if (waste < 0 || waste > 100) throw new Error("Waste must be between 0 and 100");
  return money(line.quantity * line.rate * (1 + waste / 100));
}

export function calculateQuoteTotals(input: {
  lines: CostLine[];
  overheadPercent: number;
  marginPercent: number;
  quantity: number;
}): QuoteTotals {
  const { lines, overheadPercent, marginPercent, quantity } = input;
  if (quantity <= 0) throw new Error("Quote quantity must be greater than zero");
  if (overheadPercent < 0 || marginPercent < 0 || marginPercent >= 100) {
    throw new Error("Invalid overhead or margin percent");
  }

  const directCost = money(lines.reduce((sum, line) => sum + lineCost(line), 0));
  const overhead = money(directCost * overheadPercent / 100);
  const manufacturingCost = money(directCost + overhead);
  const sellingPrice = money(manufacturingCost / (1 - marginPercent / 100));
  const margin = money(sellingPrice - manufacturingCost);

  return {
    directCost,
    overhead,
    manufacturingCost,
    margin,
    sellingPrice,
    unitPrice: money(sellingPrice / quantity)
  };
}
