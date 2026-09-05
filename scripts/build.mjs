import { build } from 'esbuild';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { Script } from 'node:vm';
const result = await build({ entryPoints: ['client/index.jsx'], bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2020', external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'], jsx: 'automatic' });
const source = `window.__ModuleLoader__.load({id:"routinekit",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});\n`;
new Script(source); await mkdir('lib', { recursive: true }); await writeFile('lib/client.js', source); await chmod('bin/cli.mjs', 0o755); console.log('Built DSH workbench client.');
