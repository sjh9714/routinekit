import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { serveWorkbench, trustedRequest, ApprovalQueue } from '../src/server.mjs';
import { RoutineService } from '../src/service.mjs';
test('local workbench rejects cross-origin, forged host and missing capability', async () => {
  const root = await mkdtemp(join(tmpdir(),'routinekit-server-test-')); const service = new RoutineService({ root }); const server = await serveWorkbench(service); const origin = new URL(server.url).origin;
  try {
    assert.equal((await fetch(`${origin}/api/state`)).status,401);
    assert.equal((await fetch(`${origin}/api/state`,{headers:{'x-routinekit-token':server.token,origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(`${origin}/api/state`,{headers:{'x-routinekit-token':server.token}})).status,200);
    const rawStatus = await new Promise((resolve, reject) => { const req = request(`${origin}/api/state`, { headers: { 'x-routinekit-token': server.token, host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error',reject); req.end(); });
    assert.equal(rawStatus,403);
    const no = trustedRequest({socket:{remoteAddress:'192.168.1.3'},headers:{host:'127.0.0.1:1234'}}); assert.equal(no,false);
  } finally { await server.close(); await rm(root,{recursive:true}); }
});
test('approvals are single-use and cancellation settles pending prompts', async () => {
  const queue = new ApprovalQueue(); const controller = new AbortController();
  const waiting = queue.ask({stage:'run'},controller.signal); const {id} = queue.list()[0]; queue.answer(id,true); assert.equal(await waiting,true);
  assert.throws(()=>queue.answer(id,true)); const again = queue.ask({stage:'save'},controller.signal); controller.abort(); assert.equal(await again,false); assert.equal(queue.list().length,0);
});
