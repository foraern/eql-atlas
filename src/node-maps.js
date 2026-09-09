import fs from 'node:fs/promises';
import path from 'node:path';
import {createCatalog,loadSource,decodeMap} from './core.js';

export async function scanFolder(root) {
  root=await fs.realpath(root);
  const entries=await fs.readdir(root,{withFileTypes:true}),paths=[];
  for(const entry of entries){
    if(entry.name.startsWith('.'))continue;
    if(entry.isFile()&&/\.txt$/i.test(entry.name))paths.push(entry.name);
    if(entry.isDirectory())for(const f of await fs.readdir(path.join(root,entry.name),{withFileTypes:true})){if(f.isFile()&&/\.txt$/i.test(f.name))paths.push(`${entry.name}/${f.name}`);}
  }
  const zones=createCatalog(paths);if(!zones.length)throw Error('No map text files found. Select the game’s maps folder.');
  return {root,zones};
}
export async function readZone(catalog,key,sourceId) {
  const zone=catalog.zones.find(z=>z.key===key);if(!zone)throw Error('Unknown zone.');
  return loadSource(zone,sourceId,async relative=>{
    const real=await fs.realpath(path.join(catalog.root,relative));
    const sub=path.relative(catalog.root,real);
    if(sub.startsWith('..'+path.sep)||sub==='..'||path.isAbsolute(sub))throw Error('Map resolves outside the selected folder.');
    const stat=await fs.stat(real);if(stat.size>64*1024*1024)throw Error('Map file exceeds the 64 MB limit.');
    return decodeMap(await fs.readFile(real));
  });
}
