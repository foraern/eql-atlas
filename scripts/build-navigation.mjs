import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
function run(args) {
  const r = spawnSync('cmake', args, { cwd: root, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
}
run([
  '-S',
  'navigation/engine',
  '-B',
  'navigation/build',
  '-DCMAKE_BUILD_TYPE=Release',
]);
run(['--build', 'navigation/build', '--config', 'Release', '--parallel', '6']);
const out = path.join(
  root,
  'navigation/runtime',
  `${process.platform}-${process.arch}`,
  'navigation',
);
await fs.mkdir(out, { recursive: true });
const executable =
  'AtlasNavigation' + (process.platform === 'win32' ? '.exe' : '');
await fs.copyFile(
  path.join(root, 'navigation/build', executable),
  path.join(out, executable),
);
if (process.platform !== 'win32')
  await fs.chmod(path.join(out, executable), 0o755);
for (const [from, to] of [
  ['navigation/engine/Crossings', 'Crossings'],
  ['navigation/engine', 'source/engine'],
  ['navigation/Vendor', 'source/Vendor'],
])
  await fs.cp(path.join(root, from), path.join(out, to), { recursive: true });
console.log('Bundled navigation runtime:', out);
