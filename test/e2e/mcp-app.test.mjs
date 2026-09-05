import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMCPServer } from '../../src/mcp.mjs';
import { prepareDemo } from '../../src/demo.mjs';
import { launchBrowser } from '../../src/browser.mjs';

test('MCP App in official AppBridge: render, human review, typed replay and stop', { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'routinekit-app-'));
  const demo = await prepareDemo({ root, headless: true }); const server = createMCPServer(demo.service);
  const client = new Client({ name: 'routinekit-reference-test-host', version: '1.0' }, { capabilities: { elicitation: { form: {} } } });
  const [a,b] = InMemoryTransport.createLinkedPair();
  const browser = await launchBrowser({ headless: true }); const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let pending;
  client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
    return new Promise(resolve => {
      const finish = action => { pending = undefined; extra.signal.removeEventListener('abort', abort); void page.evaluate(() => { document.getElementById('host-review').hidden = true; }); resolve({ action, ...(action === 'accept' ? { content: { approved: true } } : {}) }); };
      const abort = () => finish('cancel'); extra.signal.addEventListener('abort', abort, { once: true }); pending = finish;
      void page.evaluate(message => { document.getElementById('host-detail').textContent = message; document.getElementById('host-review').hidden = false; }, request.params.message);
    });
  });
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const resource = await client.readResource({ uri: 'ui://routinekit/workbench.html' });
    await page.setContent('<section id="host-review" hidden><pre id="host-detail"></pre><button id="deny">Host: deny</button><button id="accept">Host: approve once</button></section><iframe title="RoutineKit" sandbox="allow-scripts allow-downloads" style="width:100%;height:980px;border:0"></iframe>');
    await page.exposeFunction('hostTool', args => client.callTool(args));
    await page.exposeFunction('hostAnswer', action => pending?.(action));
    const host = await build({ stdin: { contents: 'import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"; window.mount = async html => { const frame = document.querySelector("iframe"); const bridge = new AppBridge(null, {name:"RoutineKit test host",version:"1.0"}, {serverTools:{}}); bridge.oncalltool = args => window.hostTool(args); await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow)); frame.srcdoc = html; document.getElementById("accept").onclick = () => window.hostAnswer("accept"); document.getElementById("deny").onclick = () => window.hostAnswer("decline"); };', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    await page.addScriptTag({ content: host.outputFiles[0].text });
    await page.evaluate(html => window.mount(html), resource.contents[0].text);
    const app = page.frameLocator('iframe');
    await app.getByText('2 successful calls captured', { exact: false }).waitFor();
    await app.locator('#expose').check();
    await app.getByRole('button', { name: 'Review & save', exact: true }).click();
    await page.getByRole('button', { name: 'Host: approve once', exact: true }).click();
    await app.getByText('1 saved', { exact: true }).waitFor();
    const specs = (await client.listTools()).tools; assert.ok(specs.some(t => t.name.startsWith('routine_saved_find_project_')));
    await app.locator('[data-input="category"]').fill('drawing');
    await app.getByRole('button', { name: 'Review & run →', exact: true }).click();
    for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Host: approve once', exact: true }).click(); await page.locator('#host-review').waitFor({ state: 'hidden' }); }
    await app.getByText('Ready for the next run.', { exact: true }).waitFor();
    assert.equal((await demo.service.state()).lastResult.result.name, 'Moss Sketch');
    await app.getByRole('button', { name: 'Review & run →', exact: true }).click();
    await page.getByRole('button', { name: 'Host: deny', exact: true }).click();
    await app.locator('#notice.error').waitFor(); assert.equal(demo.service.runState, 'failed');
    await app.getByRole('button', { name: 'Review & run →', exact: true }).click();
    await page.getByRole('button', { name: 'Host: approve once', exact: true }).waitFor();
    await app.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.locator('#host-review').waitFor({ state: 'hidden' });
    await app.locator('#notice').filter({ hasText: /Cancelled|Done/ }).waitFor();
    assert.equal(demo.service.browser.page, undefined); assert.deepEqual(errors, []);
    await mkdir('.artifacts', { recursive: true }); await page.screenshot({ path: '.artifacts/mcp-app.png', fullPage: true });
  } finally { pending?.('cancel'); await client.close(); await server.close(); await demo.close(); await browser.close(); await rm(root, { recursive: true }); }
});
