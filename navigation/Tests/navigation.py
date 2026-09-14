#!/usr/bin/env python3
"""Black-box navigation checks with synthetic collision geometry; no game assets needed."""
import json, subprocess, pathlib, math, sys, tempfile, os
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Helper:
 def __init__(self):
  self.log=tempfile.TemporaryFile(mode='w+')
  self.p=subprocess.Popen([str(ROOT/'build'/('AtlasNavigation.exe' if os.name=='nt' else 'AtlasNavigation'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log,text=True)
  self.id=0
 def close(self):
  self.p.stdin.close();self.p.wait(timeout=5)
 def request(self,command,**values):
  self.id+=1;self.p.stdin.write(json.dumps(dict(version=1,id=self.id,command=command,**values))+'\n');self.p.stdin.flush()
  while True:
   line=self.p.stdout.readline()
   assert line, 'helper exited before returning JSON'
   r=json.loads(line)
   assert r['id']==self.id
   if r['event']=='result':return r['result']
   if r['event']=='error':raise Error(r['code'],r['message'],r.get('details',{}))
 def fixture(self,triangles,**kw):return self.request('fixture',triangles=triangles,**kw)
 def project(self,p):return self.request('projectPoint',point=p)['candidates']
 def route(self,a,b):return self.request('findRoute',start=self.project(a)[0],end=self.project(b)[0])
class Error(Exception):
 def __init__(self,code,message,details=None):self.code=code;self.details=details or {};super().__init__(message)
def floor(x0,y0,x1,y1,z=0):
 a=[x0,y0,z];b=[x1,y0,z];c=[x1,y1,z];d=[x0,y1,z]
 return [[a,b,c],[a,c,d]]
def wall(x0,y0,x1,y1,z0=0,z1=15):
 a=[x0,y0,z0];b=[x1,y1,z0];c=[x1,y1,z1];d=[x0,y0,z1]
 return [[a,b,c],[a,c,d],[c,b,a],[d,c,a]]
def expect(code,fn):
 try:fn()
 except Error as e:assert e.code==code,(e.code,code,str(e));return
 raise AssertionError('Expected '+code)
def main():
 h=Helper()
 try:
  h.fixture(floor(0,0,100,100))
  r=h.route([5,5,0],[95,95,0]);assert 120<r['distance']<130
  assert all(abs(p[2])<1 for p in r['points'])
  assert not h.project([105,50,0]);assert not h.project([50,50,20])
  assert h.route([50,50,0],[50,50,0])['distance']<.01
  # A bounded projection onto a polygon edge remains a valid route endpoint.
  # Detour's point-in-polygon flag can be false on these exact boundaries.
  for p in ([1,50,0],[50,1,0],[99,50,0],[50,99,0]):
   e=h.project(p)[0]
   assert h.request('findRoute',start=e,end=e)['distance']<.01
   assert h.request('findRoute',start=e,end=h.project([50,50,0])[0])['distance']>40
   outside=dict(e,point=[e['point'][0]+.1,e['point'][1],e['point'][2]])
   if p[0]==99:expect('endpoint',lambda:h.request('findRoute',start=outside,end=e))
  expect('point',lambda:h.project([1,2]))
  h.fixture(floor(0,0,100,100)+wall(50,0,50,75))
  r=h.route([20,20,0],[80,20,0]);assert max(p[1] for p in r['points'])>75
  assert r['distance']>125
  # Every crossing of the wall's X must use the opening.
  for a,b in zip(r['points'],r['points'][1:]):
   if (a[0]-50)*(b[0]-50)<0:assert min(a[1],b[1])>=75
  h.fixture(floor(0,0,40,40)+floor(60,0,100,40))
  expect('noRoute',lambda:h.route([20,20,0],[80,20,0]))
  h.fixture(floor(0,0,50,50)+floor(0,0,50,50,10))
  assert len(h.project([25,25,5]))==2
  expect('noRoute',lambda:h.route([25,25,0],[25,25,10]))
  # Water classification must disconnect the full strip, including clearance.
  h.fixture(floor(0,0,100,50),blocked=[[[45,0,-1],[55,50,2]]])
  assert not h.project([50,25,0])
  expect('noRoute',lambda:h.route([20,25,0],[80,25,0]))
  expect('emptyWalkingSurface',lambda:h.fixture(floor(0,0,50,50),blocked=[[[-10,-10,-10],[60,60,20]]]))
  # Low ceiling prevents traversal beneath it.
  h.fixture(floor(0,0,100,40)+[t[::-1] for t in floor(40,0,60,40,4)])
  expect('noRoute',lambda:h.route([20,20,0],[80,20,0]))
  # Stair with a supported small rise versus an unsupported climb/drop.
  for rise,success in [(1,True),(4,False)]:
   h.fixture(floor(0,0,40,40)+floor(40,0,80,40,rise)+wall(40,0,40,40,0,rise))
   if success:assert h.route([20,20,0],[60,20,rise])['distance']>35
   else:expect('noRoute',lambda:h.route([20,20,0],[60,20,rise]))
  # A continuous ramp is traversable only within the slope setting.
  for rise,success in [(15,True),(60,False)]:
   ramp=[[[30,0,0],[60,0,rise],[60,40,rise]],[[30,0,0],[60,40,rise],[30,40,0]]]
   h.fixture(floor(0,0,30,40)+ramp+floor(60,0,90,40,rise))
   if success:assert h.route([15,20,0],[75,20,rise])['distance']>60
   else:expect('noRoute',lambda:h.route([15,20,0],[75,20,rise]))
  # Radius changes eliminate a narrow supported connecting corridor.
  narrow=floor(0,0,30,40)+floor(30,18,60,22)+floor(60,0,90,40)
  h.fixture(narrow,profile={'radius':.4});assert h.route([15,20,0],[75,20,0])['distance']>55
  h.fixture(narrow,profile={'radius':2});expect('noRoute',lambda:h.route([15,20,0],[75,20,0]))
  # Widely separated surfaces use vertical tile layers without connecting them.
  h.fixture(floor(0,0,50,50,-33000)+floor(0,0,50,50,0))
  assert h.project([25,25,-33000]) and h.project([25,25,0])
  expect('noRoute',lambda:h.route([25,25,-33000],[25,25,0]))
  # Cross several tile seams in both directions.
  h.fixture(floor(0,0,350,50));assert h.route([10,25,0],[340,25,0])['distance']>329
  expect('profile',lambda:h.fixture(floor(0,0,20,20),profile={'height':-1}))
  expect('capacity',lambda:h.fixture(floor(0,0,40000,40000)))
  print('PASS: endpoints, wall detours, complete routes, disconnected/stacked floors, water exclusion, headroom, steps, slopes, clearance, tile seams')
 finally:h.close()
if __name__=='__main__':main()
