import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuantityBreaks } from "../dist/quantity-pricing.js";

test("setup cost is diluted over larger quantities", () => {
  const result = calculateQuantityBreaks({
    setupLines:[{description:"setup",quantity:1,rate:1000,wastePercent:0}],
    variableLines:[{description:"part",quantity:1,rate:100,wastePercent:0}],
    quantities:[1,10,100], overheadPercent:0, marginPercent:0
  });
  assert.deepEqual(result.map(x=>x.unitPrice), [1100,200,110]);
});
