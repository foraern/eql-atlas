const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
module.exports = async (win, root) => {
  const dir = path.join(root, 'qa');
  await fs.mkdir(dir, { recursive: true });
  const evaluate = (code) => win.webContents.executeJavaScript(code);
  const settle = () =>
    evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.atlasTest.viewer.render();resolve()})))',
    );
  for (let n = 0; n < 200; n++) {
    if (await evaluate('Boolean(window.atlasTest?.state.ready)')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await evaluate('window.atlasTest.state')).ready, true, 'initial map ready');
  await evaluate("window.atlasTest.selectZone('kedge')");
  let initial = await evaluate('window.atlasTest.state');
  assert.equal(initial.lines, 3517);
  assert.equal(initial.zones, 581);
  await settle();
  const pixels = await evaluate(
    `(()=>{const v=window.atlasTest.viewer;v.render();const c=document.createElement('canvas');c.width=v.renderer.domElement.width;c.height=v.renderer.domElement.height;const x=c.getContext('2d');x.drawImage(v.renderer.domElement,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i+1]>100&&d[i+2]>100&&d[i]<d[i+1]*.9)count++;return {count,width:c.width,height:c.height,lines:v.renderer.info.render.lines};})()`,
  );
  assert.ok(pixels.count > 200, 'visible map pixels were rendered: ' + JSON.stringify(pixels));
  await fs.writeFile(
    path.join(dir, 'desktop-3d.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await evaluate(
    "document.querySelector('[data-view=north]').click(); document.getElementById('height-scale').value='4'; document.getElementById('height-scale').dispatchEvent(new Event('change'));document.getElementById('z-low-number').value='-100';document.getElementById('z-low-number').dispatchEvent(new Event('change'));document.getElementById('z-high-number').value='80';document.getElementById('z-high-number').dispatchEvent(new Event('change'));",
  );
  const side = await evaluate('window.atlasTest.state');
  assert.equal(side.factor, 4);
  assert.equal(side.mode, 'north');
  assert.ok(side.visible < initial.visible);
  assert.ok(
    await evaluate(
      'window.atlasTest.viewer.filtered.visible.every(l=>l[2]>=-100.001&&l[2]<=80.001&&l[5]>=-100.001&&l[5]<=80.001)',
    ),
  );
  await evaluate("document.getElementById('cutaway').click()");
  assert.ok(
    await evaluate(
      'window.atlasTest.viewer.filtered.visible.every(l=>Math.abs(l[1]-window.atlasTest.viewer.options.depth.center)<=50.001&&Math.abs(l[4]-window.atlasTest.viewer.options.depth.center)<=50.001)',
    ),
  );
  await evaluate(
    "document.getElementById('cutaway').click();document.getElementById('all-heights').click();document.getElementById('references').click();document.getElementById('location').value='128.63,30.11,299.07';document.getElementById('mark-location').click();window.atlasTest.viewer.render()",
  );
  assert.deepEqual((await evaluate('window.atlasTest.state')).marker, [-30.11, -128.63, 299.07]);
  await settle();
  await fs.writeFile(
    path.join(dir, 'desktop-side.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await evaluate("window.atlasTest.selectZone('najena')");
  assert.equal((await evaluate('window.atlasTest.state')).lines, 4144);
  await evaluate(
    "document.getElementById('source-select').selectedIndex=1;document.getElementById('source-select').dispatchEvent(new Event('change'))",
  );
  for (let n = 0; n < 100; n++) {
    if ((await evaluate('window.atlasTest.state')).ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal((await evaluate('window.atlasTest.state')).source, 'Brewall-20240109');
  await evaluate(
    "window.atlasTest.setView('west');document.getElementById('height-scale').value='8';document.getElementById('height-scale').dispatchEvent(new Event('change'));document.getElementById('vertical-edges').click();window.atlasTest.viewer.render()",
  );
  const highlight = await evaluate(
    `(()=>{const v=window.atlasTest.viewer,c=document.createElement('canvas');c.width=v.renderer.domElement.width;c.height=v.renderer.domElement.height;const x=c.getContext('2d');function count(edges){v.setOptions({edges});v.render();x.drawImage(v.renderer.domElement,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>120&&d[i+1]>60&&d[i]>d[i+1]*1.2&&d[i+1]>d[i+2]*1.25)n++;return n;}return {off:count(false),on:count(true)};})()`,
  );
  assert.ok(
    highlight.on > highlight.off + 20,
    'orange vertical highlights remain visible above teal geometry: ' + JSON.stringify(highlight),
  );
  await settle();
  await fs.writeFile(
    path.join(dir, 'desktop-najena.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  const png = await evaluate('window.atlasTest.viewer.png().then(b=>({size:b.size,type:b.type}))');
  assert.equal(png.type, 'image/png');
  assert.ok(png.size > 1000);
  const isolated = await evaluate(
    '({require:typeof window.require,process:typeof window.process,bridge:typeof window.atlasDesktop.load})',
  );
  assert.deepEqual(isolated, { require: 'undefined', process: 'undefined', bridge: 'function' });
  const report = { passed: true, initial, side, png, pixels, highlight, isolated };
  await fs.writeFile(path.join(dir, 'desktop-test.json'), JSON.stringify(report, null, 2));
  console.log(
    'PASS desktop: visible map pixels, orange highlights, zone/source switching, slices, height scale, depth cutaway, /loc, PNG, isolated bridge',
  );
};
