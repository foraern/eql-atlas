#!/usr/bin/env python3
"""Explicit crossing graph regression tests; every userTested record here is synthetic."""
import copy, json, math
from navigation import Helper, Error, expect, floor
PROFILE=dict(height=6.55,radius=1.31,step=2,slope=45)
def main():
 h=Helper()
 try:
  geometry=floor(0,0,40,40)+floor(48,0,70,40)+floor(80,0,120,40)
  h.fixture(geometry)
  start=h.project([10,20,0])[0];end=h.project([110,20,0])[0]
  def point(p):return h.project(p)[0]['point']
  links=[dict(id='one',kind='jump',label='First gap',**{'from':point([39,20,0]),'to':point([49,20,0])}),dict(id='two',kind='jump',label='Second gap',**{'from':point([69,20,0]),'to':point([81,20,0])})]
  catalog=dict(version=1,zone='fixture',format='synthetic',assets={},links=links)
  def route(mode='preview',cat=None,**movement):return h.request('findRoute',start=start,end=end,catalogs=[catalog if cat is None else cat],movement=dict(mode=mode,**movement))
  try:route('walk')
  except Error as e:
   assert e.code=='noRoute' and len(e.details['excluded'])==2 and e.details['reachable']
   assert max(p[0] for t in e.details['reachable'] for p in t)<41,'reachable overlay never includes other islands'
  else:assert False
  expect('noRoute',lambda:route('tested'))
  r=route();assert r['status']=='requiresVerification' and r['unverifiedCrossings']==2 and r['crossings']==2
  assert [s['kind'] for s in r['segments']]==['walk','jump','walk','jump','walk']
  assert math.dist(r['points'][-1],end['point'])<.5
  for s in r['segments']:
   if s['kind']=='walk':
    for p in s['points']:assert h.project(p),'walking samples remain on dry surfaces'
   else:assert len(s['points'])==2 and s['status']=='unverified','schematic jumps never become smoothed walking lines'
  reverse=lambda:h.request('findRoute',start=end,end=start,catalogs=[catalog],movement=dict(mode='preview'))
  expect('noRoute',reverse)
  expect('noRoute',lambda:route(jumpDistance=5))
  expect('noRoute',lambda:route(actions=['swim']))
  stale=copy.deepcopy(catalog);stale['assets']={'changed.s3d':'new'}
  expect('noRoute',lambda:route(cat=stale))
  tested=copy.deepcopy(catalog)
  for link in tested['links']:link['verification']=dict(status='userTested',capability='Test character',date='2026-09-14',notes='Synthetic verification fixture only',profile=PROFILE)
  r=route('tested',cat=tested,capability='Test character');assert r['status']=='userTestedCrossings' and r['unverifiedCrossings']==0
  assert all(s['verification']['notes']=='Synthetic verification fixture only' for s in r['segments'] if s['kind']!='walk')
  expect('noRoute',lambda:route('tested',cat=tested,capability='Different character'))
  # A valid but longer user-tested route wins over a shorter unverified shortcut.
  alternate=copy.deepcopy(tested);alternate['links'].append(dict(id='shortcut',kind='swim',**{'from':start['point'],'to':end['point']}))
  r=route(cat=alternate,capability='Test character',actions=['jump','swim']);assert r['unverifiedCrossings']==0 and r['crossings']==2
  # Other supported actions require explicit links and enabled capabilities.
  for kind in ['swim','door','lift','bridge']:
   c=copy.deepcopy(catalog)
   for link in c['links']:link['kind']=kind;link['note']='Operate the crossing before proceeding.'
   r=route(cat=c,actions=[kind]);assert all(s['kind'] in ['walk',kind] for s in r['segments'])
   expect('noRoute',lambda:route('walk',cat=c,actions=[kind]))
   expect('noRoute',lambda:route('tested',cat=c,actions=[kind]))
   for link in c['links']:link['verification']=dict(status='userTested',capability='Test character',date='2026-09-15',notes='Synthetic evidence',profile=PROFILE)
   r=route('tested',cat=c,actions=[kind],capability='Test character')
   assert all(s['note']=='Operate the crossing before proceeding.' and s['verification']['notes']=='Synthetic evidence' for s in r['segments'] if s['kind']!='walk')
  # Catalogs with duplicate IDs or excessive links fail explicitly.
  dup=copy.deepcopy(catalog);dup['links'].append(dup['links'][0]);expect('catalog',lambda:route(cat=dup))
  huge=copy.deepcopy(catalog);huge['links']=[dict(links[0],id=str(i)) for i in range(65)];expect('capacity',lambda:route(cat=huge))
  expect('capabilities',lambda:route(jumpDistance=-1))
  # A profile change invalidates the user-test evidence even with the same assets.
  h.fixture(geometry,profile=dict(PROFILE,height=7));start=h.project([10,20,0])[0];end=h.project([110,20,0])[0]
  expect('noRoute',lambda:route('tested',cat=tested,capability='Test character'))
  # Same-floor pure walking is preferred to any special connection.
  h.fixture(floor(0,0,120,40));start=h.project([10,20,0])[0];end=h.project([110,20,0])[0]
  assert route()['crossings']==0 and route()['status']=='static'
  assert h.request('findRoute',start=start,end=start)['distance']<.01
  # Drop direction and height are enforced independently from jumping.
  h.fixture(floor(0,0,40,40,5)+floor(48,0,90,40,0))
  start=h.project([10,20,5])[0];end=h.project([80,20,0])[0]
  c=dict(version=1,zone='fixture',format='synthetic',assets={},links=[dict(id='drop',kind='drop',**{'from':point([39,20,5]),'to':point([49,20,0])})])
  assert route(cat=c,actions=['drop'])['crossings']==1
  expect('noRoute',lambda:route(cat=c,actions=['drop'],drop=2))
  c['links'][0]['from'],c['links'][0]['to']=c['links'][0]['to'],c['links'][0]['from']
  expect('noRoute',lambda:h.request('findRoute',start=end,end=start,catalogs=[c],movement=dict(mode='preview',actions=['drop'])))
  # Ambiguous stacked landing floors are rejected instead of silently selected.
  h.fixture(floor(0,0,40,40)+floor(48,0,90,40)+floor(48,0,90,40,10))
  start=h.project([10,20,0])[0];end=h.project([80,20,0])[0]
  c['links']=[dict(id='ambiguous',kind='jump',**{'from':point([39,20,0]),'to':[50,20,5]})]
  expect('noRoute',lambda:route(cat=c))
  print('PASS: action graph, dry-only failure diagnostics, directed crossings, capability limits, ambiguous floors, asset and verification invalidation, safer route preference, schematic segments, complete arrival and capacity errors')
 finally:h.close()
if __name__=='__main__':main()
