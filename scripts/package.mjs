import { packager } from '@electron/packager';
import packageInfo from '../package.json' with { type: 'json' };
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const platform = arg('--platform') || process.platform,
  arch = arg('--arch') || process.arch;
const navigation = path.join(
  root,
  'navigation/runtime',
  `${platform}-${arch}`,
  'navigation',
);
const executable = path.join(
  navigation,
  'AtlasNavigation' + (platform === 'win32' ? '.exe' : ''),
);
if (!fs.existsSync(executable))
  throw Error(
    `Build the ${platform}-${arch} navigation helper before packaging. A helper for a different platform cannot be substituted.`,
  );
const electronZipDir = arg('--electron-zip-dir');
if (electronZipDir) {
  const filename = `electron-v${packageInfo.devDependencies.electron}-${platform}-${arch}.zip`;
  const manifest = fs.readFileSync(
    path.join(electronZipDir, 'SHASUMS256.txt'),
    'utf8',
  );
  const expected = manifest
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1]?.replace(/^\*/, '') === filename)?.[0];
  const hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(
    path.join(electronZipDir, filename),
  ))
    hash.update(bytes);
  if (!expected || hash.digest('hex') !== expected)
    throw Error('Electron ZIP checksum does not match its release manifest.');
}
const outputs = await packager({
  ...(electronZipDir ? { electronZipDir } : {}),
  dir: root,
  out: path.join(root, 'release'),
  name: 'EQL Atlas Cross-Platform',
  appBundleId: 'local.eql.atlas.crossplatform',
  appVersion: packageInfo.version,
  platform,
  arch,
  overwrite: true,
  asar: true,
  extraResource: [navigation],
  prune: false,
  ignore: [
    /^\/navigation(?:\/|$)/,
    /^\/node_modules(?:\/|$)/,
    /^\/release(?:\/|$)/,
    /^\/qa(?:\/|$)/,
    /^\/tests(?:\/|$)/,
    /^\/scripts(?:\/|$)/,
    /^\/\.git(?:\/|$)/,
  ],
  ...(platform === 'darwin'
    ? { icon: path.join(root, 'assets', 'AppIcon.icns') }
    : {}),
});
console.log(outputs.join('\n'));
