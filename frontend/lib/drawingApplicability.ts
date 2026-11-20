import type { AIExtraction } from './types';

// An inferred manufacturing category is not proof that a dimension is N/A.
// New source-scoped analyses explicitly identify fields that truly do not apply.
export function dimensionApplicability(data: AIExtraction, label: string): boolean {
  const key = String(label || '').toLowerCase().replace(/^overall /, '').trim();
  return data.field_applicability?.[key] !== 'not_applicable';
}
