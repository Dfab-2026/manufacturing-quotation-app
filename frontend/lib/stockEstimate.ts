export function estimateStock(v: {shape:string; lengthMm:number; widthMm:number; quantity:number; densityKgM3:number; stockLengthMm:number; stockWidthMm:number; cuttingGapMm:number; unitVolumeMm3:number}) {
  const {shape,lengthMm:l,widthMm:w,quantity:q,densityKgM3:d,stockLengthMm:sl,stockWidthMm:sw,cuttingGapMm:k,unitVolumeMm3:volume}=v;
  if (![l,q,d,sl,volume].every(n=>Number.isFinite(n)&&n>0)||!Number.isInteger(q)||!Number.isFinite(k)||k<0) return null;
  const sheet=shape==='plate';
  if(sheet&&(!(w>0)||!(sw>0)||!Number.isFinite(sw))) return null;
  const fit=(a:number,b:number)=>Math.floor((a+k)/(b+k));
  const capacity=sheet?Math.max(fit(sl,l)*fit(sw,w),fit(sl,w)*fit(sw,l)):fit(sl,l);
  if(capacity<1) return null;
  const units=Math.ceil(q/capacity);
  const kgPerStock=volume/l*(sheet?sl*sw/w:sl)*d/1e9;
  const purchasedKg=units*kgPerStock, blankKg=volume*q*d/1e9;
  return {capacity,units,purchasedKg,blankKg,remainingKg:Math.max(0,purchasedKg-blankKg),utilization:100*blankKg/purchasedKg};
}
