import './style.css';
import { NavigationController } from './navigation.js';
import { MapViewer } from './viewer.js';
import {
  createCatalog,
  loadSource,
  decodeMap,
  parseLoc,
  formatLoc,
} from './core.js';

const $ = (id) => document.getElementById(id);
const desktop = window.atlasDesktop;
let catalog = [];
let files = new Map();
let zone = null;
let sourceId = '';
let loadID = 0;
let labelOptions = [];
let ready = false;
const status = (message, error = false) => {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
};
const unwrap = async (promise) => {
  const result = await promise;
  if (!result.ok) throw Error(result.error);
  return result.value;
};
let viewer;
try {
  viewer = new MapViewer($('map-stage'), selectLabel);
} catch (e) {
  status('This device could not start WebGL 2: ' + e.message, true);
  $('empty-state').querySelector('p').textContent =
    'A browser or graphics driver with WebGL 2 is required.';
  throw e;
}

const navigation = new NavigationController(viewer, {
  mergeInventory(inventory) {
    const installed = new Set(inventory.zones.map((z) => z.key));
    catalog = catalog.filter((z) => !z.navigationOnly || installed.has(z.key));
    for (const key of installed)
      if (!catalog.some((z) => z.key === key))
        catalog.push({
          key,
          name: key + ' · geometry',
          navigationOnly: true,
          sources: [{ id: 'navigation', name: 'Navigation surfaces' }],
        });
    catalog.sort((a, b) => a.name.localeCompare(b.name));
    renderZones();
    if (!zone && catalog.length) selectZone(catalog[0].key);
  },
  onSurface(_triangles, wasFull) {
    if (!viewer.data) return;
    const surfaceOnly = zone.navigationOnly || !viewer.data.lines.length;
    if (surfaceOnly) {
      viewer.data.navigationOnly = true;
      viewer.extendNavigationBounds();
      viewer.showNavigation = true;
    }
    const b = viewer.data.bounds;
    for (const id of ['z-low', 'z-high', 'z-low-number', 'z-high-number']) {
      $(id).min = Math.floor(b.min[2]);
      $(id).max = Math.max(Math.floor(b.min[2]) + 1, Math.ceil(b.max[2]));
    }
    if (wasFull || surfaceOnly) allHeights();
    if (surfaceOnly) {
      $('empty-state').hidden = true;
      viewer.fit();
    }
  },
});

function showCatalog(value) {
  navigation.invalidate(true);
  navigation.zone = null;
  navigation.inventory = null;
  viewer.setNavigation([]);
  catalog = value.zones;
  $('zone-search').value = '';
  renderZones();
  status(`${catalog.length} zone maps available`);
  const saved = localStorage.getItem('atlas-cross-zone');
  const z =
    catalog.find((z) => z.key === saved) ||
    catalog.find((z) => z.key === 'kedge') ||
    catalog[0];
  if (z)
    selectZone(z.key).then(() => {
      if (desktop) navigation.refreshInventory();
    });
}
function renderZones() {
  const term = $('zone-search').value.toLowerCase().trim();
  const matches = catalog.filter((zone) =>
    `${zone.name} ${zone.key}`.toLowerCase().includes(term),
  );
  const buttons = document.createDocumentFragment();
  for (const match of matches) {
    const button = document.createElement('button');
    button.className = 'zone-item';
    button.dataset.zone = match.key;
    button.setAttribute('aria-current', String(match.key === zone?.key));
    const name = document.createElement('strong');
    const key = document.createElement('small');
    name.textContent = match.name;
    key.textContent = match.key;
    button.append(name, key);
    button.onclick = () => selectZone(match.key);
    buttons.append(button);
  }
  $('zone-list').replaceChildren(buttons);
  $('zone-count').textContent =
    `${matches.length} of ${catalog.length} zone maps`;
}

async function chooseFolder() {
  try {
    if (desktop) {
      const c = await unwrap(desktop.chooseFolder());
      if (c) showCatalog(c);
    } else $('folder-input').click();
  } catch (e) {
    status(e.message, true);
  }
}
$('open-folder').onclick = chooseFolder;
$('folder-input').onchange = async (e) => {
  try {
    const nextFiles = new Map();
    for (const file of e.target.files) {
      const parts = file.webkitRelativePath.split('/');
      parts.shift();
      nextFiles.set(parts.join('/'), file);
    }
    const zones = createCatalog([...nextFiles.keys()]);
    if (!zones.length)
      throw Error('No map files found. Choose the game’s maps folder.');
    files = nextFiles;
    showCatalog({ zones });
  } catch (error) {
    status(error.message, true);
  }
};
$('zone-search').oninput = renderZones;
async function selectZone(key) {
  const selectedZone = catalog.find((zone) => zone.key === key);
  if (!selectedZone) return;
  zone = selectedZone;
  navigation.setZone(zone);
  localStorage.setItem('atlas-cross-zone', key);
  sourceId = zone.sources[0].id;
  $('source-select').replaceChildren(
    ...zone.sources.map((s) => new Option(s.name, s.id)),
  );
  $('source-select').disabled = false;
  renderZones();
  await loadMap();
}
$('source-select').onchange = () => {
  sourceId = $('source-select').value;
  loadMap();
};
function showEmptyState(title, message) {
  $('empty-state').hidden = false;
  $('empty-state').querySelector('h2').textContent = title;
  $('empty-state').querySelector('p').textContent = message;
}

