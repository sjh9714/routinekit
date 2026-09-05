import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareDemo } from '../src/demo.mjs';
import { serveWorkbench } from '../src/server.mjs';
import { launchBrowser } from '../src/browser.mjs';
const root = await mkdtemp(join(tmpdir(),'routinekit-recording-'));
await mkdir('.artifacts/video',{recursive:true}); await mkdir('docs',{recursive:true});
const demo = await prepareDemo({root,headless:true}); const server = await serveWorkbench(demo.service); const browser = await launchBrowser({headless:true});
const context = await browser.newContext({viewport:{width:1200,height:1000},recordVideo:{dir:'.artifacts/video',size:{width:1200,height:1000}}}); const page = await context.newPage(); const video = page.video();
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
try {
  await page.goto(server.url); await page.getByText('2 successful calls captured',{exact:false}).waitFor(); await pause(1500);
  await page.locator('#checks').fill('[{"step":"step_2","path":"/opened","equals":true}]');
  await page.getByRole('button',{name:'Preview capture',exact:true}).click(); await page.locator('#data').filter({hasText:'contractHash'}).waitFor(); await pause(1000);
  await page.getByRole('button',{name:'Review & save',exact:true}).click(); await page.getByRole('button',{name:'Approve once',exact:true}).waitFor(); await pause(900); await page.getByRole('button',{name:'Approve once',exact:true}).click();
  await page.getByText('1 saved',{exact:true}).waitFor(); await page.locator('[data-input="category"]').fill('timer'); await pause(900);
  await page.getByRole('button',{name:'Review & run →',exact:true}).click();
  for(let i=0;i<3;i++){const button=page.getByRole('button',{name:'Approve once',exact:true});await button.waitFor();const id=await page.locator('.approval').getAttribute('data-approval-id');await pause(700);await button.click();await page.locator(`[data-approval-id="${id}"]`).waitFor({state:'detached'});}
  await page.getByText('Ready for the next run.',{exact:true}).waitFor();
  if(demo.service.lastResult?.result?.name!=='Tide Timer') throw new Error('Demo did not replay changed input');
  await page.locator('#output').scrollIntoViewIfNeeded(); await pause(1800); await page.evaluate(()=>window.scrollTo(0,0)); await pause(1400);
  await page.screenshot({path:'docs/workbench.png',fullPage:true});
} finally { await context.close(); await browser.close(); await server.close(); await demo.close(); await rm(root,{recursive:true}); }
const source = await video.path();
for(const args of [
  ['-y','-i',source,'-an','-c:v','libx264','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart','docs/demo.mp4'],
  ['-y','-i',source,'-vf','fps=8,scale=840:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer','-loop','0','docs/demo.gif'],
]){const result=spawnSync('ffmpeg',args,{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}
console.log('Recorded an actual browser workflow to docs/demo.mp4 and docs/demo.gif. Scripted tutorial, native WebMCP, no simulated model.');
