import { spawnSync } from 'node:child_process';
const python = process.platform === 'win32' ? 'python' : 'python3';
for (const file of ['navigation.py', 'geometry.py', 'action_navigation.py']) {
  const r = spawnSync(python, ['navigation/Tests/' + file], {
    stdio: 'inherit',
  });
  if (r.error) throw r.error;
  if (r.status) process.exit(r.status);
}
