#!/usr/bin/env python3
"""Read-only Nagafen conditional-bridge checks; no in-game passage claim.
Usage: python3 navigation/Tests/nagafen_routes.py GAME_ROOT CACHE OUTPUT
"""
import copy,json,math,pathlib,sys
from navigation import Helper,expect,ROOT

def main():
 root,cache,out=map(pathlib.Path,sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
 h=Helper()
 try:
  p=h.request('prepare',root=str(root.resolve()),cache=str(cache.resolve()),zone='soldungb',format='s3d')
  catalog=json.loads((ROOT/'engine/Crossings/soldungb.s3d.json').read_text())
  assert catalog['assets']==p['manifest']['assets'],'Installed assets changed; re-review bridge endpoints'
  end=h.project([824.1087,1376.3337,85.2857]);assert len(end)==1
  results=[]
  for name,point in [('eql',[263.1578,425.4055,-112.7701]),('brewall',[265.7017,413.6787,-111.9677])]:
   start=h.project(point);assert len(start)==1
   for a,b,direction in [(start[0],end[0],'to-nagafen'),(end[0],start[0],'from-nagafen')]:
    def route(mode='preview',cat=catalog,actions=['bridge']):
     return h.request('findRoute',start=a,end=b,catalogs=[cat],movement=dict(mode=mode,actions=actions))
    expect('noRoute',lambda:route('walk'));expect('noRoute',lambda:route('tested'))
    expect('noRoute',lambda:route(actions=['jump']))
    stale=copy.deepcopy(catalog);stale['assets']['soldungb.s3d']='changed'
    expect('noRoute',lambda:route(cat=stale))
    r=route();assert r['status']=='requiresVerification' and r['crossings']==r['unverifiedCrossings']==1
    assert [s['kind'] for s in r['segments']]==['walk','bridge','walk']
    assert r['segments'][1]['status']=='unverified' and 'lower the bridge' in r['segments'][1]['note']
    assert math.dist(r['points'][-1],b['point'])<.5
    for segment in r['segments']:
     if segment['kind']=='walk':
      for point in segment['points']:
       candidates=h.project(point);assert candidates and min(math.dist(point,c['point']) for c in candidates)<.5
    results.append(dict(entrance=name,direction=direction,distance=r['distance'],elapsedMS=r['elapsedMS'],status=r['status'],crossings=r['crossings']))
  (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
  print('PASS: both Lavastorm entrances and reverse Nagafen previews; walking/tested/disabled/stale rejection; walking samples and arrival')
  print(json.dumps(results))
 finally:h.close()
if __name__=='__main__':main()
