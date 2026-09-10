const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');

// Synthetic geometry exercises the file/renderer boundary without a private map corpus.
const mapFiles = {
  'alpha.txt': 'L 0,0,0,100,100,0,0,0,0\nP 50,50,0,0,0,0,1,Main_Room',
  'alpha_1.txt': 'L 0,0,100,100,100,110,0,0,0',
  'alpha_2.txt': 'L 10000,10000,10000,11000,11000,11000,0,0,0',
  'beta.txt': 'L 20,20,0,60,60,0,0,0,0',
  'gamma.txt': 'L 20,20,0,70,70,0,0,0,0',
  'Brewall/gamma_1.txt': 'P 40,40,0,0,0,0,1,Optional_Reference',
};

async function createFixture(qaRoot) {
  await fs.mkdir(qaRoot, { recursive: true });
  const folder = await fs.mkdtemp(path.join(qaRoot, 'regression-maps-'));
  await fs.mkdir(path.join(folder, 'Brewall'));
  await Promise.all(
    Object.entries(mapFiles).map(([relative, text]) =>
      fs.writeFile(path.join(folder, relative), text),
    ),
  );
  return folder;
}

async function run(win, root, fixture, browserMode) {
  const evaluate = (code) => win.webContents.executeJavaScript(code);
  const mode = browserMode ? 'browser' : 'desktop';
  const originalSaveDialog = dialog.showSaveDialog;
  let exportName;
  dialog.showSaveDialog = async (_window, options) => {
    exportName = options.defaultPath;
    return { canceled: false, filePath: path.join(fixture, 'export.png') };
  };

  async function waitFor(expression) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Timed out waiting for ${expression}`);
  }

  async function failFile(relative) {
    if (browserMode) {
      await evaluate(
        `window.failedMapNames.add(${JSON.stringify(path.basename(relative))}); void 0`,
      );
    } else {
      await fs.unlink(path.join(fixture, relative));
    }
  }

  try {
    if (browserMode) {
      assert.equal(await evaluate('typeof window.atlasDesktop'), 'undefined');
      win.webContents.debugger.attach('1.3');
      const { root: document } = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', {
        nodeId: document.nodeId,
        selector: '#folder-input',
      });
      await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId,
        files: [fixture],
      });
      // Browser File objects may retain an open handle after unlinking. Inject read
      // failures at that boundary so both modes exercise the same load failure.
      await evaluate(`
        window.failedMapNames = new Set();
        window.originalRead = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = function() {
          if (window.failedMapNames.has(this.name)) return Promise.reject(Error('Fixture read failed'));
          return window.originalRead.call(this);
        };
        window.originalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() { window.exportName = this.download; };
        void 0;
      `);
    }

    await waitFor('Boolean(window.atlasTest?.state.ready)');
    await evaluate("window.atlasTest.selectZone('alpha')");
    const layers = await evaluate(`(() => {
      document.getElementById('all-heights').click();
      return { bounds: atlasTest.viewer.data.bounds, visible: atlasTest.state.visible,
        maximumHeight: Number(document.getElementById('z-high').max) };
    })()`);
    assert.deepEqual(layers.bounds.max, [100, 100, 110]);
    assert.equal(layers.maximumHeight, 110);
    assert.equal(
      layers.visible,
      2,
      'all standard geometry remains visible; decoration is excluded',
    );

    await evaluate(`
      atlasTest.setView('north');
      document.getElementById('height-scale').value = '4';
      document.getElementById('height-scale').dispatchEvent(new Event('change'));
      document.getElementById('z-low-number').value = '100';
      document.getElementById('z-low-number').dispatchEvent(new Event('change'));
    `);
    assert.equal(await evaluate('atlasTest.state.factor'), 4);
    const rulerLabels = await evaluate(`(() => {
      const context = atlasTest.viewer.ctx;
      const original = context.fillText;
      const labels = [];
      context.fillText = function(text, ...args) {
        if (text.startsWith('Z ')) labels.push(text);
        return original.call(this, text, ...args);
      };
      try { atlasTest.viewer.render(); } finally { context.fillText = original; }
      return labels;
    })()`);
    assert.ok(rulerLabels.length > 1, 'side ruler still draws actual game heights');

    assert.equal(await evaluate('atlasTest.state.visible'), 1, 'layer 1 can be isolated');
    await evaluate(`
      document.getElementById('all-heights').click();
      document.getElementById('location').value = '-50,-50,105';
      document.getElementById('mark-location').click();
      document.getElementById('landmark').value = '0';
      document.getElementById('landmark').dispatchEvent(new Event('change'));
    `);
    assert.deepEqual(await evaluate('atlasTest.state.marker'), [50, 50, 105]);
    assert.ok(await evaluate('Boolean(atlasTest.viewer.selected)'));

    await failFile('beta.txt');
    await evaluate("window.pendingLoad = atlasTest.selectZone('beta'); void 0");
    const loading = await evaluate(`({
      ready: atlasTest.state.ready, data: atlasTest.viewer.data,
      exportDisabled: document.getElementById('export').disabled,
    })`);
    assert.equal(loading.ready, false);
    assert.equal(loading.data, null);
    assert.equal(loading.exportDisabled, true);
    await evaluate('window.pendingLoad');
    const failed = await evaluate(`({
      ready: atlasTest.state.ready, data: atlasTest.viewer.data,
      marker: atlasTest.viewer.marker, selected: atlasTest.viewer.selected,
      labels: atlasTest.viewer.labels.length, choices: document.getElementById('landmark').options.length,
      vertices: atlasTest.viewer.visible.geometry.getAttribute('position')?.count || 0,
      exportDisabled: document.getElementById('export').disabled,
      markerDisabled: document.getElementById('mark-location').disabled,
      message: document.querySelector('#empty-state h2').textContent,
    })`);
    assert.deepEqual(failed, {
      ready: false,
      data: null,
      marker: null,
      selected: null,
      labels: 0,
      choices: 1,
      vertices: 0,
      exportDisabled: true,
      markerDisabled: true,
      message: 'Could not load this map',
    });

    await evaluate("atlasTest.selectZone('alpha')");
    assert.equal(await evaluate('atlasTest.state.ready'), true, 'a failed load is recoverable');
    await failFile('Brewall/gamma_1.txt');
    await evaluate("atlasTest.selectZone('gamma')");
    const references = await evaluate(`({
      ready: atlasTest.state.ready, key: atlasTest.viewer.data.key,
      warning: document.getElementById('status').textContent,
      disabled: document.getElementById('references').disabled,
    })`);
    assert.equal(references.ready, true);
    assert.equal(references.key, 'gamma');
    assert.equal(references.disabled, true);
    assert.match(references.warning, /optional references unavailable/);

    // Defer PNG completion across a zone switch. Its filename must still name
    // the map that was captured, even though another load completes first.
    await evaluate("atlasTest.selectZone('alpha')");
    await evaluate(`
      atlasTest.setView('3d');
      window.originalPNG = atlasTest.viewer.png.bind(atlasTest.viewer);
      atlasTest.viewer.png = async () => {
        const blob = await window.originalPNG();
        await new Promise(resolve => { window.releasePNG = resolve; });
        return blob;
      };
      window.pendingExport = document.getElementById('export').onclick();
      void 0;
    `);
    await waitFor("typeof window.releasePNG === 'function'");
    await evaluate("atlasTest.selectZone('gamma')");
    await evaluate('window.releasePNG(); window.pendingExport');
    assert.equal(browserMode ? await evaluate('window.exportName') : exportName, 'alpha-3d.png');
    await evaluate('atlasTest.viewer.png = window.originalPNG; void 0');

    const png = await evaluate(
      'atlasTest.viewer.png().then(blob => ({size: blob.size, type: blob.type}))',
    );
    assert.equal(png.type, 'image/png');
    assert.ok(png.size > 1000);
    const isolation = await evaluate(
      '({require: typeof window.require, process: typeof window.process})',
    );
    assert.deepEqual(isolation, { require: 'undefined', process: 'undefined' });

    const layouts = [];
    if (browserMode) {
      win.setMinimumSize(320, 400);
      for (const [width, height] of [
        [1510, 960],
        [1000, 740],
        [390, 844],
      ]) {
        win.setContentSize(width, height);
        await evaluate(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        );
        const metrics = await evaluate(
          '({width: innerWidth, scroll: document.documentElement.scrollWidth, canvas: atlasTest.viewer.width})',
        );
        assert.equal(metrics.width, width);
        assert.ok(metrics.scroll <= width + 1);
        assert.ok(metrics.canvas > 100);
        layouts.push(metrics);
      }
    }
    const pixels = await evaluate(`(() => {
      const viewer = atlasTest.viewer;
      viewer.render();
      const canvas = document.createElement('canvas');
      canvas.width = viewer.renderer.domElement.width;
      canvas.height = viewer.renderer.domElement.height;
      const context = canvas.getContext('2d');
      context.drawImage(viewer.renderer.domElement, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 1] > 100 && rgba[i + 2] > 100 && rgba[i] < rgba[i + 1] * 0.9) count++;
      }
      return count;
    })()`);
    assert.ok(pixels > 10, 'map geometry is visible at the final viewport');
    await fs.writeFile(
      path.join(root, 'qa', `regression-${mode}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    await fs.writeFile(
      path.join(root, 'qa', `regression-${mode}.json`),
      JSON.stringify(
        { passed: true, layers, failed, references, png, isolation, layouts },
        null,
        2,
      ),
    );
    console.log(
      `PASS ${mode} regressions: layer bounds, failed-load cleanup/recovery, optional references, export identity, PNG, isolation, layouts`,
    );
  } finally {
    dialog.showSaveDialog = originalSaveDialog;
    if (browserMode) {
      await evaluate(`
        if (window.originalRead) File.prototype.arrayBuffer = window.originalRead;
        if (window.originalAnchorClick) HTMLAnchorElement.prototype.click = window.originalAnchorClick;
        void 0;
      `);
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

module.exports = { createFixture, run };
