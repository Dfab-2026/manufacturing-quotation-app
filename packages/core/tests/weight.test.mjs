import assert from "node:assert/strict";
import test from "node:test";
import { calculateWeight, chooseWeight } from "../dist/weight.js";

test("calculates SS304 plate weight", () => {
  const result = calculateWeight(
    { shape: "plate", lengthMm: 1000, widthMm: 500, thicknessMm: 5 },
    7930
  );
  assert.equal(result.netKg, 19.825);
});

test("drawing weight has priority over geometry", () => {
  const result = chooseWeight({
    drawingWeightKg: 12.4,
    geometry: { shape: "plate", lengthMm: 1000, widthMm: 500, thicknessMm: 5 },
    densityKgPerM3: 7930,
    scrapPercent: 10
  });
  assert.equal(result.source, "drawing");
  assert.equal(result.netKg, 12.4);
  assert.equal(result.rawKg, 13.64);
});
