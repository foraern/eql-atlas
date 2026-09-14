import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import packageInfo from '../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '..');
const target = `${process.platform}-${process.arch}`;
const labels = {
  'darwin-arm64': 'macOS-arm64.zip',
  'win32-x64': 'Windows-x64.zip',
  'linux-x64': 'Linux-x64.tar.gz',
};
if (!labels[target]) throw Error(`Unsupported release target: ${target}`);
const directory = `EQL Atlas Cross-Platform-${target}`;
const release = path.join(root, 'release');
const assets = path.join(release, 'assets');
fs.mkdirSync(assets, { recursive: true });
const filename = `EQL-Atlas-${packageInfo.version}-${labels[target]}`;
const archive = path.join(assets, filename);
fs.rmSync(archive, { force: true });
let command, args;
if (process.platform === 'darwin') {
  command = 'ditto';
  args = ['-c', '-k', '--sequesterRsrc', '--keepParent',
    path.join(release, directory, 'EQL Atlas Cross-Platform.app'), archive];
} else if (process.platform === 'win32') {
  command = 'pwsh';
  args = ['-NoProfile', '-Command',
    'Compress-Archive -LiteralPath $env:ATLAS_ARCHIVE_SOURCE -DestinationPath $env:ATLAS_ARCHIVE_DESTINATION -CompressionLevel Optimal'];
} else {
  command = 'tar';
  args = ['-czf', archive, '-C', release, directory];
}
const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: { ...process.env, ATLAS_ARCHIVE_SOURCE: path.join(release, directory),
    ATLAS_ARCHIVE_DESTINATION: archive },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const hash = createHash('sha256');
for await (const bytes of fs.createReadStream(archive)) hash.update(bytes);
fs.writeFileSync(`${archive}.sha256`, `${hash.digest('hex')}  ${filename}\n`);
console.log(archive);
