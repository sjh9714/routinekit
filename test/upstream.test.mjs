import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { UpstreamMCP, validateConfig } from '../src/upstream.mjs';
import { RoutineService } from '../src/service.mjs';
import { invokeTool, savedTools } from '../src/tools.mjs';

test('official filesystem MCP: capture, named tool, changed inputs, denial and cleanup', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'routinekit-files-'));
  const config = { servers: { files: { command: process.execPath, args: [resolve('node_modules/@modelcontextprotocol/server-filesystem/dist/index.js'), root], tools: ['write_file','read_text_file'] } } };
  const upstream = new UpstreamMCP(config); const service = new RoutineService({ root: join(root, 'routines'), upstream });
  const approvals = []; const options = { approve: async review => { approvals.push(review.stage); return true; } };
  const first = join(root, 'first.txt'); const second = join(root, 'second.txt');
  try {
    assert.equal((await service.state()).servers[0].connected, false);
    await assert.rejects(service.invoke('connect', { server: 'files' }, { approve: async () => false }), { code: 'APPROVAL_REQUIRED' });
    assert.equal(upstream.connections.size, 0);
    await service.invoke('connect', { server: 'files' }, options);
    const transport = upstream.connections.get('files').transport; const pid = transport.pid; assert.ok(pid);
    assert.equal((await service.tools()).length, 2);
    await service.invoke('record', { name: 'write-and-check', inputs: { file: first, content: 'first note' }, tools: ['mcp:files:write_file','mcp:files:read_text_file'] }, options);
    await service.invoke('call', { name: 'mcp:files:write_file', arguments: { path: first, content: 'first note' } }, options);
    await service.invoke('call', { name: 'mcp:files:read_text_file', arguments: { path: first } }, options);
    await service.invoke('save', { expose: true, checks: [{ step: 'step_2', path: '/content', input: 'content' }] }, options);
    const specs = await savedTools(service); assert.equal(specs[0].name, 'routine_saved_write_and_check');
    assert.equal(specs[0].inputSchema.properties.file.type, 'string');
    const replayed = await invokeTool(service, specs[0].name, { file: second, content: 'second note' }, options);
    assert.equal(replayed.result.content, 'second note'); assert.equal(replayed.modelCalls, 0);
    assert.equal(await readFile(second, 'utf8'), 'second note'); assert.equal(await readFile(first, 'utf8'), 'first note');
    await assert.rejects(invokeTool(service, specs[0].name, { file: second, content: 'denied' }, { approve: async () => false }), { code: 'APPROVAL_REQUIRED' });
    assert.equal(await readFile(second, 'utf8'), 'second note');
    await assert.rejects(service.invoke('call', { name: 'mcp:files:delete_file', arguments: {} }, options), { code: 'TOOL_MISSING' });
    await assert.rejects(service.invoke('call', { name: 'mcp:files:read_text_file', arguments: { path: resolve('package.json') } }, options), { code: 'MCP_TOOL_FAILED' });
    const tool = (await service.tools())[0];
    await assert.rejects(upstream.call(tool.name, { path: second, content: 'changed' }, { contract: { ...tool, source: { ...tool.source, version: 'different' } } }), { code: 'TOOL_CHANGED' });
    await service.invoke('stop'); assert.equal(upstream.connections.size, 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.deepEqual(approvals.slice(-4, -1), ['run','step','step']);
  } finally { await service.close(); await rm(root, { recursive: true }); }
});
test('cancelling an unresponsive upstream request closes its owned process', { timeout: 10000 }, async () => {
  const upstream = new UpstreamMCP({ servers: { slow: { command: process.execPath, args: [resolve('test/fixtures/slow-mcp.mjs')], tools: ['wait'] } } });
  try {
    await upstream.connect('slow'); const pid = upstream.connections.get('slow').transport.pid;
    const [contract] = await upstream.tools(); const controller = new AbortController();
    const pending = upstream.call(contract.name, {}, { contract, signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending); clearTimeout(timer); await upstream.close();
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await upstream.close(); }
});
test('explicit upstream config rejects installers, credential values, unknown fields and unbounded tools', () => {
  assert.throws(() => validateConfig({ servers: { files: { command: 'npx', args: [], tools: ['read'] } } }), { code: 'CONFIG' });
  assert.throws(() => validateConfig({ servers: { files: { command: process.execPath, args: [], tools: ['read'], env: { token: 'value' } } } }), { code: 'CONFIG' });
  assert.throws(() => validateConfig({ servers: { files: { command: process.execPath, args: ['Bearer private'], tools: ['read'] } } }), { code: 'SENSITIVE_DATA' });
});
