import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function check(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) await check(path);
    else if (/\.(mjs|js)$/.test(item.name)) { const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' }); if (result.status !== 0) process.exit(result.status || 1); }
  }
}
for (const dir of ['src','bin','scripts','web','test']) await check(dir);
console.log('All JavaScript syntax checks passed.');
