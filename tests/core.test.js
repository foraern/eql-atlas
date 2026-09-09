import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMap,parseLoc,formatLoc,clipLine,boundsOf,createCatalog,filteredGeometry,loadSource} from '../src/core.js';
test('EQ location order, signs, and invalid values',()=>{
  assert.deepEqual(parseLoc('128.63, 30.11, 299.07'),[-30.11,-128.63,299.07]);
  assert.equal(formatLoc([-30.11,-128.63,299.07]),'128.63, 30.11, 299.07');
  for(const value of ['1,2','1,garbage,2,3','1,2,NaN','1,2,Infinity',''])assert.equal(parseLoc(value),null);
});
test('clips shafts crossing an entire height slab and descending shafts',()=>{
  const line=[0,10,-100,100,30,100,0];
  assert.deepEqual(clipLine(line,2,-20,20),[40,18,-20,60,22,20,0]);
  assert.deepEqual(clipLine([100,30,100,0,10,-100,0],2,-20,20),[60,22,20,40,18,-20,0]);
  assert.equal(clipLine(line,2,101,200),null);
  assert.deepEqual(clipLine([0,0,5,1,1,5,1],2,5,5),[0,0,5,1,1,5,1]);
});
test('parses source annotations as plain text and preserves commas',()=>{
  const d=parseMap('L 0,0,-2,10,20,2,0,0,0\nP -10,-20,2,0,0,0,3,Room,_Upper\nL NaN,0,0,1,1,1,0,0,0\nP 0,0,0,0,0,0,1,<script>alert(1)</script>');
  assert.equal(d.lines.length,1);assert.equal(d.skipped,1);assert.equal(d.labels[0].name,'Room, Upper');assert.equal(d.labels[1].name,'<script>alert(1)</script>');
  assert.deepEqual(boundsOf(d.lines,d.labels).max,[10,20,2]);
});
test('groups collection layers while preserving numeric zone suffixes',()=>{
  const c=createCatalog(['kedge.txt','kedge_1.txt','Brewall/kedge.txt','Brewall/kedge_2.txt','qeynos2.txt','../secret.txt','Brewall/sub/map.txt','notes.md']);
  assert.equal(c.length,2);const k=c.find(z=>z.key==='kedge');assert.equal(k.sources[0].id,'');assert.equal(k.sources[1].files[2],'Brewall/kedge_2.txt');assert.equal(c[1].key,'qeynos2');
});
test('height bounds ignore decorative layer 2 legends',()=>{
  assert.deepEqual(boundsOf([[0,0,0,1,1,2,0],[10000,10000,10000,11000,12000,13000,2]]).max,[1,1,2]);
});
test('depth slicing clips exactly on both side axes',()=>{
  const lines=[[-100,-100,-100,100,100,100,0]];
  for(const side of ['north','west']){const r=filteredGeometry(lines,{low:-10,high:10,depth:{center:0,width:10},side});assert.deepEqual(r.visible,[[-5,-5,-5,5,5,5,0]]);}
});
test('map source reads only catalog paths and adds separate reference labels',async()=>{
  const c=createCatalog(['kedge.txt','Brewall/kedge_1.txt']);const requested=[];
  const d=await loadSource(c[0],'',async p=>{requested.push(p);return p==='kedge.txt'?'L 0,0,0,1,1,1,0,0,0':'P 1,1,1,0,0,0,1,Stairs_Up';});
  assert.deepEqual(requested,['kedge.txt','Brewall/kedge_1.txt']);assert.equal(d.references[0].reference,true);assert.equal(d.references[0].name,'Stairs Up');
  await assert.rejects(()=>loadSource(c[0],'../secret',()=>''));
});
