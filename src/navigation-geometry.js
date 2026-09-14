import { clipLine, boundsOf } from './core.js';
export function slabs(options) {
  const result = [[2, options.low, options.high]];
  if (options.depth)
    result.push([
      options.side === 'west' ? 0 : 1,
      options.depth.center - options.depth.width / 2,
      options.depth.center + options.depth.width / 2,
    ]);
  return result;
}
export function visiblePoint(p, options) {
  return slabs(options).every(
    ([axis, lo, hi]) => p[axis] >= lo && p[axis] <= hi,
  );
}
export function routeClip(a, b, options) {
  let line = [...a, ...b, 0];
  for (const [axis, lo, hi] of slabs(options)) {
    line = clipLine(line, axis, lo, hi);
    if (!line) return null;
  }
  return line;
}
export function clipTriangle(triangle, options) {
  let polygon = triangle;
  for (const [axis, lo, hi] of slabs(options))
    for (const [limit, sign] of [
      [lo, 1],
      [hi, -1],
    ]) {
      if (!Number.isFinite(limit)) continue;
      const out = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length],
          insideA = (a[axis] - limit) * sign >= 0,
          insideB = (b[axis] - limit) * sign >= 0;
        if (insideA) out.push(a);
        if (insideA !== insideB) {
          const t = (limit - a[axis]) / (b[axis] - a[axis]);
          out.push(a.map((v, k) => v + (b[k] - v) * t));
        }
      }
      polygon = out;
    }
  const triangles = [];
  for (let i = 1; i + 1 < polygon.length; i++)
    triangles.push([polygon[0], polygon[i], polygon[i + 1]]);
  return triangles;
}
export function pointBounds(points) {
  return boundsOf(
    [],
    points.map((position) => ({ position, layer: 0 })),
  );
}
