#!/usr/bin/env python3
"""Integration checks against read-only installed assets; all mutations use a temporary copy."""
import sys,pathlib,tempfile,shutil,hashlib,json
from navigation import Helper,Error,expect
root=pathlib.Path(sys.argv[1]).resolve();cache=pathlib.Path(sys.argv[2]).resolve()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
originals=[root/'mistmoore.s3d',root/'mistmoore_obj.s3d'];before=[sha(p) for p in originals]
with tempfile.TemporaryDirectory(prefix='atlas-real-tests-') as tmp:
 tmp=pathlib.Path(tmp);source=tmp/'game';source.mkdir()
 for p in originals:shutil.copyfile(p,source/p.name)
 for name in ['geometry.map','mistmoore.wtr']:(source/name).write_text('DO NOT OVERWRITE')
 h=Helper()
 def prepare(**kw):return h.request('prepare',root=str(source),cache=str(tmp/'cache'),zone='mistmoore',format='s3d',**kw)
 try:
  a=prepare();assert not a['cached'];assert prepare()['cached']
  start=h.project([-75.996788,68.370064,-120.806252])[0];end=h.project([-75.827087,192.079163,-120.806244])[0]
  r=h.request('findRoute',start=start,end=end);assert r['distance']>100 and r['elapsedMS']<1000
  assert all((source/name).read_text()=='DO NOT OVERWRITE' for name in ['geometry.map','mistmoore.wtr'])
  changed=prepare(profile={'radius':1.5});assert changed['key']!=a['key']
  assert prepare()['cached']
  (source/'mistmoore_obj.s3d').unlink()
  expect('geometryRead',prepare)
  shutil.copyfile(root/'mistmoore_obj.s3d',source/'mistmoore_obj.s3d')
  assert prepare()['cached']
  # Hash-based invalidation must notice content changes even when metadata is restored.
  archive=source/'mistmoore.s3d';stat=archive.stat();archive.write_bytes(archive.read_bytes()+b'\0')
  import os;os.utime(archive,ns=(stat.st_atime_ns,stat.st_mtime_ns))
  updated=prepare();assert not updated['cached'];assert updated['contentKey']!=a['contentKey']
  # Invalid cache data is rebuilt, never presented as a usable route.
  meshfile=pathlib.Path(updated['surfaceFile']).with_name('mesh.bin');meshfile.write_bytes(b'invalid')
  h.close();h=Helper();assert not prepare()['cached']
  print('PASS: cold/warm cache, real route below one second, profile isolation, missing dependency, content hashes, corrupt-cache recovery, read-only source sentinel files')
 finally:h.close()
assert before==[sha(p) for p in originals]
h=Helper()
try:
 r=h.request('prepare',root=str(root),cache=str(cache),zone='kedge',format='s3d',verifyWater=True)
 underwater=[0,0,-100]
 assert not h.project(underwater),'Underwater control must not project onto a dry walking surface'
 print('PASS: Kedge underwater endpoint excluded; dry-tile proof checked against exact per-voxel water queries')
finally:h.close()
