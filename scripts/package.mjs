import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const platform = arg('--platform') || process.platform,
  arch = arg('--arch') || process.arch;
const outputs = await packager({
  dir: root,
  out: path.join(root, 'release'),
  name: 'EQL Atlas Cross-Platform',
  appBundleId: 'local.eql.atlas.crossplatform',
  appVersion: '0.1.0',
  platform,
  arch,
  overwrite: true,
  asar: true,
  prune: false,
  ignore: [
    /^\/node_modules(?:\/|$)/,
    /^\/release(?:\/|$)/,
    /^\/qa(?:\/|$)/,
    /^\/tests(?:\/|$)/,
    /^\/scripts(?:\/|$)/,
    /^\/\.git(?:\/|$)/,
  ],
  ...(platform === 'darwin' ? { icon: path.join(root, 'assets', 'AppIcon.icns') } : {}),
});
console.log(outputs.join('\n'));
