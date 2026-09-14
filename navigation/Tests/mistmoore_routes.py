#!/usr/bin/env python3
"""Read-only Mistmoore route regressions. No proprietary geometry is included.

Usage: python3 Tests/mistmoore_routes.py GAME_ROOT CACHE OUTPUT
Coordinates are map X,Y,Z; Princess Cherista is the Brewall annotation.
These tests establish mesh connectivity, not in-game movement permission.
"""
import json
import math
import pathlib
import sys
from navigation import Helper, expect

root, cache, output = (pathlib.Path(p).resolve() for p in sys.argv[1:4])
output.mkdir(parents=True, exist_ok=True)
cases = {
    'entrance-to-princess': (
        [-126.5327, 330.9282, -182.7388], [-23.1604, 132.3854, -156.5857]),
    'reported-coordinates': (
        [-118.78, 317.58, -181.60], [11.48, -164.55, -195.61]),
}
h = Helper()
results = []
try:
    for step in (1.5, 1.6, 2.0):
        profile = dict(height=6.55, radius=1.31, step=step, slope=45)
        prep = h.request('prepare', root=str(root), cache=str(cache),
                         zone='mistmoore', format='s3d', profile=profile)
        for name, (start, end) in cases.items():
            a, b = h.project(start), h.project(end)
            assert len(a) == len(b) == 1, (name, 'Expected unambiguous floors', a, b)
            row = dict(test=name, step=step, resolvedStart=a[0]['point'], resolvedEnd=b[0]['point'])
            if step == 1.5:
                expect('noRoute', lambda: h.request('findRoute', start=a[0], end=b[0]))
                row['status'] = 'noRoute'
            else:
                route = h.request('findRoute', start=a[0], end=b[0])
                assert math.dist(route['points'][-1], b[0]['point']) < .5
                assert route['distance'] > 500 and route['elapsedMS'] < 1000
                # Check every sampled point against a permitted surface with a tight tolerance.
                # Triangle heights at polygon edges can differ by a voxel-sized amount.
                for point in route['points']:
                    candidates = h.project(point)
                    assert candidates and candidates[0]['distance'] < .5, (name, point, candidates)
                row.update(status='complete', distance=route['distance'], queryMS=route['elapsedMS'])
                fixture = dict(zone='mistmoore', profile=profile, **route,
                               triangles=json.loads(pathlib.Path(prep['surfaceFile']).read_text()))
                (output / f'{name}-step{step}.json').write_text(json.dumps(fixture))
            results.append(row)
            print(json.dumps(row), flush=True)
    (output / 'results.json').write_text(json.dumps(results, indent=2))
    print('PASS: Mistmoore reported endpoints and entrance-to-Princess profile sensitivity, arrival and sampled surfaces')
finally:
    h.close()
