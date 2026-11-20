import {test} from 'node:test';
import assert from 'node:assert/strict';
import {anchorMatches,anchorPosition,evidenceImage,evidenceMatchesSource,measurementSemantic,validAnchor,markerSide,availableDrawingPages} from '../lib/drawingLocator.ts';
const anchor={label:'Radius',value:'2.1 mm',x:.2,y:.4,w:.1,h:.05,page:2};
test('exact source position and size independent of viewport',()=>{
  const position=anchorPosition(anchor);assert.equal(parseFloat(position.left),25);assert.ok(Math.abs(parseFloat(position.top)-42.5)<1e-10);assert.equal(position.width,'10%');
});
test('correct semantic and matching value only',()=>{
  assert.equal(anchorMatches(anchor,{label:'Bend radius',value:'2.1 mm'}),true);
  assert.equal(anchorMatches(anchor,{label:'Thickness',value:'2.1 mm'}),false);
  assert.equal(anchorMatches(anchor,{label:'Radius',value:'2.2 mm'}),false);
});
test('units/aliases for measured fields',()=>{
  assert.equal(measurementSemantic('Overall X'),'length');assert.equal(measurementSemantic('Mass'),'weight');assert.equal(measurementSemantic('OD'),'outer diameter');
});
test('invalid and off-page coordinates rejected',()=>{
  for(const a of [{...anchor,x:NaN},{...anchor,y:-1},{...anchor,w:0},{...anchor,page:-1},{...anchor,x:.99,w:.1}])assert.equal(validAnchor(a),false);
});
test('do not project source markers on wrong page',()=>{
  assert.equal(evidenceImage({evidence_preview:'first',evidence_pages:{'2':'third'}},2),'third');
  assert.equal(evidenceImage({evidence_preview:'first'},2),undefined);
  assert.equal(evidenceImage({evidence_preview:'first'},0),'first');
});
test('stale source hash must not display markers',()=>{
  assert.equal(evidenceMatchesSource({evidence_hash:'old'},'new'),false);
  assert.equal(evidenceMatchesSource({evidence_hash:'ABC'},'abc'),true);
});
test('weight and repeated matches remain locatable',()=>{
  const weight={...anchor,label:'Weight',value:'1.2501 kg'};
  assert.equal(anchorMatches(weight,{label:'Weight',value:'1.25 kg'}),true);
  assert.equal([anchor,{...anchor,x:.6}].filter(a=>anchorMatches(a,{label:'Radius',value:'2.1 mm'})).length,2);
});

test('compact marker chooses a free edge without covering source digits',()=>{
  assert.equal(markerSide(anchor),'right');
  assert.equal(markerSide({...anchor,x:.94,w:.05}),'left');
  assert.equal(markerSide({...anchor,x:.03,w:.94,y:.1,h:.05}),'bottom');
  assert.equal(markerSide({...anchor,x:.03,w:.94,y:.9,h:.05}),'top');
});
test('all pages are selectable even when only some are cached or have anchors',()=>{
  assert.deepEqual(availableDrawingPages({evidence_page_count:20,evidence_pages:{'0':'first','18':'late'},drawing_locations:[anchor]}),Array.from({length:20},(_,i)=>i));
  assert.deepEqual(availableDrawingPages({evidence_preview:'first',drawing_locations:[anchor]}),[0,2]);
  assert.deepEqual(availableDrawingPages(null),[]);
});
