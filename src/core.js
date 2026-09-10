import zoneNames from './zone-names.json' with { type: 'json' };

// Map points are [mapX, mapY, Z]. A segment stores two points followed by its layer:
// [startX, startY, startZ, endX, endY, endZ, layer]. /loc uses [-mapY, -mapX, Z].
export function parseMap(text, { layer = 0, source = '', reference = false } = {}) {
  const lines = [];
  const labels = [];
  let skipped = 0;

  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!/^[LP]\s/.test(row)) continue;

    const parts = row
      .slice(1)
      .split(',')
      .map((part) => part.trim());
    const isLine = row[0] === 'L';
    const coordinateCount = isLine ? 6 : 3;
    const minimumFields = isLine ? 9 : 8;
    const coordinates = parts
      .slice(0, coordinateCount)
      .map((value) => (value === '' ? NaN : Number(value)));
    if (
      parts.length < minimumFields ||
      coordinates.length !== coordinateCount ||
      !coordinates.every(Number.isFinite)
    ) {
      skipped++;
      continue;
    }

    if (isLine) {
      lines.push([...coordinates, layer]);
    } else {
      const name = parts.slice(7).join(',').replaceAll('_', ' ').replaceAll('`', '’');
      if (name) labels.push({ position: coordinates, name, source, reference, layer });
    }
  }

  return { lines, labels, skipped };
}

export function parseLoc(text) {
  const fields = text
    .trim()
    .replace(/^\/loc\s*/i, '')
    .split(/[\s,]+/);
  if (fields.length !== 3 || fields.some((field) => !field)) return null;
  const coordinates = fields.map(Number);
  if (!coordinates.every(Number.isFinite)) return null;
  const [locY, locX, z] = coordinates;
  return [-locX, -locY, z];
}

export function formatLoc([mapX, mapY, z]) {
  return [-mapY, -mapX, z].map((value) => (Object.is(value, -0) ? 0 : value).toFixed(2)).join(', ');
}

export function clipLine(line, axis, low, high) {
  if (low > high) return null;
  const start = line[axis];
  const delta = line[axis + 3] - start;
  if (Math.abs(delta) < 1e-9) return start >= low && start <= high ? line : null;

  // Intersect the segment's parameter interval [0, 1] with the requested slab.
  const lowRatio = (low - start) / delta;
  const highRatio = (high - start) / delta;
  const enter = Math.max(0, Math.min(lowRatio, highRatio));
  const exit = Math.min(1, Math.max(lowRatio, highRatio));
  if (enter > exit) return null;

  return [
    ...[0, 1, 2].map((axis) => line[axis] + (line[axis + 3] - line[axis]) * enter),
    ...[0, 1, 2].map((axis) => line[axis] + (line[axis + 3] - line[axis]) * exit),
    line[6],
  ];
}

export function boundsOf(lines, labels = []) {
  // Both standard layers contain geometry. Only fall back to decorative layers
  // when there is no standard geometry to frame.
  const standardLines = lines.filter((line) => line[6] <= 1);
  const geometry = standardLines.length ? standardLines : lines;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const includePoint = (point) => {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  };

  for (const line of geometry) {
    includePoint(line);
    includePoint(line.slice(3, 6));
  }
  if (!geometry.length) {
    for (const label of labels) {
      if (label.layer <= 1) includePoint(label.position);
    }
  }
  if (!Number.isFinite(min[0])) {
    min.fill(0);
    max.fill(0);
  }

  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const size = min.map((value, axis) => max[axis] - value);
  return { min, max, center, size, span: Math.max(...size, 1) };
}

export function parseMapPath(relativePath) {
  const parts = relativePath.replaceAll('\\', '/').split('/');
  if (
    parts.length > 2 ||
    parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
  ) {
    return null;
  }
  const match = /^(.+?)(?:_([1-3]))?\.txt$/i.exec(parts.at(-1));
  if (!match) return null;
  return {
    key: match[1].toLowerCase(),
    layer: Number(match[2] || 0),
    source: parts.length === 2 ? parts[0] : '',
    path: relativePath,
  };
}

export function createCatalog(paths) {
  const zones = new Map();
  for (const path of paths) {
    const map = parseMapPath(path);
    if (!map) continue;
    if (!zones.has(map.key)) {
      zones.set(map.key, {
        key: map.key,
        name:
          zoneNames[map.key] ||
          map.key.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
        sources: [],
      });
    }
    const zone = zones.get(map.key);
    let source = zone.sources.find((source) => source.id === map.source);
    if (!source) {
      source = { id: map.source, name: map.source || 'EQL maps', files: {} };
      zone.sources.push(source);
    }
    source.files[map.layer] = path;
  }

  for (const zone of zones.values()) {
    zone.sources.sort((a, b) => {
      if (a.id === '') return -1;
      if (b.id === '') return 1;
      return a.id.localeCompare(b.id);
    });
  }
  return [...zones.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadSource(zone, sourceId, readText) {
  const source = zone.sources.find((source) => source.id === sourceId);
  if (!source) throw Error('Map source is unavailable.');

  const lines = [];
  const labels = [];
  const warnings = [];
  for (const [layer, path] of Object.entries(source.files)) {
    const parsed = parseMap(await readText(path), { layer: Number(layer), source: source.name });
    for (const line of parsed.lines) lines.push(line);
    for (const label of parsed.labels) labels.push(label);
    if (parsed.skipped) warnings.push(`${path}: ${parsed.skipped} malformed records skipped`);
  }

  // Reference labels are optional enrichment. Their failure must not discard
  // successfully loaded geometry; failures in the selected source still reject.
  const referenceSource = zone.sources.find(
    (source) => source.id !== sourceId && /brewall/i.test(source.name),
  );
  const referencePath = referenceSource?.files[1];
  let references = [];
  if (referencePath) {
    try {
      const parsed = parseMap(await readText(referencePath), {
        layer: 1,
        source: referenceSource.name,
        reference: true,
      });
      references = parsed.labels;
      if (parsed.skipped)
        warnings.push(`${referencePath}: ${parsed.skipped} malformed reference records skipped`);
    } catch (error) {
      warnings.push(`${referencePath}: optional references unavailable (${error.message})`);
    }
  }

  return {
    key: zone.key,
    name: zone.name,
    source: source.name,
    lines,
    labels,
    references,
    warnings,
    bounds: boundsOf(lines, labels),
  };
}

export function filteredGeometry(
  lines,
  { low = -Infinity, high = Infinity, layers = [0, 1], depth = null, side = 'north' } = {},
) {
  const context = [];
  const visible = [];
  const vertical = [];
  for (let line of lines) {
    if (!layers.includes(line[6])) continue;
    if (depth) {
      const axis = side === 'west' ? 0 : 1;
      line = clipLine(line, axis, depth.center - depth.width / 2, depth.center + depth.width / 2);
      if (!line) continue;
    }
    context.push(line);
    line = clipLine(line, 2, low, high);
    if (!line) continue;
    visible.push(line);

    const heightChange = Math.abs(line[5] - line[2]);
    const horizontalLength = Math.hypot(line[3] - line[0], line[4] - line[1]);
    if (heightChange > 4 && heightChange > horizontalLength * 0.5) vertical.push(line);
  }
  return { context, visible, vertical };
}

export function decodeMap(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
