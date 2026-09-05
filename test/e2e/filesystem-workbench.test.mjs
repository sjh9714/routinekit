import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { UpstreamMCP } from '../../src/upstream.mjs';
import { RoutineService } from '../../src/service.mjs';
import { serveWorkbench } from '../../src/server.mjs';
import { launchBrowser } from '../../src/browser.mjs';

test('filesystem workbench: no-JSON capture, typed arguments, checks and skill ZIP download', { timeout: 90000 }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'routinekit-forms-')));
  const upstream = new UpstreamMCP({ servers: { files: { command: process.execPath, args: [resolve('node_modules/@modelcontextprotocol/server-filesystem/dist/index.js'), root], tools: ['write_file','read_text_file'] } } });
  const service = new RoutineService({ root: join(root, 'routines'), upstream }); const server = await serveWorkbench(service);
  const browser = await launchBrowser({ headless: true }); const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  async function approve() { const card = page.locator('.approval'); await card.waitFor(); const id = await card.getAttribute('data-approval-id'); await card.getByRole('button', { name: 'Approve once', exact: true }).click(); await page.locator(`[data-approval-id="${id}"]`).waitFor({ state: 'detached' }); }
  try {
    await page.goto(server.url);
    await page.getByText('Connect a local MCP server', { exact: true }).click();
    await page.getByRole('button', { name: 'Review & connect', exact: true }).click(); await approve();
    await page.getByRole('button', { name: 'Connected', exact: true }).waitFor();
    await page.locator('#capture > summary').click();
    await page.locator('#record-name').fill('ui-file-flow');
    const first = join(root, 'first.txt');
    await page.getByLabel('Input name', { exact: true }).fill('file'); await page.getByLabel('Example value', { exact: true }).fill(first);
    await page.locator('#add-input').click(); await page.getByLabel('Input name', { exact: true }).nth(1).fill('content'); await page.getByLabel('Example value', { exact: true }).nth(1).fill('original note');
    await page.locator('#record-tools').selectOption(['mcp:files:write_file','mcp:files:read_text_file']);
    await page.getByRole('button', { name: 'Start capture', exact: true }).click(); await approve();
    await page.getByText('Call one connected tool', { exact: true }).click();
    await page.locator('#call-name').selectOption('mcp:files:write_file'); await page.getByLabel('Argument path', { exact: true }).fill(first); await page.getByLabel('Argument content', { exact: true }).fill('original note');
    await page.getByRole('button', { name: 'Review & call', exact: true }).click(); await approve();
    await page.getByText('1 successful calls captured', { exact: false }).waitFor();
    await page.locator('#call-name').selectOption('mcp:files:read_text_file'); await page.getByLabel('Argument path', { exact: true }).fill(first);
    await page.getByRole('button', { name: 'Review & call', exact: true }).click(); await approve();
    await page.getByText('2 successful calls captured', { exact: false }).waitFor();
    await page.locator('#add-check').click(); await page.getByLabel('Result field', { exact: true }).selectOption({ label: 'step_2 /content' }); await page.getByLabel('Compare with', { exact: true }).selectOption('content');
    await page.locator('#expose').check(); await page.getByRole('button', { name: 'Review & save', exact: true }).click(); await approve();
    await page.getByText('1 saved', { exact: true }).waitFor();
    const second = join(root, 'second.txt'); await page.locator('[data-input="file"]').fill(second); await page.locator('[data-input="content"]').fill('changed note');
    await page.getByRole('button', { name: 'Review & run →', exact: true }).click(); for (let i = 0; i < 3; i++) await approve();
    await page.getByText('Ready for the next run.', { exact: true }).waitFor(); assert.equal(await readFile(second, 'utf8'), 'changed note');
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export skill ZIP', exact: true }).click(); const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'ui-file-flow.zip'); const archive = unzipSync(await readFile(await download.path()));
    const routine = JSON.parse(strFromU8(archive['routine.json'])); assert.equal(routine.expose, true); assert.equal(routine.steps[1].checks[0].input, 'content');
    assert.equal(strFromU8(archive['routine.json']).includes('original note'), false); assert.match(strFromU8(archive['SKILL.md']), /approval gate/); assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); await rm(root, { recursive: true }); }
});
