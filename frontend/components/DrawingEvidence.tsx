"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { recoverDrawingEvidence, fetchDrawingPage } from '@/lib/api';
import type { AIExtraction } from '@/lib/types';
import ModelViewer from '@/components/ModelViewer';
import { isVisualCadFormat } from '@/lib/cad';
import { dimensionApplicability } from '@/lib/drawingApplicability';
import { anchorMatches, anchorPosition, evidenceImage, evidenceMatchesSource, equalMeasurement as equalValue, measurementSemantic as semantic, validAnchor, markerSide, availableDrawingPages } from '@/lib/drawingLocator';

export default function DrawingEvidence({data,source,previewUrl,fallbackImage,sourceHash,onEvidenceRecovered}: {data: AIExtraction | null; source?: File | null; previewUrl?: string; fallbackImage?: string | null; sourceHash?: string; onEvidenceRecovered?: (result:AIExtraction)=>void}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const recoveredCallback = useRef(onEvidenceRecovered);
  recoveredCallback.current = onEvidenceRecovered;
  const dataRef = useRef(data);
  dataRef.current = data;
  const [selected, choose] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [recovered, setRecovered] = useState<AIExtraction | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [failure, setFailure] = useState(false);
  const [retry, setRetry] = useState(0);
  const [imageFailure, setImageFailure] = useState(false);
  const attempted = useRef(new Set<string>());
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const sourceKey = source ? `${source.name}:${source.size}:${source.lastModified}:${sourceHash || ""}` : sourceHash || "";
  const cadViewer = !!source && isVisualCadFormat(source);
  const kernelCad = !!source && /\.(stp|step|igs|iges)$/i.test(source.name);
  const identityKey = sourceHash || sourceKey;
  const supported = !!source && /\.(pdf|dxf|png|jpe?g|webp|bmp|tiff?|stp|step|igs|iges)$/i.test(source.name);
  const [page,setPage] = useState(0);
  const [zoom,setZoom] = useState(100);
  const [pageImages,setPageImages] = useState<Record<string,string>>({});
  const [pageLoading,setPageLoading] = useState(false);
  const [pageError,setPageError] = useState(false);
  const [pageRetry,setPageRetry] = useState(0);
  const [pageCount,setPageCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pdfSource = !!source && /\.pdf$/i.test(source.name);
  // Source changes clear old evidence; refreshing the same source must not
  // erase a user's selection or restart the drawing preview unnecessarily.
  useEffect(() => {
    setRecovered(null); setFailure(false); choose(null); setPage(0); setZoom(100); setPageImages({}); setPageError(false); setPageCount(0);
    attempted.current.clear();
  }, [identityKey]);
  useEffect(() => {
    const original = dataRef.current;
    const file = sourceRef.current;
    if (!file || !supported || (!retry && evidenceMatchesSource(original,sourceHash) && original?.evidence_version === 7 && (original?.drawing_locations?.some(validAnchor) || original?.geometry_locations?.length) && Number(original?.thickness_mm || 0)>0)) { setRecovering(false); return; }
    const controller = new AbortController();
    setRecovering(true); setFailure(false);
    recoverDrawingEvidence(file, original, controller.signal, sourceHash || original?.evidence_hash).then(value=>{
      if (!controller.signal.aborted && evidenceMatchesSource(value,sourceHash)) {
        setRecovered(value); recoveredCallback.current?.(value);
        setFailure(!value.evidence_preview && !value.geometry_locations?.length);
      }
    }).catch(()=>{if (!controller.signal.aborted) setFailure(true);}).finally(()=>{if (!controller.signal.aborted) setRecovering(false);});
    return ()=>controller.abort();
  }, [sourceKey, supported, sourceHash, retry]);
  const combined = recovered ? {...data,...recovered} : data;
  const evidence = evidenceMatchesSource(combined,sourceHash) ? combined : null;
  const measurements = data ? {...data, thickness_mm: data.thickness_mm || evidence?.thickness_mm, dimensions: [...(data.dimensions || []), ...(recovered?.dimensions || []).filter(d=>!(data.dimensions || []).some(old=>old.label===d.label && Number(old.value_mm)===Number(d.value_mm)))]} : evidence;
  const locations = (evidence?.drawing_locations || []).filter(validAnchor);
  const entries: {label:string;value:string}[] = [];
  const add = (label:string, value:unknown, unit='mm') => {
    const n = Number(value);
    if(n > 0 && Number.isFinite(n)) { const value=`${Number(n.toPrecision(8))} ${unit}`; if(!entries.some(x=>x.label===label && x.value===value)) entries.push({label,value}); }
  };
  for(const item of measurements?.dimensions || []) { const label=String(item.label || 'Dimension'); if(semantic(label)==='thickness' && Number(measurements?.thickness_mm||0)>0) continue; add(label,item.value_mm); }
  for(const item of data?.holes || []) add('Hole diameter',item.diameter_mm);
  for(const item of data?.bends || []) add('Bend radius',item.radius_mm);
  for(const item of data?.chamfers || []) add('Chamfer',item.size_mm);
  for(const [label,value] of [['Length',measurements?.length_mm],['Width',measurements?.width_mm],['Height',measurements?.height_mm]] as const) { if(!entries.some(x=>semantic(x.label)===semantic(label))) add(label,value); }
  add('Thickness',measurements?.thickness_mm);
  add('Weight',data?.weight_kg,'kg');
  const items = [...entries];
  for(const loc of locations) if(!items.some(x=>semantic(x.label)===semantic(loc.label) && (equalValue(parseFloat(x.value),parseFloat(loc.value)) || ['thickness','weight'].includes(semantic(x.label))))) items.push({label:loc.label,value:loc.value});
  for(const loc of evidence?.geometry_locations || []) { const value=`${Number(loc.value_mm.toPrecision(8))} mm`; if(!items.some(x=>semantic(x.label)===semantic(loc.label) && (equalValue(parseFloat(x.value),parseFloat(value)) || semantic(x.label)==='thickness'))) items.push({label:loc.label,value}); }
  if(data) for(const label of ['Length','Width','Height','Thickness','Weight']) {
    if(!items.some(x=>semantic(x.label)===semantic(label))) items.push({label,value:dimensionApplicability(data,label)?'Review required':'N/A'});
  }
  const locate = (item:typeof items[number]) => {
    const hits = locations.filter(loc=>anchorMatches(loc,item));
    if(hits.length || item.label!=="Weight" || !Number.isFinite(parseFloat(item.value))) return hits;
    // A calculated weight has no printed weight coordinate: locate its measured inputs.
    if(data?.weight_source === "drawing_stated" || data?.weight_prediction?.source === "drawing_stated" || (!data?.weight_prediction && !/geometry|calculat|predict|solid/i.test(data?.weight_source || ""))) return hits;
    return locations.filter(loc=>["length","width","height","thickness","outer diameter","inner diameter"].includes(semantic(loc.label))).map(loc=>({...loc,kind:"calculation"}));
  };
  const itemKey = (item:typeof items[number])=>`${item.label}:${item.value}`;
  const current = items.find(item=>itemKey(item)===selected) || null;
  const hits = current ? locate(current) : [];
  const active = hits.filter(hit=>(hit.page ?? 0)===page);
  const geometry = (item:typeof items[number]) => (evidence?.geometry_locations || []).filter(g=>item.label === "Weight" && Number.isFinite(parseFloat(item.value)) ? data?.weight_source !== "drawing_stated" && data?.weight_prediction?.source !== "drawing_stated" && g.kind === "extent" : semantic(g.label)===semantic(item.label) && equalValue(g.value_mm,parseFloat(item.value)));
  const pointKey = JSON.stringify(current ? geometry(current).flatMap(g=>g.points).filter(p=>p.length===3 && p.every(Number.isFinite)) : []);
  const points = useMemo<number[][]>(()=>JSON.parse(pointKey),[pointKey]);
  const image = pageImages[String(page)] || evidenceImage(evidence,page);
  const availablePages = availableDrawingPages(pageCount ? {...evidence,evidence_page_count:pageCount} : evidence);
  const pageOptions = availablePages.length ? availablePages : [0];
  const pageIndex = Math.max(0,pageOptions.indexOf(page));
  useEffect(()=>{
    if(!pdfSource || !source || image) {setPageLoading(false);return;}
    const controller=new AbortController();
    setPageLoading(true);setPageError(false);
    fetchDrawingPage(source,page,controller.signal,sourceHash).then(result=>{
      if(controller.signal.aborted || result.page!==page || !evidenceMatchesSource({evidence_hash:result.evidence_hash},sourceHash))return;
      setPageCount(result.page_count);
      // Keep a bounded cache; previously analyzed page images remain in evidence.
      setPageImages(old=>{const next={...old,[String(page)]:result.image};const keys=Object.keys(next).filter(key=>key!==String(page));for(const key of keys.slice(0,Math.max(0,keys.length-3))) delete next[key];return next;});
    }).catch(()=>{if(!controller.signal.aborted)setPageError(true);}).finally(()=>{if(!controller.signal.aborted)setPageLoading(false);});
    return ()=>controller.abort();
  },[pdfSource,sourceKey,page,image,sourceHash,pageRetry]);
  useEffect(()=>setImageFailure(false),[image]);
  // A delayed source recovery may find a different page. Keep the same row
  // selected and navigate once the real source coordinates arrive.
  const firstPage = hits[0]?.page ?? 0;
  const matchingPages = Array.from(new Set(hits.map(h=>h.page ?? 0)));
  const pageKey = matchingPages.join(',');
  useEffect(()=>{
    if (pageKey) setPage(firstPage);
  },[selected,pageKey,firstPage]);
  useEffect(()=>{
    if(!current || !active.length || !image || !scrollRef.current)return;
    const frame=requestAnimationFrame(()=>{
      const viewport=scrollRef.current;const stage=viewport?.querySelector<HTMLElement>('.drawing-locator-image-stage');
      if(!viewport || !stage)return;
      const a=active[0];viewport.scrollTo({left:(a.x+a.w/2)*stage.clientWidth-viewport.clientWidth/2,top:(a.y+a.h/2)*stage.clientHeight-viewport.clientHeight/2,behavior:'auto'});
    });return ()=>cancelAnimationFrame(frame);
  },[selected,page,pulse,zoom,image]);
  const selectSource = (item:typeof items[number])=>{
    const key=itemKey(item), matches=locate(item), cad=geometry(item);
    choose(key); setPage(matches[0]?.page ?? 0); setPulse(v=>v+1);
    // Some saved quotations already contain other anchors, but not this row.
    // Try fresh extraction once per row instead of treating partial evidence as complete.
    if ((!matches.length && !cad.length || matches.length && !pdfSource && !evidenceImage(evidence,matches[0].page ?? 0)) && supported && !recovering && !attempted.current.has(key)) {
      attempted.current.add(key); setRetry(v=>v+1);
    }
    requestAnimationFrame(()=>previewRef.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'}));
  };
  const status = current ? kernelCad && points.length ? 'Measured CAD geometry highlighted.' : active.length && image && !imageFailure && !kernelCad ? `${active.length} source location(s) on this page. ${hits.some(h=>h.kind==='calculation')?'Contributing measurements highlighted.':hits.some(h=>h.kind==='candidate')?'Matching callouts — confirm against the drawing.':'Source highlighted.'}` : pageLoading || recovering ? 'Locating source…' : hits.length && !active.length ? 'Source is on another page. Select a page marked source.' : 'No verified source position for this value. Review the drawing or retry source extraction.' : 'Select Locate beside a measurement to highlight its source in the drawing.';
  return <section className="sheet-section drawing-evidence-review"><h3>Interactive Drawing Analysis</h3>
    <div className="drawing-locator-status">
      <div><strong>{current ? `${current.label} · ${current.value}` : 'Drawing source locator'}</strong><p role="status" aria-live="polite">{status}</p></div>
      {current && <div className="drawing-locator-actions">{supported && !recovering && (!active.length && !points.length || imageFailure) && <button type="button" className="btn secondary" onClick={()=>{setImageFailure(false);setRetry(v=>v+1);}}>Retry source extraction</button>}<button className="btn secondary" type="button" onClick={()=>{choose(null);setPulse(v=>v+1);}}>Clear</button></div>}
    </div>
    {!kernelCad && (image || pdfSource) && <div className="drawing-locator-toolbar">
      <div className="drawing-locator-controls"><button type="button" className="btn secondary" aria-label="Previous drawing page" disabled={pageIndex===0 || pageLoading} onClick={()=>setPage(pageOptions[pageIndex-1])}>‹</button><label>Page <select aria-label="Drawing page" value={page} onChange={e=>{setPage(Number(e.target.value));setPulse(v=>v+1)}}>{pageOptions.map(p=><option key={p} value={p}>{p+1}{matchingPages.includes(p)?' · source':''}</option>)}</select> of {pageOptions.length}</label><button type="button" className="btn secondary" aria-label="Next drawing page" disabled={pageIndex>=pageOptions.length-1 || pageLoading} onClick={()=>setPage(pageOptions[pageIndex+1])}>›</button></div>
      <div className="drawing-locator-controls"><button type="button" className="btn secondary" aria-label="Zoom out" disabled={zoom<=100} onClick={()=>setZoom(z=>Math.max(100,z-25))}>−</button><span aria-live="polite">{zoom}%</span><button type="button" className="btn secondary" aria-label="Zoom in" disabled={zoom>=300} onClick={()=>setZoom(z=>Math.min(300,z+25))}>+</button><button type="button" className="btn secondary" onClick={()=>{setZoom(100);scrollRef.current?.scrollTo(0,0)}}>Fit</button></div>
    </div>}
    <div ref={previewRef} className="drawing-evidence-preview">
      {kernelCad ? <div style={{height:420}}><ModelViewer file={source || null} highlightPoints={points} highlightPulse={pulse}/></div> : image && !imageFailure ? <div className="drawing-locator-scroll" ref={scrollRef}><div className="drawing-locator-image-stage" style={{width:`${zoom}%`}}>
        <img src={image} alt={`Original drawing, page ${page+1}`} onError={()=>setImageFailure(true)}/>
        <div className="drawing-locator-overlay" aria-hidden="true">
          {active.map((anchor,i)=><div key={`${pulse}-${i}`} className="drawing-locator-anchor" data-side={markerSide(anchor)} style={anchorPosition(anchor)}>
            <span className="drawing-locator-pin"><span className="drawing-locator-dot"/><span className="drawing-locator-pulse"/></span>
          </div>)}
        </div>
      </div></div> : cadViewer ? <div style={{height:420}}><ModelViewer file={source || null} highlightPoints={points} highlightPulse={pulse}/></div> : <div className="drawing-locator-fallback">{page===0 && (fallbackImage || (previewUrl && !/\.pdf$/i.test(source?.name || '') && source?.type !== 'application/pdf' ? previewUrl : '')) ? <img src={fallbackImage || previewUrl} alt="Original drawing (unregistered preview)"/> : <div role="status">{pageLoading || recovering ? 'Rendering original drawing…' : failure || imageFailure || pageError ? 'Could not render this drawing page.' : 'Original drawing page is not available in this saved quotation.'}</div>}{pdfSource && pageError && <button type="button" className="btn secondary" onClick={()=>setPageRetry(v=>v+1)}>Retry page</button>}{supported && !recovering && <button type="button" className="btn secondary" onClick={()=>{setImageFailure(false);setRetry(v=>v+1);}}>Retry source extraction</button>}</div>}
    </div>
    {current && active.length>0 && image && !kernelCad && !imageFailure && <div className="drawing-locator-callouts"><strong>Highlighted drawing evidence</strong>{active.slice(0,8).map((a,i)=><span key={i}>{a.callout || `${a.label}: ${a.value}`}</span>)}{active.length>8 && <span>+{active.length-8} more locations on this page</span>}</div>}
    {items.length ? <div className="editable-table-scroll"><table><thead><tr><th>Extracted feature</th><th>Value</th><th>Source</th></tr></thead><tbody>{items.map((item,i)=><tr key={i} className={selected===itemKey(item)?'drawing-locator-selected':''}><td>{item.label}</td><td>{item.value}</td><td>{item.value==='N/A' ? <span>N/A</span> : <button type="button" className="btn secondary" aria-pressed={selected===itemKey(item)} disabled={!Number.isFinite(parseFloat(item.value))} onClick={()=>selectSource(item)}>Locate</button>}</td></tr>)}</tbody></table></div>:<p>No extracted measurements available.</p>}
  </section>;
}

// Mount only when opened, avoiding duplicate OCR/CAD loads on other workflow pages.
export function DrawingEvidenceDisclosure(props: Parameters<typeof DrawingEvidence>[0]) {
  const [open,setOpen]=useState(false);
  return <details className="drawing-evidence-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Review drawing &amp; source locations</summary>
    {open && <DrawingEvidence {...props}/>}
  </details>;
}
