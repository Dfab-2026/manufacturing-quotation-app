export default function BomThumbnail({description,category}:{description:string;category:string}){
  const name=description.toLowerCase();
  const kind=/washer|gasket|bearing|flange/.test(name)?'ring':/nut/.test(name)?'nut':/bolt|screw|stud/.test(name)?'bolt':/elbow/.test(name)?'elbow':/pipe|tube/.test(name)?'pipe':category==='Raw Material'?'sheet':'part';
  return <svg viewBox="0 0 48 40" width="48" height="40" style={{flexShrink:0,background:'#edf2f6',borderRadius:6}} role="img" aria-label={`${kind} schematic reference (not supplier photo)`}>
    <title>Illustrative component reference, not supplier photo</title>
    <g stroke="#52677b" strokeWidth="1.5" fill="#becbd7" strokeLinejoin="round">
    {kind==='ring'?<><circle cx="24" cy="20" r="15"/><circle cx="24" cy="20" r="7" fill="#edf2f6"/></>:kind==='nut'?<><path d="M10 12L24 5 38 12 38 28 24 35 10 28Z"/><circle cx="24" cy="20" r="7" fill="#edf2f6"/></>:kind==='bolt'?<><path d="M4 12L12 7 20 12 20 28 12 33 4 28Z"/><rect x="20" y="15" width="23" height="10"/>{[23,27,31,35,39].map(x=><path key={x} d={`M${x} 15l3 10`} />)}</>:kind==='elbow'?<path d="M8 5H20V17Q20 23 27 23H42V35H27Q8 35 8 17Z"/>:kind==='pipe'?<><rect x="8" y="10" width="32" height="20"/><ellipse cx="40" cy="20" rx="5" ry="10"/><ellipse cx="40" cy="20" rx="3" ry="6" fill="#edf2f6"/></>:<><path d="M5 15L32 6 43 15 15 25Z"/><path d="M5 15V23L15 33 43 23V15L15 25Z"/></>}
    </g></svg>;
}
