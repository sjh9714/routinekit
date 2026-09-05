import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMCPServer } from '../src/mcp.mjs';
import { RoutineService } from '../src/service.mjs';
import { TOOL_SPECS } from '../src/tools.mjs';

test('real MCP protocol exposes tools and fails closed without human elicitation', async () => {
  const root = await mkdtemp(join(tmpdir(),'routinekit-mcp-test-')); const service = new RoutineService({root}); const server = createMCPServer(service);
  const client = new Client({name:'test-client',version:'1.0'}); const [a,b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a),client.connect(b)]);
    const listed = await client.listTools(); assert.equal(listed.tools.length, TOOL_SPECS.length + 1);
    const appTool = listed.tools.find(t => t.name === 'routine_workbench');
    const resource = await client.readResource({ uri: appTool._meta.ui.resourceUri });
    assert.match(resource.contents[0].text, /My routines/); assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    const result = await client.callTool({name:'routine_web_open',arguments:{url:'http://127.0.0.1:9'}}); assert.equal(result.isError,true); assert.match(result.content[0].text,/ELICITATION_REQUIRED/); assert.equal(service.browser.page,undefined);
  } finally { await client.close(); await server.close(); await service.close(); await rm(root,{recursive:true}); }
});
test('MCP elicitation denial never starts a browser', async () => {
  const root = await mkdtemp(join(tmpdir(),'routinekit-mcp-test-')); const service = new RoutineService({root}); const server = createMCPServer(service);
  const client = new Client({name:'test-client',version:'1.0'},{capabilities:{elicitation:{form:{}}}}); const [a,b] = InMemoryTransport.createLinkedPair();
  let asked = false; client.setRequestHandler(ElicitRequestSchema, async () => { asked = true; return {action:'decline'}; });
  try {
    await Promise.all([server.connect(a),client.connect(b)]);
    const result = await client.callTool({name:'routine_web_open',arguments:{url:'http://127.0.0.1:9'}}); assert.equal(result.isError,true); assert.equal(asked,true); assert.equal(service.browser.page,undefined);
  } finally { await client.close(); await server.close(); await service.close(); await rm(root,{recursive:true}); }
});

test('MCP stop settles the original call and sends cancellation for pending elicitation', { timeout: 5000 }, async () => {
  const service = new RoutineService(); const server = createMCPServer(service);
  const client = new Client({name:'test-client',version:'1.0'},{capabilities:{elicitation:{form:{}}}});
  const [a,b] = InMemoryTransport.createLinkedPair();
  let entered, cancelled;
  const ready = new Promise(resolve => { entered = resolve; });
  const closed = new Promise(resolve => { cancelled = resolve; });
  client.setRequestHandler(ElicitRequestSchema, async (_request, extra) => {
    entered();
    return new Promise(resolve => extra.signal.addEventListener('abort', () => resolve({action:'cancel'}), {once:true}));
  });
  try {
    await Promise.all([server.connect(a),client.connect(b)]);
    const receive = b.onmessage;
    b.onmessage = message => { if (message.method === 'notifications/cancelled') cancelled(message.params.requestId); receive(message); };
    const opening = client.callTool({name:'routine_web_open',arguments:{url:'http://127.0.0.1:9'}});
    await ready;
    const stop = await client.callTool({name:'routine_stop',arguments:{}});
    assert.notEqual(stop.isError, true);
    const result = await opening;
    assert.equal(result.isError, true); assert.match(result.content[0].text, /CANCELLED/);
    assert.equal(typeof await closed, 'number');
    assert.equal(service.browser.page, undefined); assert.equal(service.busy, false);
  } finally { await client.close(); await server.close(); await service.close(); }
});
