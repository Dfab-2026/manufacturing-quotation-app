import { calculateQuoteTotals } from "./pricing.js";
export function calculateQuantityBreaks(input) {
    const unique = [...new Set(input.quantities.map(Number))].filter(q => Number.isFinite(q) && q > 0).sort((a, b) => a - b);
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
