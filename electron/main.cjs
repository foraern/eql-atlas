const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  session,
  clipboard,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const browserTest = process.argv.includes('--browser-test');
const navigationTest = process.argv.includes('--navigation-test');
const regressionTest = process.argv.includes('--regression-test');
const selfTest =
  process.argv.includes('--self-test') ||
  browserTest ||
  regressionTest ||
  navigationTest;
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
app.setName('EQL Atlas Cross-Platform');
// Packaged app resources are read-only; keep test profiles and reports outside the archive.
const testRoot =
  selfTest && app.isPackaged
    ? path.join(app.getPath('temp'), 'eql-atlas-test-' + process.pid)
    : root;
if (selfTest) {
  // Headless CI runners lack a usable GPU; normal application launches keep
  // Chromium's default hardware selection and security settings.
  if (process.env.ATLAS_TEST_SOFTWARE_GL === '1') {
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
  }
  require('node:fs').mkdirSync(path.join(testRoot, 'qa', 'test-profile'), {
    recursive: true,
  });
  app.setPath('userData', path.join(testRoot, 'qa', 'test-profile'));
}
let win;
let navigation;
let catalog = null;
let config = {};
let scanFolder;
let readZone;
const configPath = () => path.join(app.getPath('userData'), 'atlas.json');
async function setFolder(folder) {
  const next = await scanFolder(folder);
  catalog = next;
  config.mapsFolder = next.root;
  if (!selfTest) {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(configPath(), JSON.stringify(config, null, 2));
  }
  if (navigation) {
    try {
      await navigation.setRoot(
        config.geometryFolder || path.dirname(next.root),
      );
    } catch {
      /* A missing geometry folder must not prevent text-map viewing. */
    }
  }
  return next;
}
function trusted(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame
  )
    throw Error('Untrusted frame.');
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    trusted(event);
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code, details: e.details };
    }
  });
}
function createWindow() {
  const window = new BrowserWindow({
    title: 'EQL Atlas Cross-Platform',
    width: 1510,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#0b1420',
    show: !selfTest,
    webPreferences: {
      ...(browserTest ? {} : { preload: path.join(__dirname, 'preload.cjs') }),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: !selfTest,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
  return window;
}

function registerIpcHandlers() {
  handle('atlas:navigation', async (command, value = {}, operation = '') => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof operation !== 'string' ||
      operation.length > 100
    )
      throw Error('Invalid navigation request.');
    switch (command) {
      case 'inventory':
        return navigation.discover(operation);
      case 'prepare':
        return navigation.prepare(value, operation);
      case 'project':
        return navigation.project(value, operation);
      case 'route':
        return navigation.route(value, operation);
      case 'cancel':
        await navigation.cancel();
        return true;
      case 'batch':
        return navigation.prepareAll(
          value,
          operation,
          catalog?.zones.map((z) => z.key) || [],
        );
      case 'chooseRoot': {
        const picked = await dialog.showOpenDialog(win, {
          title: 'Choose the game installation containing S3D / EQG archives',
          properties: ['openDirectory'],
        });
        if (picked.canceled) return null;
        config.geometryFolder = await navigation.setRoot(picked.filePaths[0]);
        if (!selfTest)
          await fs.writeFile(configPath(), JSON.stringify(config, null, 2));
        return navigation.discover(operation);
      }
      case 'import': {
        const picked = await dialog.showOpenDialog(win, {
          title: 'Import asset-bound crossing catalog',
          properties: ['openFile'],
          filters: [{ name: 'Crossing catalog', extensions: ['json'] }],
        });
        if (picked.canceled) return null;
        if ((await fs.stat(picked.filePaths[0])).size > 1024 * 1024)
          throw Error('Catalog exceeds 1 MB.');
        return navigation.importCatalog(
          await fs.readFile(picked.filePaths[0], 'utf8'),
        );
      }
      case 'review': {
        const review = navigation.review(value);
        const picked = await dialog.showSaveDialog(win, {
          title: 'Export crossing review',
          defaultPath: review.zone + '.crossings.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (picked.canceled) return false;
        await fs.writeFile(picked.filePath, JSON.stringify(review, null, 2));
        return true;
      }
      default:
        throw Error('Unsupported navigation operation.');
    }
  });
  handle('atlas:catalog', async () => {
    if (catalog) return catalog;
    if (config.mapsFolder) return setFolder(config.mapsFolder);
    return null;
  });
  handle('atlas:choose', async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose the EQL maps folder',
      defaultPath: config.mapsFolder,
      properties: ['openDirectory'],
    });
    return picked.canceled ? null : setFolder(picked.filePaths[0]);
  });
  handle('atlas:load', async ({ key, source }) => {
    if (
      !catalog ||
      typeof key !== 'string' ||
      typeof source !== 'string' ||
      key.length > 200 ||
      source.length > 200
    )
      throw Error('Select a map folder and zone first.');
    return readZone(catalog, key, source);
  });
  handle('atlas:copy-loc', async (text) => {
    if (
      typeof text !== 'string' ||
      text.length > 120 ||
      !/^[-+\d.]+, [-+\d.]+, [-+\d.]+$/.test(text) ||
      !text.split(',').every((s) => Number.isFinite(Number(s)))
    )
      throw Error('Invalid location.');
    clipboard.writeText(text);
    return true;
  });
  handle('atlas:export', async ({ bytes, name }) => {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length > 30 * 1024 * 1024 ||
      !Buffer.from(bytes.subarray(0, 8)).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )
    )
      throw Error('Invalid PNG.');
    const safeName =
      typeof name === 'string'
        ? name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
        : 'atlas-map';
    const selected = await dialog.showSaveDialog(win, {
      defaultPath: safeName + '.png',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (selected.canceled) return false;
    await fs.writeFile(selected.filePath, bytes);
    return true;
  });
}

