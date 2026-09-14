#!/usr/bin/env python3
"""Synthetic EQG archives exercise the actual parser, placements, collision and regions."""
import math, pathlib, struct, tempfile, zlib
from navigation import Helper, expect

def pack(fmt,*args): return struct.pack('<'+fmt,*args)
def crc(name):
    value=0
    for byte in name.encode()+b'\0':
        value ^= byte << 24
        for _ in range(8):value=((value<<1)^(0x04c11db7 if value&0x80000000 else 0))&0xffffffff
    return value

def archive(path, files):
    data=bytearray(pack('I4sI',0,b'PFS ',131072));entries=[]
    def add(check,raw):
        entries.append((check,len(data),len(raw)))
        for i in range(0,len(raw),8192):
            chunk=raw[i:i+8192];compressed=zlib.compress(chunk)
            data.extend(pack('II',len(compressed),len(chunk))+compressed)
    names=pack('I',len(files))
    for name,raw in sorted(files.items()):
        add(crc(name),raw);encoded=name.encode()+b'\0';names+=pack('I',len(encoded))+encoded
    add(0x61580ac9,names)
    struct.pack_into('<I',data,0,len(data));data.extend(pack('I',len(entries)))
    for e in entries:data.extend(pack('III',*e))
    path.write_bytes(data)

def model(flags=0, terrain=False):
    result=pack('4sIIIII',b'EQGT' if terrain else b'EQGM',1,0,0,4,2)+(b'' if terrain else pack('I',0))
    for x,y in [(0,0),(40,0),(40,20),(0,20)]:result+=pack('8f',x,y,-100 if terrain else 0,0,0,1,0,0)
    for a,b,c in [(0,1,2),(0,2,3)]:result+=pack('IIIiI',a,b,c,-1,flags)
    return result

def zone(water=False):
    names=b'floor.mod\0ghost.mod\0placed\0ghost\0AWT_test\0base.ter\0TER_base\0'
    offsets={name:names.index(name.encode()+b'\0') for name in ['floor.mod','ghost.mod','placed','ghost','AWT_test','base.ter','TER_base']}
    out=pack('4sIIIIII',b'EQGZ',1,len(names),3,3,int(water),0)+names
    out+=pack('III',offsets['floor.mod'],offsets['ghost.mod'],offsets['base.ter'])
    # EQG stores horizontal rotation in rx; the loader remaps it to Z rotation.
    out+=pack('iI7f',0,offsets['placed'],100,200,30,math.pi/2,0,0,2)
    out+=pack('iI7f',1,offsets['ghost'],400,400,30,0,0,0,2)
    out+=pack('iI7f',2,offsets['TER_base'],0,0,0,0,0,0,1)
    if water:out+=pack('I4fII3f',offsets['AWT_test'],80,225,32,0,0,0,30,5,6)
    return out

def main():
    with tempfile.TemporaryDirectory(prefix='atlas-geometry-') as folder:
        root=pathlib.Path(folder);cache=root/'cache';h=Helper()
        try:
            for key,water in [('dry',False),('wet',True)]:
                archive(root/(key+'.eqg'),{key+'.zon':zone(water),'floor.mod':model(),'ghost.mod':model(1),'base.ter':model(terrain=True)})
            inventory=h.request('inventory',root=str(root))['zones']
            assert {z['key'] for z in inventory}=={'dry','wet'}
            def prepare(key):return h.request('prepare',root=str(root),cache=str(cache),zone=key,format='eqg',verifyWater=True)
            prepare('dry')
            a=[-210,-80,30];b=[-270,-80,30]
            assert h.project(a) and h.project(b),'rotation, translation, scale and winding preserve the expected floor'
            route=h.route(a,b);assert 59<route['distance']<61,'distance remains in game units'
            assert not h.project([-240,-110,30]),'rotated short axis ends at native X=100'
            assert not h.project([-430,-430,30]),'noncolliding placed object excluded'
            assert not h.project([0,0,0]),'object was translated away from the origin'
            prepare('wet')
            assert not h.project([-225,-80,30]),'water region axis conversion excludes the intended strip'
            expect('noRoute',lambda:h.route(a,b))
            archive(root/'dry.eqg',{'dry.zon':zone(),'ghost.mod':model(1),'base.ter':model(terrain=True)})
            expect('geometryRead',lambda:prepare('dry'))
            print('PASS: synthetic EQG archive, axis signs, scale, winding, rotated/translated objects, collision flags, water regions, missing required model')
        finally:h.close()
if __name__=='__main__':main()
