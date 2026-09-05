import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const temp = await mkdtemp(join(tmpdir(),'routinekit-package-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run verify:package.');
function run(args, cwd) { const r = spawnSync(process.execPath,[npmCli,...args],{cwd,encoding:'utf8',shell:false}); if(r.status!==0) throw new Error(r.stderr || r.stdout); return r.stdout; }
try {
  const packed = JSON.parse(run(['pack','--json','--pack-destination',temp],process.cwd()))[0];
  const files = packed.files.map(f=>f.path);
  for (const required of ['src/core.mjs','src/dsh.mjs','src/mcp.mjs','src/upstream.mjs','bin/cli.mjs','lib/client.js','lib/mcp-app.html','web/index.html','web/forms.js','server.json','cordis.patch.yml','README.md']) if (!files.includes(required)) throw new Error(`Missing packaged file: ${required}`);
  if(files.some(f=>f.startsWith('test/')||f.includes('.artifacts')||f.includes('node_modules')||f.endsWith('.env'))) throw new Error('Unexpected packaged content');
  await writeFile(join(temp,'package.json'),'{"name":"routinekit-package-check","private":true,"type":"module"}\n');
  run(['install','--ignore-scripts','--no-audit','--no-fund',join(temp,packed.filename)],temp);
  const installed = JSON.parse(await readFile(join(temp,'node_modules/routinekit/package.json'),'utf8'));
  const local = JSON.parse(await readFile('package.json','utf8'));
  if(installed.version!==local.version || installed.mcpName !== 'io.github.sjh9714/routinekit') throw new Error('Unexpected installed version or identity');
  const cli = spawnSync(process.execPath,[join(temp,'node_modules/routinekit/bin/cli.mjs'),'--version'],{encoding:'utf8'});
  if(cli.status!==0 || cli.stdout.trim()!==installed.version) throw new Error('Installed CLI failed');
  const client = new Client({ name: 'installed-package-check', version: '1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(temp,'node_modules/routinekit/bin/cli.mjs'), 'mcp'], env: { ROUTINEKIT_HOME: join(temp,'routines') }, stderr: 'pipe' }); transport.stderr.resume();
  try {
    await client.connect(transport);
    if (!(await client.listTools()).tools.some(t => t.name === 'routine_workbench')) throw new Error('Installed MCP App tool missing');
    const resource = await client.readResource({ uri: 'ui://routinekit/workbench.html' });
    if (!resource.contents[0].text.includes('Save as a named tool')) throw new Error('Installed MCP App resource missing');
  } finally { await client.close(); }
  console.log(`Package install verified: routinekit ${installed.version}, ${files.length} published files.`);
} finally { await rm(temp,{recursive:true}); }
