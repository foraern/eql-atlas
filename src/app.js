import './style.css';
import {MapViewer} from './viewer.js';
import {createCatalog,loadSource,decodeMap,parseLoc,formatLoc} from './core.js';

const $=id=>document.getElementById(id),desktop=window.atlasDesktop;
let catalog=[],files=new Map(),zone=null,sourceId='',loadID=0,labelOptions=[],ready=false;
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
const unwrap=async promise=>{const r=await promise;if(!r.ok)throw Error(r.error);return r.value;};
let viewer;
try{viewer=new MapViewer($('map-stage'),selectLabel);}catch(e){status('This device could not start WebGL 2: '+e.message,true);$('empty-state').querySelector('p').textContent='A browser or graphics driver with WebGL 2 is required.';throw e;}

function showCatalog(value){catalog=value.zones;$('zone-search').value='';renderZones();status(`${catalog.length} zone maps available`);const saved=localStorage.getItem('atlas-cross-zone');const z=catalog.find(z=>z.key===saved)||catalog.find(z=>z.key==='kedge')||catalog[0];if(z)selectZone(z.key);}
function renderZones(){const term=$('zone-search').value.toLowerCase().trim(),filtered=catalog.filter(z=>`${z.name} ${z.key}`.toLowerCase().includes(term));const frag=document.createDocumentFragment();for(const z of filtered){const b=document.createElement('button');b.className='zone-item';b.dataset.zone=z.key;b.setAttribute('aria-current',String(z.key===zone?.key));const name=document.createElement('strong'),key=document.createElement('small');name.textContent=z.name;key.textContent=z.key;b.append(name,key);b.onclick=()=>selectZone(z.key);frag.append(b);}$('zone-list').replaceChildren(frag);$('zone-count').textContent=`${filtered.length} of ${catalog.length} zone maps`;}
async function chooseFolder(){try{if(desktop){const c=await unwrap(desktop.chooseFolder());if(c)showCatalog(c);}else $('folder-input').click();}catch(e){status(e.message,true);}}
$('open-folder').onclick=chooseFolder;
$('folder-input').onchange=async e=>{try{files=new Map();for(const file of e.target.files){const parts=file.webkitRelativePath.split('/');parts.shift();files.set(parts.join('/'),file);}const zones=createCatalog([...files.keys()]);if(!zones.length)throw Error('No map files found. Choose the game’s maps folder.');showCatalog({zones});}catch(error){status(error.message,true);}};
$('zone-search').oninput=renderZones;
async function selectZone(key){zone=catalog.find(z=>z.key===key);if(!zone)return;localStorage.setItem('atlas-cross-zone',key);sourceId=zone.sources[0].id;$('source-select').replaceChildren(...zone.sources.map(s=>new Option(s.name,s.id)));$('source-select').disabled=false;renderZones();await loadMap();}
$('source-select').onchange=()=>{sourceId=$('source-select').value;loadMap();};
async function loadMap(){const id=++loadID;ready=false;status('Loading '+zone.name+'…');$('zone-title').textContent=zone.name;$('empty-state').hidden=false;$('empty-state').querySelector('h2').textContent='Loading '+zone.name+'…';$('empty-state').querySelector('p').textContent='Reading local map coordinates.';
  try{const data=desktop?await unwrap(desktop.load(zone.key,sourceId)):await loadSource(zone,sourceId,async p=>{const file=files.get(p);if(!file)throw Error('Map file is missing. Reopen the folder.');if(file.size>64*1024*1024)throw Error('Map file exceeds 64 MB.');return decodeMap(await file.arrayBuffer());});if(id!==loadID)return;
    viewer.setData(data);$('empty-state').hidden=Boolean(data.lines.length);if(!data.lines.length){$('empty-state').querySelector('h2').textContent='No line geometry';$('empty-state').querySelector('p').textContent='Try another map source for this zone.';}
    $('references').disabled=!data.references.length;if(!data.references.length)$('references').checked=false;
    $('cutaway').checked=false;$('location').value='';$('location-detail').textContent='Manual marker · no live tracking';$('landmark-detail').textContent='Select a map annotation to see its coordinates.';$('label-search').value='';
    for(const id of ['z-low','z-high','z-low-number','z-high-number']){$(id).min=Math.floor(data.bounds.min[2]);$(id).max=Math.max(Math.floor(data.bounds.min[2])+1,Math.ceil(data.bounds.max[2]));}
    $('z-low').value=viewer.options.low;$('z-high').value=viewer.options.high;syncHeightFields();setView(viewer.mode);updateOptions();ready=true;
    $('zone-subtitle').textContent=`${data.key} · ${data.source} · ${data.lines.length.toLocaleString()} source segments`;
    status(data.warnings.length?data.warnings.join(' · '):'Map loaded · files stay on this computer',data.warnings.length>0);
  }catch(e){if(id===loadID){status(e.message,true);$('zone-subtitle').textContent='Could not load this source.';$('empty-state').hidden=false;$('empty-state').querySelector('h2').textContent='Could not load this map';$('empty-state').querySelector('p').textContent=e.message;}}
}
function syncHeightFields(){$('z-low-number').value=Number($('z-low').value).toFixed(1);$('z-high-number').value=Number($('z-high').value).toFixed(1);}
function depthState(){const side=['north','west'].includes(viewer.mode);return side&&$('cutaway').checked?{center:Number($('depth').value),width:Math.max(1,Number($('depth-width').value)||100)}:null;}
function updateOptions(){if(!viewer.data)return;viewer.labels=[...viewer.data.labels,...($('references').checked?viewer.data.references:[])];viewer.setOptions({low:Number($('z-low').value),high:Number($('z-high').value),layers:$('extra-layers').checked?[0,1,2,3]:[0,1],ghost:$('ghost').checked,edges:$('vertical-edges').checked,labels:$('show-labels').checked,depth:depthState()});refreshLandmarks();$('depth-value').textContent=Number($('depth').value).toFixed(1);}
function refreshLandmarks(){const selected=viewer.selected,term=$('label-search').value.toLowerCase();labelOptions=viewer.labels.filter(l=>viewer.options.layers.includes(l.layer)&&l.name.toLowerCase().includes(term)).sort((a,b)=>a.name.localeCompare(b.name));$('landmark').replaceChildren(new Option(`${labelOptions.length} labels · choose one`,''),...labelOptions.map((l,i)=>new Option((l.reference?'[ref] ':'')+l.name,String(i))));if(selected){const i=labelOptions.indexOf(selected);if(i>=0)$('landmark').value=String(i);}}
for(const id of ['ghost','vertical-edges','references','extra-layers','show-labels'])$(id).onchange=updateOptions;
for(const side of ['low','high']){
  $('z-'+side).oninput=()=>{if(Number($('z-low').value)>Number($('z-high').value))$('z-'+(side==='low'?'high':'low')).value=$('z-'+side).value;syncHeightFields();updateOptions();};
  $('z-'+side+'-number').onchange=()=>{const n=Number($('z-'+side+'-number').value);if(!Number.isFinite(n)){status('Enter a numeric height.',true);return;}$('z-'+side).value=n;$('z-'+side).oninput();};
}
function allHeights(){if(!viewer.data)return;$('z-low').value=$('z-low').min;$('z-high').value=$('z-high').max;syncHeightFields();updateOptions();}
$('all-heights').onclick=allHeights;
function moveSlice(dir){if(!viewer.data)return;const min=Number($('z-low').min),max=Number($('z-high').max);let lo=Number($('z-low').value),hi=Number($('z-high').value),span=hi-lo;if(span>150||span<1)span=Math.min(80,max-min);const center=(hi+lo)/2+span*.8*dir;lo=Math.max(min,Math.min(max-span,center-span/2));$('z-low').value=lo;$('z-high').value=lo+span;syncHeightFields();updateOptions();}
$('slice-down').onclick=()=>moveSlice(-1);$('slice-up').onclick=()=>moveSlice(1);
function configureDepth(){const side=['north','west'].includes(viewer.mode);$('height-scale').disabled=!side;$('cutaway').disabled=!side;const active=side&&$('cutaway').checked;for(const id of ['depth','depth-width'])$(id).disabled=!active;if(viewer.data){const axis=viewer.mode==='west'?0:1,b=viewer.data.bounds;$('depth').min=b.min[axis];$('depth').max=Math.max(b.min[axis]+1,b.max[axis]);$('depth').value=b.center[axis];}$('depth-value').textContent=Number($('depth').value).toFixed(1);}
function setView(mode){viewer.setView(mode);for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===mode));configureDepth();updateOptions();$('interaction-help').textContent=mode==='3d'?'Drag to orbit · Shift-drag / right-drag to pan · Scroll to zoom':'Drag to pan · Scroll to zoom · Use cutaway to separate overlapping rooms';}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
$('height-scale').onchange=()=>{viewer.setMagnification(Number($('height-scale').value));updateOptions();};
$('cutaway').onchange=()=>{configureDepth();updateOptions();};$('depth').oninput=updateOptions;
$('depth-width').onchange=()=>{const n=Number($('depth-width').value);if(!Number.isFinite(n)||n<=0){status('Depth width must be positive.',true);$('depth-width').value=100;}updateOptions();};
$('fit-zone').onclick=()=>viewer.fit();$('fit-slice').onclick=()=>viewer.fit(true);$('zoom-in').onclick=()=>viewer.zoom(1.25);$('zoom-out').onclick=()=>viewer.zoom(.8);
$('label-search').oninput=refreshLandmarks;$('landmark').onchange=()=>{if($('landmark').value!=='')selectLabel(labelOptions[Number($('landmark').value)]);};
function selectLabel(label){if(!label)return;viewer.selected=label;viewer.focus(label.position);refreshLandmarks();$('landmark-detail').textContent=`${label.name} · /loc ${formatLoc(label.position)}${label.reference?' · Brewall reference':''}`;}
$('copy-loc').onclick=async()=>{if(!viewer.selected)return;try{const text=formatLoc(viewer.selected.position);if(desktop)await unwrap(desktop.copyLoc(text));else await navigator.clipboard.writeText(text);status('Landmark coordinates copied.');}catch{status('Select and copy the coordinates above.',true);}};
$('slice-here').onclick=()=>{const p=viewer.selected?.position;if(!p)return;$('z-low').value=p[2]-40;$('z-high').value=p[2]+40;if($('cutaway').checked)$('depth').value=p[viewer.mode==='west'?0:1];syncHeightFields();updateOptions();viewer.focus(p);};
function markLocation(){if(!viewer.data)return;const p=parseLoc($('location').value);if(!p){status('Enter three numbers in /loc order: Y, X, Z.',true);return;}const b=viewer.data.bounds,margin=Math.max(50,b.span*.15);if(p.some((v,i)=>v<b.min[i]-margin||v>b.max[i]+margin)){status('That location is outside this map. Check the zone and Y, X, Z order.',true);return;}viewer.marker=p;viewer.focus(p);$('location-detail').textContent=`/loc ${formatLoc(p)} · manual marker`;status('Location marked.');}
$('mark-location').onclick=markLocation;$('location').onkeydown=e=>{if(e.key==='Enter')markLocation();};$('clear-location').onclick=()=>{viewer.marker=null;$('location').value='';$('location-detail').textContent='Manual marker · no live tracking';viewer.requestRender();};
$('export').onclick=async()=>{if(!viewer.data)return;try{const blob=await viewer.png();if(!blob)throw Error('Could not create image.');if(desktop){const saved=await unwrap(desktop.exportPNG(new Uint8Array(await blob.arrayBuffer()),`${zone.key}-${viewer.mode}`));if(saved)status('Map image saved.');}else{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${zone.key}-${viewer.mode}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(e){status(e.message,true);}};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();$('zone-search').focus();}});
if(desktop){status('Looking for your map folder…');unwrap(desktop.catalog()).then(c=>{if(c)showCatalog(c);else status('Choose your EQL maps folder to begin.');}).catch(e=>status('Choose your maps folder: '+e.message,true));}
window.atlasTest={get state(){return {ready,zones:catalog.length,key:zone?.key,source:sourceId,lines:viewer.data?.lines.length,visible:viewer.filtered?.visible.length,mode:viewer.mode,factor:viewer.factor,marker:viewer.marker,context:viewer.filtered?.context.length,webgl:viewer.renderer.capabilities.isWebGL2!==false};},selectZone,setView,viewer};
