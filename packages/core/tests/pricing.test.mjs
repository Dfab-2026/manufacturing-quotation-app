import assert from "node:assert/strict";
import test from "node:test";
import { calculateQuoteTotals } from "../dist/pricing.js";

test("computes deterministic quote totals", () => {
  const totals = calculateQuoteTotals({
    quantity: 10,
    overheadPercent: 10,
    marginPercent: 20,
    lines: [
      {
        id: "1",
        category: "material",
        description: "SS304",
        quantity: 10,
        basis: "kg",
        rate: 200
      }
    ]
  });
  assert.equal(totals.directCost, 2000);
  assert.equal(totals.manufacturingCost, 2200);
  assert.equal(totals.sellingPrice, 2750);
  assert.equal(totals.unitPrice, 275);
});
