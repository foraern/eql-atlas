import { scanFolder, readZone } from '../src/node-maps.js';
import assert from 'node:assert/strict';
const folder = process.argv[2];
if (!folder) throw Error('Usage: npm run test:maps -- /path/to/maps');
const catalog = await scanFolder(folder);
let sources = 0,
  lines = 0,
  warnings = 0,
  empty = 0,
  largest = { key: '', lines: 0 };
for (const zone of catalog.zones)
  for (const source of zone.sources) {
    const d = await readZone(catalog, zone.key, source.id);
    sources++;
    lines += d.lines.length;
    warnings += d.warnings.length;
    if (!d.lines.length) empty++;
    if (d.lines.length > largest.lines) largest = { key: zone.key, lines: d.lines.length };
    assert.ok(d.bounds.span >= 1 && Number.isFinite(d.bounds.span));
  }
const k = await readZone(catalog, 'kedge', '');
assert.equal(k.lines.length, 3517);
assert.equal(k.bounds.min[2], -349.88);
assert.equal(k.bounds.max[2], 363.84);
console.log(
  JSON.stringify(
    { zones: catalog.zones.length, sources, lines, warnings, empty, largest },
    null,
    2,
  ),
);
