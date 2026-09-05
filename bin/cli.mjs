#!/usr/bin/env node
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { RoutineStore, exportSkill } from '../src/store.mjs';
import { RoutineService } from '../src/service.mjs';
import { safeError, validateRoutine, fail, LIMITS } from '../src/core.mjs';
import { serveWorkbench } from '../src/server.mjs';
import { serveFixture } from '../src/fixture.mjs';
import { WebMCPBrowser } from '../src/browser.mjs';
const args = process.argv.slice(2); const command = args[0] || 'help';
const configIndex = args.indexOf('--config');
if (configIndex !== -1 && (!args[configIndex + 1] || args[configIndex + 1].startsWith('--'))) { console.error('--config requires a file path'); process.exit(1); }
const configFile = configIndex === -1 ? process.env.ROUTINEKIT_CONFIG : resolve(args[configIndex + 1]);
function openURL(url) {
  const [bin, commandArgs] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(bin, commandArgs, { stdio: 'ignore', shell: false }); child.on('error', () => {}); child.unref();
}
async function keepAlive(close) {
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await close(); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
try {
  if (command === 'mcp') { const { serveMCP } = await import('../src/mcp.mjs'); const service = new RoutineService({ configFile }); await service.upstreamReady; const server = await serveMCP(service); await keepAlive(async () => { await server.close(); await service.close(); }); }
  else if (command === 'open' || command === 'demo' || command === 'demo-files') {
    if (command === 'demo-files' && (!args[1] || args[1].startsWith('--'))) fail('ARGUMENT', 'Usage: routinekit demo-files PATH_TO_INSTALLED_FILESYSTEM_SERVER/dist/index.js [--no-open]. This runs that trusted script and writes sample files only in a new temporary workspace.');
    const demo = command === 'demo-files' ? await (await import('../src/file-demo.mjs')).prepareFileDemo(args[1]) : command === 'demo' ? await (await import('../src/demo.mjs')).prepareDemo() : null;
    const service = demo?.service || new RoutineService({ configFile }); await service.upstreamReady;
    const workbench = await serveWorkbench(service);
    console.log(`RoutineKit workbench: ${workbench.url}`);
    if (command === 'demo') console.log('Scripted tutorial: two real native-WebMCP calls are captured. Preview, add checks, save, then try category "timer" or "drawing". The local fixture is available only while this process runs.');
    if (command === 'demo-files') console.log(`Scripted tutorial through your installed MCP filesystem server, not a model. Add a check: step_2 /content equals input content. Save as Tool, then try file ${demo.nextFile} and any new content. Only temporary sample files and demo routines are removed on exit. Export a skill ZIP before exiting if you want to keep it.`);
    console.log('Press Ctrl+C to stop and close only RoutineKit-owned browser processes.');
    if (!args.includes('--no-open')) openURL(workbench.url);
    await keepAlive(async () => { await workbench.close(); await demo?.close(); });
  } else if (command === 'doctor') {
    const fixture = await serveFixture(); const browser = new WebMCPBrowser({ headless: true });
    try { const info = await browser.open(fixture.url); const output = await browser.call('catalog_search', { category: 'notes' }); if (output.items?.[0]?.name !== 'Pine Notes') fail('DOCTOR', 'Native WebMCP execution did not return the expected result.'); console.log(JSON.stringify({ node: process.version, browser: await browser.browser.version(), webmcp: info.mode, tools: info.tools.length, realToolCall: 'passed', profile: 'ephemeral' }, null, 2)); }
    finally { await browser.close(); await fixture.close(); }
  } else if (command === 'list') console.log(JSON.stringify(await new RoutineStore().list(), null, 2));
  else if (command === 'inspect') console.log(JSON.stringify(await new RoutineStore().get(args[1]), null, 2));
  else if (command === 'import') {
    if (!args[1]) fail('ARGUMENT', 'Usage: routinekit import FILE');
    const stat = await lstat(resolve(args[1])); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.bytes) fail('FILE', 'Import a bounded regular JSON file.');
    const routine = validateRoutine(JSON.parse(await readFile(resolve(args[1]), 'utf8')));
    // A CLI user explicitly imports a file; this action never executes it.
    console.log(JSON.stringify(await new RoutineStore().save(routine)));
  } else if (command === 'export') {
    if (!args[1] || !args[2]) fail('ARGUMENT', 'Usage: routinekit export NAME NEW_DIRECTORY');
    console.log(await exportSkill(await new RoutineStore().get(args[1]), args[2]));
  } else if (command === '--version' || command === 'version') console.log('0.2.0');
  else if (command === 'help' || command === '--help') console.log('RoutineKit\n\n  routinekit demo [--no-open]     Real WebMCP capture tutorial\n  routinekit demo-files SERVER   Run an installed filesystem MCP script in a temporary workspace\n  routinekit open [--no-open]    Local capture/replay workbench\n  routinekit doctor             Check browser + real native WebMCP tool call\n  routinekit mcp                MCP stdio server + MCP App (human elicitation required)\n  routinekit list\n  routinekit inspect NAME\n  routinekit import FILE        Review/import; never executes\n  routinekit export NAME NEW_DIRECTORY\n\nopen/mcp: --config FILE or ROUTINEKIT_CONFIG for an explicit local MCP server allowlist.\nStorage: ROUTINEKIT_HOME or ~/.routinekit. No global host configuration is edited.');
  else fail('ARGUMENT', 'Unknown command. Run routinekit --help.');
} catch(error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }
