import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMCPServer } from '../../src/mcp.mjs';
import { RoutineService } from '../../src/service.mjs';
import { WebMCPBrowser } from '../../src/browser.mjs';
import { serveFixture } from '../../src/fixture.mjs';
test('MCP client captures and replays a native browser workflow with fresh elicitation', {timeout:60000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'routinekit-mcp-browser-'));const fixture=await serveFixture();const service=new RoutineService({root,browser:new WebMCPBrowser({headless:true})});const server=createMCPServer(service);
  const client=new Client({name:'integration-test',version:'1.0'},{capabilities:{elicitation:{form:{}}}});let approvals=0;
  client.setRequestHandler(ElicitRequestSchema,async()=>{approvals++;return {action:'accept',content:{approved:true}};});const [a,b]=InMemoryTransport.createLinkedPair();
  async function call(name,args={}){const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true,JSON.stringify(result));return JSON.parse(result.content[0].text);}
  try {
    await Promise.all([server.connect(a),client.connect(b)]);await call('routine_web_open',{url:fixture.url});
    await call('routine_record',{name:'mcp-project',inputs_json:'{"category":"notes"}',tools:['webmcp:catalog_search','webmcp:catalog_open']});
    const first=await call('routine_web_call',{name:'webmcp:catalog_search',arguments_json:'{"category":"notes"}'});
    await call('routine_web_call',{name:'webmcp:catalog_open',arguments_json:JSON.stringify({id:first.items[0].id})});
    await call('routine_save',{checks_json:'[{"step":"step_2","path":"/opened","equals":true}]'});
    const result=await call('routine_run',{name:'mcp-project',inputs_json:'{"category":"drawing"}'});
    assert.equal(result.result.name,'Moss Sketch');assert.equal(result.modelCalls,0);assert.equal(approvals,8);
  } finally {await client.close();await server.close();await service.close();await fixture.close();await rm(root,{recursive:true});}
});
