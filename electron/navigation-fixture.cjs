// Synthetic public-domain EQG fixtures. No game assets are distributed.
const fs = require('node:fs/promises'),
  path = require('node:path'),
  zlib = require('node:zlib');
function pack(format, ...values) {
  const out = Buffer.alloc(
    [...format].reduce((n, f) => n + (f === 's' ? 4 : 4), 0),
  );
  let i = 0;
  for (const [j, f] of [...format].entries()) {
    if (f === 's') out.write(values[j], i, 4, 'ascii');
    else if (f === 'f') out.writeFloatLE(values[j], i);
    else if (f === 'i') out.writeInt32LE(values[j], i);
    else out.writeUInt32LE(values[j] >>> 0, i);
    i += 4;
  }
  return out;
}
function crc(name) {
  let v = 0;
  for (const b of Buffer.from(name + '\0')) {
    v ^= b << 24;
    for (let i = 0; i < 8; i++)
      v = (v << 1) ^ (v & 0x80000000 ? 0x04c11db7 : 0);
  }
  return v >>> 0;
}
function archive(files) {
  const parts = [pack('IsI', 0, 'PFS ', 131072)],
    entries = [];
  let length = 12;
  const add = (hash, raw) => {
    entries.push(pack('III', hash, length, raw.length));
    for (let i = 0; i < raw.length; i += 8192) {
      const chunk = raw.subarray(i, i + 8192),
        compressed = zlib.deflateSync(chunk),
        block = Buffer.concat([
          pack('II', compressed.length, chunk.length),
          compressed,
        ]);
      parts.push(block);
      length += block.length;
    }
  };
  const names = [pack('I', Object.keys(files).length)];
  for (const [name, raw] of Object.entries(files).sort()) {
    add(crc(name), raw);
    const n = Buffer.from(name + '\0');
    names.push(pack('I', n.length), n);
  }
  add(0x61580ac9, Buffer.concat(names));
  parts[0].writeUInt32LE(length, 0);
  return Buffer.concat([...parts, pack('I', entries.length), ...entries]);
}
function model(terrain = false) {
  const parts = [pack('sIIIII', terrain ? 'EQGT' : 'EQGM', 1, 0, 0, 4, 2)];
  if (!terrain) parts.push(pack('I', 0));
  for (const [x, y] of [
    [0, 0],
    [40, 0],
    [40, 20],
    [0, 20],
  ])
    parts.push(pack('ffffffff', x, y, terrain ? -100 : 0, 0, 0, 1, 0, 0));
  for (const [a, b, c] of [
    [0, 1, 2],
    [0, 2, 3],
  ])
    parts.push(pack('IIIiI', a, b, c, -1, 0));
  return Buffer.concat(parts);
}
function zone(stacked = false) {
  const names = Buffer.from('floor.mod\0placed\0base.ter\0TER_base\0upper\0');
  const at = (s) => names.indexOf(Buffer.from(s + '\0'));
  const parts = [
    pack('sIIIIII', 'EQGZ', 1, names.length, 2, stacked ? 3 : 2, 0, 0),
    names,
    pack('II', at('floor.mod'), at('base.ter')),
  ];
  parts.push(
    pack('iIfffffff', 0, at('placed'), 100, 200, 30, Math.PI / 2, 0, 0, 2),
    pack('iIfffffff', 1, at('TER_base'), 0, 0, 0, 0, 0, 0, 1),
  );
  if (stacked)
    parts.push(
      pack('iIfffffff', 0, at('upper'), 100, 200, 40, Math.PI / 2, 0, 0, 2),
    );
  return Buffer.concat(parts);
}
async function createFixture(directory) {
  const root = path.join(directory, 'navigation-fixture'),
    maps = path.join(root, 'maps');
  await fs.mkdir(path.join(maps, 'alternate'), { recursive: true });
  for (const key of ['dry', 'stacked', 'navonly', 'empty'])
    await fs.writeFile(
      path.join(root, key + '.eqg'),
      archive({
        [key + '.zon']: zone(key === 'stacked'),
        'floor.mod': model(),
        'base.ter': model(true),
      }),
    );
  const map =
    'L -200, -100, 30, -280, -100, 30, 255, 255, 255\nL -280, -100, 30, -280, -60, 30, 255, 255, 255\nL -280, -60, 30, -200, -60, 30, 255, 255, 255\nL -200, -60, 30, -200, -100, 30, 255, 255, 255\nP -270, -80, 30, 255, 255, 255, 1, Destination\n';
  await fs.writeFile(path.join(maps, 'empty.txt'), '');
  await fs.writeFile(path.join(maps, 'dry.txt'), map);
  await fs.writeFile(path.join(maps, 'stacked.txt'), map);
  await fs.writeFile(path.join(maps, 'alternate', 'dry.txt'), map);
  return maps;
}
module.exports = { createFixture, archive, model, zone };
