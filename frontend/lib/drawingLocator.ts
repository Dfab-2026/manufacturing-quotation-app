import type { AIExtraction } from './types';

export type DrawingAnchor = NonNullable<AIExtraction['drawing_locations']>[number];
export type Measurement = { label: string; value: string };

export function measurementSemantic(label: string) {
  const l = canonicalMeasurementLabel(label).toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/^(overall|primary)\s+/, '').trim();
  if (/thickness|\bthk\b|gauge/.test(l)) return 'thickness';
  if (/^(x|length)$/.test(l)) return 'length';
  if (/^(y|width)$/.test(l)) return 'width';
  if (/^(z|height|depth)$/.test(l)) return 'height';
  if (/^(od|o\.d\.?)$|outer|outside|external/.test(l)) return 'outer diameter';
  if (/^(id|i\.d\.?)$|inner|inside|internal/.test(l)) return 'inner diameter';
  if (/^(hole depth|thread depth|bend angle|chamfer angle|stud length|weld size|weld length)$/.test(l)) return l;
  if (/radius/.test(l)) return 'radius';
  if (/diameter|hole|[ø⌀∅]/.test(l)) return 'diameter';
  if (/chamfer/.test(l)) return 'chamfer';
  if (/^(weight|mass|wt\.?)$/.test(l)) return 'weight';
  return l;
}

export function equalMeasurement(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= Math.max(.0001, Math.abs(b)*.000002);
}

export function validAnchor(anchor: DrawingAnchor): boolean {
  const {x,y,w,h} = anchor;
  return [x,y,w,h].every(Number.isFinite) && w > 0 && h > 0 && x >= 0 && y >= 0 && x < 1 && y < 1 && x+w <= 1.001 && y+h <= 1.001 && Number.isInteger(anchor.page ?? 0) && (anchor.page ?? 0) >= 0;
}

export function anchorMatches(anchor: DrawingAnchor, measurement: Measurement) {
  if (!validAnchor(anchor) || measurementSemantic(anchor.label) !== measurementSemantic(measurement.label)) return false;
  const a = parseFloat(anchor.value), b = parseFloat(measurement.value);
  return equalMeasurement(a,b) || (measurementSemantic(measurement.label)==='weight' && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=.0005);
}

// Never put page N evidence on the first-page thumbnail when N is missing.
export function evidenceImage(data: AIExtraction | null | undefined, page: number) {
  return data?.evidence_pages?.[String(page)] || (page===0 ? data?.evidence_preview : undefined);
}

export function anchorPosition(anchor: DrawingAnchor) {
  return { left: `${Math.min(1, anchor.x+anchor.w/2)*100}%`, top: `${Math.min(1, anchor.y+anchor.h/2)*100}%`, width: `${Math.min(1,anchor.w)*100}%`, height: `${Math.min(1,anchor.h)*100}%` };
}

export function evidenceMatchesSource(data: AIExtraction | null | undefined, hash?: string) {
  return !hash || !data?.evidence_hash || hash.toLowerCase() === data.evidence_hash.toLowerCase();
}

// Place the visible dot outside the digit box, choosing the roomier edge.
export function markerSide(anchor: DrawingAnchor): "right" | "left" | "top" | "bottom" {
  const gaps = {right:1-anchor.x-anchor.w,left:anchor.x,top:anchor.y,bottom:1-anchor.y-anchor.h};
  if(gaps.right>=.08) return "right";
  if(gaps.left>=.08) return "left";
  return gaps.bottom>gaps.top ? "bottom" : "top";
}

export function availableDrawingPages(data: AIExtraction | null | undefined): number[] {
  const count = Number(data?.evidence_page_count||0);
  const pages = new Set<number>();
  if(Number.isSafeInteger(count)&&count>0) for(let i=0;i<count;i++) pages.add(i);
  for(const key of Object.keys(data?.evidence_pages||{})) {const p=Number(key);if(Number.isSafeInteger(p)&&p>=0) pages.add(p);}
  if(data?.evidence_preview) pages.add(0);
  for(const a of data?.drawing_locations||[]) if(validAnchor(a)) pages.add(a.page??0);
  return [...pages].sort((a,b)=>a-b);
}

