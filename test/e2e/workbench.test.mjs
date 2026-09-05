import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDemo } from '../../src/demo.mjs';
import { serveWorkbench } from '../../src/server.mjs';
import { launchBrowser } from '../../src/browser.mjs';

test('real workbench UI previews, approves, saves, changes input and replays', { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(),'routinekit-ui-test-')); const demo = await prepareDemo({ root, headless: true }); const server = await serveWorkbench(demo.service);
  const browser = await launchBrowser({ headless: true }); const page = await browser.newPage({ viewport: { width:1280,height:940 } }); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(server.url);
    await page.getByText('2 successful calls captured', { exact:false }).waitFor();
    await page.locator('#checks').fill('[{"step":"step_2","path":"/opened","equals":true}]');
    await page.getByRole('button',{name:'Preview capture',exact:true}).click();
    await page.locator('#data').filter({hasText:'contractHash'}).waitFor();
    await page.getByRole('button',{name:'Review & save',exact:true}).click();
    await page.getByRole('button',{name:'Approve once',exact:true}).click();
    await page.getByText('1 saved',{exact:true}).waitFor();
    await page.locator('[data-input="category"]').fill('timer');
    await page.getByRole('button',{name:'Review & run →',exact:true}).click();
    for (let i=0;i<3;i++) { const button = page.getByRole('button',{name:'Approve once',exact:true}); await button.waitFor(); const cardId = await page.locator('.approval').getAttribute('data-approval-id'); await button.click(); await page.locator(`[data-approval-id="${cardId}"]`).waitFor({state:'detached'}); }
    await page.getByText('Ready for the next run.',{exact:true}).waitFor();
    const current = await demo.service.state(); assert.equal(current.lastResult.result.name,'Tide Timer'); assert.equal(current.lastResult.modelCalls,0); assert.equal(current.events.length,4);
    assert.deepEqual(errors,[]);
    await mkdir('.artifacts',{recursive:true}); await page.screenshot({path:'.artifacts/workbench.png',fullPage:true});
  } catch(error) { await mkdir('.artifacts',{recursive:true}); await page.screenshot({path:'.artifacts/workbench-failure.png',fullPage:true}).catch(()=>{}); throw error; }
  finally { await browser.close(); await server.close(); await demo.close(); await rm(root,{recursive:true}); }
});
