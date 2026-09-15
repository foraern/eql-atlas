import { parseLoc, formatLoc } from './core.js';
const $ = (id) => document.getElementById(id);
const aborted = () =>
  Object.assign(Error('Navigation request superseded.'), { code: 'cancelled' });
export class NavigationController {
  constructor(viewer, { mergeInventory, onSurface }) {
    this.viewer = viewer;
    this.desktop = window.atlasDesktop;
    this.mergeInventory = mergeInventory;
    this.onSurface = onSurface;
    this.serial = 0;
    this.busy = false;
    this.context = null;
    this.zone = null;
    this.inventory = null;
    this.resolved = {};
    this.route = null;
    this.restoreSettings();
    this.desktop?.onNavigationProgress((e) => {
      if (e.operation === this.operation) {
        const fraction =
          e.total > 0
            ? ` · ${e.done}/${e.total} tiles (${Math.floor((100 * e.done) / e.total)}%)`
            : '';
        this.status(e.message + fraction);
        if (e.total > 0) {
          $('route-progress').max = e.total;
          $('route-progress').value = e.done;
        } else $('route-progress').removeAttribute('value');
        if (e.type === 'batch') {
          $('route-coverage').hidden = false;
          $('route-coverage').textContent +=
            `${e.key}: ${e.entry.status}${e.entry.error ? ' — ' + e.entry.error : ''}\n`;
        }
      }
    });
    $('route-calculate').onclick = () => this.run((id) => this.calculate(id));
    $('route-clear').onclick = () => {
      this.invalidate(true);
      this.status('Choose two points to find a walking route.');
    };
    $('route-cancel').onclick = () => {
      this.invalidate();
      this.status('Cancelled. Completed caches are retained.');
    };
    $('route-fit').onclick = () => viewer.fitRoute();
    $('route-swap').onclick = () => {
      const a = $('route-start').value;
      $('route-start').value = $('route-end').value;
      $('route-end').value = a;
      this.invalidate();
    };
    for (const side of ['start', 'end']) {
      $('route-' + side).oninput = () => this.invalidate();
      $('route-' + side).onkeydown = (e) => {
        if (e.key === 'Enter') this.run((id) => this.calculate(id));
      };
      $('route-' + side + '-source').onchange = (e) => {
        const source = e.target.value;
        e.target.value = '';
        this.run(async (id) => {
          if (source === 'pick') {
            await this.ensure(id);
            this.check(id);
            this.picking = side;
            viewer.navigationPicking = true;
            viewer.showNavigation = true;
            viewer.rebuildNavigation();
            this.status(
              'Click a visible floor for ' +
                (side === 'start' ? 'start' : 'destination') +
                '.',
            );
            return;
          }
          const p =
            source === 'landmark'
              ? viewer.selected?.position
              : viewer.marker || parseLoc($('location').value);
          if (!p)
            throw Error(
              source === 'landmark'
                ? 'Select a landmark first.'
                : 'Enter your /loc in Your location first.',
            );
          this.clearRoute();
          $('route-' + side).value = formatLoc(p);
          delete this.resolved[side];
          await this.ensure(id);
          await this.resolve(side, p, id);
        });
      };
    }
    viewer.onNavigationPick = (points) =>
      this.run(async (id) => {
        if (!this.picking) return;
        const side = this.picking;
        if (!points.length)
          throw Error(
            'No selectable navigation surface here. Adjust the slice or view.',
          );
        const p =
          points.length === 1
            ? points[0]
            : await this.choose(
                'Choose the ' + side + ' floor',
                points,
                (p) => '/loc ' + formatLoc(p),
                id,
              );
        this.check(id);
        this.picking = null;
        viewer.navigationPicking = false;
        this.clearRoute();
        $('route-' + side).value = formatLoc(p);
        await this.resolve(side, p, id, true);
        viewer.showNavigation =
          $('route-surfaces').checked || this.zone?.navigationOnly;
        viewer.rebuildNavigation();
      });
    for (const key of [
      'height',
      'radius',
      'step',
      'slope',
      'format',
      'mode',
      'capability',
      'jumpDistance',
      'jumpRise',
      'jumpDrop',
      'drop',
    ])
      $('route-' + key).onchange = () => {
        if (key === 'format' && this.zone)
          localStorage.setItem(
            'atlas-geometry-' + this.zone.key,
            $('route-format').value,
          );
        this.saveSettings();
        this.invalidate();
        if (['height', 'radius', 'step', 'slope', 'format'].includes(key))
          this.viewer.setNavigation([]);
      };
    for (const input of $('route-actions').querySelectorAll('input'))
      input.onchange = () => {
        this.saveSettings();
        this.invalidate();
      };
    $('route-surfaces').onchange = () =>
      this.run(async (id) => {
        if ($('route-surfaces').checked) await this.ensure(id);
        viewer.showNavigation =
          $('route-surfaces').checked || this.zone?.navigationOnly;
        viewer.rebuildNavigation();
      });
    $('route-root').onclick = () =>
      this.run(async (id) => {
        this.context = null;
        this.resolved = {};
        this.inventory = null;
        this.clearRoute();
        this.viewer.setNavigation([]);
        const r = await this.call('chooseRoot', {}, id);
        if (r) {
          this.context = null;
          this.resolved = {};
          this.clearRoute();
          this.inventory = r;
          this.mergeInventory(r);
          this.configureVersions();
          this.status(this.inventorySummary(r));
        }
      });
    $('route-batch').onclick = () =>
      this.run(async (id) => {
        this.context = null;
        this.resolved = {};
        this.clearRoute();
        $('route-coverage').textContent = '';
        const r = await this.call('batch', { profile: this.profile() }, id);
        $('route-coverage').hidden = false;
        $('route-coverage').textContent = Object.entries(r.results)
          .map(
            ([key, v]) =>
              `${key}: ${v.status}${v.error ? ' — ' + v.error : ''}`,
          )
          .join('\n');
        const counts = {};
        for (const v of Object.values(r.results))
          counts[v.status] = (counts[v.status] || 0) + 1;
        this.status(
          Object.entries(counts)
            .map(([k, v]) => `${v} ${k}`)
            .join(' · '),
        );
      });
    $('route-import').onclick = () =>
      this.run(async (id) => {
        const r = await this.call('import', {}, id);
        if (r) {
          this.context = null;
          this.resolved = {};
          this.clearRoute();
          this.status(
            `Imported ${r.links} crossings for ${r.zone}. Test evidence is checked per direction, profile and setup.`,
          );
        }
      });
    $('route-review').onclick = () =>
      this.run(async (id) => {
        await this.ensure(id);
        const r = await this.call(
          'review',
          { context: this.context, movement: this.movement() },
          id,
        );
        if (r)
          this.status(
            'Crossing review exported. Record actual in-game evidence before marking a direction userTested.',
          );
      });
    this.availability();
  }
  restoreSettings() {
    try {
      const saved = JSON.parse(
        localStorage.getItem('atlas-navigation-settings'),
      );
      if (saved?.version !== 1) return;
      for (const key of [
        'height',
        'radius',
        'step',
        'slope',
        'jumpDistance',
        'jumpRise',
        'jumpDrop',
        'drop',
      ])
        if (Number.isFinite(saved[key]))
          $('route-' + key).value = String(saved[key]);
      if (['walk', 'tested', 'preview'].includes(saved.mode))
        $('route-mode').value = saved.mode;
      if (
        typeof saved.capability === 'string' &&
        saved.capability.length <= 120
      )
        $('route-capability').value = saved.capability;
      if (Array.isArray(saved.actions))
        for (const input of $('route-actions').querySelectorAll('input'))
          input.checked = saved.actions.includes(input.value);
    } catch {
      /* Invalid saved preferences use the visible defaults. */
    }
  }
  saveSettings() {
    const p = this.profile(),
      m = this.movement();
    if (
      !Object.values(p).every(Number.isFinite) ||
      p.height < 1 ||
      p.height > 30 ||
      p.radius < 0.4 ||
      p.radius > 10 ||
      p.step < 0 ||
      p.step > p.height ||
      p.slope < 1 ||
      p.slope > 60 ||
      !m.capability ||
      [m.jumpDistance, m.jumpRise, m.jumpDrop, m.drop].some(
        (v) => !Number.isFinite(v) || v < 0 || v > 100,
      )
    )
      return;
    localStorage.setItem(
      'atlas-navigation-settings',
      JSON.stringify({ version: 1, ...p, ...m }),
    );
  }
  status(text, error = false) {
    $('route-status').textContent = text;
    $('route-status').classList.toggle('error', error);
  }
  check(id) {
    if (id !== this.serial) throw aborted();
  }
  async call(command, value = {}, id = this.serial) {
    this.check(id);
    const r = await this.desktop.navigation(command, value, String(id));
    this.check(id);
    if (!r.ok)
      throw Object.assign(Error(r.error), { code: r.code, details: r.details });
    return r.value;
  }
  async run(fn) {
    if (!this.desktop) return;
    if (this.busy) this.invalidate();
    const id = ++this.serial;
    this.operation = String(id);
    this.busy = true;
    $('route-progress').removeAttribute('value');
    this.availability();
    try {
      return await fn(id);
    } catch (e) {
      if (id !== this.serial || e.code === 'cancelled') return;
      if (['assetsChanged', 'stale', 'helperExited'].includes(e.code)) {
        this.context = null;
        this.resolved = {};
        this.clearRoute();
      }
      this.status(e.message, true);
      if (e.details?.reachable) {
        this.viewer.setReachable(e.details.reachable, e.details.excluded || []);
        this.status(
          e.message +
            ' ' +
            e.details.explanation +
            ' ' +
            (e.details.excluded || [])
              .map((x) => x.reason)
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(' · '),
          true,
        );
      }
    } finally {
      if (id === this.serial) {
        this.busy = false;
        this.availability();
      }
    }
  }
  availability() {
    for (const e of $('routing-panel').querySelectorAll('input,select,button'))
      e.disabled = !this.desktop;
    $('route-cancel').hidden = !this.busy && !this.picking;
    $('route-progress').hidden = !this.busy;
    for (const id of [
      'calculate',
      'swap',
      'batch',
      'import',
      'review',
      'root',
      'surfaces',
    ])
      $('route-' + id).disabled = !this.desktop || this.busy;
    $('route-fit').disabled = !this.route;
    if (!this.desktop)
      this.status(
        'Routing requires the desktop app and local game geometry. Browser map viewing remains available.',
      );
  }
  clearRoute() {
    this.route = null;
    $('route-instructions').hidden = true;
    $('route-instructions-text').textContent = '';
    this.viewer.setRoute(null, this.resolved);
    this.viewer.setReachable(null);
    this.availability();
  }
  invalidate(clearInputs = false) {
    ++this.serial;
    this.operation = '';
    this.busy = false;
    this.context = null;
    this.resolved = {};
    this.picking = null;
    this.viewer.navigationPicking = false;
    this.choiceResolve?.(null);
    this.choiceResolve = null;
    if ($('route-choice').open) $('route-choice').close();
    void this.desktop?.navigation('cancel', {}, '');
    for (const side of ['start', 'end']) {
      $('route-' + side + '-resolved').textContent = '';
      if (clearInputs) $('route-' + side).value = '';
    }
    this.clearRoute();
    this.status('Route cleared. Choose endpoints and find a route.');
    this.availability();
  }
  setZone(zone) {
    if (this.zone?.key === zone.key) return;
    this.invalidate(true);
    this.zone = zone;
    this.viewer.setNavigation([]);
    this.configureVersions();
    this.status('Choose two points to find a walking route.');
  }
  async refreshInventory() {
    return this.run(async (id) => {
      const r = await this.call('inventory', {}, id);
      this.inventory = r;
      this.mergeInventory(r);
      this.configureVersions();
      this.status(this.inventorySummary(r));
    });
  }
  inventorySummary(r) {
    return `${r.zones.length} installed geometry versions.${r.failures?.length ? ' ' + r.failures.length + ' archive inspection failures.' : ''}`;
  }
  configureVersions() {
    const choices =
      this.inventory?.zones.filter((z) => z.key === this.zone?.key) || [];
    const saved = localStorage.getItem('atlas-geometry-' + this.zone?.key);
    $('route-format').replaceChildren(
      new Option(
        choices.length ? 'Choose geometry…' : 'Geometry unavailable',
        '',
      ),
      ...choices.map((z) => new Option(z.format.toUpperCase(), z.format)),
    );
    $('route-format').value =
      choices.length === 1
        ? choices[0].format
        : choices.some((z) => z.format === saved)
          ? saved
          : '';
  }
  profile() {
    return Object.fromEntries(
      ['height', 'radius', 'step', 'slope'].map((k) => [
        k,
        Number($('route-' + k).value),
      ]),
    );
  }
  movement() {
    return {
      mode: $('route-mode').value,
      capability: $('route-capability').value.trim(),
      actions: [...$('route-actions').querySelectorAll('input:checked')].map(
        (e) => e.value,
      ),
      ...Object.fromEntries(
        ['jumpDistance', 'jumpRise', 'jumpDrop', 'drop'].map((k) => [
          k,
          Number($('route-' + k).value),
        ]),
      ),
    };
  }
  async ensure(id) {
    if (this.context) return;
    if (!this.zone) throw Error('Choose a zone first.');
    if (!this.inventory) {
      this.inventory = await this.call('inventory', {}, id);
      this.mergeInventory(this.inventory);
      this.configureVersions();
    }
    const choices = this.inventory.zones.filter((z) => z.key === this.zone.key);
    if (!choices.length)
      throw Error(
        'Zone geometry unavailable. Choose the game folder in Route options if it is installed elsewhere.',
      );
    let format = $('route-format').value;
    if (!format) {
      format = await this.choose(
        'Choose the installed geometry version',
        choices.map((z) => z.format),
        (f) => f.toUpperCase(),
        id,
      );
      this.check(id);
      $('route-format').value = format;
      localStorage.setItem('atlas-geometry-' + this.zone.key, format);
    }
    this.status('Preparing ' + this.zone.key + '…');
    const r = await this.call(
      'prepare',
      { zone: this.zone.key, format, profile: this.profile() },
      id,
    );
    const b = this.viewer.data?.bounds;
    const wasFull =
      !b ||
      (this.viewer.options.low <= Math.floor(b.min[2]) &&
        this.viewer.options.high >= Math.ceil(b.max[2]));
    this.context = r.context;
    this.manifest = r.manifest;
    this.viewer.setNavigation(r.triangles);
    this.viewer.showNavigation =
      $('route-surfaces').checked || this.zone.navigationOnly;
    this.onSurface(r.triangles, wasFull);
    this.viewer.rebuildNavigation();
    this.status(r.cached ? 'Cached navigation ready.' : 'Navigation ready.');
  }
  choose(title, values, label, id) {
    this.check(id);
    $('route-choice-title').textContent = title;
    return new Promise((resolve, reject) => {
      const done = (value) => {
        this.choiceResolve = null;
        $('route-choice').close();
        if (value === null) reject(aborted());
        else resolve(value);
      };
      this.choiceResolve = done;
      $('route-choices').replaceChildren(
        ...values.map((value) => {
          const b = document.createElement('button');
          b.textContent = label(value);
          b.onclick = () => done(value);
          return b;
        }),
      );
      $('route-choice-cancel').onclick = () => done(null);
      $('route-choice').oncancel = (e) => {
        e.preventDefault();
        done(null);
      };
      $('route-choice').showModal();
    });
  }
  async resolve(side, point, id, picked = false) {
    const r = await this.call('project', { context: this.context, point }, id);
    let candidates = r.candidates;
    // A ray hit already identifies a visible surface. Never switch to a hidden height.
    if (picked)
      candidates = candidates.filter(
        (c) => Math.abs(c.point[2] - point[2]) < 0.5,
      );
    if (!candidates.length)
      throw Error(
        'No nearby walking floor within twice the radius horizontally and one character height vertically.',
      );
    const c =
      candidates.length === 1
        ? candidates[0]
        : await this.choose(
            'Choose the ' + side + ' floor',
            candidates,
            (c) =>
              '/loc ' +
              formatLoc(c.point) +
              ` · adjustment ${c.distance.toFixed(2)} units`,
            id,
          );
    this.check(id);
    this.resolved[side] = c;
    $('route-' + side + '-resolved').textContent =
      '/loc ' +
      formatLoc(c.point) +
      ` · adjusted ${c.distance.toFixed(2)} units`;
    this.viewer.setRoute(this.route, this.resolved);
    this.status('Endpoint placed on the selected floor.');
    return c;
  }
  async calculate(id) {
    const a = parseLoc($('route-start').value),
      b = parseLoc($('route-end').value);
    if (!a || !b)
      throw Error('Enter start and destination in /loc order: Y, X, Z.');
    this.clearRoute();
    await this.ensure(id);
    const start = this.resolved.start || (await this.resolve('start', a, id)),
      end = this.resolved.end || (await this.resolve('end', b, id));
    this.status('Finding route…');
    const query = async (movement) => {
      const began = performance.now();
      const result = await this.call('route', { context: this.context, start, end, movement }, id);
      result.queryWallMS = performance.now() - began;
      return result;
    };
    let r;
    const movement = this.movement();
    try {
      r = await query(movement);
    } catch (error) {
      const excludedActions = [...new Set((error.details?.excluded || [])
        .map((link) => link.kind)
        .filter((kind) => ['bridge', 'door', 'lift', 'jump', 'drop', 'swim'].includes(kind)))];
      if (error.code !== 'noRoute' || !excludedActions.length) throw error;
      const previewMovement = { ...movement, mode: 'preview',
        actions: [...new Set([...movement.actions, ...excludedActions])] };
      if (movement.mode === 'preview' && excludedActions.every((kind) => movement.actions.includes(kind)))
        throw error;
      // Offer a preview only when recorded transitions complete this exact route.
      // Never connect arbitrary gaps or relax the walking profile.
      try { r = await query(previewMovement); }
      catch (previewError) {
        if (previewError.code === 'noRoute') throw error;
        throw previewError;
      }
      this.viewer.setReachable(error.details.reachable || [], error.details.excluded || []);
      this.status('No route under the current rules. Recorded conditional crossings provide a preview; their conditions must hold.');
      const preview = await this.choose(
        `Preview a route with ${r.unverifiedCrossings} unverified crossings?`,
        [true, false],
        (value) => value ? 'Show conditional route preview' : 'Keep current routing rules',
        id,
      );
      this.check(id);
      if (!preview) throw error;
      $('route-mode').value = 'preview';
      const used = new Set(r.segments.map((segment) => segment.kind));
      for (const input of $('route-actions').querySelectorAll('input'))
        if (used.has(input.value)) input.checked = true;
      this.saveSettings();
      // Recheck source freshness after the user closes the prompt.
      r = await query(this.movement());
    }
    r.capability = this.movement().capability;
    $('route-instructions').hidden = false;
    $('route-instructions-text').textContent =
      `Setup: ${this.movement().capability}\n` +
      r.segments
        .map((segment, i) => {
          const p = segment.points;
          return (
            `${i + 1}. ${segment.kind} · /loc ${formatLoc(p[0])} → ${formatLoc(p[p.length - 1])}` +
            (segment.kind === 'walk'
              ? ''
              : `\n${segment.label || segment.kind} · ${segment.status}\n${segment.note || ''}` +
                (segment.verification
                  ? `\nUser test: ${segment.verification.date} · ${segment.verification.notes}`
                  : ''))
          );
        })
        .join('\n\n');
    this.route = r;
    if (r.segments.some((segment) => segment.kind === 'bridge'))
      $('route-instructions').open = true;
    this.viewer.setRoute(r, this.resolved);
    this.viewer.fitRoute();
    const kind =
      r.status === 'requiresVerification'
        ? `UNVERIFIED PREVIEW · ${r.unverifiedCrossings} crossings need testing`
        : r.status === 'userTestedCrossings'
          ? `${r.crossings} user-tested crossings · recorded conditions must hold`
          : 'Walking route';
    this.status(
      `${kind} · ${r.distance.toFixed(1)} game units · ${r.queryWallMS.toFixed(1)} ms${r.crossings ? ' · crossing lengths are schematic' : ''}`,
    );
  }
}
