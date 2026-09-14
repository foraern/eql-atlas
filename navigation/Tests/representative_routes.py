#!/usr/bin/env python3
"""Read-only routes in another dungeon, an outdoor zone, standard EQG and EQG v4."""
import sys,pathlib,json,math
from navigation import Helper
root,cache,out=(pathlib.Path(p).resolve() for p in sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
cases=[
 ('arena2','eqg',[859.3587646484375,-696.5462646484375,47.399654388427734],[-289.974609375,-346.67962646484375,-9.266136169433594]),
 ('commonlands','eqg',[3259.2021484375,474.63165283203125,38.392913818359375],[-2448.00634765625,-722.178955078125,-22.508848190307617]),
 ('commons','s3d',[500.0773010253906,-283.16015625,21.397911071777344],[-3874.674560546875,-789.5416870117188,-48.602081298828125]),
 ('najena','s3d',[-141.72500610351562,-200.59584045410156,-27.799999237060547],[108.67499542236328,-349.3958435058594,-4.921271324157715])]
results=[];h=Helper()
try:
 for zone,fmt,a,b in cases:
  h.log.seek(0);h.log.truncate()
  h.request('prepare',root=str(root),cache=str(cache),zone=zone,format=fmt,validateOnly=True)
  h.log.seek(0);diagnostics=h.log.read();(out/(zone+'-loader.log')).write_text(diagnostics)
  if zone=='commonlands':assert 'v4' in diagnostics,'Expected actual EQG v4 parser coverage'
  prep=h.request('prepare',root=str(root),cache=str(cache),zone=zone,format=fmt)
  start,end=h.project(a),h.project(b);assert len(start)==len(end)==1
  route=h.request('findRoute',start=start[0],end=end[0]);assert route['status']=='static';assert math.dist(route['points'][-1],end[0]['point'])<.5
  for p in route['points']:
   candidates=h.project(p);assert candidates and candidates[0]['distance']<.5
  row=dict(zone=zone,format=fmt,distance=route['distance'],queryMS=route['elapsedMS'],points=len(route['points']))
  results.append(row);print(json.dumps(row),flush=True)
  (out/(zone+'.json')).write_text(json.dumps(dict(zone=zone,format=fmt,**route)))
 (out/'results.json').write_text(json.dumps(results,indent=2))
 print('PASS: representative S3D, EQG and EQG v4 route arrivals and every sampled point lies on the permitted surface')
finally:h.close()