function installMenu() {
  const template = [];
  if (process.platform === 'darwin')
    template.push({
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    });
  template.push(
    {
      label: 'File',
      submenu: [
        {
          label: 'Choose Maps Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () =>
            win.webContents.executeJavaScript(
              "document.getElementById('open-folder').click()",
            ),
        },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app
  .whenReady()
  .then(async () => {
    ({ scanFolder, readZone } = await import(
      pathToFileURL(path.join(root, 'src/node-maps.js'))
    ));
    try {
      config = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    } catch {}
    const requested = arg('--maps');
    if (requested) config.mapsFolder = requested;
    const navFixture =
      navigationTest && !requested
        ? await require('./navigation-fixture.cjs').createFixture(
            path.join(testRoot, 'qa'),
          )
        : null;
    if (navFixture) {
      config.mapsFolder = navFixture;
      delete config.geometryFolder;
    }
    const fixture = regressionTest
      ? await require('./regression-test.cjs').createFixture(
          path.join(testRoot, 'qa'),
        )
      : null;
    if (fixture) config.mapsFolder = fixture;
    const helper = path.join(
      app.isPackaged
        ? process.resourcesPath
        : path.join(root, 'navigation', 'build'),
      ...(app.isPackaged ? ['navigation'] : []),
      'AtlasNavigation' + (process.platform === 'win32' ? '.exe' : ''),
    );
    navigation = new (require('./navigation.cjs').NavigationBackend)({
      helper,
      cache: path.join(app.getPath('userData'), 'navigation-cache'),
      settings: path.join(app.getPath('userData'), 'crossings.json'),
      progress: (event) => {
        if (win && !win.isDestroyed())
          win.webContents.send('atlas:navigation-progress', event);
      },
    });
    await navigation.init();
    if (config.geometryFolder || config.mapsFolder) {
      try {
        await navigation.setRoot(
          config.geometryFolder || path.dirname(config.mapsFolder),
        );
      } catch {
        /* The folder picker remains available after an installation moves. */
      }
    }
    app.setAboutPanelOptions({
      applicationName: 'EQL Atlas',
      applicationVersion: app.getVersion(),
      comments:
        'Offline maps and static-geometry walking routes. Preparation reads local game assets. Clearance and step values are modelling assumptions. Door access and live obstructions are unverified. Special crossings require explicit evidence; previews are not confirmed routes.',
    });
    win = createWindow();
    registerIpcHandlers();
    installMenu();
    if (selfTest)
      await win.webContents.session.clearStorageData({
        storages: ['localstorage'],
      });
    await win.loadFile(path.join(root, 'dist/index.html'));
    if (selfTest) {
      try {
        if (navigationTest)
          await require('./navigation-test.cjs')(win, testRoot, navigation);
        else if (regressionTest) {
          await require('./regression-test.cjs').run(
            win,
            testRoot,
            fixture,
            browserTest,
          );
        } else if (browserTest)
          await require('./browser-test.cjs')(win, testRoot, requested);
        else await require('./self-test.cjs')(win, testRoot);
        console.log('Test reports:', path.join(testRoot, 'qa'));
        await navigation.cancel();
        app.exit(0);
      } catch (error) {
        console.error(error);
        await navigation.cancel();
        app.exit(1);
      }
    }
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());

let quitting = false;
app.on('before-quit', (event) => {
  if (navigation?.child && !quitting) {
    event.preventDefault();
    quitting = true;
    navigation.cancel().finally(() => app.quit());
  }
});