function updateControlAvailability() {
  const controls = document.querySelectorAll(
    '.controls-panel input, .controls-panel select, .controls-panel button, .tools button',
  );
  for (const control of controls)
    if (!control.closest('#routing-panel')) control.disabled = !ready;
  const sideView = ready && ['north', 'west'].includes(viewer.mode);
  $('height-scale').disabled = !sideView;
  $('cutaway').disabled = !sideView;
  const cutawayActive = sideView && $('cutaway').checked;
  $('depth').disabled = !cutawayActive;
  $('depth-width').disabled = !cutawayActive;
  $('references').disabled = !ready || !viewer.data.references.length;
}

function clearMap() {
  ready = false;
  viewer.clearData();
  labelOptions = [];
  $('landmark').replaceChildren(new Option('Choose a landmark', ''));
  $('landmark-detail').textContent =
    'Select a map annotation to see its coordinates.';
  $('label-search').value = '';
  $('location').value = '';
  $('location-detail').textContent = 'Manual marker · no live tracking';
  $('cutaway').checked = false;
  updateControlAvailability();
}

function navigationMap(selectedZone) {
  return {
    key: selectedZone.key,
    name: selectedZone.name,
    source: 'Navigation surfaces',
    navigationOnly: true,
    lines: [],
    labels: [],
    references: [],
    warnings: [],
    bounds: {
      min: [-1, -1, -1],
      max: [1, 1, 1],
      center: [0, 0, 0],
      size: [2, 2, 2],
      span: 2,
    },
  };
}

async function readMap(selectedZone, selectedSource, selectedFiles) {
  if (selectedZone.navigationOnly) return navigationMap(selectedZone);
  if (desktop) return unwrap(desktop.load(selectedZone.key, selectedSource));
  return loadSource(selectedZone, selectedSource, async (path) => {
    const file = selectedFiles.get(path);
    if (!file) throw Error('Map file is missing. Reopen the folder.');
    if (file.size > 64 * 1024 * 1024) throw Error('Map file exceeds 64 MB.');
    return decodeMap(await file.arrayBuffer());
  });
}

function displayMap(data) {
  if (!data.lines.length && viewer.navigationTriangles.length)
    data.navigationOnly = true;
  viewer.showNavigation = data.navigationOnly || $('route-surfaces').checked;
  viewer.setData(data);
  if (
    data.lines.length ||
    (data.navigationOnly && viewer.navigationTriangles.length)
  ) {
    $('empty-state').hidden = true;
  } else {
    showEmptyState(
      data.navigationOnly ? 'Navigation surfaces' : 'No line geometry',
      data.navigationOnly
        ? 'Choose route endpoints or enable navigation surfaces in Route options to prepare this zone.'
        : 'Try another map source for this zone.',
    );
  }
  if (!data.references.length) $('references').checked = false;
  for (const id of ['z-low', 'z-high', 'z-low-number', 'z-high-number']) {
    $(id).min = Math.floor(data.bounds.min[2]);
    $(id).max = Math.max(
      Math.floor(data.bounds.min[2]) + 1,
      Math.ceil(data.bounds.max[2]),
    );
  }
  $('z-low').value = viewer.options.low;
  $('z-high').value = viewer.options.high;
  syncHeightFields();
  setView(viewer.mode);
  ready = true;
  updateControlAvailability();
  $('zone-subtitle').textContent =
    `${data.key} · ${data.source} · ${data.lines.length.toLocaleString()} source segments`;
  status(
    data.warnings.length
      ? data.warnings.join(' · ')
      : 'Map loaded · files stay on this computer',
    data.warnings.length > 0,
  );
}

