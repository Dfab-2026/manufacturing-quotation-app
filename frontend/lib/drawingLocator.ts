import type { AIExtraction } from './types';

export type DrawingAnchor = NonNullable<AIExtraction['drawing_locations']>[number];
export type Measurement = { label: string; value: string };

export function measurementSemantic(label: string) {
  const l = label.toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/^(overall|primary)\s+/, '').trim();
  if (/thickness|\bthk\b|gauge/.test(l)) return 'thickness';
  if (/^(x|length)$/.test(l)) return 'length';
  if (/^(y|width)$/.test(l)) return 'width';
  if (/^(z|height|depth)$/.test(l)) return 'height';
  if (/^(od|o\.d\.?)$|outer|outside|external/.test(l)) return 'outer diameter';
  if (/^(id|i\.d\.?)$|inner|inside|internal/.test(l)) return 'inner diameter';
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
