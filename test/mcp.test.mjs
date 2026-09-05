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

test('real MCP protocol exposes tools and fails closed without human elicitation', async () => {
  const root = await mkdtemp(join(tmpdir(),'routinekit-mcp-test-')); const service = new RoutineService({root}); const server = createMCPServer(service);
  const client = new Client({name:'test-client',version:'1.0'}); const [a,b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a),client.connect(b)]);
    const listed = await client.listTools(); assert.equal(listed.tools.length,12);
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