/** User-facing names; persisted CAD axis identities remain intact. */
export function canonicalMeasurementLabel(label: string): string {
  const clean = label.replace(/\s*\((?:predicted|review(?: required)?)\)\s*$/i, '').trim();
  const key = clean.toLowerCase().replace(/^(overall|primary|total)\s+/, '').replace(/-/g, ' ').replace(/\(([xyz])(?: axis)?\)/g,' $1').replace(/\s+/g, ' ').trim();
  for (const [name, axis] of [['Length','x'],['Width','y'],['Height','z']]) {
    if ([name.toLowerCase(),axis,`${axis} axis`,`${name.toLowerCase()} ${axis}`,`${name.toLowerCase()} ${axis} axis`,`${axis} axis ${name.toLowerCase()}`,`${axis} dimension`].includes(key)) return name;
  }
  if (/^(thk|thick|thickness|wall thickness|sheet thickness|plate thickness|gauge)$/.test(key)) return 'Thickness';
  if (/^(od|o\.d\.?|outer diameter|outside diameter|external diameter)$/.test(key)) return 'Outer Diameter';
  if (/^(id|i\.d\.?|inner diameter|inside diameter|internal diameter)$/.test(key)) return 'Inner Diameter';
  if (/^hole\s*[ø⌀∅]\s*[\d.,]+$/i.test(key)) return 'Hole diameter';
  if (/^(dimension|linear dimension)$/.test(key)) return 'Linear Dimension';
  return clean;
}

export function uniqueDimensionRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  const name=(row:T)=>canonicalMeasurementLabel(String(row.label||'')).toLowerCase();
  const value=(row:T)=>Number(row.value_mm||0);
  const compatible=(a:T,b:T)=>['tolerance','source_handle','kind'].every(k=>!a[k]||!b[k]||a[k]===b[k]) && !(Number(a.quantity||1)>1 && Number(b.quantity||1)>1 && Number(a.quantity)!==Number(b.quantity));
  const out:T[]=[];
  for(const row of rows) {
    const n=name(row),v=value(row);
    if(!n){out.push(row);continue;}
    if(!(v>0) && rows.some(other=>name(other)===n&&value(other)>0)) continue;
    const duplicate=out.findIndex(other=>name(other)===n&&equalMeasurement(value(other),v)&&compatible(other,row));
    if(duplicate<0){out.push(row);continue;}
    const old=out[duplicate];
    const merged={...row,...old} as T;
    for(const key of Object.keys(row)) if(!old[key]&&row[key]) (merged as Record<string,unknown>)[key]=row[key];
    (merged as Record<string,unknown>).quantity=Math.max(Number(old.quantity||1),Number(row.quantity||1));
    (merged as Record<string,unknown>).confidence=Math.max(Number(old.confidence||0),Number(row.confidence||0));
    out[duplicate]=merged;
  }
  return out.filter(row=> !(name(row)==='linear dimension'&&value(row)>0&&!row.source_handle&&out.some(other=>['length','width','height','thickness'].includes(name(other))&&equalMeasurement(value(other),value(row))&&compatible(other,row)&&(!row.tolerance||row.tolerance===other.tolerance))));
}

export type MeasurementStatus = 'Verified' | 'Predicted' | 'Calculated' | 'Source unverified' | 'Review required' | 'N/A';
export function measurementStatus(data: AIExtraction | null | undefined, item: Measurement, anchors: DrawingAnchor[], geometry: boolean): MeasurementStatus {
  if(item.value === 'N/A') return 'N/A';
  if(!Number.isFinite(parseFloat(item.value))) return 'Review required';
  const sem=measurementSemantic(item.label), n=parseFloat(item.value);
  const rows=(data?.dimensions || []).filter(r=>measurementSemantic(String(r.label||''))===sem && equalMeasurement(Number(r.value_mm),n));
  const fields = [
    ['Hole diameter',data?.holes,'diameter_mm'],['Hole depth',data?.holes,'depth_mm'],
    ['Bend radius',data?.bends,'radius_mm'],['Bend angle',data?.bends,'angle_deg'],
    ['Chamfer',data?.chamfers,'size_mm'],['Chamfer angle',data?.chamfers,'angle_deg'],
    ['Thread depth',data?.threads,'depth_mm'],['Stud length',data?.studs,'length_mm'],
    ['Weld size',data?.welds,'size_mm'],['Weld length',data?.welds,'length_mm'],
  ] as const;
  for(const [label,features,field] of fields) if(label===item.label) rows.push(...(features||[]).filter(r=>equalMeasurement(Number(r[field]),n)));
  const prediction=/predict|estimat|assum|infer/i;
  const basis=sem==='thickness' ? data?.thickness_basis : sem==='weight' ? [data?.weight_source,data?.weight_prediction?.source,data?.weight_prediction?.basis].join(' ') : '';
  const explicit=sem==='weight' && data?.weight_source==='drawing_stated';
  if(!explicit && (prediction.test(basis||'') || rows.some(r=>prediction.test([r.label,r.source,r.basis,r.status,r.prediction_status].join(' '))) || (data?.evidence||[]).some(r=>measurementSemantic(r.field.replace(/^predicted\s+/i,''))===sem && equalMeasurement(parseFloat(r.value),n) && prediction.test(r.field+' '+r.basis)))) return 'Predicted';
  if(anchors.some(a=>a.kind==='calculation') || /calculat|\(OD|solid_volume/i.test(basis||'')) return 'Calculated';
  if(geometry || anchors.some(a=>a.kind==='verified')) return 'Verified';
  return 'Source unverified';
}
