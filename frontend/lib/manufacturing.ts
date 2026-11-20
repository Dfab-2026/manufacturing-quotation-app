import type { AIExtraction, CostRow } from './types';
export const categories = ['Review Required','Sheet Metal','Piping','CNC Machining','Turning','Structural Fabrication','Plate Fabrication','Pressure Vessel & Tank','Casting','Forging','Extrusion','Additive Manufacturing','Standard Components','Assembly'];
export const scopes = ['Complete manufacturing','Customer-supplied raw material','Customer-supplied components','Welding only','Machining only','Assembly only','Surface finishing only'];
export function scopedRows(rows: CostRow[], scope: string): CostRow[] {
  if (scope === scopes[0]) return rows;
  return rows.filter(row => {
    const cat = row.category.toUpperCase();
    const text = `${row.item} ${row.rateId || ''}`;
    if (scope === scopes[1]) return cat !== 'MATERIAL';
    if (scope === scopes[2]) return cat !== 'MATERIAL' && (cat !== 'OTHER' || !row.id.startsWith('bom-purchase-'));
    if (cat === 'MATERIAL' || row.id.startsWith('bom-purchase-')) return false;
    if (scope === scopes[3]) return /weld|\btig\b|\bmig\b|\bqc\b|inspection|shielding gas|filler/i.test(text);
    if (scope === scopes[4]) return /machin|mill|turn|drill|boring|thread|tap|chamfer|inspection|\bqc\b/i.test(text);
    if (scope === scopes[5]) return /assembl|fasten|inspection|\bqc\b/i.test(text);
    if (scope === scopes[6]) return /finish|polish|grind|coat|passivat|deburr|inspection|\bqc\b/i.test(text);
    return true;
  });
}
export function categoryOf(data?: AIExtraction | null): string {
  if (data?.manufacturing_category) return data.manufacturing_category;
  const form = data?.engineering_intelligence?.part_form || data?.part_form;
  const primary = data?.primary_manufacturing_type || data?.engineering_intelligence?.primary_manufacturing_type;
  if (form === 'Assembly') return 'Assembly';
  if (form === 'Tube / Pipe' || primary === 'Tube / Pipe Fabrication') return 'Piping';
  if (form === 'Sheet' || form === 'Enclosure / Cover' || primary === 'Sheet-Metal Fabrication' || data?.bends?.length) return 'Sheet Metal';
  if (form === 'Plate') return 'Plate Fabrication';
  if (form === 'Frame') return 'Structural Fabrication';
  if (primary === 'CNC Turning') return 'Turning';
  if (primary === 'CNC Milling' || primary === 'General Machining') return 'CNC Machining';
  return categories.includes(primary || '') ? primary! : 'Review Required';
}
