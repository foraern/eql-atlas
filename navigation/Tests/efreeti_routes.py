#!/usr/bin/env python3
"""Asset-bound Efreeti action-routing pilot; no real jump claim is made."""
import json,pathlib,sys,math
from navigation import Helper,Error,expect,ROOT

def main():
 root,cache,out=map(pathlib.Path,sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
 h=Helper()
 try:
  p=h.request('prepare',root=str(root.resolve()),cache=str(cache.resolve()),zone='soldungb',format='s3d')
  catalog=json.loads((ROOT/'engine/Crossings/soldungb.s3d.json').read_text())
  assert catalog['assets']==p['manifest']['assets'],'Installed assets differ from reviewed pilot; re-review crossings before testing'
  a=h.project([265.70,413.68,-111.97])[0];b=h.project([-334.17,481.02,-83.97])[0]
  def route(mode,start=a,end=b,**extra):return h.request('findRoute',start=start,end=end,catalogs=[catalog],movement=dict(mode=mode,**extra))
  expect('noRoute',lambda:route('walk'));expect('noRoute',lambda:route('tested'))
  reports=[]
  for first,last,name in [(a,b,'entrance-to-efreeti'),(b,a,'efreeti-to-entrance')]:
   r=route('preview',first,last)
   assert r['status']=='requiresVerification' and r['crossings']==4 and r['unverifiedCrossings']==4
   assert math.dist(r['points'][-1],last['point'])<.5
   for segment in r['segments']:
    if segment['kind']=='walk':
     for point in segment['points']:
      candidates=h.project(point)
      assert candidates and min(math.dist(point,c['point']) for c in candidates)<.5
    else:assert segment['kind']=='jump' and len(segment['points'])==2 and segment['status']=='unverified'
   reports.append(dict(name=name,distance=r['distance'],elapsedMS=r['elapsedMS'],crossings=r['crossings'],status=r['status']))
   (out/(name+'.json')).write_text(json.dumps(dict(zone='soldungb',format='s3d',profile=dict(height=6.55,radius=1.31,step=2,slope=45),movement=dict(mode='preview',capability='Standard movement',actions=['jump'],jumpDistance=16,jumpRise=2,jumpDrop=2,drop=8),triangles=json.load(open(p['surfaceFile'])),**r)))
  expect('noRoute',lambda:route('preview',jumpDistance=8))
  (out/'results.json').write_text(json.dumps(reports,indent=2)+'\n')
  print('PASS: Efreeti four-crossing previews in both directions; dry-only and tested modes reject; reduced jump limit rejects; walking samples and destination verified')
  print(json.dumps(reports))
 finally:h.close()
if __name__=='__main__':main()
