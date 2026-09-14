#!/usr/bin/env python3
"""Prepare every content-identified installed zone, one worker at a time.
Usage: python3 Tests/coverage.py GAME_DIRECTORY CACHE_DIRECTORY REPORT_DIRECTORY
Writes only caches/reports; source archives are never modified.
"""
import sys,json,pathlib,subprocess,time,os
from navigation import Helper
ROOT=pathlib.Path(__file__).resolve().parents[1]
def main():
 root,cache,out=map(lambda p:pathlib.Path(p).resolve(),sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
 h=Helper();inventory=h.request('inventory',root=str(root));h.close()
 (out/'inventory.json').write_text(json.dumps(inventory,indent=2))
 results=[]
 for i,z in enumerate(inventory['zones']):
  start=time.monotonic();req=dict(version=1,id=i,command='prepare',root=str(root),cache=str(cache),zone=z['key'],format=z['format'])
  try:
   p=subprocess.run([str(ROOT/'build'/('AtlasNavigation.exe' if os.name=='nt' else 'AtlasNavigation'))],input=json.dumps(req)+'\n',capture_output=True,text=True,timeout=600)
   events=[json.loads(l) for l in p.stdout.splitlines() if l.startswith('{')];last=events[-1] if events else {}
   if last.get('event')=='result':
    r=last['result'];entry=dict(z,status='ready',seconds=round(time.monotonic()-start,3),cached=r['cached'],engine=r['manifest']['engine'],surfaceFile=r['surfaceFile'])
   else:entry=dict(z,status='failed',seconds=round(time.monotonic()-start,3),code=last.get('code','helperExited'),error=last.get('message','Helper exit '+str(p.returncode)),diagnostics=p.stderr[-4000:])
  except subprocess.TimeoutExpired:entry=dict(z,status='failed',code='timeout',error='Preparation exceeded ten minutes')
  results.append(entry)
  tmp=out/'coverage.json.tmp';tmp.write_text(json.dumps(results,indent=2));tmp.replace(out/'coverage.json')
  print(f"{i+1}/{len(inventory['zones'])} {z['key']}.{z['format']}: {entry['status']} {entry.get('seconds','')} {entry.get('error','')}",flush=True)
 print('Complete:',sum(e['status']=='ready' for e in results),'ready,',sum(e['status']=='failed' for e in results),'failed.',flush=True)
if __name__=='__main__':main()
