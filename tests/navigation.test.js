import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  clipTriangle,
  routeClip,
  visiblePoint,
} from '../src/navigation-geometry.js';
const require = createRequire(import.meta.url);
const {
  NavigationBackend,
  profile,
  movement,
  validateCatalog,
} = require('../electron/navigation.cjs');
const { createFixture } = require('../electron/navigation-fixture.cjs');
const helper = path.resolve(
  'navigation/build/AtlasNavigation' +
    (process.platform === 'win32' ? '.exe' : ''),
);
test('navigation inputs reject invalid profiles, capabilities and unbound catalogs', () => {
  assert.equal(profile().step, 2);
  assert.deepEqual(movement({mode:'preview',actions:['bridge']}).actions, ['bridge']);
  assert.throws(() => profile({ height: NaN }));
  assert.throws(() => profile({ step: 8, height: 6 }));
  assert.throws(() => movement({ mode: 'automatic' }));
  assert.throws(() => movement({ jumpDistance: Infinity }));
  assert.throws(() => validateCatalog({ version: 1, zone: '../escape' }));
});
test('navigation surfaces and route use identical height and depth clipping', () => {
  const o = { low: 2, high: 4, side: 'north', depth: { center: 0, width: 4 } };
  const triangles = clipTriangle(
    [
      [-5, -5, 0],
      [5, -5, 6],
      [0, 5, 3],
    ],
    o,
  );
  assert.ok(triangles.length);
  for (const t of triangles)
    for (const p of t)
      assert.ok(
        visiblePoint(p, {
          ...o,
          low: 1.999999,
          high: 4.000001,
          depth: { center: 0, width: 4.000001 },
        }),
      );
  const line = routeClip([0, -6, 0], [0, 6, 6], o);
  assert.ok(line);
  assert.deepEqual(line.slice(0, 3), [0, -2, 2]);
  assert.deepEqual(line.slice(3, 6), [0, 2, 4]);
  assert.equal(routeClip([0, 0, 9], [5, 0, 9], o), null);
});
test('real helper IPC, lossless references, hashes, caches, failures, cancellation and resumable batch', async () => {
  await fs.access(helper);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-ü-'));
  const maps = await createFixture(temp),
    cache = path.join(temp, 'cache');
  const n = new NavigationBackend({
    helper,
    cache,
    settings: path.join(temp, 'catalogs.json'),
  });
  try {
    await n.init();
    await n.setRoot(path.dirname(maps));
    const inventory = await n.discover('inventory');
    assert.equal(inventory.zones.length, 4);
    const prep = await n.prepare({ zone: 'dry', format: 'eqg' }, 'prep');
    assert.ok(prep.triangles.length);
    assert.equal(prep.cached, false);
    const hash = createHash('sha256')
      .update(await fs.readFile(path.join(path.dirname(maps), 'dry.eqg')))
      .digest('hex');
    assert.equal(
      prep.manifest.assets['dry.eqg'],
      hash,
      'portable SHA256 equals Node SHA256',
    );
    const a = (
      await n.project(
        { context: prep.context, point: [-210, -80, 30] },
        'project',
      )
    ).candidates[0];
    const b = (
      await n.project(
        { context: prep.context, point: [-270, -80, 30] },
        'project',
      )
    ).candidates[0];
    assert.equal(typeof a.poly, 'string');
    const r = await n.route(
      { context: prep.context, start: a, end: b },
      'route',
    );
    assert.ok(r.distance > 59 && r.distance < 61);
    assert.equal(r.status, 'static');
    assert.equal(
      (await n.route({ context: prep.context, start: a, end: a }, 'identical'))
        .distance,
      0,
    );
    const warm = await n.prepare({ zone: 'dry', format: 'eqg' }, 'warm');
    assert.equal(warm.cached, true);
    await assert.rejects(
      n.route({ context: prep.context, start: a, end: b }, 'old'),
      { code: 'stale' },
    );
    const q = n.project(
      { context: warm.context, point: [-210, -80, 30] },
      'queued',
    );
    const rejection = assert.rejects(q, { code: 'cancelled' });
    await n.cancel();
    await rejection;
    assert.equal(n.child, null);
    await assert.rejects(
      n.prepare({ zone: 'missing', format: 'eqg' }, 'missing'),
      { code: 'unavailable' },
    );
    await n.setRoot(path.dirname(maps));
    await n.discover('again');
    const fresh = await n.prepare({ zone: 'dry', format: 'eqg' }, 'fresh');
    const changed = require('../electron/navigation-fixture.cjs');
    await fs.writeFile(
      path.join(path.dirname(maps), 'dry.eqg'),
      changed.archive({
        'dry.zon': changed.zone(),
        'floor.mod': changed.model(),
        'base.ter': changed.model(true),
        'note.txt': Buffer.from('changed'),
      }),
    );
    await assert.rejects(
      n.project({ context: fresh.context, point: [-210, -80, 30] }, 'changed'),
      { code: 'assetsChanged' },
    );
    assert.equal(
      (await n.prepare({ zone: 'dry', format: 'eqg' }, 'rebuild')).cached,
      false,
    );
    // A broken required object should fail one zone without stopping later zones.
    const fixture = require('../electron/navigation-fixture.cjs');
    await fs.writeFile(
      path.join(path.dirname(maps), 'dry.eqg'),
      fixture.archive({
        'dry.zon': fixture.zone(),
        'base.ter': fixture.model(true),
      }),
    );
    const batch = await n.prepareAll({}, 'batch', ['missing']);
    assert.equal(batch.results['dry.eqg'].status, 'failed');
    assert.equal(batch.results['navonly.eqg'].status, 'ready');
    assert.equal(batch.results.missing.status, 'unavailable');
    const resume = await n.prepareAll({}, 'resume');
    assert.equal(resume.results['navonly.eqg'].cached, true);
    assert.ok(
      JSON.parse(await fs.readFile(path.join(cache, 'coverage.json'), 'utf8'))
        .results['stacked.eqg'],
    );
    // Cancel after the helper reports real work, not merely while queued.
    let interrupted = false;
    n.progress = () => {
      if (!interrupted) {
        interrupted = true;
        void n.cancel();
      }
    };
    const floor = [
      [
        [0, 0, 0],
        [2000, 0, 0],
        [2000, 2000, 0],
      ],
      [
        [0, 0, 0],
        [2000, 2000, 0],
        [0, 2000, 0],
      ],
    ];
    await assert.rejects(
      n.request({ command: 'fixture', triangles: floor }, 'interrupt'),
      { code: 'cancelled' },
    );
    await n.reaping;
    assert.equal(interrupted, true);
    assert.equal(n.child, null);
    n.progress = () => {};
    assert.equal(
      (
        await n.prepare(
          { zone: 'navonly', format: 'eqg' },
          'after-interruption',
        )
      ).cached,
      true,
    );
    await n.cancel();
    const unavailable = new NavigationBackend({
      helper: path.join(temp, 'missing-helper'),
      cache,
      settings: path.join(temp, 'missing-settings'),
    });
    await assert.rejects(
      unavailable.request(
        { command: 'inventory', root: path.dirname(maps) },
        'missing-helper',
      ),
      { code: 'helperUnavailable' },
    );
    await unavailable.cancel();
  } finally {
    await n.cancel();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
