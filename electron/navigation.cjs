const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const fail = (code, message, details = {}) =>
  Object.assign(new Error(message), { code, details });
const point = (p) =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
function profile(value = {}) {
  const p = Object.fromEntries(
    Object.entries({ height: 6.55, radius: 1.31, step: 2, slope: 45 }).map(
      ([k, v]) => [k, value[k] ?? v],
    ),
  );
  if (
    !Object.values(p).every(Number.isFinite) ||
    p.height < 1 ||
    p.height > 30 ||
    p.radius < 0.4 ||
    p.radius > 10 ||
    p.step < 0 ||
    p.step > p.height ||
    p.slope < 1 ||
    p.slope > 60
  )
    throw fail(
      'profile',
      'Height 1–30, radius 0.4–10, step 0–height and slope 1–60 required.',
    );
  return p;
}
function movement(value = {}) {
  const m = {
    mode: value.mode ?? 'walk',
    capability: value.capability ?? 'Standard movement',
    actions: value.actions ?? ['jump'],
    jumpDistance: value.jumpDistance ?? 16,
    jumpRise: value.jumpRise ?? 2,
    jumpDrop: value.jumpDrop ?? 2,
    drop: value.drop ?? 8,
  };
  if (
    !['walk', 'tested', 'preview'].includes(m.mode) ||
    typeof m.capability !== 'string' ||
    !m.capability.trim() ||
    m.capability.length > 120 ||
    !Array.isArray(m.actions) ||
    m.actions.length > 5 ||
    m.actions.some(
      (a) => !['jump', 'swim', 'drop', 'door', 'lift'].includes(a),
    ) ||
    [m.jumpDistance, m.jumpRise, m.jumpDrop, m.drop].some(
      (v) => !Number.isFinite(v) || v < 0 || v > 100,
    )
  )
    throw fail('capabilities', 'Invalid character movement settings.');
  return m;
}
function endpoint(p) {
  if (
    !p ||
    !point(p.point) ||
    typeof p.poly !== 'string' ||
    !/^\d{1,20}$/.test(p.poly)
  )
    throw fail('endpoint', 'Invalid selected floor.');
  return { point: p.point, poly: p.poly };
}
function validateCatalog(c) {
  if (
    !c ||
    c.version !== 1 ||
    !/^[a-z0-9_-]{1,100}$/.test(c.zone) ||
    !['s3d', 'eqg'].includes(c.format) ||
    !c.assets ||
    typeof c.assets !== 'object' ||
    Array.isArray(c.assets) ||
    !Object.keys(c.assets).length ||
    !Array.isArray(c.links) ||
    c.links.length > 64
  )
    throw fail(
      'catalog',
      'Expected a version 1, asset-bound crossing catalog with at most 64 links.',
    );
  for (const [name, hash] of Object.entries(c.assets))
    if (
      !/^[\w.-]+$/.test(name) ||
      typeof hash !== 'string' ||
      !/^(?:[a-f0-9]{64}|missing)$/.test(hash)
    )
      throw fail('catalog', 'Invalid source identity.');
  const ids = new Set();
  for (const link of c.links) {
    if (
      !link ||
      typeof link.id !== 'string' ||
      !link.id ||
      link.id.length > 120 ||
      ids.has(link.id) ||
      !['jump', 'swim', 'drop', 'door', 'lift'].includes(link.kind) ||
      !point(link.from) ||
      !point(link.to)
    )
      throw fail('catalog', 'Invalid or duplicate crossing.');
    ids.add(link.id);
    if (
      link.via &&
      (!Array.isArray(link.via) ||
        link.via.length > 512 ||
        !link.via.every(point))
    )
      throw fail('catalog', 'Invalid crossing waypoints.');
  }
  return c;
}
async function atomicJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID();
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, file);
}
class NavigationBackend {
  constructor({ helper, cache, settings, progress = () => {} }) {
    this.helper = helper;
    this.cache = cache;
    this.settings = settings;
    this.progress = progress;
    this.preparation = 0;
    this.generation = 0;
    this.tail = Promise.resolve();
    this.reaping = Promise.resolve();
    this.child = null;
    this.waiter = null;
    this.root = null;
    this.inventory = null;
    this.context = null;
    this.manifest = null;
    this.custom = [];
    this.buffer = '';
  }
  async init() {
    try {
      this.custom = JSON.parse(await fs.readFile(this.settings, 'utf8'));
      if (!Array.isArray(this.custom) || this.custom.length > 32)
        this.custom = [];
      else this.custom = this.custom.map(validateCatalog);
    } catch {
      this.custom = [];
    }
    const directory = path.join(path.dirname(this.helper), 'Crossings');
    this.bundled = [];
    try {
      for (const file of await fs.readdir(directory))
        if (file.endsWith('.json'))
          this.bundled.push(
            validateCatalog(
              JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')),
            ),
          );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  cancel() {
    this.preparation++;
    this.generation++;
    this.context = null;
    this.manifest = null;
    const child = this.child;
    this.child = null;
    if (this.waiter) {
      this.waiter.reject(
        fail('cancelled', 'Cancelled. Completed caches are retained.'),
      );
      this.waiter = null;
    }
    if (child) {
      this.reaping = new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        timer.unref();
        child.once('close', async () => {
          clearTimeout(timer);
          if (child.pid)
            await fs
              .rm(path.join(this.cache, 'scratch-' + child.pid), {
                recursive: true,
                force: true,
              })
              .catch(() => {});
          resolve();
        });
        if (child.exitCode !== null || child.signalCode !== null) {
          clearTimeout(timer);
          resolve();
        } else child.kill('SIGTERM');
      });
    }
    return this.reaping;
  }
  request(body, operation, check = () => {}) {
    const generation = this.generation;
    const run = async () => {
      await this.reaping;
      if (generation !== this.generation)
        throw fail('cancelled', 'Navigation request superseded.');
      await check();
      if (!this.child) {
        this.buffer = '';
        const child = spawn(this.helper, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        });
        this.child = child;
        child.stderr.on('data', () => {}); // Drain parser diagnostics; stdout is the only protocol.
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          if (child !== this.child) return;
          this.buffer += chunk;
          if (Buffer.byteLength(this.buffer) > 256 * 1024 * 1024) {
            this.waiter?.reject(
              fail('capacity', 'Navigation response exceeds 256 MB.'),
            );
            this.waiter = null;
            void this.cancel();
            return;
          }
          let end;
          while ((end = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end + 1);
            try {
              const event = JSON.parse(line),
                w = this.waiter;
              if (!w || event.id !== w.id || event.version !== 1)
                throw fail(
                  'protocol',
                  'Unexpected navigation helper response.',
                );
              if (event.event === 'progress')
                this.progress({
                  operation: w.operation,
                  message: event.message,
                  done: event.done,
                  total: event.total,
                });
              else if (event.event === 'result') {
                this.waiter = null;
                w.resolve(event.result);
              } else if (event.event === 'error') {
                this.waiter = null;
                w.reject(fail(event.code, event.message, event.details));
              } else throw fail('protocol', 'Unknown helper event.');
            } catch (e) {
              this.waiter?.reject(e);
              this.waiter = null;
              void this.cancel();
            }
          }
        });
        child.on('error', (e) => {
          if (child === this.child) {
            this.waiter?.reject(
              fail(
                'helperUnavailable',
                'The navigation helper could not start: ' + e.message,
              ),
            );
            this.waiter = null;
            this.child = null;
          }
        });
        child.on('close', () => {
          if (child === this.child) {
            this.waiter?.reject(
              fail(
                'helperExited',
                'Navigation helper exited before completing the request.',
              ),
            );
            this.waiter = null;
            this.child = null;
            this.context = null;
          }
        });
        child.stdin.on('error', (e) => {
          if (child === this.child) {
            this.waiter?.reject(e);
            this.waiter = null;
            void this.cancel();
          }
        });
      }
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        this.waiter = { id, operation, resolve, reject };
        this.child.stdin.write(
          JSON.stringify({ ...body, id, version: 1 }) + '\n',
        );
      });
    };
    const task = this.tail.then(run, run);
    this.tail = task.catch(() => {});
    return task;
  }
  async setRoot(root) {
    const reaping = this.cancel(),
      generation = this.generation;
    this.root = null;
    this.inventory = null;
    await reaping;
    const resolved = await fs.realpath(root);
    if (generation !== this.generation)
      throw fail('cancelled', 'Installation selection superseded.');
    this.root = resolved;
    return resolved;
  }
  async discover(operation) {
    if (!this.root) throw fail('root', 'Choose the game installation folder.');
    const generation = this.generation,
      r = await this.request(
        { command: 'inventory', root: this.root },
        operation,
      );
    if (generation !== this.generation)
      throw fail('cancelled', 'Inventory superseded.');
    this.inventory = r;
    return r;
  }
  async prepare(value, operation, loadSurface = true) {
    const ticket = ++this.preparation;
    const p = profile(value.profile);
    if (!this.inventory) await this.discover(operation);
    if (
      !this.inventory.zones.some(
        (z) => z.key === value.zone && z.format === value.format,
      )
    )
      throw fail('unavailable', 'Selected zone geometry is not installed.');
    this.context = null;
    this.manifest = null;
    const generation = this.generation;
    const r = await this.request(
      {
        command: 'prepare',
        root: this.root,
        cache: this.cache,
        zone: value.zone,
        format: value.format,
        profile: p,
      },
      operation,
    );
    if (generation !== this.generation || ticket !== this.preparation)
      throw fail('cancelled', 'Preparation superseded.');
    if (loadSurface) {
      const file = await fs.realpath(r.surfaceFile),
        relative = path.relative(await fs.realpath(this.cache), file);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw fail('protocol', 'Surface file is outside the navigation cache.');
      if ((await fs.stat(file)).size > 220 * 1024 * 1024)
        throw fail('capacity', 'Navigation surface exceeds display capacity.');
      r.triangles = JSON.parse(await fs.readFile(file, 'utf8'));
    }
    if (generation !== this.generation || ticket !== this.preparation)
      throw fail('cancelled', 'Preparation superseded.');
    this.context = randomUUID();
    this.manifest = r.manifest;
    return { ...r, context: this.context, surfaceFile: undefined };
  }
  requireContext(context) {
    if (typeof context !== 'string' || context !== this.context)
      throw fail(
        'stale',
        'Zone or profile changed. Prepare and select the endpoints again.',
      );
  }
  async requireFreshContext(context) {
    this.requireContext(context);
    const generation = this.generation,
      manifest = this.manifest;
    for (const [name, expected] of Object.entries(manifest.assets)) {
      let actual;
      try {
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(
          path.join(this.root, name),
        )) {
          if (generation !== this.generation)
            throw fail('cancelled', 'Source check superseded.');
          hash.update(bytes);
        }
        actual = hash.digest('hex');
      } catch (e) {
        if (e.code === 'ENOENT') actual = 'missing';
        else throw e;
      }
      if (actual !== expected) {
        this.context = null;
        throw fail(
          'assetsChanged',
          'Game geometry changed. Find the route again to rebuild navigation.',
        );
      }
    }
    this.requireContext(context);
  }
  project(value, operation) {
    if (!point(value.point))
      throw fail('point', 'Enter three finite coordinates.');
    return this.request(
      { command: 'projectPoint', point: value.point },
      operation,
      () => this.requireFreshContext(value.context),
    );
  }
  route(value, operation) {
    const catalogs = this.bundled
      .filter(
        (c) =>
          !this.custom.some((v) => v.zone === c.zone && v.format === c.format),
      )
      .concat(this.custom);
    return this.request(
      {
        command: 'findRoute',
        start: endpoint(value.start),
        end: endpoint(value.end),
        movement: movement(value.movement),
        catalogs,
      },
      operation,
      () => this.requireFreshContext(value.context),
    );
  }
  async importCatalog(data) {
    if (Buffer.byteLength(data) > 1024 * 1024)
      throw fail('capacity', 'Crossing catalog exceeds 1 MB.');
    const c = validateCatalog(JSON.parse(data)),
      next = this.custom
        .filter((v) => v.zone !== c.zone || v.format !== c.format)
        .concat(c);
    if (
      next.length > 32 ||
      Buffer.byteLength(JSON.stringify(next)) > 4 * 1024 * 1024
    )
      throw fail('capacity', 'Imported catalogs exceed capacity.');
    await this.cancel();
    await atomicJSON(this.settings, next);
    this.custom = next;
    return { zone: c.zone, format: c.format, links: c.links.length };
  }
  review(value) {
    this.requireContext(value.context);
    const m = movement(value.movement),
      manifest = this.manifest;
    const catalog = this.custom.find(
      (c) => c.zone === manifest.zone && c.format === manifest.format,
    ) ||
      this.bundled.find(
        (c) => c.zone === manifest.zone && c.format === manifest.format,
      ) || {
        version: 1,
        zone: manifest.zone,
        format: manifest.format,
        assets: manifest.assets,
        links: [],
      };
    return {
      ...catalog,
      reviewTemplate: {
        status: 'unverified',
        capability: m.capability,
        date: '',
        notes:
          'Record an observed in-game test before marking userTested. Each direction must be tested separately.',
        profile: profile(manifest.profile),
      },
    };
  }
  async prepareAll(value, operation, mapKeys = []) {
    const p = profile(value.profile);
    if (!this.inventory) await this.discover(operation);
    const generation = this.generation,
      results = {};
    for (const entry of this.inventory.failures || [])
      results[entry.archive] = {
        status: 'failed',
        code: 'archiveRead',
        error: entry.error,
      };
    for (const key of mapKeys)
      if (!this.inventory.zones.some((z) => z.key === key))
        results[key] = { status: 'unavailable' };
    for (const z of this.inventory.zones) {
      if (generation !== this.generation)
        throw fail(
          'cancelled',
          'Batch cancelled; completed caches are retained.',
        );
      try {
        const r = await this.prepare(
          { zone: z.key, format: z.format, profile: p },
          operation,
          false,
        );
        results[z.key + '.' + z.format] = { status: 'ready', cached: r.cached };
      } catch (e) {
        if (e.code === 'cancelled') throw e;
        results[z.key + '.' + z.format] = {
          status: 'failed',
          code: e.code,
          error: e.message,
        };
      }
      await atomicJSON(path.join(this.cache, 'coverage.json'), {
        profile: p,
        results,
      });
      this.progress({
        operation,
        message: `${z.key}: ${results[z.key + '.' + z.format].status} · ${Object.keys(results).length} recorded`,
        type: 'batch',
        key: z.key + '.' + z.format,
        entry: results[z.key + '.' + z.format],
      });
    }
    return { profile: p, results };
  }
}
module.exports = {
  NavigationBackend,
  profile,
  movement,
  validateCatalog,
  point,
  fail,
};
