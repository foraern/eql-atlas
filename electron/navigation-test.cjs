const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
module.exports = async (win, root, backend) => {
  const evaluate = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => {
    for (let i = 0; i < 600; i++) {
      if (await evaluate(code)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error(
      'Timed out: ' +
        code +
        ' ' +
        (await evaluate('document.getElementById("route-status").textContent')),
    );
  };
  const settle = () =>
    evaluate(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{atlasTest.viewer.render();r()})))',
    );
  const route = async (a, b, acceptPreview = false) => {
    await evaluate(
      `(()=>{document.getElementById('route-start').value=${JSON.stringify(a)};document.getElementById('route-end').value=${JSON.stringify(b)};atlasTest.navigation.invalidate();document.getElementById('route-calculate').click();})()`,
    );
    await wait('!atlasTest.navigation.busy || document.getElementById("route-choice").open');
    if (await evaluate('document.getElementById("route-choice").open')) {
      assert.match(await evaluate('document.getElementById("route-choice-title").textContent'), /unverified crossings/);
      await evaluate(`document.getElementById("route-choices").children[${acceptPreview ? 0 : 1}].click()`);
      await wait('!atlasTest.navigation.busy');
    }
    return evaluate(
      '({status:document.getElementById("route-status").textContent,route:atlasTest.navigation.route})',
    );
  };
  const screenshot = async (name) => {
    await settle();
    await fs.writeFile(
      path.join(root, 'qa', name + '.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
  };
  await wait(
    'Boolean(window.atlasTest?.state.ready && atlasTest.navigation.inventory && !atlasTest.navigation.busy)',
  );
  const reports = [];
  if (backend.inventory.zones.some((z) => z.key === 'dry')) {
    await evaluate("atlasTest.selectZone('dry')");
    let result = await route('80,210,30', '80,270,30');
    assert.equal(result.route?.status, 'static', result.status);
    assert.ok(
      result.route.queryWallMS < 1000,
      'cached query including source freshness and IPC under one second',
    );
    assert.ok(result.route.distance > 59 && result.route.distance < 61);
    reports.push({
      name: 'synthetic',
      distance: result.route.distance,
      ms: result.route.elapsedMS,
      queryWallMS: result.route.queryWallMS,
    });
    await screenshot('route-synthetic');
    await evaluate(
      "atlasTest.navigation.inventory.zones.push({key:'dry',format:'s3d'});localStorage.removeItem('atlas-geometry-dry');atlasTest.navigation.invalidate();atlasTest.navigation.configureVersions();document.getElementById('route-calculate').click()",
    );
    await wait("document.getElementById('route-choice').open");
    assert.match(
      await evaluate(
        "document.getElementById('route-choice-title').textContent",
      ),
      /geometry version/,
    );
    await evaluate(
      "Array.from(document.getElementById('route-choices').children).find(b=>b.textContent==='EQG').click()",
    );
    await wait('!atlasTest.navigation.busy');
    assert.ok(await evaluate('atlasTest.navigation.route'));
    await evaluate(
      "atlasTest.navigation.inventory.zones=atlasTest.navigation.inventory.zones.filter(z=>z.format!=='s3d');atlasTest.navigation.configureVersions()",
    );
    // Conditional fallback is generic: real helper, synthetic stacked floors,
    // an explicit bridge record, and no zone-name special case.
    await evaluate("atlasTest.selectZone('stacked')");
    await route('80,210,30', '80,270,30');
    const originalCatalogs = backend.bundled;
    backend.bundled = [...originalCatalogs, {
      version: 1, zone: 'stacked', format: 'eqg', assets: backend.manifest.assets,
      links: [{ id: 'fixture-bridge', kind: 'bridge', label: 'Fixture bridge',
        from: [-210,-80,30], to: [-270,-80,40],
        note: 'Lower the bridge before crossing. Synthetic fixture; unverified.' }],
    }];
    const askForBridge = async () => {
      await evaluate("document.getElementById('route-mode').value='walk';document.getElementById('route-actions').querySelector('input[value=bridge]').checked=false;document.getElementById('route-start').value='80,210,30';document.getElementById('route-end').value='80,270,40';atlasTest.navigation.invalidate();document.getElementById('route-calculate').click()");
      await wait("document.getElementById('route-choice').open");
      assert.match(await evaluate("document.getElementById('route-choice-title').textContent"), /1 unverified crossings/);
    };
    try {
      const disconnected = await route('10,10,-100', '80,270,40');
      assert.equal(disconnected.route, null);
      assert.equal(await evaluate("document.getElementById('route-choice').open"), false);
      await askForBridge();
      await evaluate("document.getElementById('route-choices').children[1].click()");
      await wait('!atlasTest.navigation.busy');
      assert.equal(await evaluate('atlasTest.navigation.route'), null);
      assert.equal(await evaluate("document.getElementById('route-mode').value"), 'walk');
      await askForBridge();
      await evaluate("document.getElementById('route-choices').children[0].click()");
      await wait('!atlasTest.navigation.busy');
      assert.equal(await evaluate('atlasTest.navigation.route.status'), 'requiresVerification');
      assert.deepEqual(await evaluate('atlasTest.navigation.route.segments.map(s=>s.kind)'), ['walk','bridge','walk']);
      assert.ok(await evaluate("document.getElementById('route-instructions').open"));
      assert.match(await evaluate("document.getElementById('route-instructions-text').textContent"), /Lower the bridge/);
      await screenshot('route-bridge-fixture');
      // Cancellation during the prompt cannot publish its computed preview.
      await askForBridge();
      await evaluate("document.getElementById('route-clear').click()");
      await wait('!atlasTest.navigation.busy');
      assert.equal(await evaluate('atlasTest.navigation.route'), null);
      assert.equal(await evaluate("document.getElementById('route-choice').open"), false);
    } finally { backend.bundled = originalCatalogs; }
    await evaluate("document.getElementById('route-mode').value='walk';atlasTest.selectZone('dry')");
    await route('80,210,30', '80,270,30');
    // Text collection changes preserve the computed route and its mesh context.
    await evaluate(
      "document.getElementById('source-select').selectedIndex=1;document.getElementById('source-select').dispatchEvent(new Event('change'))",
    );
    await wait('atlasTest.state.ready');
    assert.ok(await evaluate('atlasTest.navigation.route'));
    const reference = path.join(backend.root, 'maps', 'alternate', 'dry.txt');
    const referenceBytes = await fs.readFile(reference);
    try {
      await fs.unlink(reference);
      await evaluate(
        "document.getElementById('source-select').dispatchEvent(new Event('change'))",
      );
      await wait('atlasTest.state.ready');
      assert.ok(
        await evaluate(
          'atlasTest.navigation.route && atlasTest.viewer.data.navigationOnly && atlasTest.viewer.navigationMesh.visible',
        ),
      );
      assert.equal(
        await evaluate("document.getElementById('empty-state').hidden"),
        true,
      );
    } finally {
      await fs.writeFile(reference, referenceBytes);
    }
    await evaluate(
      "document.getElementById('source-select').dispatchEvent(new Event('change'))",
    );
    await wait('atlasTest.state.ready');
    await evaluate(
      "document.getElementById('route-step').value='1.5';document.getElementById('route-step').dispatchEvent(new Event('change'))",
    );
    assert.equal(await evaluate('atlasTest.navigation.route'), null);
    await evaluate(
      "document.getElementById('route-step').value='2';document.getElementById('route-step').dispatchEvent(new Event('change'))",
    );
    result = await route('80,210,30', '80,210,30');
    assert.equal(result.route.distance, 0);
    result = await route('9999,9999,9999', '80,270,30');
    assert.equal(result.route, null);
    assert.match(result.status, /No nearby/);
    // Landmark and manual-location sources use the same bounded projection.
    await evaluate(
      "atlasTest.viewer.selected=atlasTest.viewer.data.labels[0];document.getElementById('route-end-source').value='landmark';document.getElementById('route-end-source').dispatchEvent(new Event('change'))",
    );
    await wait('!atlasTest.navigation.busy');
    assert.ok(await evaluate('atlasTest.navigation.resolved.end'));
    await evaluate(
      "document.getElementById('location').value='80,210,30';document.getElementById('route-start-source').value='location';document.getElementById('route-start-source').dispatchEvent(new Event('change'))",
    );
    await wait('!atlasTest.navigation.busy');
    assert.ok(await evaluate('atlasTest.navigation.resolved.start'));
    // Stacked floors must prompt; escape cancels without selecting a hidden floor.
    await evaluate("atlasTest.selectZone('stacked')");
    await evaluate(
      "document.getElementById('route-start').value='80,210,35';document.getElementById('route-end').value='80,270,40';document.getElementById('route-calculate').click()",
    );
    await wait("document.getElementById('route-choice').open");
    assert.ok(
      await evaluate(
        "document.getElementById('route-choices').children.length>=2",
      ),
    );
    await evaluate("document.getElementById('route-choice-cancel').click()");
    await wait('!atlasTest.navigation.busy');
    assert.equal(await evaluate('atlasTest.navigation.route'), null);
    await evaluate(
      "atlasTest.setView('top');document.getElementById('route-start-source').value='pick';document.getElementById('route-start-source').dispatchEvent(new Event('change'))",
    );
    await wait('!atlasTest.navigation.busy');
    await evaluate(
      'atlasTest.viewer.render();(()=>{const p=atlasTest.viewer.project([-210,-80,40]);atlasTest.viewer.pickNavigation(p.x,p.y)})()',
    );
    await wait("document.getElementById('route-choice').open");
    const heights = await evaluate(
      "Array.from(document.getElementById('route-choices').children).map(e=>e.textContent)",
    );
    assert.equal(heights.length, 2);
    await evaluate(
      "document.getElementById('route-choices').children[0].click()",
    );
    await wait('!atlasTest.navigation.busy');
    assert.ok(await evaluate('atlasTest.navigation.resolved.start'));
    await evaluate("atlasTest.selectZone('navonly')");
    result = await route('80,210,30', '80,270,30');
    assert.ok(result.route, result.status);
    assert.equal(
      await evaluate("document.getElementById('empty-state').hidden"),
      true,
    );
    assert.equal(
      await evaluate('atlasTest.viewer.navigationMesh.visible'),
      true,
    );
    await evaluate("atlasTest.selectZone('empty')");
    result = await route('80,210,30', '80,270,30');
    assert.ok(result.route, result.status);
    assert.equal(
      await evaluate("document.getElementById('empty-state').hidden"),
      true,
    );
    assert.equal(
      await evaluate('atlasTest.viewer.navigationMesh.visible'),
      true,
    );
    // Editing during work invalidates all stale results and terminates the owned process.
    await evaluate(
      "document.getElementById('route-batch').click();document.getElementById('route-start').dispatchEvent(new Event('input'))",
    );
    await wait('!atlasTest.navigation.busy');
    assert.equal(await evaluate('atlasTest.navigation.route'), null);
  } else {
    await evaluate("atlasTest.selectZone('mistmoore')");
    for (const [name, a, b] of [
      ['reported', '-317.58,118.78,-181.60', '164.55,-11.48,-195.61'],
      [
        'princess',
        '-330.9282,126.5327,-182.7388',
        '-132.3854,23.1604,-156.5857',
      ],
    ]) {
      const result = await route(a, b);
      assert.equal(result.route?.status, 'static', result.status);
      assert.ok(
        result.route.queryWallMS < 1000,
        'cached query including source freshness and IPC under one second',
      );
      reports.push({
        name,
        distance: result.route.distance,
        ms: result.route.elapsedMS,
        queryWallMS: result.route.queryWallMS,
      });
    }
    for (const mode of ['top', '3d', 'north']) {
      await evaluate(
        `atlasTest.setView('${mode}');atlasTest.viewer.fitRoute()`,
      );
      await screenshot('route-mistmoore-' + mode);
    }
    await evaluate(
      "document.getElementById('z-low-number').value='-185';document.getElementById('z-low-number').dispatchEvent(new Event('change'));document.getElementById('z-high-number').value='-175';document.getElementById('z-high-number').dispatchEvent(new Event('change'));document.getElementById('height-scale').value='4';document.getElementById('height-scale').dispatchEvent(new Event('change'));atlasTest.viewer.render()",
    );
    assert.ok(await evaluate('atlasTest.viewer.hiddenRouteParts>0'));
    await screenshot('route-mistmoore-sliced');
    await evaluate("atlasTest.selectZone('soldungb')");
    let result = await route(
      '-413.68,-265.70,-111.97',
      '-481.02,334.17,-83.97',
    );
    assert.equal(result.route, null);
    assert.match(result.status, /walking route/);
    assert.ok(await evaluate('atlasTest.viewer.reachableTriangles.length>0'));
    await screenshot('route-efreeti-no-walking-route');
    await evaluate(
      "document.getElementById('route-mode').value='preview';document.getElementById('route-mode').dispatchEvent(new Event('change'))",
    );
    result = await route('-413.68,-265.70,-111.97', '-481.02,334.17,-83.97');
    assert.equal(result.route?.status, 'requiresVerification', result.status);
    assert.equal(result.route.crossings, 4);
    assert.equal(result.route.unverifiedCrossings, 4);
    reports.push({
      name: 'efreeti-preview',
      distance: result.route.distance,
      ms: result.route.elapsedMS,
      queryWallMS: result.route.queryWallMS,
      crossings: 4,
    });
    for (const mode of ['top', '3d', 'north']) {
      await evaluate(
        `atlasTest.setView('${mode}');atlasTest.viewer.fitRoute()`,
      );
      await screenshot('route-efreeti-' + mode);
    }
    await evaluate("document.getElementById('route-mode').value='walk';document.getElementById('route-actions').querySelector('input[value=bridge]').checked=false;document.getElementById('route-mode').dispatchEvent(new Event('change'))");
    result = await route('-413.6787,-265.7017,-111.9677', '-1376.3337,-824.1087,85.2857', true);
    assert.equal(result.route?.status, 'requiresVerification', result.status);
    assert.deepEqual(result.route.segments.map(s=>s.kind), ['walk','bridge','walk']);
    assert.equal(result.route.unverifiedCrossings, 1);
    assert.match(await evaluate("document.getElementById('route-instructions-text').textContent"), /lower the bridge/);
    reports.push({name:'nagafen-bridge-preview',distance:result.route.distance,queryWallMS:result.route.queryWallMS,crossings:1});
    for (const mode of ['top', '3d']) {
      await evaluate(`atlasTest.setView('${mode}');atlasTest.viewer.fitRoute()`);
      await screenshot('route-nagafen-' + mode);
    }
    const png = await evaluate(
      'atlasTest.viewer.png().then(async b=>Array.from(new Uint8Array(await b.arrayBuffer())))',
    );
    assert.ok(png.length > 10000);
    await fs.writeFile(
      path.join(root, 'qa', 'route-export.png'),
      Buffer.from(png),
    );
  }
  await fs.writeFile(
    path.join(root, 'qa', 'navigation-ui-test.json'),
    JSON.stringify({ passed: true, reports }, null, 2),
  );
  console.log('PASS Electron navigation: ' + JSON.stringify(reports));
};
