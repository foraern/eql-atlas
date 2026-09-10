const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
module.exports = async (win, root, folder) => {
  assert.ok(folder, 'Pass --maps with the folder to import');
  const evaluate = (code) => win.webContents.executeJavaScript(code);
  assert.equal(
    await evaluate('typeof window.atlasDesktop'),
    'undefined',
    'ordinary browser mode has no desktop bridge',
  );
  win.webContents.debugger.attach('1.3');
  const { root: doc } = await win.webContents.debugger.sendCommand('DOM.getDocument');
  const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', {
    nodeId: doc.nodeId,
    selector: '#folder-input',
  });
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [folder] });
  for (let n = 0; n < 250; n++) {
    if (await evaluate('window.atlasTest.state.ready')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  let initial = await evaluate('window.atlasTest.state');
  assert.equal(initial.ready, true, 'folder import completed');
  assert.equal(initial.zones, 581);
  await evaluate("window.atlasTest.selectZone('kedge')");
  assert.equal((await evaluate('window.atlasTest.state')).lines, 3517);
  await evaluate(
    "document.getElementById('zone-search').value='najena';document.getElementById('zone-search').dispatchEvent(new Event('input'))",
  );
  assert.equal(await evaluate("document.querySelectorAll('.zone-item').length"), 1, 'zone search');
  const checks = [];
  win.setMinimumSize(320, 400);
  for (const [width, height] of [
    [1510, 960],
    [1000, 740],
    [390, 844],
  ]) {
    win.setContentSize(width, height);
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const metrics = await evaluate(
      '({width:innerWidth,scroll:document.documentElement.scrollWidth,canvas:window.atlasTest.viewer.width,lines:window.atlasTest.viewer.filtered.visible.length})',
    );
    assert.equal(metrics.width, width, 'requested viewport width applied');
    assert.ok(
      metrics.scroll <= metrics.width + 1,
      'responsive layout has no horizontal overflow: ' + JSON.stringify(metrics),
    );
    assert.ok(metrics.canvas > 100);
    checks.push(metrics);
  }
  await fs.writeFile(
    path.join(root, 'qa', 'browser-mobile.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await fs.writeFile(
    path.join(root, 'qa', 'browser-test.json'),
    JSON.stringify({ passed: true, initial, checks }, null, 2),
  );
  win.webContents.debugger.detach();
  console.log(
    'PASS browser mode: actual folder input, 581 zones, map parsing, zone search, desktop/tablet/mobile layouts',
  );
};
