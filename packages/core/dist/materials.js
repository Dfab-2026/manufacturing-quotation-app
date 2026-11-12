export const MATERIAL_DENSITIES = {
    SS304: { code: "SS304", kgPerM3: 7930 },
    SS316: { code: "SS316", kgPerM3: 8000 },
    MS: { code: "MS", kgPerM3: 7850 },
    AL6061: { code: "AL6061", kgPerM3: 2700 },
    CU: { code: "CU", kgPerM3: 8960 },
    BRASS: { code: "BRASS", kgPerM3: 8500 }
};
export function getDensity(code) {
    return MATERIAL_DENSITIES[code.trim().toUpperCase()] ?? null;
}
