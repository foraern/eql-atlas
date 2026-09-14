import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  clipTriangle,
  routeClip,
  visiblePoint,
  pointBounds,
} from './navigation-geometry.js';
import { boundsOf, filteredGeometry } from './core.js';

export class MapViewer {
  constructor(stage, onPick) {
    this.stage = stage;
    this.onPick = onPick;
    this.mode = '3d';
    this.factor = 1;
    this.magnification = 1;
    this.data = null;
    this.marker = null;
    this.selected = null;
    this.labels = [];
    this.hits = [];
    this.options = {
      low: -Infinity,
      high: Infinity,
      layers: [0, 1],
      depth: null,
      side: 'north',
      ghost: true,
      edges: false,
      labels: true,
    };
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x090f18);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.id = 'geometry-canvas';
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Zone geometry. Drag to rotate; scroll to zoom.',
    );
    stage.prepend(this.renderer.domElement);
    this.overlay = document.getElementById('labels-canvas');
    this.ctx = this.overlay.getContext('2d');
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-500, 500, 500, -500, 0.1, 1e7);
    this.camera.position.set(700, 600, 900);
    this.camera.lookAt(0, 0, 0);
    this.half = 500;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.minZoom = 0.03;
    this.controls.maxZoom = 1000;
    this.controls.addEventListener('change', () => this.requestRender());
    this.geometry = new THREE.Group();
    this.scene.add(this.geometry);
    // Keep the highlight in the transparent render pass so its renderOrder places it above the teal lines.
    this.materials = {
      context: new THREE.LineBasicMaterial({
        color: 0x6e879e,
        transparent: true,
        opacity: 0.18,
        depthTest: false,
      }),
      visible: new THREE.LineBasicMaterial({
        color: 0x65cdd0,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
      }),
      vertical: new THREE.LineBasicMaterial({
        color: 0xe9a15b,
        transparent: true,
        opacity: 1,
        depthTest: false,
      }),
    };
    for (const kind of ['context', 'visible', 'vertical']) {
      this[kind] = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        this.materials[kind],
      );
      this[kind].renderOrder =
        kind === 'context' ? 0 : kind === 'visible' ? 1 : 2;
      this.geometry.add(this[kind]);
    }
    this.navigationTriangles = [];
    this.reachableTriangles = null;
    this.route = null;
    this.routeEndpoints = {};
    this.navigationMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x4ece9c,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    this.geometry.add(this.navigationMesh);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      down = [e.clientX, e.clientY];
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4)
        return;
      const rect = stage.getBoundingClientRect(),
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      if (this.navigationPicking) {
        this.pickNavigation(x, y);
        return;
      }
      const hit = this.hits.find(
        (h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h,
      );
      if (hit) this.onPick(hit.label);
    });
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      document.getElementById('status').textContent =
        'Graphics context lost. Reload the app to restore the map.';
    });
    this.resize();
  }
  resize() {
    const r = this.stage.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    const dpr = Math.min(devicePixelRatio, 2);
    this.overlay.width = Math.round(this.width * dpr);
    this.overlay.height = Math.round(this.height * dpr);
    this.overlay.style.width = this.width + 'px';
    this.overlay.style.height = this.height + 'px';
    this.dpr = dpr;
    this.updateFrustum();
    this.requestRender();
  }
  updateFrustum() {
    const aspect = this.width / this.height;
    this.camera.left = -this.half * aspect;
    this.camera.right = this.half * aspect;
    this.camera.top = this.half;
    this.camera.bottom = -this.half;
    this.camera.updateProjectionMatrix();
  }
  setData(data) {
    this.data = data;
    this.extendNavigationBounds();
    this.labels = data.labels;
    this.marker = null;
    this.selected = null;
    this.options.depth = null;
    this.options.low = Math.floor(data.bounds.min[2]);
    this.options.high = Math.ceil(data.bounds.max[2]);
    this.rebuild();
    this.fit();
  }
  setOptions(options) {
    Object.assign(this.options, options);
    this.rebuild();
  }
  clearData() {
    this.data = null;
    this.filtered = null;
    this.labels = [];
    this.hits = [];
    this.marker = null;
    this.selected = null;
    this.options.depth = null;
    for (const kind of ['context', 'visible', 'vertical']) {
      this[kind].geometry.dispose();
      this[kind].geometry = new THREE.BufferGeometry();
    }
    document.getElementById('map-stats').textContent = '';
    document.getElementById('map-caption').textContent = '';
    this.requestRender();
  }
  lineGeometry(lines) {
    const vertices = new Float32Array(lines.length * 6);
    let i = 0;
    for (const l of lines) {
      vertices[i++] = l[0];
      vertices[i++] = l[2];
      vertices[i++] = l[1];
      vertices[i++] = l[3];
      vertices[i++] = l[5];
      vertices[i++] = l[4];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    g.computeBoundingSphere();
    return g;
  }
  rebuild() {
    if (!this.data) return;
    this.filtered = filteredGeometry(this.data.lines, this.options);
    const sliced =
      this.options.low > this.data.bounds.min[2] ||
      this.options.high < this.data.bounds.max[2];
    for (const [kind, lines] of [
      ['context', this.options.ghost && sliced ? this.filtered.context : []],
      ['visible', this.filtered.visible],
      ['vertical', this.options.edges ? this.filtered.vertical : []],
    ]) {
      const old = this[kind].geometry;
      this[kind].geometry = this.lineGeometry(lines);
      old.dispose();
    }
    this.geometry.scale.y = this.factor;
    this.rebuildNavigation();
    this.requestRender();
    document.getElementById('map-stats').textContent =
      `${this.filtered.visible.length.toLocaleString()} segments · Z ${this.options.low.toFixed(1)} to ${this.options.high.toFixed(1)}` +
      (this.options.depth ? ' · depth cutaway' : '');
  }
  setView(mode) {
    this.mode = mode;
    this.factor = ['north', 'west'].includes(mode) ? this.magnification : 1;
    this.geometry.scale.y = this.factor;
    this.controls.enableRotate = mode === '3d';
    this.controls.mouseButtons.LEFT =
      mode === '3d' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.camera.up.set(0, 1, 0);
    let dir;
    if (mode === 'top') {
      dir = new THREE.Vector3(0, 1, 0);
      this.camera.up.set(0, 0, -1);
    } else if (mode === 'north') dir = new THREE.Vector3(0, 0, 1);
    else if (mode === 'west') dir = new THREE.Vector3(1, 0, 0);
    else dir = new THREE.Vector3(0.55, 0.65, 1).normalize();
    this.direction = dir;
    this.options.side = mode === 'west' ? 'west' : 'north';
    if (mode === '3d' || mode === 'top') this.options.depth = null;
    this.fit();
    this.rebuild();
  }
  setMagnification(value) {
    this.magnification = value;
    this.setView(this.mode);
  }
  fit(slice = false, override = null) {
    if (!this.data) return;
    const bounds =
      override ||
      (slice && this.filtered?.visible.length
        ? boundsOf(this.filtered.visible)
        : this.data.bounds);
    const center = new THREE.Vector3(
      bounds.center[0],
      bounds.center[2] * this.factor,
      bounds.center[1],
    );
    const direction =
      this.direction?.clone() ||
      this.camera.position.clone().sub(this.controls.target).normalize();
    this.direction = null;
    const distance = Math.max(this.data.bounds.span * this.factor * 5, 1000);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.target.copy(center);
    this.camera.near = 0.1;
    this.camera.far = distance * 20;
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    const inverseRotation = this.camera.quaternion.clone().invert();
    let x = 0,
      y = 0;
    for (const a of [bounds.min[0], bounds.max[0]])
      for (const c of [bounds.min[1], bounds.max[1]])
        for (const z of [bounds.min[2], bounds.max[2]]) {
          const v = new THREE.Vector3(a, z * this.factor, c)
            .sub(center)
            .applyQuaternion(inverseRotation);
          x = Math.max(x, Math.abs(v.x));
          y = Math.max(y, Math.abs(v.y));
        }
    this.half = Math.max(y, x / (this.width / this.height), 5) * 1.2;
    this.camera.zoom = 1;
    this.updateFrustum();
    this.controls.update();
    this.requestRender();
  }
  focus(point) {
    const target = new THREE.Vector3(
        point[0],
        point[2] * this.factor,
        point[1],
      ),
      delta = target.clone().sub(this.controls.target);
    this.controls.target.copy(target);
    this.camera.position.add(delta);
    this.controls.update();
    this.requestRender();
  }
  zoom(value) {
    this.camera.zoom = Math.max(0.03, Math.min(1000, this.camera.zoom * value));
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }
  project(point) {
    const p = new THREE.Vector3(
      point[0],
      point[2] * this.factor,
      point[1],
    ).project(this.camera);
    return {
      x: ((p.x + 1) * this.width) / 2,
      y: ((1 - p.y) * this.height) / 2,
      z: p.z,
    };
  }
  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }
  render() {
    this.camera.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay();
  }
  drawHeightRuler() {
    const context = this.ctx;
    const width = this.width;
    const height = this.height;
    const halfHeight = this.half / this.camera.zoom,
      centerZ = this.controls.target.y / this.factor,
      approximateStep = (halfHeight * 2) / this.factor / 7,
      power = 10 ** Math.floor(Math.log10(Math.max(0.001, approximateStep))),
      step = Math.ceil(approximateStep / power) * power;
    for (
      let z = Math.ceil((centerZ - halfHeight / this.factor) / step) * step;
      z < centerZ + halfHeight / this.factor;
      z += step
    ) {
      const projected = this.project([
        this.controls.target.x,
        this.controls.target.z,
        z,
      ]);
      if (projected.y < 55 || projected.y > height - 45) continue;
      context.strokeStyle = '#8ba6bc28';
      context.beginPath();
      context.moveTo(56, projected.y);
      context.lineTo(width - 12, projected.y);
      context.stroke();
      context.fillStyle = '#9dafc0';
      context.fillText('Z ' + Number(z.toFixed(2)), 8, projected.y - 5);
    }
  }

  drawAnnotation(text, point, color, label, boxes) {
    const context = this.ctx;
    const w = this.width;
    const h = this.height;
    const projected = this.project(point);
    if (
      projected.z < -1 ||
      projected.z > 1 ||
      projected.x < 8 ||
      projected.x > w - 8 ||
      projected.y < 44 ||
      projected.y > h - 38
    )
      return;
    context.fillStyle = color;
    context.beginPath();
    context.arc(projected.x, projected.y, label ? 3 : 5, 0, Math.PI * 2);
    context.fill();
    const maxWidth = Math.min(w - 25, 250);
    while (context.measureText(text).width > maxWidth && text.length > 5)
      text = text.slice(0, -2);
    if (context.measureText(text).width >= maxWidth - 10) text += '…';
    const textWidth = context.measureText(text).width;
    const placements = [-22, 9, -41, 28].flatMap((offsetY) =>
      (label ? [8] : [8, -textWidth - 18]).map((offsetX) => ({
        offsetX,
        offsetY,
      })),
    );
    for (const { offsetX, offsetY } of placements) {
      const box = {
        x: Math.max(8, Math.min(w - textWidth - 18, projected.x + offsetX)),
        y: projected.y + offsetY,
        w: textWidth + 10,
        h: 21,
      };
      if (
        box.y < 42 ||
        box.y + box.h > h - 38 ||
        boxes.some(
          (b) =>
            box.x < b.x + b.w + 3 &&
            box.x + box.w > b.x - 3 &&
            box.y < b.y + b.h + 3 &&
            box.y + box.h > b.y - 3,
        )
      )
        continue;
      context.fillStyle = '#090f18e8';
      context.fillRect(box.x, box.y, box.w, box.h);
      context.fillStyle = color;
      context.fillText(text, box.x + 5, box.y + 15);
      boxes.push(box);
      if (label) this.hits.push({ ...box, label });
      break;
    }
  }

  drawOverlay() {
    const c = this.ctx,
      w = this.width,
      h = this.height;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    this.hits = [];
    if (!this.data) return;
    const boxes = [
      { x: 0, y: 0, w, h: 44 },
      { x: 0, y: h - (this.route ? 100 : 40), w, h: this.route ? 100 : 40 },
    ];
    c.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    if (['north', 'west'].includes(this.mode)) this.drawHeightRuler();
    const draw = (text, point, color, label) =>
      this.drawAnnotation(text, point, color, label, boxes);
    this.drawRoute(draw);
    if (this.marker)
      draw(
        `You · Z ${this.marker[2].toFixed(1)}`,
        this.marker,
        '#ffe087',
        null,
      );
    if (this.selected)
      draw(
        `${this.selected.name} · Z ${this.selected.position[2].toFixed(1)}`,
        this.selected.position,
        '#ffe087',
        this.selected,
      );
    if (this.options.labels) {
      let shown = 0;
      for (const l of this.labels) {
        if (
          l === this.selected ||
          !this.options.layers.includes(l.layer) ||
          l.position[2] < this.options.low ||
          l.position[2] > this.options.high
        )
          continue;
        const d = this.options.depth;
        if (
          d &&
          Math.abs(l.position[this.mode === 'west' ? 0 : 1] - d.center) >
            d.width / 2
        )
          continue;
        draw(l.name, l.position, l.reference ? '#ffca8d' : '#e1eff6', l);
        if (++shown > 350) break;
      }
    }
    const captions = {
      '3d': '3D · true proportions',
      top: 'Top · north ↑ · east →',
      north: 'Side · looking north · east →',
      west: 'Side · looking west · north →',
    };
    document.getElementById('map-caption').textContent =
      captions[this.mode] +
      (this.factor !== 1 ? ` · height ×${this.factor}` : '');
  }
  setNavigation(triangles) {
    this.navigationTriangles = triangles;
    this.reachableTriangles = null;
    this.excludedCrossings = [];
    this.extendNavigationBounds();
    this.rebuildNavigation();
  }
  extendNavigationBounds() {
    if (!this.data || !this.navigationTriangles.length) return;
    const points = [this.data.bounds.min, this.data.bounds.max];
    // Accumulate without spreading a large mesh into call arguments.
    let min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const tri of this.navigationTriangles)
      for (const p of tri)
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], p[a]);
          max[a] = Math.max(max[a], p[a]);
        }
    this.data.bounds = pointBounds(
      this.data.navigationOnly ? [min, max] : points.concat([min, max]),
    );
  }
  rebuildNavigation() {
    const triangles = this.reachableTriangles || this.navigationTriangles;
    this.navigationMesh.visible = !!(
      this.showNavigation ||
      this.navigationPicking ||
      this.reachableTriangles
    );
    const vertices = [];
    if (this.navigationMesh.visible)
      for (const tri of triangles)
        for (const clipped of clipTriangle(tri, this.options))
          for (const p of clipped) vertices.push(p[0], p[2], p[1]);
    this.navigationMesh.geometry.dispose();
    this.navigationMesh.geometry = new THREE.BufferGeometry();
    this.navigationMesh.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    if (vertices.length) this.navigationMesh.geometry.computeBoundingSphere();
    this.requestRender();
  }
  pickNavigation(x, y) {
    this.camera.updateMatrixWorld(true);
    this.geometry.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2),
      this.camera,
    );
    const points = [];
    for (const hit of ray.intersectObject(this.navigationMesh)) {
      const p = [hit.point.x, hit.point.z, hit.point.y / this.factor];
      if (!points.some((q) => Math.hypot(...p.map((v, i) => v - q[i])) < 0.5))
        points.push(p);
    }
    this.onNavigationPick?.(points);
  }
  setReachable(triangles, excluded = []) {
    this.reachableTriangles = triangles;
    this.excludedCrossings = excluded;
    this.rebuildNavigation();
  }
  setRoute(route, endpoints = {}) {
    this.route = route;
    this.routeEndpoints = { ...endpoints };
    this.requestRender();
  }
  fitRoute() {
    if (!this.route?.points.length) return;
    this.fit(false, pointBounds(this.route.points));
    // Reserve room for route annotations and the persistent geometry caveat.
    this.half *= this.height / Math.max(100, this.height - 100);
    this.updateFrustum();
    this.requestRender();
  }
  drawRoute(draw) {
    const c = this.ctx;
    let hidden = 0,
      arrowDistance = 0,
      action = 0;
    const drawSegment = (a, b, color, dashed, opacity = 1) => {
      const p = this.project(a),
        q = this.project(b);
      if (p.z < -1 || p.z > 1 || q.z < -1 || q.z > 1) return;
      c.globalAlpha = opacity;
      c.strokeStyle = color;
      c.lineWidth = 3;
      c.setLineDash(dashed ? [7, 5] : []);
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
      c.stroke();
      c.setLineDash([]);
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      arrowDistance += length;
      if (opacity === 1 && length > 0.1 && (arrowDistance > 70 || dashed)) {
        const angle = Math.atan2(q.y - p.y, q.x - p.x),
          x = (p.x + q.x) / 2,
          y = (p.y + q.y) / 2;
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(x + 6 * Math.cos(angle), y + 6 * Math.sin(angle));
        c.lineTo(x + 5 * Math.cos(angle + 2.5), y + 5 * Math.sin(angle + 2.5));
        c.lineTo(x + 5 * Math.cos(angle - 2.5), y + 5 * Math.sin(angle - 2.5));
        c.fill();
        arrowDistance = 0;
      }
      c.globalAlpha = 1;
    };
    for (const segment of this.route?.segments || []) {
      const crossing = segment.kind !== 'walk',
        color = crossing ? '#ffb464' : '#68f5e1';
      for (let i = 1; i < segment.points.length; i++) {
        const a = segment.points[i - 1],
          b = segment.points[i],
          line = routeClip(a, b, this.options);
        if (!visiblePoint(a, this.options) || !visiblePoint(b, this.options)) {
          hidden++;
          if (this.options.ghost) drawSegment(a, b, color, true, 0.17);
        }
        if (line)
          drawSegment(line.slice(0, 3), line.slice(3, 6), color, crossing);
      }
      if (crossing) {
        action++;
        const p = segment.points[0];
        if (visiblePoint(p, this.options))
          draw(
            `${segment.kind} ${action} · ${segment.status === 'unverified' ? 'UNVERIFIED' : 'user-tested'}`,
            p,
            color,
            null,
          );
      }
    }
    for (const crossing of this.excludedCrossings || [])
      if (crossing.from && crossing.to) {
        const line = routeClip(crossing.from, crossing.to, this.options);
        if (line)
          drawSegment(line.slice(0, 3), line.slice(3, 6), '#ff9c64', true, 0.5);
      }
    for (const [key, color, label] of [
      ['start', '#a5ff92', 'Start'],
      ['end', '#ff9cc6', 'Destination'],
    ]) {
      const p = this.routeEndpoints[key]?.point;
      if (p) {
        if (visiblePoint(p, this.options)) draw(label, p, color, null);
        else {
          hidden++;
          if (this.options.ghost) {
            c.globalAlpha = 0.25;
            draw(label + ' · hidden', p, color, null);
            c.globalAlpha = 1;
          }
        }
      }
    }
    if (this.route) {
      c.fillStyle = '#0a111bea';
      c.fillRect(8, this.height - 91, this.width - 16, 48);
      c.fillStyle =
        this.route.status === 'requiresVerification' ? '#ffb464' : '#cfeee9';
      c.fillText(
        `${this.route.status === 'requiresVerification' ? 'UNVERIFIED PREVIEW' : this.route.status === 'userTestedCrossings' ? 'User-tested crossings · ' + this.route.capability : 'Walking route'} · ${this.route.distance.toFixed(1)} units${hidden ? ' · portions hidden by slice / cutaway' : ''}`,
        15,
        this.height - 72,
        this.width - 30,
      );
      c.fillStyle = '#b7c8d5';
      c.font = '11px sans-serif';
      c.fillText(
        'Based on static geometry; door access and live obstructions are unverified.',
        15,
        this.height - 53,
        this.width - 30,
      );
      c.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    }
    this.hiddenRouteParts = hidden;
  }
  async png() {
    this.render();
    const c = document.createElement('canvas');
    c.width = this.renderer.domElement.width;
    c.height = this.renderer.domElement.height;
    const x = c.getContext('2d');
    x.drawImage(this.renderer.domElement, 0, 0);
    x.drawImage(this.overlay, 0, 0, c.width, c.height);
    x.fillStyle = '#dce6f1';
    x.font = `${14 * this.dpr}px sans-serif`;
    x.fillText(
      `${this.data.name} · ${document.getElementById('map-caption').textContent}`,
      15 * this.dpr,
      27 * this.dpr,
    );
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }
}
