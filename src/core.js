import zoneNames from './zone-names.json' with { type:'json' };

export function parseMap(text,{layer=0,source='',reference=false}={}) {
  const lines=[],labels=[];let skipped=0;
  for(const raw of text.split(/\r?\n/)) {
    const row=raw.trim();if(!/^[LP]\s/.test(row))continue;
    const parts=row.slice(1).split(',').map(s=>s.trim()),line=row[0]==='L',n=line?6:3;
    const values=parts.slice(0,n).map(v=>v===''?NaN:Number(v));
    if(parts.length<(line?9:8)||values.length!==n||!values.every(Number.isFinite)){skipped++;continue;}
    if(line)lines.push([...values,layer]);
    else {const name=parts.slice(7).join(',').replaceAll('_',' ').replaceAll('`','’');if(name)labels.push({position:values,name,source,reference,layer});}
  }
  return {lines,labels,skipped};
}
export function parseLoc(text) {
  const fields=text.trim().replace(/^\/loc\s*/i,'').split(/[\s,]+/);
  if(fields.length!==3||fields.some(s=>!s))return null;
  const n=fields.map(Number);return n.every(Number.isFinite)?[-n[1],-n[0],n[2]]:null;
}
export const formatLoc=p=>[-p[1],-p[0],p[2]].map(n=>(Object.is(n,-0)?0:n).toFixed(2)).join(', ');
export function clipLine(line,axis,low,high) {
  if(low>high)return null;
  const a=line[axis],d=line[axis+3]-a;
  if(Math.abs(d)<1e-9)return a>=low&&a<=high?line:null;
  const u=(low-a)/d,v=(high-a)/d,t0=Math.max(0,Math.min(u,v)),t1=Math.min(1,Math.max(u,v));
  if(t0>t1)return null;
  return [...[0,1,2].map(i=>line[i]+(line[i+3]-line[i])*t0),...[0,1,2].map(i=>line[i]+(line[i+3]-line[i])*t1),line[6]];
}
export function boundsOf(lines,labels=[]) {
  const base=lines.filter(l=>l[6]===0),standard=lines.filter(l=>l[6]<=1);
  const chosen=base.length?base:standard.length?standard:lines;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  const add=p=>{for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}};
  for(const l of chosen){add(l);add(l.slice(3,6));}
  if(!chosen.length)labels.filter(l=>l.layer<=1).forEach(l=>add(l.position));
  if(!Number.isFinite(min[0])){min.fill(0);max.fill(0);}
  const center=min.map((v,i)=>(v+max[i])/2),size=min.map((v,i)=>max[i]-v);
  return {min,max,center,size,span:Math.max(...size,1)};
}
export function parseMapPath(relativePath) {
  const p=relativePath.replaceAll('\\','/').split('/');
  if(p.length>2||p.some(s=>!s||s==='.'||s==='..'||s.startsWith('.')))return null;
  const file=p.at(-1),match=/^(.+?)(?:_([1-3]))?\.txt$/i.exec(file);if(!match)return null;
  return {key:match[1].toLowerCase(),layer:Number(match[2]||0),source:p.length===2?p[0]:'',path:relativePath};
}
export function createCatalog(paths) {
  const zones=new Map();
  for(const path of paths){const p=parseMapPath(path);if(!p)continue;
    if(!zones.has(p.key))zones.set(p.key,{key:p.key,name:zoneNames[p.key]||p.key.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),sources:[]});
    const z=zones.get(p.key);let s=z.sources.find(s=>s.id===p.source);
    if(!s){s={id:p.source,name:p.source||'EQL maps',files:{}};z.sources.push(s);}
    s.files[p.layer]=path;
  }
  return [...zones.values()].map(z=>({...z,sources:z.sources.sort((a,b)=>a.id===''?-1:b.id===''?1:a.id.localeCompare(b.id))})).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function loadSource(zone,sourceId,readText) {
  const source=zone.sources.find(s=>s.id===sourceId);if(!source)throw Error('Map source is unavailable.');
  const lines=[],labels=[],warnings=[];
  for(const [layer,path] of Object.entries(source.files)){
    const d=parseMap(await readText(path),{layer:Number(layer),source:source.name});for(const line of d.lines)lines.push(line);for(const label of d.labels)labels.push(label);
    if(d.skipped)warnings.push(`${path}: ${d.skipped} malformed records skipped`);
  }
  const ref=zone.sources.find(s=>s.id!==sourceId&&/brewall/i.test(s.name));let references=[];
  if(ref?.files[1])references=parseMap(await readText(ref.files[1]),{layer:1,source:ref.name,reference:true}).labels;
  return {key:zone.key,name:zone.name,source:source.name,lines,labels,references,warnings,bounds:boundsOf(lines,labels)};
}
export function filteredGeometry(lines,{low=-Infinity,high=Infinity,layers=[0,1],depth=null,side='north'}={}) {
  const context=[],visible=[],vertical=[];
  for(let line of lines){if(!layers.includes(line[6]))continue;
    if(depth){line=clipLine(line,side==='west'?0:1,depth.center-depth.width/2,depth.center+depth.width/2);if(!line)continue;}
    context.push(line);line=clipLine(line,2,low,high);if(!line)continue;visible.push(line);
    const dz=Math.abs(line[5]-line[2]);if(dz>4&&dz>Math.hypot(line[3]-line[0],line[4]-line[1])*.5)vertical.push(line);
  }
  return {context,visible,vertical};
}
export function decodeMap(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('windows-1252').decode(bytes);}}
