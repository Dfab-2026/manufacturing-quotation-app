const MM3_PER_M3 = 1_000_000_000;
function assertFinitePositive(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be greater than zero`);
    }
}
function volumeMm3(geometry) {
    switch (geometry.shape) {
        case "plate": {
            assertFinitePositive(geometry.lengthMm, "lengthMm");
            assertFinitePositive(geometry.widthMm, "widthMm");
            assertFinitePositive(geometry.thicknessMm, "thicknessMm");
            const gross = geometry.lengthMm * geometry.widthMm * geometry.thicknessMm;
            const removed = Math.max(0, geometry.removedVolumeMm3 ?? 0);
            if (removed >= gross)
                throw new Error("removed volume must be below gross volume");
            return gross - removed;
        }
        case "solid_round": {
            assertFinitePositive(geometry.diameterMm, "diameterMm");
            assertFinitePositive(geometry.lengthMm, "lengthMm");
            const radius = geometry.diameterMm / 2;
            return Math.PI * radius * radius * geometry.lengthMm;
        }
        case "pipe": {
            assertFinitePositive(geometry.outerDiameterMm, "outerDiameterMm");
            assertFinitePositive(geometry.wallThicknessMm, "wallThicknessMm");
            assertFinitePositive(geometry.lengthMm, "lengthMm");
            const outerR = geometry.outerDiameterMm / 2;
            const innerR = outerR - geometry.wallThicknessMm;
            if (innerR <= 0)
                throw new Error("wall thickness is invalid for pipe diameter");
            return Math.PI * (outerR ** 2 - innerR ** 2) * geometry.lengthMm;
        }
        case "rect_tube": {
            const { widthMm, heightMm, wallThicknessMm, lengthMm } = geometry;
            [widthMm, heightMm, wallThicknessMm, lengthMm].forEach((value, index) => assertFinitePositive(value, ["widthMm", "heightMm", "wallThicknessMm", "lengthMm"][index] ?? "dimension"));
            const innerW = widthMm - 2 * wallThicknessMm;
            const innerH = heightMm - 2 * wallThicknessMm;
            if (innerW <= 0 || innerH <= 0)
                throw new Error("wall thickness is invalid for tube size");
            return (widthMm * heightMm - innerW * innerH) * lengthMm;
        }
    }
}
export function calculateWeight(geometry, densityKgPerM3, scrapPercent = 0) {
    assertFinitePositive(densityKgPerM3, "densityKgPerM3");
    if (!Number.isFinite(scrapPercent) || scrapPercent < 0 || scrapPercent > 100) {
        throw new Error("scrapPercent must be between 0 and 100");
    }
    const netKg = (volumeMm3(geometry) / MM3_PER_M3) * densityKgPerM3;
    const rawKg = netKg * (1 + scrapPercent / 100);
    return {
        netKg: round(netKg),
        rawKg: round(rawKg),
        scrapKg: round(rawKg - netKg),
        source: "calculated",
        formula: `${geometry.shape}: volume × density, scrap ${scrapPercent}%`
    };
}
export function chooseWeight(input) {
    const scrap = input.scrapPercent ?? 0;
    if (input.drawingWeightKg && input.drawingWeightKg > 0) {
        const raw = input.drawingWeightKg * (1 + scrap / 100);
        return {
            netKg: round(input.drawingWeightKg),
            rawKg: round(raw),
            scrapKg: round(raw - input.drawingWeightKg),
            source: "drawing",
            formula: `drawing stated weight, scrap ${scrap}%`
        };
    }
    if (input.cadVolumeMm3 && input.cadVolumeMm3 > 0) {
        const net = (input.cadVolumeMm3 / MM3_PER_M3) * input.densityKgPerM3;
        const raw = net * (1 + scrap / 100);
        return {
            netKg: round(net),
            rawKg: round(raw),
            scrapKg: round(raw - net),
            source: "cad",
            formula: `CAD volume × density, scrap ${scrap}%`
        };
    }
    if (input.geometry) {
        return calculateWeight(input.geometry, input.densityKgPerM3, scrap);
    }
    throw new Error("No reliable weight source is available");
}
function round(value) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