async function loadMap() {
  const id = ++loadID;
  clearMap();
  status('Loading ' + zone.name + '…');
  $('zone-title').textContent = zone.name;
  $('zone-subtitle').textContent = '';
  showEmptyState(
    'Loading ' + zone.name + '…',
    'Reading local map coordinates.',
  );
  try {
    // Capture the folder's file map before awaiting; a later import owns its own load.
    const data = await readMap(zone, sourceId, files);
    if (id !== loadID) return;
    displayMap(data);
  } catch (error) {
    if (id !== loadID) return;
    if (navigation.context && viewer.navigationTriangles.length) {
      const fallback = navigationMap(zone);
      fallback.source = 'Navigation surfaces · reference unavailable';
      fallback.warnings = [error.message];
      displayMap(fallback);
      return;
    }
    clearMap();
    status(error.message, true);
    $('zone-subtitle').textContent = 'Could not load this source.';
    showEmptyState('Could not load this map', error.message);
  }
}

function syncHeightFields() {
  $('z-low-number').value = Number($('z-low').value).toFixed(1);
  $('z-high-number').value = Number($('z-high').value).toFixed(1);
}
function depthState() {
  const side = ['north', 'west'].includes(viewer.mode);
  return side && $('cutaway').checked
    ? {
        center: Number($('depth').value),
        width: Math.max(1, Number($('depth-width').value) || 100),
      }
    : null;
}
function updateOptions() {
  if (!viewer.data) return;
  viewer.labels = [
    ...viewer.data.labels,
    ...($('references').checked ? viewer.data.references : []),
  ];
  viewer.setOptions({
    low: Number($('z-low').value),
    high: Number($('z-high').value),
    layers: $('extra-layers').checked ? [0, 1, 2, 3] : [0, 1],
    ghost: $('ghost').checked,
    edges: $('vertical-edges').checked,
    labels: $('show-labels').checked,
    depth: depthState(),
  });
  refreshLandmarks();
  $('depth-value').textContent = Number($('depth').value).toFixed(1);
}
function refreshLandmarks() {
  const selected = viewer.selected,
    term = $('label-search').value.toLowerCase();
  labelOptions = viewer.labels
    .filter(
      (l) =>
        viewer.options.layers.includes(l.layer) &&
        l.name.toLowerCase().includes(term),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  $('landmark').replaceChildren(
    new Option(`${labelOptions.length} labels · choose one`, ''),
    ...labelOptions.map(
      (l, i) => new Option((l.reference ? '[ref] ' : '') + l.name, String(i)),
    ),
  );
  if (selected) {
    const i = labelOptions.indexOf(selected);
    if (i >= 0) $('landmark').value = String(i);
  }
}
for (const id of [
  'ghost',
  'vertical-edges',
  'references',
  'extra-layers',
  'show-labels',
])
  $(id).onchange = updateOptions;
for (const side of ['low', 'high']) {
  $('z-' + side).oninput = () => {
    if (Number($('z-low').value) > Number($('z-high').value))
      $('z-' + (side === 'low' ? 'high' : 'low')).value = $('z-' + side).value;
    syncHeightFields();
    updateOptions();
  };
  $('z-' + side + '-number').onchange = () => {
    const n = Number($('z-' + side + '-number').value);
    if (!Number.isFinite(n)) {
      status('Enter a numeric height.', true);
      return;
    }
    $('z-' + side).value = n;
    $('z-' + side).oninput();
  };
}
function allHeights() {
  if (!viewer.data) return;
  $('z-low').value = $('z-low').min;
  $('z-high').value = $('z-high').max;
  syncHeightFields();
  updateOptions();
}
$('all-heights').onclick = allHeights;
function moveSlice(dir) {
  if (!viewer.data) return;
  const min = Number($('z-low').min),
    max = Number($('z-high').max);
  let lo = Number($('z-low').value),
    hi = Number($('z-high').value),
    span = hi - lo;
  if (span > 150 || span < 1) span = Math.min(80, max - min);
  const center = (hi + lo) / 2 + span * 0.8 * dir;
  lo = Math.max(min, Math.min(max - span, center - span / 2));
  $('z-low').value = lo;
  $('z-high').value = lo + span;
  syncHeightFields();
  updateOptions();
}
$('slice-down').onclick = () => moveSlice(-1);
$('slice-up').onclick = () => moveSlice(1);
function configureDepth() {
  updateControlAvailability();
  if (viewer.data) {
    const axis = viewer.mode === 'west' ? 0 : 1,
      b = viewer.data.bounds;
    $('depth').min = b.min[axis];
    $('depth').max = Math.max(b.min[axis] + 1, b.max[axis]);
    $('depth').value = b.center[axis];
  }
  $('depth-value').textContent = Number($('depth').value).toFixed(1);
}
function setView(mode) {
  viewer.setView(mode);
  for (const b of document.querySelectorAll('[data-view]'))
    b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  configureDepth();
  updateOptions();
  $('interaction-help').textContent =
    mode === '3d'
      ? 'Drag to orbit · Shift-drag / right-drag to pan · Scroll to zoom'
      : 'Drag to pan · Scroll to zoom · Use cutaway to separate overlapping rooms';
}
for (const b of document.querySelectorAll('[data-view]'))
  b.onclick = () => setView(b.dataset.view);
$('height-scale').onchange = () => {
  viewer.setMagnification(Number($('height-scale').value));
  updateOptions();
};
$('cutaway').onchange = () => {
  configureDepth();
  updateOptions();
};
$('depth').oninput = updateOptions;
$('depth-width').onchange = () => {
  const n = Number($('depth-width').value);
  if (!Number.isFinite(n) || n <= 0) {
    status('Depth width must be positive.', true);
    $('depth-width').value = 100;
  }
  updateOptions();
};
$('fit-zone').onclick = () => viewer.fit();
$('fit-slice').onclick = () => viewer.fit(true);
$('zoom-in').onclick = () => viewer.zoom(1.25);
$('zoom-out').onclick = () => viewer.zoom(0.8);
$('label-search').oninput = refreshLandmarks;
$('landmark').onchange = () => {
  if ($('landmark').value !== '')
    selectLabel(labelOptions[Number($('landmark').value)]);
};
function selectLabel(label) {
  if (!label) return;
  viewer.selected = label;
  viewer.focus(label.position);
  refreshLandmarks();
  $('landmark-detail').textContent =
    `${label.name} · /loc ${formatLoc(label.position)}${label.reference ? ' · Brewall reference' : ''}`;
}
$('copy-loc').onclick = async () => {
  if (!viewer.selected) return;
  try {
    const text = formatLoc(viewer.selected.position);
    if (desktop) await unwrap(desktop.copyLoc(text));
    else await navigator.clipboard.writeText(text);
    status('Landmark coordinates copied.');
  } catch {
    status('Select and copy the coordinates above.', true);
  }
};
$('slice-here').onclick = () => {
  const p = viewer.selected?.position;
  if (!p) return;
  $('z-low').value = p[2] - 40;
  $('z-high').value = p[2] + 40;
  if ($('cutaway').checked)
    $('depth').value = p[viewer.mode === 'west' ? 0 : 1];
  syncHeightFields();
  updateOptions();
  viewer.focus(p);
};
function markLocation() {
  if (!viewer.data) return;
  const p = parseLoc($('location').value);
  if (!p) {
    status('Enter three numbers in /loc order: Y, X, Z.', true);
    return;
  }
  const b = viewer.data.bounds,
    margin = Math.max(50, b.span * 0.15);
  if (p.some((v, i) => v < b.min[i] - margin || v > b.max[i] + margin)) {
    status(
      'That location is outside this map. Check the zone and Y, X, Z order.',
      true,
    );
    return;
  }
  viewer.marker = p;
  viewer.focus(p);
  $('location-detail').textContent = `/loc ${formatLoc(p)} · manual marker`;
  status('Location marked.');
}
$('mark-location').onclick = markLocation;
$('location').onkeydown = (e) => {
  if (e.key === 'Enter') markLocation();
};
$('clear-location').onclick = () => {
  viewer.marker = null;
  $('location').value = '';
  $('location-detail').textContent = 'Manual marker · no live tracking';
  viewer.requestRender();
};
$('export').onclick = async () => {
  if (!viewer.data) return;
  const name = `${viewer.data.key}-${viewer.mode}`;
  try {
    const blob = await viewer.png();
    if (!blob) throw Error('Could not create image.');
    if (desktop) {
      const saved = await unwrap(
        desktop.exportPNG(new Uint8Array(await blob.arrayBuffer()), name),
      );
      if (saved) status('Map image saved.');
    } else {
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `${name}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) {
    status(e.message, true);
  }
};
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('zone-search').focus();
  }
});
updateControlAvailability();

if (desktop) {
  status('Looking for your map folder…');
  unwrap(desktop.catalog())
    .then((c) => {
      if (c) showCatalog(c);
      else status('Choose your EQL maps folder to begin.');
    })
    .catch((e) => status('Choose your maps folder: ' + e.message, true));
}
window.atlasTest = {
  get state() {
    return {
      ready,
      zones: catalog.length,
      mapZones: catalog.filter((z) => !z.navigationOnly).length,
      key: zone?.key,
      source: sourceId,
      lines: viewer.data?.lines.length,
      visible: viewer.filtered?.visible.length,
      mode: viewer.mode,
      factor: viewer.factor,
      marker: viewer.marker,
      context: viewer.filtered?.context.length,
      webgl: viewer.renderer.capabilities.isWebGL2 !== false,
    };
  },
  selectZone,
  setView,
  viewer,
  navigation,
};
